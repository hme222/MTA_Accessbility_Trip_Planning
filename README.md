# MTA_Accessbility_Trip_Planning

`gtfs_accessibility.py` builds an augmented copy of the MTA subway static feed with
station accessibility resolved down to direction of travel, reflecting live
elevator outages.

```
python3 gtfs_accessibility.py     # -> ~/Downloads/gtfs_accessible.zip
```

## The two encodings

Accessibility is written into two separate columns because **the MTA and GTFS
conventions disagree on the value `2`**:

| Value | GTFS `wheelchair_boarding` | MTA `mta_ada_status` |
|-------|----------------------------|----------------------|
| `0`   | No information             | Not accessible       |
| `1`   | Accessible path exists     | Fully accessible     |
| `2`   | **Boarding not possible**  | **Partially accessible** |

Writing the MTA meaning into `wheelchair_boarding` would tell every standard trip
planner the opposite of what was intended: a partially accessible station would
read as categorically unusable. So they are kept apart:

- **`wheelchair_boarding`** — GTFS semantics, for consumers. Set on both parent
  stations and directional platforms.
- **`mta_ada_status`** — MTA semantics, verbatim. Set on parent stations only.
  A non-standard column; spec-compliant consumers ignore unknown fields.

## How partial accessibility is expressed

GTFS has no "partial" value, but it does not need one — the feed already has
directional child stops. A station accessible in one direction gets:

```
R15     49 St   location_type=1                wheelchair_boarding=1   mta_ada_status=2
R15N    49 St   parent_station=R15             wheelchair_boarding=1
R15S    49 St   parent_station=R15             wheelchair_boarding=2
```

The parent says "there is an accessible path here"; the platforms say which one.
A router doing `stop_times` → `stops` lookups gets this right for free.

## Sources

| Source | Provides |
|---|---|
| [MTA Subway Stations](https://data.ny.gov/resource/39hk-dx4f.json) | Static ADA baseline, incl. `ada_northbound` / `ada_southbound` |
| MTA E&E API (`Requests_MTA.py`) | Live elevator/escalator outages |

Both join to GTFS parent station IDs exactly — 496/496 for the stations dataset,
193/193 for equipment (`elevatorsgtfsstopid`). No name matching anywhere.

## Rules applied

- **Escalator outages never downgrade a station.** An escalator is not a
  step-free path, so it cannot be what makes a station accessible.
- **`redundant` elevator outages never downgrade.** A parallel unit covers the
  same path. Recorded in the report as degraded-but-intact.
- **A blocking outage knocks out both directions.** The E&E feed does not map an
  elevator to a single direction of travel, so this is deliberately conservative.

`accessibility_status.txt` ships inside the zip with the reasoning per station.

## Return-trip risk

A partially accessible station is a one-way trap: a rider can *arrive* on the
accessible platform but cannot *board* to come back. Because `direction_id=0`
trips call only at `N` platforms and `direction_id=1` only at `S`, the return
leg for any stop is unambiguously that station's opposite platform.

`trips.txt` gains two columns:

| Column | Meaning |
|---|---|
| `return_risk` | `one_way_trap`, `return_outage_soon`, or empty |
| `return_risk_stops` | space-separated parent station IDs carrying the risk |

`trip_return_risk.txt` holds the per-stop detail: which platform, at what time
in the trip, and why.

Two hazards are distinguished:

- **`one_way_trap`** — the opposite platform has no step-free access at all.
  Permanent, from the ADA baseline.
- **`return_outage_soon`** — the opposite platform works now, but its ADA
  elevator has a *scheduled* outage. Temporary, from the E&E upcoming feed.

Note that a current blocking outage does **not** produce a trap: it knocks out
both directions, making the station simply inaccessible rather than asymmetric.

Empty `return_risk` fields read back from CSV as `NaN`, not `''` — filter with
`.fillna('')` or `.notna()`, not `!= ''`.

## Realtime endpoints

Listed at <https://api.mta.info/#/subwayRealTimeFeeds>. All on
`https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/` — the same host the
elevator API uses — and all verified reachable without an API key.

| Feed | Path |
|---|---|
| 1234567S | `nyct%2Fgtfs` |
| ACE | `nyct%2Fgtfs-ace` |
| BDFM | `nyct%2Fgtfs-bdfm` |
| G | `nyct%2Fgtfs-g` |
| JZ | `nyct%2Fgtfs-jz` |
| NQRW | `nyct%2Fgtfs-nqrw` |
| L | `nyct%2Fgtfs-l` |
| SIR | `nyct%2Fgtfs-si` |
| Subway alerts | `camsys%2Fsubway-alerts` (or `.json`) |
| All / bus / LIRR / MNR alerts | `camsys%2F{all,bus,lirr,mnr}-alerts` (or `.json`) |
| LIRR / MNR realtime | `lirr%2Fgtfs-lirr`, `mnr%2Fgtfs-mnr` |

### Protobuf extensions

The trip feeds carry **NYCT extension** data in field 1001 (`train_id`,
`is_assigned`, `direction`, `scheduled_track`, `actual_track`). The stock
`gtfs-realtime.proto` cannot decode these and drops them *silently* — parsing
succeeds and the fields are simply absent. Decoding requires
`gtfs-realtime-NYCT.proto` compiled alongside it, or the `nyct-gtfs` package.

Alerts carry a separate `transit_realtime.mercury_alert` extension. The `.json`
variants sidestep this entirely — extension fields appear as ordinary JSON keys,
no protobuf toolchain needed.

## Trip planning

**Accessibility warns; it never blocks.** A trip through a platform that is not
step-free is still returned, carrying its advisories. Riders have workarounds the
feed cannot see — a companion, a transfer, a bus leg, a different exit — so the
data's job is to inform the decision, not make it.

```python
import gtfs_accessibility as ga

feed = "~/Downloads/gtfs_accessible"
ga.plan_trip(feed, "R16", "R15", date="20260817", after="09:00:00", limit=6)
```

```
route_id  trip_headsign          depart    arrive    severity        advisories
W         Astoria-Ditmars Blvd   09:02:30  09:04:00  return_warning  return trip from 49 St is not step-free
R         Forest Hills-71 Av     09:04:30  09:06:00  return_warning  return trip from 49 St is not step-free
```

`date` and `after` are *scheduling* filters (which services run that day, from
what time) — not accessibility filters. Without a date you get every service
pattern in the feed, which is rarely what a rider wants.

### Severity levels

| Severity | Meaning |
|---|---|
| `step_free` | Accessible out and back |
| `return_warning` | Reachable, but the return leg is not step-free |
| `outbound_warning` | Boarding or exiting is not step-free on this trip |

### Strict mode, if you need it

`trips_serving(..., require_step_free=True)` opts in to hard filtering. Be aware
of what that does — for a destination with no step-free access it returns
**nothing**, which presents as "no service" rather than "here are your options,
with caveats":

| Query | Advisory (default) | `require_step_free=True` |
|---|---|---|
| Times Sq → 49 St | 7,320 trips | 3,660 trips |
| Times Sq → Union Sq | 10,578 trips | **0 trips** |

### Other helpers

```python
ga.accessible_stations(feed, direction="N")   # stations usable northbound
ga.active_services(feed, "20260817")          # service_ids running that date
```

## Caveat: this is a snapshot

`wheelchair_boarding` is accurate as of build time, but the zip is static and
outages change hourly. For rider-facing use, rebuild on a schedule or serve
accessibility live alongside a stable feed.
