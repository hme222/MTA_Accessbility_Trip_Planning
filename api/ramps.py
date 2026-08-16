"""Curb ramp quality around a station, from NYC Open Data.

The alternatives feature tells a rider to walk to a nearby accessible station.
It has no idea whether that walk is possible in a wheelchair -- a station 700
metres away is useless if the corners between here and there have no curb cuts.

NYC DOT publishes every pedestrian ramp in the city with the measurements the
ADA actually specifies, so the question is answerable rather than assumed.

The thresholds below are the ADA Standards for Accessible Design, not
house rules:

    running slope  <= 8.33%   (1:12, section 405.2)
    cross slope    <= 2.08%   (1:48, section 405.3)
    clear width    >= 36 in   (section 405.5)
    detectable warning surface required at the street edge (section 705)

A ramp that misses any of these is reported as substandard rather than absent:
it exists, and some riders manage it, which is the same "warn, never block"
posture the rest of this project takes. What the app must not do is imply a
walk is fine when the measurements say otherwise.
"""

import math
import threading
import time

import requests

RAMPS_URL = "https://data.cityofnewyork.us/resource/ufzp-rrqu.json"

# ADA Standards for Accessible Design.
MAX_RUNNING_SLOPE = 8.33
MAX_CROSS_SLOPE = 2.08
MIN_WIDTH_INCHES = 36.0

RAMP_TTL_SECONDS = 3600  # Ramps are built infrastructure; they change slowly.

_cache = {}
_lock = threading.Lock()


def _number(value):
    """Parse a Socrata numeric string. `999` is the dataset's not-measured code."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return None if parsed >= 999 else parsed


def _bounds(lat, lon, meters):
    """Bounding box around a point, in degrees."""
    dlat = meters / 111_320.0
    dlon = meters / (111_320.0 * max(0.1, math.cos(math.radians(lat))))
    return lat + dlat, lon - dlon, lat - dlat, lon + dlon


def assess(ramp):
    """Judge one ramp against the ADA thresholds.

    Only measured values are judged. A missing measurement is recorded as
    unverified rather than counted as a pass -- absence of evidence is not
    compliance, and this is exactly the distinction the project keeps
    everywhere else.
    """
    issues = []

    running = _number(ramp.get("ramp_running_slope_total"))
    if running is not None and running > MAX_RUNNING_SLOPE:
        issues.append("slope %.1f%% exceeds the %.2f%% ADA maximum" % (running, MAX_RUNNING_SLOPE))

    # Cross slope is signed in the feed; the magnitude is what matters.
    cross = _number(ramp.get("ramp_cross_slope"))
    if cross is not None and abs(cross) > MAX_CROSS_SLOPE:
        issues.append("cross slope %.1f%% exceeds the %.2f%% ADA maximum" % (abs(cross), MAX_CROSS_SLOPE))

    width = _number(ramp.get("ramp_width"))
    if width is not None and width < MIN_WIDTH_INCHES:
        issues.append("width %.0f in is under the %.0f in ADA minimum" % (width, MIN_WIDTH_INCHES))

    # The detectable warning surface is what tells a blind rider where the
    # sidewalk ends and the roadway begins.
    dws = (ramp.get("dws_conditions") or "").strip()
    if dws and dws.lower() not in ("good condition", "fair condition"):
        issues.append("detectable warning surface: %s" % dws.lower())

    obstacle = (ramp.get("obstacles_ramp") or "").strip()
    if obstacle and obstacle.lower() not in ("none", ""):
        issues.append("obstruction: %s" % obstacle.lower())

    if (ramp.get("ponding") or "").strip().lower() == "yes":
        issues.append("ponds with water")

    measured = any(v is not None for v in (running, cross, width))
    return {
        "ramp_id": ramp.get("rampid", ""),
        "street": ramp.get("ramp_onstr") or ramp.get("stname1") or "",
        "running_slope": running,
        "cross_slope": abs(cross) if cross is not None else None,
        "width_inches": width,
        "compliant": measured and not issues,
        "measured": measured,
        "issues": issues,
        "detectable_warning": dws or None,
        "surface_condition": None,
        "obstruction": obstacle or None,
        "ponding": True if (ramp.get("ponding") or "").strip().lower() == "yes" else False,
    }


def near(lat, lon, meters=200, limit=200):
    """Curb ramps within `meters` of a point, each scored against the ADA.

    Cached for an hour: this is built infrastructure, not live status, and the
    demo should not hammer a public open-data endpoint.
    """
    if lat is None or lon is None:
        return {"total": 0, "compliant": 0, "substandard": 0, "unverified": 0, "ramps": []}

    key = (round(lat, 4), round(lon, 4), meters)
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit["fetched_at"] < RAMP_TTL_SECONDS:
            return hit

    north, west, south, east = _bounds(lat, lon, meters)
    params = {
        "$where": "within_box(the_geom,%f,%f,%f,%f)" % (north, west, south, east),
        "$select": (
            "rampid,ramp_onstr,stname1,ramp_running_slope_total,ramp_cross_slope,"
            "ramp_width,dws_conditions,obstacles_ramp,ponding"
        ),
        "$limit": limit,
    }

    try:
        response = requests.get(RAMPS_URL, params=params, timeout=20)
        response.raise_for_status()
        rows = response.json()
    except Exception as exc:
        # Never fail the page over a third-party outage; the rest of the
        # station's accessibility data is unaffected.
        return {
            "total": 0,
            "compliant": 0,
            "substandard": 0,
            "unverified": 0,
            "ramps": [],
            "error": str(exc)[:160],
        }

    scored = [assess(row) for row in rows]
    result = {
        "fetched_at": time.time(),
        "total": len(scored),
        "compliant": sum(1 for r in scored if r["compliant"]),
        "substandard": sum(1 for r in scored if r["measured"] and not r["compliant"]),
        "unverified": sum(1 for r in scored if not r["measured"]),
        # Worst first: a rider planning a walk needs the problems, not a census.
        "ramps": sorted(scored, key=lambda r: (r["compliant"], -len(r["issues"])))[:40],
    }

    with _lock:
        _cache[key] = result
    return result
