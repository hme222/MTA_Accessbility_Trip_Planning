"""JSON API over the accessible feed, for the mobile client.

Every accessibility decision is made in `gtfs_accessibility`; this layer only
loads the feed once, shapes results as JSON, and adds the scheduling defaults a
phone needs (today's date, departures from now on).

    uvicorn api.main:app --reload --port 8000

The core contract carries through unchanged: **accessibility warns, it never
blocks**. `/plan` returns every itinerary with its advisories attached. Strict
filtering exists behind an explicit opt-in and is not the default.
"""

import os
import sys
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import gtfs_accessibility as ga  # noqa: E402
from api.feed import FeedCache  # noqa: E402
from api import ramps as ramp_data  # noqa: E402

try:
    from zoneinfo import ZoneInfo

    NY = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - zoneinfo data missing
    NY = None

FEED_DIR = os.environ.get("GTFS_ACCESSIBLE_DIR", "~/Downloads/gtfs_accessible")

# Ordered worst-first: the UI leads with what a rider needs to know.
SEVERITY_RANK = {"outbound_warning": 0, "return_warning": 1, "step_free": 2}

app = FastAPI(
    title="MTA Accessible Trip Planning",
    description="Directional subway accessibility with live elevator outages.",
    version="1.0.0",
)

# Wide open for local development against Expo, which serves from a LAN origin
# that changes with the network. Restrict this before any public deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

cache = FeedCache(FEED_DIR).install()


@app.on_event("startup")
def startup():
    if not os.path.isdir(cache.gtfs_dir):
        print("WARNING: feed not found at %s" % cache.gtfs_dir)
        print("Build it first: python3 gtfs_accessibility.py")
        return
    print("Loading feed from %s ..." % cache.gtfs_dir)
    print("Feed ready in %.1fs (%d stations)" % (cache.warm(), len(cache.stations())))


# -- models ---------------------------------------------------------------


class Station(BaseModel):
    stop_id: str
    stop_name: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    mta_ada_status: str
    northbound: bool
    southbound: bool
    reason: str = ""
    routes: List[str] = []


class TripOption(BaseModel):
    trip_id: str
    route_id: str
    direction_id: str
    trip_headsign: str
    depart: str
    arrive: str
    severity: str
    advisories: List[str] = []


class PlanResponse(BaseModel):
    origin: Station
    destination: Station
    date: str
    after: str
    count: int
    severity_counts: Dict[str, int]
    trips: List[TripOption]


# -- helpers --------------------------------------------------------------


def _now():
    return datetime.now(NY) if NY else datetime.now()


def _station_or_404(stop_id: str) -> dict:
    station = cache.station_index().get(stop_id)
    if station is None:
        raise HTTPException(404, "no station with stop_id %r" % stop_id)
    return station


def _require_feed():
    if not os.path.isdir(cache.gtfs_dir):
        raise HTTPException(
            503,
            "feed not built. Run `python3 gtfs_accessibility.py`, or set "
            "GTFS_ACCESSIBLE_DIR to an existing feed.",
        )


# -- routes ---------------------------------------------------------------


@app.get("/health")
def health():
    ready = os.path.isdir(cache.gtfs_dir)
    return {
        "status": "ok" if ready else "feed_missing",
        "feed_dir": cache.gtfs_dir,
        "loaded": cache.loaded_at is not None,
        "stations": len(cache.stations()) if ready else 0,
        # Clients surface this. The feed is a snapshot and outages change
        # hourly, so how old it is is part of the answer, not metadata.
        "feed_built_at": cache.built_at() if ready else None,
    }


@app.get("/stations", response_model=List[Station])
def stations(
    q: Optional[str] = Query(None, description="Case-insensitive name search"),
    direction: Optional[str] = Query(None, pattern="^[NS]$", description="N or S"),
    accessible_only: bool = Query(
        False,
        description="Return only ADA accessible stations. Off by default -- the app "
        "shows every station and labels its status.",
    ),
    limit: int = Query(500, ge=1, le=2000),
):
    """List stations with accessibility resolved per direction of travel."""
    _require_feed()
    results = cache.stations()

    if q:
        needle = q.strip().lower()
        results = [s for s in results if needle in s["stop_name"].lower()]

    if direction == "N":
        results = [s for s in results if s["northbound"]]
    elif direction == "S":
        results = [s for s in results if s["southbound"]]
    elif accessible_only:
        results = [s for s in results if s["northbound"] or s["southbound"]]

    return results[:limit]


@app.get("/stations/{stop_id}", response_model=Station)
def station(stop_id: str):
    _require_feed()
    return _station_or_404(stop_id)


class Alternative(BaseModel):
    stop_id: str
    stop_name: str
    routes: List[str] = []
    shared_routes: List[str] = []
    northbound: bool
    southbound: bool
    reason: str = ""
    meters: int


@app.get("/stations/{stop_id}/alternatives", response_model=List[Alternative])
def alternatives(
    stop_id: str,
    direction: Optional[str] = Query(None, pattern="^[NS]$"),
    limit: int = Query(4, ge=1, le=10),
    max_meters: int = Query(1600, ge=100, le=5000),
):
    """Accessible stations near one that is not.

    Telling a rider their station does not work is only half an answer. Results
    prefer stations sharing a route with the original, then proximity.

    `meters` is straight-line distance, which understates the actual walk.
    """
    _require_feed()
    _station_or_404(stop_id)
    return cache.nearby_accessible(
        stop_id, limit=limit, direction=direction, max_meters=max_meters
    )


class StationEquipment(BaseModel):
    equipment: str
    type: str
    serving: str = ""
    ada: bool
    redundant: bool
    working: bool
    reason: str = ""
    estimated_return: str = ""


@app.get("/stations/{stop_id}/all-equipment", response_model=List[StationEquipment])
def all_station_equipment(stop_id: str):
    """Every elevator and escalator at a station, working or not.

    The question a transfer raises is not "why is this closed" but "what is
    here and does it work". The feed's `serving` text describes in-station
    connections directly -- "mezzanine to lower mezzanine A/C/E to downtown
    1/2/3 platform" is the path a change of train depends on.

    That text is prose, not structure. It is reported as-is rather than parsed
    into a claim that a particular platform-to-platform route is step-free.
    """
    _require_feed()
    _station_or_404(stop_id)
    return cache.all_equipment_at(stop_id)


class Equipment(BaseModel):
    equipment: str
    type: str
    serving: str = ""
    ada: bool
    redundant: bool
    blocking: bool
    reason: str = ""
    outage_date: str = ""
    estimated_return: str = ""


@app.get("/stations/{stop_id}/equipment", response_model=List[Equipment])
def station_equipment(stop_id: str):
    """Which elevators and escalators are down at this station, and why.

    The station's own `reason` field names equipment numbers, which tell a
    rider nothing. This is what those numbers mean: what the unit serves, why
    it is out, and when it is expected back -- the details that decide whether
    to wait, reroute, or take the bus.
    """
    _require_feed()
    _station_or_404(stop_id)
    return cache.equipment_at(stop_id)


class Ramp(BaseModel):
    ramp_id: str
    street: str = ""
    running_slope: Optional[float] = None
    cross_slope: Optional[float] = None
    width_inches: Optional[float] = None
    compliant: bool
    measured: bool
    issues: List[str] = []
    detectable_warning: Optional[str] = None
    surface_condition: Optional[str] = None
    obstruction: Optional[str] = None
    ponding: Optional[bool] = None


class RampReport(BaseModel):
    total: int
    compliant: int
    substandard: int
    unverified: int
    ramps: List[Ramp] = []
    error: Optional[str] = None


@app.get("/stations/{stop_id}/ramps", response_model=RampReport)
def station_ramps(
    stop_id: str,
    meters: int = Query(200, ge=50, le=800, description="Search radius"),
):
    """Curb ramp quality around a station, from NYC Open Data.

    The app tells riders to walk to a nearby accessible station; this says
    whether that walk is actually passable. NYC DOT publishes every pedestrian
    ramp with the measurements the ADA specifies -- running slope, cross slope,
    width, detectable warning surface -- so each corner is scored against the
    real standard rather than assumed usable.
    """
    _require_feed()
    station = _station_or_404(stop_id)
    return ramp_data.near(station["lat"], station["lon"], meters=meters)


@app.get("/plan", response_model=PlanResponse)
def plan(
    origin: str = Query(..., description="Parent station id, e.g. R16"),
    destination: str = Query(..., description="Parent station id, e.g. R15"),
    date: Optional[str] = Query(None, pattern=r"^\d{8}$", description="YYYYMMDD"),
    after: Optional[str] = Query(
        None, pattern=r"^\d{2}:\d{2}(:\d{2})?$", description="HH:MM or HH:MM:SS"
    ),
    limit: int = Query(12, ge=1, le=100),
    require_step_free: bool = Query(
        False,
        description="Hard-filter to guaranteed ADA accessible trips. Off by default: "
        "a destination that is not ADA accessible returns nothing, which reads as "
        "'no service' rather than 'here are your options, with caveats'.",
    ),
):
    """Plan origin -> destination, every option carrying its advisories."""
    _require_feed()
    start = _station_or_404(origin)
    end = _station_or_404(destination)

    now = _now()
    date = date or now.strftime("%Y%m%d")
    after = after or now.strftime("%H:%M:%S")
    if len(after) == 5:
        after += ":00"

    if require_step_free:
        # plan_trip advises rather than filters, so strict mode is applied by
        # intersecting with the trips that trips_serving will vouch for.
        allowed = set(
            ga.trips_serving(cache.gtfs_dir, [origin, destination], require_step_free=True)[
                "trip_id"
            ]
        )
    else:
        allowed = None

    frame = ga.plan_trip(cache.gtfs_dir, origin, destination, date=date, after=after)

    options = []
    if not frame.empty:
        for row in frame.to_dict("records"):
            if allowed is not None and row["trip_id"] not in allowed:
                continue
            advisories = [a for a in str(row["advisories"]).split("; ") if a]
            options.append(
                TripOption(
                    trip_id=row["trip_id"],
                    route_id=row["route_id"],
                    direction_id=str(row["direction_id"]),
                    trip_headsign=row["trip_headsign"],
                    depart=row["depart"],
                    arrive=row["arrive"],
                    severity=row["severity"],
                    advisories=advisories,
                )
            )

    counts = {"step_free": 0, "return_warning": 0, "outbound_warning": 0}
    for opt in options:
        counts[opt.severity] = counts.get(opt.severity, 0) + 1

    return PlanResponse(
        origin=Station(**start),
        destination=Station(**end),
        date=date,
        after=after,
        count=len(options),
        severity_counts=counts,
        trips=options[:limit],
    )


class TransferLeg(BaseModel):
    route: str
    headsign: str
    depart: str
    arrive: str


class TransferOption(BaseModel):
    depart: str
    arrive: str
    total_minutes: int
    wait_minutes: int
    arrive_station: str
    arrive_name: str
    transfer_station: str
    transfer_name: str
    walk_between: bool
    transfer_routes: List[str] = []
    leg_1: TransferLeg
    leg_2: TransferLeg
    severity: str
    advisories: List[str] = []


class TransferResponse(BaseModel):
    origin: Station
    destination: Station
    date: str
    after: str
    count: int
    options: List[TransferOption]


@app.get("/plan/transfers", response_model=TransferResponse)
def plan_transfers(
    origin: str = Query(...),
    destination: str = Query(...),
    date: Optional[str] = Query(None, pattern=r"^\d{8}$"),
    after: Optional[str] = Query(None, pattern=r"^\d{2}:\d{2}(:\d{2})?$"),
    limit: int = Query(8, ge=1, le=25),
):
    """Journeys with one change of train.

    Kept separate from `/plan` because it costs seconds rather than
    milliseconds: the client shows direct trips immediately and fills these in
    as they arrive.

    This matters more than in an ordinary planner. Only 140 of 496 stations are
    fully accessible, so a large share of usable journeys require a change --
    and a change is exactly where accessibility breaks, since it needs four
    working platforms instead of two.
    """
    _require_feed()
    start = _station_or_404(origin)
    end = _station_or_404(destination)

    now = _now()
    date = date or now.strftime("%Y%m%d")
    after = after or now.strftime("%H:%M:%S")
    if len(after) == 5:
        after += ":00"

    frame = ga.plan_trip_with_transfer(
        cache.gtfs_dir, origin, destination, date=date, after=after, limit=limit
    )

    options = []
    if not frame.empty:
        for row in frame.to_dict("records"):
            total = (ga.gtfs_seconds(row["arrive"]) - ga.gtfs_seconds(row["depart"])) // 60
            options.append(
                TransferOption(
                    depart=row["depart"],
                    arrive=row["arrive"],
                    total_minutes=max(0, int(total)),
                    wait_minutes=int(row["wait_seconds"]) // 60,
                    arrive_station=row["arrive_station"],
                    arrive_name=row["arrive_name"],
                    transfer_station=row["transfer_station"],
                    transfer_name=row["transfer_name"],
                    walk_between=bool(row["walk_between"]),
                    # Lines actually available where leg two boards -- proof on
                    # the face of the result that the change is possible.
                    transfer_routes=cache.routes_by_station().get(row["transfer_station"], []),
                    leg_1=TransferLeg(
                        route=row["route_1"],
                        headsign=row["headsign_1"],
                        depart=row["depart"],
                        arrive=row["leg1_arrive"],
                    ),
                    leg_2=TransferLeg(
                        route=row["route_2"],
                        headsign=row["headsign_2"],
                        depart=row["leg2_depart"],
                        arrive=row["arrive"],
                    ),
                    severity=row["severity"],
                    advisories=[a for a in str(row["advisories"]).split("; ") if a],
                )
            )

    return TransferResponse(
        origin=Station(**start),
        destination=Station(**end),
        date=date,
        after=after,
        count=len(options),
        options=options,
    )


@app.get("/outages/upcoming")
def upcoming_outages(
    blocking_only: bool = Query(
        False, description="Only outages that will remove an accessible route"
    ),
    limit: int = Query(200, ge=1, le=500),
):
    """Scheduled future elevator and escalator outages.

    Lets a rider plan around a closure instead of finding it on the platform.
    This is also the source of the `return_outage_soon` hazard: a return
    platform that works now but loses its elevator tonight passes every
    current-state check while still stranding someone.
    """
    data = cache.upcoming_outages()
    items = data["outages"]
    if blocking_only:
        items = [o for o in items if o["will_block"]]
    return dict(data, outages=items[:limit], total=len(items))


@app.get("/bus/alerts")
def bus_alerts(
    route: Optional[str] = Query(None, description="Filter to one route, e.g. M14A+"),
    limit: int = Query(60, ge=1, le=300),
):
    """Live MTA bus service alerts.

    Every MTA bus is wheelchair accessible, so when a station has no accessible
    route the bus usually does -- which makes a bus disruption an accessibility
    problem rather than a footnote.
    """
    data = cache.bus_alerts()
    alerts = data["alerts"]

    if route:
        needle = route.strip().upper()
        alerts = [a for a in alerts if any(r.upper() == needle for r in a["routes"])]

    return dict(data, alerts=alerts[:limit], total=len(alerts))


@app.get("/outages")
def outages(
    blocking_only: bool = Query(
        False, description="Only outages that actually remove an accessible route"
    ),
):
    """Live elevator and escalator outages.

    Escalators and redundant elevators are reported but never marked blocking --
    an escalator is not an accessible route, and a redundant unit has a parallel
    one covering the same route.
    """
    data = cache.outages()
    if blocking_only:
        items = [o for o in data["outages"] if o["blocking"]]
        return dict(data, outages=items, total=len(items))
    return data
