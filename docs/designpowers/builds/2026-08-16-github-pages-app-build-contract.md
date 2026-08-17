# Build Contract: Accessible Transit GitHub Pages App

**Date:** 2026-08-16
**Profile:** Standard
**Selected queue:** Bug, followed by Feature, then Visual; queues remain separate.

## Outcome
- Problem: The React planner does not build or appear on the public static site.
- Users: Portfolio reviewers and riders, including keyboard, screen-reader, low-vision, motion-sensitive, and cognitively overloaded users.
- Primary task: Open the planner, choose two stations, and review a representative route with accessibility advisories.
- Success evidence: Passing build and tests, working static demo at the repository Pages base path, visible snapshot disclosure, and responsive screenshots.

## Current Release
- Essential feature 1: Restore a valid TypeScript/Vite production build.
- Essential feature 2: Provide a typed snapshot API adapter that supports the existing primary journey without FastAPI.
- Essential feature 3: Publish the app at `/app/` and connect the existing project page to it.
- Key screens: Project landing page and planner default/results states.

## Experience Direction
- Approved strategy: Keep the narrative root; add a separate usable planner route.
- Design system: Existing `web/src/styles.css` and app components.
- Taste direction: NYC Transit signage; high contrast, terse copy, no decorative novelty.
- Responsive locks: 320, 390, 900, and 1440 CSS pixels.
- Input modes: Keyboard, touch, pointer, and screen reader.

## Technical Boundaries
- Inputs and outputs: Existing React forms and the existing `api.ts` response types.
- Data and persistence: Versioned, local TypeScript fixture data; user settings remain local only.
- Authentication: None.
- Integrations: Optional `VITE_API_URL`; static demo is the default Pages build.
- Existing architecture: React/Vite frontend, FastAPI backend, GitHub Pages from `docs/`.

## Inclusive Requirements
- Accessibility: Preserve semantic tabs, combobox keyboard behavior, focus placement, live regions, 44 px targets, non-color status, text resizing, and reduced-motion support.
- Cognitive and neuroinclusive UX: State data mode plainly, keep the primary planner shallow, preserve form selections after recoverable errors, and avoid surprise refreshes.
- Motion and adaptation: No new required motion; retain `prefers-reduced-motion` behavior.

## Scope Control
- In scope: Build configuration, demo data adapter, mode disclosure, Pages path integration, truthful docs copy, tests, and local verification.
- Out of scope: Public backend hosting, scheduled data pipelines, production deployment, secrets, or a visual redesign.
- Preserve unchanged: Core accessibility decision model, existing planner interactions, public data provenance, and the root case-study narrative.

## Recovery
- Existing commit SHA: `accf5604f352a3e213ff045e8d653e7455fd887a`.
- Dirty-worktree notes: Only Designpowers planning artefacts have been added before implementation.
- Rollback approach: Revert the bounded frontend/config/docs patch or reset a fresh clone to the recorded SHA; no commit is created without authorization.

## Engineering Law Trace
| Law | Source status | Concrete evidence | Risk | Counter-risk / exception | Required change | Test or acceptance criterion | Result |
|---|---|---|---|---|---|---|---|
| Gall's Law | Verified | The existing planner UI and API types already work as a coherent small system | Rebuilding the planner inside the static page would duplicate behavior | A thin adapter still needs enough fidelity to exercise the primary task | Keep existing components and replace only the data boundary | Live and demo modes compile against the same exported API functions | Pending |
| KISS | Index-only | GitHub Pages cannot execute the Python service | Adding service workers or browser-side GTFS parsing would create fragile complexity | A fixture must remain clearly limited, not presented as production data | Use a direct typed demo adapter selected at build time | Static build contains no runtime dependency on `/api` | Pending |
| Law of Unintended Consequences | Verified | Production currently defaults to `/api`, which silently targets the wrong Pages origin | A seemingly successful build becomes a broken public app | Failing every build without an API would prevent a useful demo | Make mode explicit and show provenance in the UI | No network request occurs in demo mode; live mode requires an explicit URL | Pending |
| Testing Pyramid | Verified | Lint passes but the build fails because no TypeScript project exists | Static checks alone miss integration and asset-path failures | Full end-to-end coverage is disproportionate for a small static slice | Add focused unit/contract checks, then render the production build | Type check, Vite build, focused tests, and browser smoke check all pass | Pending |

## Matrix Check
- Applied dimensions: context and mechanics; agentic UX, trust, and accessibility; design systems and prototyping.
- Hard gates: truthful data provenance, accessible critical path, recovery from missing live service, representative build/render verification.
- Evidence status: Verified repository/code evidence; owner-approved design direction; engineering-law application is practitioner synthesis linked to verified/index sources.
- Validation required: TypeScript build, fixture/live contract checks, production path smoke test, accessibility and responsive review.
