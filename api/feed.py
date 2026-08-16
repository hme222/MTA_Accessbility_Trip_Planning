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

import math
import os
import threading
import time

import requests

import gtfs_accessibility as ga
from Requests_MTA import rebuild_elevator_status


def _haversine_meters(lat1, lon1, lat2, lon2):
    """Great-circle distance. Straight-line, so always shorter than the walk."""
    radius = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))

# Live outage data is refetched at most this often. The E&E feed updates on the
# order of minutes, and a stale elevator status is worse than a slow one.
OUTAGE_TTL_SECONDS = 120

# Bus service alerts. The .json variant needs no protobuf toolchain and no API
# key. Alerts change less often than elevator status, so a longer TTL.
BUS_ALERTS_URL = (
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fbus-alerts.json"
)
BUS_ALERT_TTL_SECONDS = 300


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

        self._bus = None
        self._bus_at = 0.0
        self._bus_lock = threading.Lock()

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

    def nearby_accessible(self, stop_id, limit=4, direction=None, max_meters=1600):
        """Accessible stations near `stop_id`, nearest first.

        Warning a rider that their station is unusable is only half an answer;
        this supplies the other half. Stations sharing a route with the original
        come first -- a nearby accessible station on an unrelated line rarely
        helps -- and within that, nearest wins.

        Distances are straight-line, which understates the walk. They are
        labeled as such rather than dressed up as walking directions the feed
        cannot actually produce.
        """
        origin = self.station_index().get(stop_id)
        if origin is None or origin["lat"] is None:
            return []

        origin_routes = set(origin["routes"])
        out = []

        for station in self.stations():
            if station["stop_id"] == stop_id or station["lat"] is None:
                continue

            if direction == "N" and not station["northbound"]:
                continue
            if direction == "S" and not station["southbound"]:
                continue
            if direction is None and not (station["northbound"] or station["southbound"]):
                continue

            meters = _haversine_meters(
                origin["lat"], origin["lon"], station["lat"], station["lon"]
            )
            if meters > max_meters:
                continue

            shared = sorted(origin_routes & set(station["routes"]))
            out.append(
                {
                    "stop_id": station["stop_id"],
                    "stop_name": station["stop_name"],
                    "routes": station["routes"],
                    "shared_routes": shared,
                    "northbound": station["northbound"],
                    "southbound": station["southbound"],
                    "reason": station["reason"],
                    "meters": round(meters),
                }
            )

        out.sort(key=lambda s: (not s["shared_routes"], s["meters"]))
        return out[:limit]

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

    # -- bus alerts -------------------------------------------------------

    def bus_alerts(self, force=False):
        """Current MTA bus service alerts.

        Buses matter to this project more than their share of the network
        suggests: every MTA bus is wheelchair accessible -- ramp or lift, plus
        kneeling -- so when a station has no accessible route, the bus usually
        does. That makes bus disruptions an accessibility problem, not a
        footnote.

        The `.json` variant of the feed is used deliberately: the protobuf
        version carries a `mercury_alert` extension that the stock
        gtfs-realtime schema drops silently. As JSON the extension fields are
        ordinary keys, so no protobuf toolchain is needed.
        """
        with self._bus_lock:
            fresh = time.time() - self._bus_at < BUS_ALERT_TTL_SECONDS
            if self._bus is not None and fresh and not force:
                return self._bus

            try:
                response = requests.get(BUS_ALERTS_URL, timeout=20)
                response.raise_for_status()
                payload = response.json()
            except Exception as exc:  # network, JSON, or HTTP failure
                # Serve stale data rather than nothing; a slightly old alert is
                # far more useful to a rider than an error.
                if self._bus is not None:
                    return self._bus
                return {"fetched_at": time.time(), "total": 0, "alerts": [], "error": str(exc)}

            self._bus = self._summarize_bus_alerts(payload)
            self._bus_at = time.time()
            return self._bus

    def _summarize_bus_alerts(self, payload):
        def text_of(block):
            translations = (block or {}).get("translation") or []
            for item in translations:
                if item.get("language", "en").startswith("en") and item.get("text"):
                    return item["text"].strip()
            return translations[0].get("text", "").strip() if translations else ""

        alerts = []
        for entity in payload.get("entity", []):
            alert = entity.get("alert")
            if not alert:
                continue

            routes = sorted(
                {
                    informed.get("route_id")
                    for informed in alert.get("informed_entity", [])
                    if informed.get("route_id")
                }
            )
            if not routes:
                continue

            mercury = alert.get("transit_realtime.mercury_alert", {}) or {}
            alerts.append(
                {
                    "id": entity.get("id", ""),
                    "routes": routes,
                    "header": text_of(alert.get("header_text")),
                    "description": text_of(alert.get("description_text")),
                    # The Mercury extension is where the human-readable
                    # category lives; `effect` is frequently absent here.
                    "alert_type": mercury.get("alert_type", ""),
                    "updated_at": mercury.get("updated_at"),
                }
            )

        alerts.sort(key=lambda a: (len(a["routes"]), a["routes"][0] if a["routes"] else ""))
        return {"fetched_at": time.time(), "total": len(alerts), "alerts": alerts}

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
