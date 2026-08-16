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


def gtfs_seconds(value):
    """'25:14:30' -> seconds past midnight. GTFS hours pass 24 after midnight."""
    hours, minutes, seconds = (int(part) for part in value.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def transfer_graph(gtfs_dir):
    """Map parent station -> [(reachable station, minimum transfer seconds)].

    `transfers.txt` carries two kinds of row, and they mean different things:

      * `from == to` -- changing trains inside one station complex.
      * `from != to` -- an in-system passageway between two complexes, such as
        59 St-Columbus Circle's IRT and IND halves.

    Every NYC row is `transfer_type=2`, a minimum time rather than a guarantee.
    A station with no self-transfer row still permits a same-platform change, so
    it gets a default.
    """
    graph = {}
    transfers = read_table(gtfs_dir, "transfers.txt")

    for row in transfers.itertuples(index=False):
        seconds = int(row.min_transfer_time) if str(row.min_transfer_time).isdigit() else 180
        graph.setdefault(row.from_stop_id, []).append((row.to_stop_id, seconds))

    return graph


# A transfer inside one complex when the feed lists no explicit time for it.
DEFAULT_TRANSFER_SECONDS = 180


def station_complexes(gtfs_dir):
    """Group parent stations that a rider experiences as one station.

    GTFS gives 14 St-Union Sq three parent stations -- `L03` for the L, `R20`
    for the N/Q/R/W, `635` for the 4/5/6 -- but nobody arranges to meet at
    "R20". Planning to one of them alone discards every route that arrives on a
    different platform of the same station, which is most of them.

    The cross-station rows of `transfers.txt` are exactly this grouping: an
    in-system passageway between two parents. Following them transitively
    yields the complex.

    Returns {parent_station: frozenset(all parents in its complex)}.
    """
    adjacency = {}
    transfers = read_table(gtfs_dir, "transfers.txt")

    for row in transfers.itertuples(index=False):
        if row.from_stop_id == row.to_stop_id:
            continue
        adjacency.setdefault(row.from_stop_id, set()).add(row.to_stop_id)
        adjacency.setdefault(row.to_stop_id, set()).add(row.from_stop_id)

    complexes = {}
    for start in adjacency:
        if start in complexes:
            continue
        # Flood fill: complexes chain (Times Sq reaches 42 St-Port Authority).
        group, queue = set(), [start]
        while queue:
            node = queue.pop()
            if node in group:
                continue
            group.add(node)
            queue.extend(adjacency.get(node, ()))
        frozen = frozenset(group)
        for member in group:
            complexes[member] = frozen

    return complexes


def complex_of(gtfs_dir, station_id):
    """Every parent station a rider would call by the same name."""
    return sorted(station_complexes(gtfs_dir).get(station_id, {station_id}))


def _leg_candidates(gtfs_dir, station_ids, services, stops):
    """Trips calling at `station_ids`, with each call's time and position."""
    children = stops[stops["parent_station"].isin(station_ids)]
    parent_of = dict(zip(children["stop_id"], children["parent_station"]))

    stop_times = read_table(
        gtfs_dir,
        "stop_times.txt",
        usecols=["trip_id", "stop_id", "arrival_time", "departure_time", "stop_sequence"],
    )
    hits = stop_times[stop_times["stop_id"].isin(parent_of)].copy()
    if hits.empty:
        return hits, stop_times

    hits["station_id"] = hits["stop_id"].map(parent_of)
    hits["stop_sequence"] = hits["stop_sequence"].astype(int)

    trips = read_table(gtfs_dir, "trips.txt")
    hits = hits.merge(trips, on="trip_id")
    if services is not None:
        hits = hits[hits["service_id"].isin(services)]

    return hits, stop_times


def plan_trip_with_transfer(
    gtfs_dir,
    origin,
    destination,
    date=None,
    after=None,
    limit=None,
    max_wait_seconds=3600,
    window_seconds=5400,
):
    """Plan origin -> destination allowing one change of train.

    Direct trips are the job of `plan_trip`; this covers what it cannot reach.
    That matters more here than in an ordinary planner: only 140 of 496 stations
    are fully accessible, so a large share of usable journeys *require* a change.

    Accessibility is judged at four platforms, not one -- board at the origin,
    alight at the transfer, board again, alight at the destination -- plus the
    return leg. A single inaccessible platform anywhere breaks the journey, so
    each is reported separately rather than collapsed into one verdict.

    **What the feed cannot say.** GTFS does not record whether the connection
    *inside* a station is step-free. For a change within one complex, both
    platforms being accessible is treated as sufficient, which is an inference
    and not a fact. For a passageway between two complexes it is not even that,
    so those carry an explicit "connection not verified" advisory. As everywhere
    else here, the uncertainty is surfaced rather than resolved by guessing.
    """
    stops = read_table(gtfs_dir, "stops.txt")
    services = active_services(gtfs_dir, date) if date is not None else None

    # A rider names a station, not a platform group, so both ends cover the
    # whole complex -- otherwise every route arriving on a different line's
    # platform of the same station is discarded.
    origin_group = complex_of(gtfs_dir, origin)
    destination_group = complex_of(gtfs_dir, destination)

    boarding, stop_times = _leg_candidates(gtfs_dir, origin_group, services, stops)
    alighting, _ = _leg_candidates(gtfs_dir, destination_group, services, stops)
    if boarding.empty or alighting.empty:
        return pd.DataFrame()

    # Only boardings inside the requested window. Without this the search walks
    # every departure for the rest of the service day -- tens of thousands of
    # trips at a hub like Times Sq -- to rank options nobody asked for.
    after_seconds = gtfs_seconds(after) if after else 0
    depart_seconds = boarding["departure_time"].map(gtfs_seconds)
    boarding = boarding[
        (depart_seconds >= after_seconds) & (depart_seconds <= after_seconds + window_seconds)
    ]
    if boarding.empty:
        return pd.DataFrame()

    # Everything downstream of each origin boarding, and everything upstream of
    # each destination alighting. The transfer must appear in both.
    stop_times = stop_times.copy()
    stop_times["stop_sequence"] = stop_times["stop_sequence"].astype(int)
    child_parent = dict(
        zip(
            stops.loc[stops["parent_station"].notna(), "stop_id"],
            stops.loc[stops["parent_station"].notna(), "parent_station"],
        )
    )

    first = stop_times[stop_times["trip_id"].isin(set(boarding["trip_id"]))].copy()
    second = stop_times[stop_times["trip_id"].isin(set(alighting["trip_id"]))].copy()
    first["station_id"] = first["stop_id"].map(child_parent)
    second["station_id"] = second["stop_id"].map(child_parent)

    board_seq = dict(zip(boarding["trip_id"], boarding["stop_sequence"]))
    board_time = dict(zip(boarding["trip_id"], boarding["departure_time"]))
    board_stop = dict(zip(boarding["trip_id"], boarding["stop_id"]))

    alight_seq = dict(zip(alighting["trip_id"], alighting["stop_sequence"]))
    alight_time = dict(zip(alighting["trip_id"], alighting["arrival_time"]))
    alight_stop = dict(zip(alighting["trip_id"], alighting["stop_id"]))

    first = first[first["stop_sequence"] > first["trip_id"].map(board_seq)]
    second = second[second["stop_sequence"] < second["trip_id"].map(alight_seq)]

    # A connecting train cannot depart before the first one leaves, nor later
    # than the window plus the longest wait worth showing.
    horizon = after_seconds + window_seconds + max_wait_seconds
    second_departs = second["departure_time"].map(gtfs_seconds)
    second = second[(second_departs >= after_seconds) & (second_departs <= horizon)]
    if first.empty or second.empty:
        return pd.DataFrame()

    graph = transfer_graph(gtfs_dir)
    trips_table = read_table(gtfs_dir, "trips.txt")
    route_of = dict(zip(trips_table["trip_id"], trips_table["route_id"]))
    headsign_of = dict(zip(trips_table["trip_id"], trips_table["trip_headsign"]))
    names = dict(zip(stops["stop_id"], stops["stop_name"]))
    boarding_flag = dict(zip(stops["stop_id"], stops["wheelchair_boarding"]))

    # Where leg two can be joined, keyed by station, kept in departure order.
    joinable = {}
    for row in second.itertuples(index=False):
        joinable.setdefault(row.station_id, []).append(row)
    for station in joinable:
        joinable[station].sort(key=lambda r: gtfs_seconds(r.departure_time))

    origin_set = set(origin_group)
    destination_set = set(destination_group)

    rows = []
    seen = set()
    for arrival in first.itertuples(index=False):
        if arrival.station_id is None or arrival.station_id in destination_set:
            continue
        if arrival.station_id in origin_set:
            continue  # still at the start; not a transfer yet

        arrive_seconds = gtfs_seconds(arrival.arrival_time)

        # Change here, or walk to a linked complex.
        options = [(arrival.station_id, DEFAULT_TRANSFER_SECONDS)]
        options += [(to, secs) for to, secs in graph.get(arrival.station_id, [])]

        for transfer_station, min_seconds in options:
            for departure in joinable.get(transfer_station, ()):
                wait = gtfs_seconds(departure.departure_time) - arrive_seconds
                if wait < min_seconds:
                    continue
                if wait > max_wait_seconds:
                    break  # sorted by time; everything later waits longer
                if departure.trip_id == arrival.trip_id:
                    continue  # same train is a direct trip, not a transfer

                key = (arrival.trip_id, departure.trip_id, transfer_station)
                if key in seen:
                    continue
                seen.add(key)

                rows.append(
                    _describe_transfer(
                        arrival,
                        departure,
                        transfer_station,
                        wait,
                        origin,
                        destination,
                        route_of,
                        headsign_of,
                        names,
                        boarding_flag,
                        board_time,
                        board_stop,
                        alight_time,
                        alight_stop,
                    )
                )

    if not rows:
        return pd.DataFrame()

    plan = pd.DataFrame(rows).sort_values(["arrive", "depart"]).reset_index(drop=True)
    # One option per pair of routes and transfer point; a dozen departures of
    # the same combination is noise, not choice.
    plan = plan.drop_duplicates(subset=["route_1", "route_2", "transfer_station"], keep="first")
    if limit is not None:
        plan = plan.head(limit)
    return plan.reset_index(drop=True)


def _describe_transfer(
    arrival,
    departure,
    transfer_station,
    wait,
    origin,
    destination,
    route_of,
    headsign_of,
    names,
    boarding_flag,
    board_time,
    board_stop,
    alight_time,
    alight_stop,
):
    """Turn one leg pair into a row, with the accessibility of all four platforms."""

    platforms = {
        "board": board_stop[arrival.trip_id],
        "transfer_in": arrival.stop_id,
        "transfer_out": departure.stop_id,
        "alight": alight_stop[departure.trip_id],
    }
    ok = {k: boarding_flag.get(v) == WB_ACCESSIBLE for k, v in platforms.items()}

    # The return leg from the destination is the opposite platform.
    dest_platform = platforms["alight"]
    opposite = destination + ("S" if dest_platform.endswith("N") else "N")
    return_ok = boarding_flag.get(opposite) == WB_ACCESSIBLE

    notes = []
    if not ok["board"]:
        notes.append("no accessible boarding at %s" % names.get(origin, origin))
    if not ok["transfer_in"] or not ok["transfer_out"]:
        notes.append(
            "changing trains at %s is not accessible"
            % names.get(transfer_station, transfer_station)
        )
    if not ok["alight"]:
        notes.append("no accessible exit at %s" % names.get(destination, destination))
    if not return_ok:
        notes.append("return trip from %s is not accessible" % names.get(destination, destination))

    # Every cross-station row in transfers.txt is an in-system connection
    # within one complex, so this is never "a different station" -- it is a
    # walk between platform groups that GTFS happens to name differently. The
    # A arrives at "14 St" and the L boards at "8 Av"; same building.
    from_name = names.get(arrival.station_id, arrival.station_id)
    to_name = names.get(transfer_station, transfer_station)
    walk_between = transfer_station != arrival.station_id

    if walk_between and from_name != to_name and ok["transfer_in"] and ok["transfer_out"]:
        # Both platforms work; whether the passageway between them is step-free
        # is simply not in the feed. Say so rather than imply either answer.
        notes.append(
            "the connection from %s to %s is inside the station, but the feed does not say "
            "whether that passageway is step-free" % (from_name, to_name)
        )

    if all(ok.values()) and return_ok:
        severity = "step_free"
    elif all(ok.values()):
        severity = "return_warning"
    else:
        severity = "outbound_warning"

    return {
        "depart": board_time[arrival.trip_id],
        "arrive": alight_time[departure.trip_id],
        "route_1": route_of.get(arrival.trip_id, ""),
        "headsign_1": headsign_of.get(arrival.trip_id, ""),
        "leg1_arrive": arrival.arrival_time,
        "arrive_station": arrival.station_id,
        "arrive_name": from_name,
        "transfer_station": transfer_station,
        "transfer_name": to_name,
        "wait_seconds": int(wait),
        "walk_between": bool(walk_between and from_name != to_name),
        "route_2": route_of.get(departure.trip_id, ""),
        "headsign_2": headsign_of.get(departure.trip_id, ""),
        "leg2_depart": departure.departure_time,
        "severity": severity,
        "advisories": "; ".join(notes),
        "trip_1": arrival.trip_id,
        "trip_2": departure.trip_id,
    }


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
