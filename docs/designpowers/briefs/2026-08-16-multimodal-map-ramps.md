# Design Brief: Multimodal Stops, Selection Map, and Ramp Detail

## Problem Statement
The planner only accepts subway stations, while riders may begin or end at a bus stop. The map is hidden below the form, so it does not help confirm a selected place. Curb-ramp information exists but appears only under an alternative station and omits useful condition details.

## Users
NYC riders comparing accessible subway and bus options, including people using screen readers, keyboard navigation, mobility devices, low vision settings, or the planner under time pressure.

## Design Direction
Extend the existing demonstration snapshot with representative subway stations and bus stops. Use one clearly labeled stop selector for either mode. Show a non-interactive map beside the selectors after either endpoint is chosen, with the same information in text. Show curb-ramp summaries for selected endpoints and include measurements, detectable-warning condition, obstructions, and ponding when published.

## Constraints
- GitHub Pages remains a static demonstration; no claim of live or complete MTA bus routing.
- Preserve the current React, API-type, transit-signage, keyboard, and screen-reader patterns.
- Bus and subway choices must be distinguishable without color.
- The map is an enhancement and must not become a keyboard trap.
- Desktop uses a planner/map split; mobile stacks the map after the selectors.

## Existing Design System
Path B (Comply): `web/src/styles.css`, existing form, result, status, route-bullet, and map patterns.

## Taste Direction
Quiet, utilitarian transit wayfinding. Clear labels and useful measurements carry the hierarchy; no decorative map treatment or new visual language.

## Success Criteria
- Either field accepts a representative subway station or bus stop.
- Subway-only, bus-only, and subway-to-bus demonstration journeys return an understandable result.
- Selecting either endpoint reveals and updates the map without requiring another action.
- Selected endpoints expose ramp context and detailed published conditions.
- Keyboard focus, accessible names, and text alternatives remain complete.
- Production build, lint, Pages-path verification, and rendered public smoke tests pass.

## Out of Scope
Complete citywide bus GTFS ingestion, real-time bus arrivals, a production multimodal routing engine, turn-by-turn walking directions, or a hosted backend.
