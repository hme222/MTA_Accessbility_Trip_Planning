# Divergence Ledger

## Structural options
Option A: Replace the root narrative with the planner; task-first but removes the project explanation
Option B: Keep the narrative root and publish the planner at `/app/`; preserves both tasks with a direct handoff
Option C: Embed the planner in an iframe inside the narrative; keeps one URL but duplicates landmarks and creates focus/height problems
Chosen: B
Chosen because: It preserves the established case study, gives the app its own document and landmarks, and avoids iframe accessibility and responsive failures

## Data-mode disclosure
Default: A rounded, colored announcement card with a vague “demo” badge
Instead: A ruled text status strip using existing semantic tokens, naming snapshot mode and its limitation
Reason: Riders must understand provenance before relying on route guidance
Validation: Snapshot wording is visible before the planner controls and remains meaningful without color

## Project-to-app handoff
Default: Generic “Try it” button or embedded dashboard preview
Instead: A specific “Open the trip planner” link to the standalone app document
Reason: Literal link text and separate landmarks reduce ambiguity for all input modes
Validation: The link resolves under the repository Pages base path and has a 44px target

## App structure
Default: Add a new dashboard shell for static mode
Instead: Keep the existing tabs, planner form, results, and error states; substitute only the data boundary
Reason: Existing interaction patterns are already accessible and coherent
Validation: Live and demo builds render the same component tree

## Landing-to-app visual continuity
Option A: Surface-only alignment; copy landing tokens but keep the app's title visually hidden
Option B: Shared compact signage hero; show route bullets, a literal title, and the landing-page content rhythm before the unchanged planner
Option C: Put the entire planner on a dark signage panel; strongest visual match but worse form density and error-state legibility
Chosen: B
Chosen because: It makes the handoff unmistakable without wrapping dense controls in a marketing surface or changing planner behavior

## App introduction
Default: Start with dashboard-style tabs and no visible page title
Instead: Reuse the landing page's black typography carrier at a tighter task-first scale
Reason: The app needs a visible H1 and immediate visual continuity with the project page
Validation: Desktop and mobile screenshots show the same wordmark, route bullets, type, gutters, and black/white rule language as the landing page
