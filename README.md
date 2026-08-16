# MTA_Accessbility_Trip_Planning

Subway accessibility resolved down to the direction of travel, reflecting live
elevator outages — so a rider is told not just whether they can get somewhere,
but whether they can get back.

| Piece | What it is |
|---|---|
| `gtfs_accessibility.py` | Builds an augmented copy of the MTA static feed |
| `api/` | FastAPI service over the built feed |
| `web/` | React + Vite app |
| `docs/` | Project page, served by GitHub Pages |

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

## JSON API

```
pip install -r api/requirements.txt
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Point it at a feed with `GTFS_ACCESSIBLE_DIR` (default `~/Downloads/gtfs_accessible`).
Interactive docs at `/docs`.

| Endpoint | Returns |
|---|---|
| `GET /health` | Feed directory, load state, station count, feed build time |
| `GET /stations` | All 496 parent stations. `?q=` name search, `?direction=N\|S` |
| `GET /stations/{stop_id}` | One station |
| `GET /stations/{stop_id}/alternatives` | Nearby accessible stations, for when this one is not |
| `GET /plan` | `?origin=&destination=` plus optional `date`, `after`, `limit` |
| `GET /plan/transfers` | Journeys with one change of train |
| `GET /outages` | Live equipment outages. `?blocking_only=true` |
| `GET /bus/alerts` | Live bus service alerts. `?route=` |

`/plan` defaults `date` and `after` to now in `America/New_York`, since a phone
asking for a trip means *now* rather than *every service pattern in the feed*.

### Why the reader seam exists

`stop_times.txt` is 133 MB and 2.3M rows. Re-parsing it per request costs ~2s,
which is fine for a one-shot build and far too slow for an API. Every feed read
in `gtfs_accessibility` therefore goes through `read_table()`, and `api/feed.py`
installs a cache behind it:

```python
FeedCache("~/Downloads/gtfs_accessible").install()
```

Nothing else changes — `plan_trip`, `trips_serving`, and `accessible_stations`
keep their logic and simply read from memory. Warm-up is ~1.5s and a trip query
then costs ~0.3s. Left as plain disk reads by default, so running the build
script directly is unaffected.

## Web app

```
cd web
npm install
npm run dev           # http://localhost:5173
```

Vite proxies `/api` to `127.0.0.1:8000`, so the browser only makes same-origin
requests and CORS never enters into it. Override the target with `API_TARGET` in
development, or `VITE_API_URL` for a build pointed at a deployed backend.

Two panels: plan a trip, and check elevators. The design follows the same rule as
the data layer — **it warns, it never blocks**. Every station appears in the
picker with its status labeled, including stations with no step-free access at
all, and "step-free trips only" is opt-in with its consequence spelled out.

Accessibility is a requirement here, not a feature:

- The station picker is a full ARIA combobox — arrow keys, Home/End, Enter,
  Escape, and `aria-activedescendant`, not a div that listens for clicks.
- Route bullets and severity chips are `aria-hidden`; each row carries one
  written label describing what it shows visually.
- Color never carries meaning alone — every severity has a glyph and a word, and
  a left rule so it survives grayscale.
- After a search, focus moves to the results heading, so the answer is where the
  user lands rather than something to hunt for.
- Skip link, real heading hierarchy, `role="status"` for counts, `role="alert"`
  for failures.
- Targets are at least 44px; `prefers-reduced-motion` is respected.

### What the app does

| Panel | |
|---|---|
| **Plan a trip** | Departures with advisories, a date and time to plan ahead, and an optional map |
| **Elevators** | Live outages, with blocking distinguished from merely informational |
| **Buses** | Service alerts — every MTA bus is wheelchair accessible, so this is often the only accessible option on a corridor |
| **Report a problem** | Composes a structured report for the rider to file. It does **not** submit anywhere, and says so |

Two features worth calling out:

**Transfers.** One change of train, which matters more here than in an
ordinary planner: with only 140 of 496 stations fully accessible, a large share
of usable journeys require a change — and a change is where accessibility
breaks, since it needs four working platforms instead of two.

Origin and destination expand to their whole *station complex* first. GTFS gives
14 St-Union Sq three parent stations (`L03`, `R20`, `635`) but nobody arranges
to meet at "R20", and planning to one alone discards every route arriving on a
different platform of the same station.

What the feed cannot say: GTFS does not record whether the connection *inside* a
station is step-free. For a change within one complex, both platforms being
accessible is treated as sufficient — an inference, not a fact. For a walk
between two differently-named complexes it is not even that, so those carry an
explicit "verify before relying on it" advisory.

**Accessible alternatives.** When a chosen station is not accessible, the app
offers nearby ones that are, each a single press to swap in. Suggestions prefer
stations sharing a route with the original before falling back to proximity — an
accessible station on an unrelated line rarely helps. Distances are
straight-line and labeled as such.

**Auto-refresh refreshes the data, not the page.** Reloading the document every
five minutes would discard selections and results, cut off a screen reader
mid-sentence, drop focus to the top, and destroy a half-written report. The
refresh is in-place, never moves focus, pauses while the tab is hidden, and can
be switched off (WCAG 2.2.1).

### Contrast

Every color pair is computed rather than eyeballed. Both themes clear **AAA
(7:1)** for text and AA (3:1) for control boundaries.

White text fails on five MTA line bullets — orange 2.98:1, G 2.31:1, S 3.90:1,
red 4.05:1, green 4.01:1 — so those take dark text instead. The published hues
are never altered: the hue is the recognition cue a rider actually uses, and
darkening enough to rescue white text would have cost orange 21% and the G 31%
of their luminance.

### Conformance, honestly

**AA as far as static analysis and computed contrast can verify, with AAA
contrast.** Not certified beyond that: several criteria can only be confirmed by
testing with real assistive technology. Full AAA is also out of reach for this
content — 3.1.5 (reading level) and 3.1.3/3.1.4 (glossary for GTFS, ADA, and
similar) are not satisfiable for a technical transit tool.

## Project page

`docs/index.html` is a self-contained page describing the project and its scope.
It is served by GitHub Pages from **Settings → Pages → Deploy from branch →
`main` → `/docs`**.

## Caveat: this is a snapshot

`wheelchair_boarding` is accurate as of build time, but the zip is static and
outages change hourly. For rider-facing use, rebuild on a schedule or serve
accessibility live alongside a stable feed.
