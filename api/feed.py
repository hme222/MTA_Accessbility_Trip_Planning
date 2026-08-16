"""In-memory cache over a built accessible feed.

`gtfs_accessibility` reads its tables through `ga.read_table`, so installing
this cache as the active reader makes every existing function -- `plan_trip`,
`accessible_stations`, `trips_serving` -- run against memory instead of disk
without changing a line of their logic.

The whole feed is ~620 MB in pandas and takes about 1.5 s to parse. Paid once at
startup, a trip query then costs ~0.1 s instead of ~2 s.

Tables are handed out by reference, not copied. Callers must treat them as
read-only; every function in `gtfs_accessibility` already does, taking `.copy()`
before it mutates.
"""

import os
import threading
import time

import gtfs_accessibility as ga
from Requests_MTA import rebuild_elevator_status

# Live outage data is refetched at most this often. The E&E feed updates on the
# order of minutes, and a stale elevator status is worse than a slow one.
OUTAGE_TTL_SECONDS = 120


class FeedCache:
    """Holds one built feed in memory and serves it to `gtfs_accessibility`."""

    def __init__(self, gtfs_dir):
        self.gtfs_dir = os.path.expanduser(gtfs_dir)
        self._tables = {}
        self._derived = {}
        self._lock = threading.RLock()
        self.loaded_at = None

        self._outages = None
        self._outages_at = 0.0
        self._outage_lock = threading.Lock()

    # -- reader seam ------------------------------------------------------

    def install(self):
        """Route `gtfs_accessibility`'s feed reads through this cache."""
        ga.set_reader(self.read)
        return self

    def read(self, gtfs_dir, name, **kwargs):
        """Reader compatible with `ga.read_table`.

        A request for a directory this cache does not hold falls through to
        disk, so a caller pointing at a different feed still gets the truth.
        """
        if os.path.expanduser(gtfs_dir) != self.gtfs_dir:
            return ga._read_from_disk(gtfs_dir, name, **kwargs)

        table = self.table(name)
        usecols = kwargs.get("usecols")
        return table[list(usecols)] if usecols else table

    # -- tables -----------------------------------------------------------

    def table(self, name):
        with self._lock:
            if name not in self._tables:
                self._tables[name] = ga._read_from_disk(self.gtfs_dir, name)
            return self._tables[name]

    def exists(self, name):
        return os.path.exists(os.path.join(self.gtfs_dir, name))

    def built_at(self):
        """When this feed was built, as a unix timestamp.

        `stops.txt` is the file the build rewrites with resolved accessibility,
        so its mtime is when the accessibility verdicts in it were true. A rider
        deciding whether to trust an elevator status needs this surfaced -- the
        feed is a snapshot and outages change hourly.
        """
        try:
            return os.path.getmtime(os.path.join(self.gtfs_dir, "stops.txt"))
        except OSError:
            return None

    def warm(self):
        """Parse the large tables up front so the first request is not slow."""
        started = time.time()
        for name in ("stops.txt", "trips.txt", "routes.txt", "accessibility_status.txt"):
            if self.exists(name):
                self.table(name)
        self.table("stop_times.txt")
        self.loaded_at = time.time()
        return self.loaded_at - started

    def reload(self):
        """Drop everything. Use after rebuilding the feed on disk."""
        with self._lock:
            self._tables.clear()
            self._derived.clear()
            self.loaded_at = None

    # -- derived views ----------------------------------------------------

    def _derive(self, key, build):
        with self._lock:
            if key not in self._derived:
                self._derived[key] = build()
            return self._derived[key]

    def stations(self):
        """Parent stations with accessibility resolved, as a list of dicts.

        Joins `stops.txt` (which carries the two encodings) to
        `accessibility_status.txt` (which carries the plain-language reason the
        build arrived at that verdict).
        """
        return self._derive("stations", self._build_stations)

    def _build_stations(self):
        stops = self.table("stops.txt")
        parents = stops[stops["location_type"] == "1"]

        reasons, north, south = {}, {}, {}
        if self.exists("accessibility_status.txt"):
            status = self.table("accessibility_status.txt")
            reasons = dict(zip(status["stop_id"], status["reason"]))
            north = dict(zip(status["stop_id"], status["northbound"]))
            south = dict(zip(status["stop_id"], status["southbound"]))

        platform_wb = dict(zip(stops["stop_id"], stops["wheelchair_boarding"]))
        routes = self.routes_by_station()

        out = []
        for _, row in parents.iterrows():
            sid = row["stop_id"]
            # Prefer the per-direction platform ratings; the status report is a
            # fallback for feeds built before it was written.
            n = platform_wb.get(sid + "N", north.get(sid, "0")) == ga.WB_ACCESSIBLE
            s = platform_wb.get(sid + "S", south.get(sid, "0")) == ga.WB_ACCESSIBLE
            out.append(
                {
                    "stop_id": sid,
                    "stop_name": row["stop_name"],
                    "lat": float(row["stop_lat"]) if row.get("stop_lat") else None,
                    "lon": float(row["stop_lon"]) if row.get("stop_lon") else None,
                    "mta_ada_status": row.get("mta_ada_status") or ga.MTA_NONE,
                    "northbound": n,
                    "southbound": s,
                    "reason": reasons.get(sid, ""),
                    "routes": routes.get(sid, []),
                }
            )
        out.sort(key=lambda st: st["stop_name"])
        return out

    def routes_by_station(self):
        """Map parent station id -> sorted route ids calling there."""
        return self._derive("routes_by_station", self._build_routes_by_station)

    def _build_routes_by_station(self):
        stops = self.table("stops.txt")
        children = stops[stops["parent_station"].notna()]
        parent_of = dict(zip(children["stop_id"], children["parent_station"]))

        stop_times = self.table("stop_times.txt")[["trip_id", "stop_id"]]
        trips = self.table("trips.txt")[["trip_id", "route_id"]]

        hits = stop_times[stop_times["stop_id"].isin(parent_of)].copy()
        hits["station_id"] = hits["stop_id"].map(parent_of)
        merged = hits.merge(trips, on="trip_id")

        grouped = merged.groupby("station_id")["route_id"].unique()
        return {sid: sorted(rs) for sid, rs in grouped.items()}

    def station_index(self):
        return self._derive(
            "station_index", lambda: {st["stop_id"]: st for st in self.stations()}
        )

    # -- live outages -----------------------------------------------------

    def outages(self, force=False):
        """Current elevator/escalator outages, refetched at most every TTL."""
        with self._outage_lock:
            fresh = time.time() - self._outages_at < OUTAGE_TTL_SECONDS
            if self._outages is not None and fresh and not force:
                return self._outages

            equipment = rebuild_elevator_status()
            self._outages = self._summarize_outages(equipment)
            self._outages_at = time.time()
            return self._outages

    def _summarize_outages(self, equipment):
        """Reduce the equipment database to what a rider needs to see.

        Reuses `outage_impact` so the blocking-vs-degraded rule stays in one
        place: escalators and redundant elevators never count as blocking.
        """
        impact = ga.outage_impact(equipment)
        names = {st["stop_id"]: st["stop_name"] for st in self.stations()}

        items = []
        for eq_id, entry in equipment.items():
            if entry["status"] != "OUT_OF_SERVICE":
                continue
            eq = entry["details"]
            station_ids = ga.split_gtfs_ids(eq.get("elevatorsgtfsstopid"))
            detail = entry["active_outage_details"] or {}
            is_elevator = eq.get("equipmenttype") == "EL"
            blocking = any(eq_id in impact.get(s, {}).get("blocking", []) for s in station_ids)

            items.append(
                {
                    "equipment": eq_id,
                    "type": "elevator" if is_elevator else "escalator",
                    "station_ids": station_ids,
                    "station_names": [names.get(s, "") for s in station_ids],
                    "serving": eq.get("serving", ""),
                    "ada": eq.get("ADA") == "Y",
                    "redundant": bool(eq.get("redundant")),
                    "blocking": blocking,
                    "reason": detail.get("reason", ""),
                    "outage_date": detail.get("outagedate", ""),
                    "estimated_return": detail.get("estimatedreturntoservice", ""),
                }
            )

        items.sort(key=lambda i: (not i["blocking"], i["equipment"]))
        return {
            "fetched_at": time.time(),
            "total": len(items),
            "blocking": sum(1 for i in items if i["blocking"]),
            "outages": items,
        }
