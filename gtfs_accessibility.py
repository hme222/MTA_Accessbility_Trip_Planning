"""Augment the MTA static GTFS feed with directional accessibility.

Combines two sources:

  * MTA Subway Stations (data.ny.gov) -- the static ADA baseline, including the
    per-direction `ada_northbound` / `ada_southbound` flags.
  * MTA Elevator & Escalator API -- live outages, which can knock a station
    below its baseline.

Accessibility is written twice, deliberately:

  * `wheelchair_boarding` uses GTFS semantics (1 = accessible, 2 = not), applied
    per directional platform. This is what trip planners read.
  * `mta_ada_status` uses the MTA convention (0 = none, 1 = full, 2 = partial),
    preserved verbatim on the parent station.

These two encodings disagree on the value 2, which is why they do not share a
column. See README.md.
"""

import csv
import os
import re
import shutil
import zipfile

import pandas as pd
import requests

from Requests_MTA import rebuild_elevator_status

STATIONS_URL = "https://data.ny.gov/resource/39hk-dx4f.json"


def _read_from_disk(gtfs_dir, name, **kwargs):
    kwargs.setdefault("dtype", str)
    return pd.read_csv(os.path.join(gtfs_dir, name), **kwargs)


# Every feed file is read through this seam so a long-running caller can serve
# the same tables from memory. stop_times.txt alone is 133 MB and 2.3M rows --
# re-parsing it per request is fine for a one-shot build and far too slow for an
# API. Left as plain disk reads by default; see api/feed.py for the cached one.
_reader = _read_from_disk


def set_reader(reader):
    """Substitute the feed-file reader. `reader(gtfs_dir, name, **kwargs)`.

    Pass None to restore plain disk reads.
    """
    global _reader
    _reader = reader or _read_from_disk


def read_table(gtfs_dir, name, **kwargs):
    """Read a feed file through the active reader."""
    return _reader(gtfs_dir, name, **kwargs)

# GTFS stops.wheelchair_boarding
WB_INHERIT = "0"          # child stops only: defer to parent station
WB_ACCESSIBLE = "1"
WB_NOT_ACCESSIBLE = "2"

# MTA convention (mta_ada_status)
MTA_NONE = "0"
MTA_FULL = "1"
MTA_PARTIAL = "2"


def fetch_station_ada():
    """Fetch the static per-direction ADA baseline, keyed by GTFS parent stop_id."""
    print("Fetching MTA station ADA baseline...")
    response = requests.get(STATIONS_URL, params={"$limit": 2000})
    response.raise_for_status()

    baseline = {}
    for row in response.json():
        baseline[row["gtfs_stop_id"]] = {
            "stop_name": row.get("stop_name", ""),
            "north": row.get("ada_northbound") == "1",
            "south": row.get("ada_southbound") == "1",
            "north_label": row.get("north_direction_label", ""),
            "south_label": row.get("south_direction_label", ""),
        }
    return baseline


def split_gtfs_ids(raw):
    """Split an `elevatorsgtfsstopid` value into GTFS parent station IDs.

    Station complexes are encoded as 'A31/L01' or '132/D19/L02'.
    """
    return [p.strip() for p in re.split(r"[,/;]", raw or "") if p.strip()]


def outage_impact(equipment_db):
    """Find stations whose accessible route is currently broken.

    Only elevators matter -- an escalator is not a step-free path, so its outage
    is recorded but never downgrades a station. An elevator flagged `redundant`
    has a parallel unit covering the same path, so it does not downgrade either.

    Returns {gtfs_stop_id: {'blocking': [...], 'degraded': [...]}}.
    """
    impact = {}

    for eq_id, entry in equipment_db.items():
        if entry["status"] != "OUT_OF_SERVICE":
            continue
        eq = entry["details"]

        # `isactive` == 'N' means decommissioned, not merely down.
        is_ada_elevator = (
            eq.get("equipmenttype") == "EL"
            and eq.get("ADA") == "Y"
            and eq.get("isactive") == "Y"
        )
        if not is_ada_elevator:
            continue

        bucket = "degraded" if eq.get("redundant") else "blocking"
        for stop_id in split_gtfs_ids(eq.get("elevatorsgtfsstopid")):
            rec = impact.setdefault(stop_id, {"blocking": [], "degraded": []})
            rec[bucket].append(eq_id)

    return impact


def upcoming_impact(equipment_db):
    """Find ADA elevators with scheduled future outages, keyed by station.

    A platform that is step-free right now but loses its elevator tonight is a
    return-trip hazard even though every current-state check passes.
    """
    upcoming = {}

    for eq_id, entry in equipment_db.items():
        if not entry["upcoming_outages"]:
            continue
        eq = entry["details"]
        is_ada_elevator = (
            eq.get("equipmenttype") == "EL"
            and eq.get("ADA") == "Y"
            and eq.get("isactive") == "Y"
        )
        if not is_ada_elevator or eq.get("redundant"):
            continue

        for outage in entry["upcoming_outages"]:
            for stop_id in split_gtfs_ids(eq.get("elevatorsgtfsstopid")):
                upcoming.setdefault(stop_id, []).append(
                    {
                        "equipment": eq_id,
                        "from": outage.get("outagedate", ""),
                        "to": outage.get("estimatedreturntoservice", ""),
                        "reason": outage.get("reason", ""),
                    }
                )

    return upcoming


def resolve_accessibility(baseline, impact, upcoming=None):
    """Combine the static baseline with live outages into a per-station verdict.

    The E&E feed does not map an elevator to a single direction of travel, so a
    blocking outage conservatively knocks out both directions at that station.
    """
    resolved = {}
    upcoming = upcoming or {}

    for stop_id, base in baseline.items():
        hit = impact.get(stop_id, {"blocking": [], "degraded": []})
        scheduled = upcoming.get(stop_id, [])
        blocked = bool(hit["blocking"])

        north = base["north"] and not blocked
        south = base["south"] and not blocked

        if north and south:
            mta_status = MTA_FULL
        elif north or south:
            mta_status = MTA_PARTIAL
        else:
            mta_status = MTA_NONE

        if not (base["north"] or base["south"]):
            reason = "no ADA access at this station"
        elif blocked:
            reason = "ADA elevator(s) out of service: " + ", ".join(
                sorted(hit["blocking"])
            )
        elif hit["degraded"]:
            reason = "redundant elevator(s) down, accessible route intact: " + ", ".join(
                sorted(hit["degraded"])
            )
        elif mta_status == MTA_PARTIAL:
            open_dir = base["north_label"] if north else base["south_label"]
            reason = "accessible %sbound only (toward %s)" % (
                "north" if north else "south",
                open_dir,
            )
        else:
            reason = "fully accessible, all ADA elevators in service"

        resolved[stop_id] = {
            "stop_id": stop_id,
            "stop_name": base["stop_name"],
            "north": north,
            "south": south,
            "mta_ada_status": mta_status,
            "baseline_partial": base["north"] != base["south"],
            "blocked_by_outage": blocked,
            "upcoming_outages": scheduled,
            "reason": reason,
        }

    return resolved


def augment_stops(stops, resolved):
    """Write both encodings into stops.txt.

    Directional platforms carry the GTFS rating for their own direction, which
    is how partial accessibility is expressed in-spec. The parent station is
    marked accessible when either direction is usable.
    """
    stops = stops.copy()
    is_parent = stops["location_type"] == "1"

    def rating_for(row):
        if row["location_type"] == "1":
            st = resolved.get(row["stop_id"])
            if st is None:
                return WB_NOT_ACCESSIBLE
            return WB_ACCESSIBLE if (st["north"] or st["south"]) else WB_NOT_ACCESSIBLE

        st = resolved.get(row["parent_station"])
        if st is None:
            return WB_INHERIT
        usable = st["north"] if row["stop_id"].endswith("N") else st["south"]
        return WB_ACCESSIBLE if usable else WB_NOT_ACCESSIBLE

    stops["wheelchair_boarding"] = stops.apply(rating_for, axis=1)

    mta = {sid: st["mta_ada_status"] for sid, st in resolved.items()}
    stops["mta_ada_status"] = ""
    stops.loc[is_parent, "mta_ada_status"] = (
        stops.loc[is_parent, "stop_id"].map(mta).fillna(MTA_NONE)
    )
    return stops


def accessible_stations(gtfs_dir, direction=None):
    """Return parent station IDs usable in `direction` ('N', 'S', or None=either)."""
    stops = read_table(gtfs_dir, "stops.txt")
    if direction is None:
        parents = stops[stops["location_type"] == "1"]
        return set(parents.loc[parents["wheelchair_boarding"] == WB_ACCESSIBLE, "stop_id"])

    children = stops[stops["stop_id"].str.endswith(direction) & stops["parent_station"].notna()]
    return set(children.loc[children["wheelchair_boarding"] == WB_ACCESSIBLE, "parent_station"])


def trips_serving(gtfs_dir, station_ids, require_step_free=False):
    """Return trips calling at every station in `station_ids`, with advisories.

    Accessibility annotates but never excludes: a trip through a platform that
    is not accessible is still returned, carrying `platform_step_free` and
    `return_step_free` flags so the caller can warn rather than hide it. Riders
    have their own workarounds -- a companion, a transfer, a bus leg -- and the
    feed is not in a position to decide the trip is impossible.

    `require_step_free=True` opts in to hard filtering, for callers that
    genuinely need a guaranteed-accessible subset.
    """
    stops = read_table(gtfs_dir, "stops.txt")
    children = stops[stops["parent_station"].isin(station_ids)]

    parent_of = dict(zip(children["stop_id"], children["parent_station"]))
    step_free = dict(zip(children["stop_id"], children["wheelchair_boarding"]))

    stop_times = read_table(
        gtfs_dir,
        "stop_times.txt",
        usecols=["trip_id", "stop_id", "departure_time", "stop_sequence"],
    )
    hits = stop_times[stop_times["stop_id"].isin(parent_of)].copy()
    hits["station_id"] = hits["stop_id"].map(parent_of)

    # Completeness is judged on the itinerary, not on accessibility.
    per_trip = hits.groupby("trip_id")["station_id"].nunique()
    complete = per_trip[per_trip == len(set(station_ids))].index
    hits = hits[hits["trip_id"].isin(complete)].copy()

    hits["platform_step_free"] = (
        hits["stop_id"].map(step_free).eq(WB_ACCESSIBLE).map({True: "1", False: "0"})
    )
    opposite = hits["station_id"] + hits["stop_id"].str[-1].map({"N": "S", "S": "N"})
    hits["return_step_free"] = (
        opposite.map(step_free).eq(WB_ACCESSIBLE).map({True: "1", False: "0"})
    )

    if require_step_free:
        hits = hits[hits["platform_step_free"] == "1"]
        per_trip = hits.groupby("trip_id")["station_id"].nunique()
        hits = hits[hits["trip_id"].isin(per_trip[per_trip == len(set(station_ids))].index)]

    hits["stop_sequence"] = hits["stop_sequence"].astype(int)
    trips = read_table(gtfs_dir, "trips.txt")
    return hits.merge(trips, on="trip_id").sort_values(["trip_id", "stop_sequence"])


def active_services(gtfs_dir, date):
    """Return service_ids running on `date` (a 'YYYYMMDD' string).

    Applies calendar.txt's weekday pattern, then calendar_dates.txt exceptions
    (type 1 adds a service, type 2 removes it).
    """
    weekday = [
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
    ][pd.Timestamp(date).dayofweek]

    services = set()
    calendar_path = os.path.join(gtfs_dir, "calendar.txt")
    if os.path.exists(calendar_path):
        cal = read_table(gtfs_dir, "calendar.txt")
        in_range = (cal["start_date"] <= date) & (cal["end_date"] >= date)
        services = set(cal.loc[in_range & (cal[weekday] == "1"), "service_id"])

    exceptions_path = os.path.join(gtfs_dir, "calendar_dates.txt")
    if os.path.exists(exceptions_path):
        exc = read_table(gtfs_dir, "calendar_dates.txt")
        today = exc[exc["date"] == date]
        services |= set(today.loc[today["exception_type"] == "1", "service_id"])
        services -= set(today.loc[today["exception_type"] == "2", "service_id"])

    return services


def plan_trip(gtfs_dir, origin, destination, date=None, after=None, limit=None):
    """Plan origin -> destination, returning every option with its advisories.

    Nothing is filtered out for accessibility. Each trip carries a `severity`
    and a plain-language `advisories` string describing what a rider needs to
    know: whether they can board, whether they can get off, and whether they can
    get back.

    `date` ('YYYYMMDD') restricts to services actually running that day, and
    `after` ('HH:MM:SS') to departures from then on -- these are scheduling
    filters, not accessibility ones.
    """
    served = trips_serving(gtfs_dir, [origin, destination])
    if served.empty:
        return served

    if date is not None:
        served = served[served["service_id"].isin(active_services(gtfs_dir, date))]
        if served.empty:
            return served.iloc[0:0]

    board = served[served["station_id"] == origin].set_index("trip_id")
    alight = served[served["station_id"] == destination].set_index("trip_id")

    # Keep only trips where the origin actually precedes the destination.
    common = board.index.intersection(alight.index)
    forward = [t for t in common if board.loc[t, "stop_sequence"] < alight.loc[t, "stop_sequence"]]

    stops = read_table(gtfs_dir, "stops.txt")
    names = dict(zip(stops["stop_id"], stops["stop_name"]))

    rows = []
    for trip_id in forward:
        b, a = board.loc[trip_id], alight.loc[trip_id]
        notes = []

        if b["platform_step_free"] != "1":
            notes.append("no accessible boarding at %s" % names.get(origin, origin))
        if a["platform_step_free"] != "1":
            notes.append("no accessible exit at %s" % names.get(destination, destination))
        if a["return_step_free"] != "1":
            notes.append(
                "return trip from %s is not accessible" % names.get(destination, destination)
            )

        if not notes:
            severity = "step_free"
        elif b["platform_step_free"] != "1" or a["platform_step_free"] != "1":
            severity = "outbound_warning"
        else:
            severity = "return_warning"

        rows.append(
            {
                "trip_id": trip_id,
                "route_id": b["route_id"],
                "direction_id": b["direction_id"],
                "trip_headsign": b["trip_headsign"],
                "depart": b["departure_time"],
                "arrive": a["departure_time"],
                "service_id": b["service_id"],
                "severity": severity,
                "advisories": "; ".join(notes),
            }
        )

    plan = pd.DataFrame(rows).sort_values("depart").reset_index(drop=True)
    if after is not None:
        plan = plan[plan["depart"] >= after]  # GTFS times sort lexically past 24:00:00
    if limit is not None:
        plan = plan.head(limit)
    return plan.reset_index(drop=True)


def platform_return_risks(stops, resolved):
    """Identify platforms a rider can reach but cannot depart from in reverse.

    A trip in direction_id 0 calls only at 'N' platforms, direction_id 1 only at
    'S' -- so the return leg for any stop is that station's opposite platform.
    Two hazards are distinguished:

      one_way_trap        the opposite platform has no accessible route at all
      return_outage_soon  the opposite platform works now but its ADA elevator
                          has a scheduled outage
    """
    children = stops[stops["parent_station"].notna()]
    boarding = dict(zip(children["stop_id"], children["wheelchair_boarding"]))
    parent_of = dict(zip(children["stop_id"], children["parent_station"]))
    name_of = dict(zip(children["stop_id"], children["stop_name"]))

    risks = {}
    for stop_id, station in parent_of.items():
        if boarding.get(stop_id) != WB_ACCESSIBLE:
            continue  # not reachable this way in the first place

        opposite = station + ("S" if stop_id.endswith("N") else "N")
        arrive_dir = "north" if stop_id.endswith("N") else "south"
        return_dir = "south" if stop_id.endswith("N") else "north"

        if boarding.get(opposite) == WB_NOT_ACCESSIBLE:
            risks[stop_id] = {
                "stop_id": stop_id,
                "station_id": station,
                "stop_name": name_of[stop_id],
                "risk": "one_way_trap",
                "detail": "reachable %sbound; no accessible %sbound return"
                % (arrive_dir, return_dir),
            }
            continue

        scheduled = resolved.get(station, {}).get("upcoming_outages", [])
        if scheduled:
            windows = "; ".join(
                "%s (%s to %s)" % (o["equipment"], o["from"], o["to"])
                for o in scheduled
            )
            risks[stop_id] = {
                "stop_id": stop_id,
                "station_id": station,
                "stop_name": name_of[stop_id],
                "risk": "return_outage_soon",
                "detail": "%sbound return at risk, scheduled outage: %s"
                % (return_dir, windows),
            }

    return risks


def trip_return_risks(gtfs_dir, stops, resolved):
    """Annotate every trip with the return hazards along its route."""
    risks = platform_return_risks(stops, resolved)

    stop_times = read_table(
        gtfs_dir,
        "stop_times.txt",
        usecols=["trip_id", "stop_id", "arrival_time", "stop_sequence"],
    )
    hits = stop_times[stop_times["stop_id"].isin(risks)].copy()
    if hits.empty:
        return pd.DataFrame(
            columns=["trip_id", "stop_id", "station_id", "stop_name", "risk", "detail"]
        )

    for field in ("station_id", "stop_name", "risk", "detail"):
        hits[field] = hits["stop_id"].map(lambda s: risks[s][field])

    trips = read_table(gtfs_dir, "trips.txt")
    detail = hits.merge(trips[["trip_id", "route_id", "direction_id"]], on="trip_id")
    detail["stop_sequence"] = detail["stop_sequence"].astype(int)
    return detail.sort_values(["trip_id", "stop_sequence"])


def annotate_trips(trips, detail):
    """Add return-risk summary columns to trips.txt."""
    trips = trips.copy()
    if detail.empty:
        trips["return_risk"] = "0"
        trips["return_risk_stops"] = ""
        return trips

    worst = detail.groupby("trip_id")["risk"].apply(
        lambda r: "one_way_trap" if "one_way_trap" in set(r) else "return_outage_soon"
    )
    stops_hit = detail.groupby("trip_id")["station_id"].apply(
        lambda s: " ".join(sorted(set(s)))
    )

    trips["return_risk"] = trips["trip_id"].map(worst).fillna("")
    trips["return_risk_stops"] = trips["trip_id"].map(stops_hit).fillna("")
    return trips


def build(gtfs_dir, out_dir, zip_output=True):
    """Write an augmented copy of the feed at `gtfs_dir` into `out_dir`."""
    baseline = fetch_station_ada()
    equipment_db = rebuild_elevator_status()
    resolved = resolve_accessibility(
        baseline, outage_impact(equipment_db), upcoming_impact(equipment_db)
    )

    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)

    for name in os.listdir(gtfs_dir):
        if name.endswith(".txt"):
            shutil.copy2(os.path.join(gtfs_dir, name), os.path.join(out_dir, name))

    stops = pd.read_csv(os.path.join(gtfs_dir, "stops.txt"), dtype=str)
    augmented = augment_stops(stops, resolved)
    augmented.to_csv(
        os.path.join(out_dir, "stops.txt"), index=False, quoting=csv.QUOTE_MINIMAL
    )

    report = pd.DataFrame(
        [
            {
                "stop_id": st["stop_id"],
                "stop_name": st["stop_name"],
                "mta_ada_status": st["mta_ada_status"],
                "northbound": "1" if st["north"] else "0",
                "southbound": "1" if st["south"] else "0",
                "blocked_by_outage": "1" if st["blocked_by_outage"] else "0",
                "reason": st["reason"],
            }
            for st in resolved.values()
        ]
    ).sort_values("stop_id")
    report.to_csv(os.path.join(out_dir, "accessibility_status.txt"), index=False)

    detail = trip_return_risks(gtfs_dir, augmented, resolved)
    detail.to_csv(os.path.join(out_dir, "trip_return_risk.txt"), index=False)

    trips = pd.read_csv(os.path.join(gtfs_dir, "trips.txt"), dtype=str)
    annotate_trips(trips, detail).to_csv(
        os.path.join(out_dir, "trips.txt"), index=False, quoting=csv.QUOTE_MINIMAL
    )

    counts = report["mta_ada_status"].value_counts()
    print("\n--- Augmented feed (mta_ada_status) ---")
    print("  1 fully accessible:     %3d" % counts.get(MTA_FULL, 0))
    print("  2 partially accessible: %3d" % counts.get(MTA_PARTIAL, 0))
    print("  0 not accessible:       %3d" % counts.get(MTA_NONE, 0))

    downgraded = report[report["blocked_by_outage"] == "1"]
    print("\nStations downgraded by live outages: %d" % len(downgraded))
    for _, row in downgraded.iterrows():
        print("  %-6s %-30s %s" % (row.stop_id, row.stop_name[:30], row.reason))

    partial = report[(report["mta_ada_status"] == MTA_PARTIAL) & (report["blocked_by_outage"] == "0")]
    print("\nBaseline partial (one direction only): %d" % len(partial))
    for _, row in partial.iterrows():
        print("  %-6s %-30s %s" % (row.stop_id, row.stop_name[:30], row.reason))

    print("\n--- Return-trip risk ---")
    if detail.empty:
        print("  no trips carry a return hazard")
    else:
        flagged = detail["trip_id"].nunique()
        print("  trips flagged: %d of %d" % (flagged, len(trips)))
        for risk, group in detail.groupby("risk"):
            print("  %-19s %6d trips, %d platforms"
                  % (risk, group["trip_id"].nunique(), group["stop_id"].nunique()))
        print()
        summary = detail.drop_duplicates("stop_id")[["stop_id", "stop_name", "risk", "detail"]]
        for _, row in summary.iterrows():
            print("  %-6s %-26s %s" % (row.stop_id, row.stop_name[:26], row.detail[:80]))

    if zip_output:
        archive = out_dir.rstrip("/") + ".zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
            for name in sorted(os.listdir(out_dir)):
                zf.write(os.path.join(out_dir, name), name)
        print("\nWrote %s" % archive)

    return out_dir


if __name__ == "__main__":
    build(
        gtfs_dir=os.path.expanduser("~/Downloads/gtfs_supplemented"),
        out_dir=os.path.expanduser("~/Downloads/gtfs_accessible"),
    )
