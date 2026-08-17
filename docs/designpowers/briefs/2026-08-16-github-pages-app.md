# Design Brief: GitHub Pages Trip Planner

## Problem Statement
The public GitHub Pages site explains Accessible Transit, but visitors cannot use the React trip planner there. The frontend is not part of the Pages build, its TypeScript configuration is missing, and its production API default points to a route GitHub Pages cannot serve.

## Users
Primary users are portfolio reviewers and NYC riders evaluating an accessibility-first planning concept. The experience must remain complete for keyboard and screen-reader users, people with low vision or limited motor control, motion-sensitive users, and people making a time-sensitive travel decision under cognitive load.

## Design Direction
Preserve the existing case-study landing page at the repository root and add the usable planner at `/app/`. The Pages release uses clearly labeled snapshot demonstration data; one environment variable switches the same frontend to a future live FastAPI service.

## Constraints
- GitHub Pages is static and cannot host FastAPI or the generated 133 MB GTFS table.
- Demonstration data must never be described as live.
- Existing transit-signage styling and accessible interaction patterns remain authoritative.
- No deployment, backend hosting, secret creation, or production replacement is included.

## Existing Design System
`web/src/styles.css`, `web/src/App.tsx`, `web/src/components.tsx`, and the matching system in `docs/index.html`.

## Taste Direction (Early Signal)
NYC Transit signage: direct, high-contrast, information-first, and restrained. Status must use text and shape in addition to color.

## Success Criteria
- `npm run build` succeeds from `web/`.
- The production build resolves assets under `/MTA_Accessibility_Trip_Planning/app/`.
- The static demo supports the primary trip-planning task without a backend.
- The UI clearly identifies snapshot data and links back to the case study.
- A configured `VITE_API_URL` restores live API mode without component changes.
- Keyboard, screen-reader, reduced-motion, responsive, loading, error, and recovery behavior remain intact.

## Out of Scope
Hosting the FastAPI service, scheduling GTFS rebuilds, claiming real-time rider readiness, changing the planner's visual system, or deploying/pushing the result.
