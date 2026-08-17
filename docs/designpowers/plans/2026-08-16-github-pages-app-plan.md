# Design Plan: Accessible Transit GitHub Pages App

**Goal:** Make the existing planner usable from GitHub Pages with truthful snapshot data and a clean path to a future live API.

**Design Direction:** `docs/designpowers/briefs/2026-08-16-github-pages-app.md`

**Personas:** Time-pressed rider and portfolio reviewer, including keyboard, screen-reader, low-vision, motion-sensitive, and cognitively overloaded contexts.

**Build Contract:** `docs/designpowers/builds/2026-08-16-github-pages-app-build-contract.md`

**Build Profile:** Standard

**Engineering Law Trace:** In the build contract.

## Task 1: Restore the frontend build
**Queue:** Bug
**Functional slice:** `npm run build` emits a deployable application.
**Files:** `web/tsconfig.json`, `web/vite.config.ts`, `web/package.json`
- Add a strict Vite-compatible TypeScript project.
- Configure the repository Pages base path and a deterministic output directory.
- Add focused test and preview scripts if required.
**Accessibility check:** Build changes must not bypass existing semantic components or CSS.
**Dependency check:** Existing TypeScript and Vite only.
**Verification:** Type check, lint, and production build pass.

## Task 2: Add the static data boundary
**Queue:** Feature
**Functional slice:** The primary planner journey works without a network service.
**Files:** `web/src/api.ts`, `web/src/demoApi.ts`, `web/src/demoData.ts`, focused tests.
- Keep the current exported API surface.
- Route demo-mode calls to typed fixtures and live-mode calls to the configured backend.
- Cover default, results, empty, and recoverable failure behavior needed by existing screens.
**Accessibility check:** Demo mode must preserve focus movement, live-region updates, and non-color advisories.
**Dependency check:** Native promises and existing types; no new data or state library.
**Verification:** Contract tests prove no network request in demo mode and URL construction in live mode.

## Task 3: Disclose data mode in the existing system
**Queue:** Visual
**Functional slice:** Visitors understand whether information is snapshot or live before relying on it.
**Files:** `web/src/App.tsx`, `web/src/styles.css`
- Add one compact status message using existing panel, rule, type, and status tokens.
- Name the snapshot date/source and link to the project explanation.
- Preserve current responsive and reduced-motion behavior.
**Accessibility check:** Status is readable as text, announced once, and never color-only.
**Dependency check:** Existing React and CSS only.
**Verification:** Keyboard and screen-reader structure inspection plus responsive screenshots.

## Task 4: Connect the public project page
**Queue:** Feature
**Functional slice:** The root page opens the planner and accurately describes current scope.
**Files:** `docs/index.html`, `README.md`, optional Pages workflow/config.
- Add a specific “Open the trip planner” action to `/app/`.
- Correct the repository source URL and stale implementation claims.
- Document demo/live build commands and backend boundary.
**Accessibility check:** Link text names the destination; focus styling and target size reuse existing patterns.
**Dependency check:** Static HTML only.
**Verification:** Built root and `/app/` paths load without broken links or assets.

## Task 5: Verify and package the patch
**Queue:** Bug
**Functional slice:** A reviewable source patch is ready without deployment.
**Files:** Test/report artefacts and user-facing patch output.
- Run lint, type check, tests, and production build.
- Render at 320, 390, 900, and 1440; inspect default and result states.
- Run house-style validators and tell checks; record intentional exceptions.
**Accessibility check:** Keyboard path, focus visibility, 200% equivalent reflow, reduced motion, and snapshot disclosure.
**Dependency check:** Existing toolchain and browser only.
**Verification:** Local health report returns Ready or Conditional with explicit remaining backend/deployment work.
