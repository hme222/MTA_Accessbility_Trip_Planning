# Design State: Accessible Transit GitHub Pages App

_Last updated: 2026-08-17_

## Brief Summary
**Problem:** The public Pages site describes the project but does not expose the React planner, and the current frontend cannot build or run on static hosting.
**Primary audience:** Portfolio reviewers and NYC riders exploring an accessibility-first planning concept.
**Success metric:** A visitor can open `/app/`, complete a representative trip-planning task with honestly labeled snapshot data, and understand how live mode differs.
**Approved brief:** `docs/designpowers/briefs/2026-08-16-github-pages-app.md`

## Design Principles
1. Demonstration data is named at every point where it could be mistaken for live service.
2. Accessibility warnings inform decisions without silently hiding routes.
3. Existing transit-signage patterns are reused; integration does not create a second visual system.
4. Static and live modes share the same UI contract so later backend work is reversible.

## Decisions Log
| Decision | Rationale | Source |
|---|---|---|
| Keep the case study at the root and add the planner at `/app/` | Preserves the existing narrative while making the product directly usable | Owner approval, 2026-08-16 |
| Ship a labeled snapshot demo until a public API exists | GitHub Pages cannot run FastAPI; a truthful working demo is better than a broken live claim | Repository inspection and owner approval, 2026-08-16 |
| Use House Style Path B (Comply) | The app already has a mature transit-signage system and accessible components | `web/src/styles.css` and `docs/index.html` |
| Add representative bus stops and mixed-mode demo journeys | The public site is static; a bounded, labeled demonstration preserves trust while showing the intended multimodal experience | Owner direction, 2026-08-16 |
| Reveal the map after either endpoint is selected | Immediate spatial confirmation reduces selection errors while the text alternative preserves access | Owner direction, 2026-08-16 |
| Show curb-ramp detail for selected endpoints | A nominally accessible stop may still be difficult to reach from the sidewalk | Owner direction, 2026-08-16 |
| Match the app chrome to the landing page with a compact signage hero and shared wrapper | Creates a continuous site experience while preserving the task-first planner | Owner direction, 2026-08-17 |
| Refresh official public data once when the browser app opens | Gives the demonstration a truthful session timestamp without presenting the limited trip schedule and stop set as live | Owner direction, 2026-08-17 |
| Apply MTA station metadata before live equipment outages | Prevents a slower station response from overwriting a current blocking elevator outage | Implementation review, 2026-08-17 |
| Keep source-session messaging out of Report a Problem | Reporting is not connected in this demonstration; its own notice explains the disabled real-use MTA handoff | Owner direction, 2026-08-17 |
| Rename the reporting task “Draft a report” and preserve its state across tabs | Makes the copy-only demonstration boundary predictable and supports interruption/resumption without implying submission | Senior accessibility and neuroinclusive reviews, 2026-08-17 |
| Keep Leaflet controls out of the hidden map subtree and show attribution as ordinary content | Prevents keyboard focus from entering controls hidden from assistive technology while preserving required OpenStreetMap credit | Senior accessibility review, 2026-08-17 |
| Clear results and report output when source inputs change | Prevents stale output from appearing to match newly edited criteria | Senior neuroinclusive review, 2026-08-17 |

## Open Questions
- Which public host will eventually run the FastAPI service and generated feed?
- Should a future hosted version replace the bounded stop and schedule demonstration with the full realtime MTA trip-planning dataset?

## Artefact Index
- Brief: `docs/designpowers/briefs/2026-08-16-github-pages-app.md`
- Build contract: `docs/designpowers/builds/2026-08-16-github-pages-app-build-contract.md`
- Plan: `docs/designpowers/plans/2026-08-16-github-pages-app-plan.md`
- House style: `.designpowers/house-style/`
- Multimodal brief: `docs/designpowers/briefs/2026-08-16-multimodal-map-ramps.md`

## Handoff Chain
Discovery approved → House Style Path B → Standard build → rendered verification → local health report.

## Current Status
Opening-time public-data refresh and the accessibility review fix round are implemented and locally verified. The bounded planner requests MTA subway accessibility, current and planned elevator/escalator outages, and demo-route bus alerts once per page opening. Curb-ramp detail requests NYC Open Data when expanded. The compact session notice names the opening time, while the schedule and stop-set limitation remains explicit. Draft a report has a separate, unlinked demonstration notice.

## Visual Continuity Evidence
- Desktop render: `/tmp/mta-app-desktop.png`
- Mobile render: `/tmp/mta-app-mobile-final.png`
- Reflow render: `/tmp/mta-app-reflow-final.png`
- Responsive locks: 320, 390, 900, and 1440 CSS pixels inspected; 320 and 390 reported zero horizontal overflow.
- Accessibility DOM audit: one visible H1, zero unlabeled fields, zero undersized measured task controls, and visible focus across the first eight keyboard stops.
- House style: Path B final validator and tell checks pass; reference hashes refreshed after the final CSS/markup revision.
- Blind review: initial mobile-density revision addressed by a two-row non-sticky mobile masthead, smaller hero, and first form field entering the initial 390px viewport.
- Public-data renders: `/tmp/mta-source-refresh-final.png` and `/tmp/mta-source-refresh-mobile-final.png`; the browser reported all official source requests completed and displayed the opening and completion times.
- Curb-ramp task check: selecting Times Sq-42 St and expanding ramp details returned 74 NYC Open Data records, rendered six representative rows, showed the source line, and did not use the unavailable state.
- Report render: `/tmp/mta-report-final.png`; the session notice is absent and the disabled MTA handoff is explained before the form.
- Automated WCAG audit: axe-core reported zero direct violations on the landing page, planner, and report state at the tested desktop and mobile widths. Manual review resolved the reported contrast, keyboard-scroll, hidden-focus, and nested-landmark failures.
- Senior accessibility review fix evidence: landing page reflows at 320px; combobox synthesized click selects a stop; the hidden Leaflet subtree has zero focusable controls; visible OpenStreetMap attribution remains; all measured task controls meet 44px.
- Neuroinclusive re-review: zero Critical or Major findings; approved for deployment as a clearly labeled portfolio demonstration, not as a rider-facing travel product.
- State-resumption task test: trip results clear after query edits with visible and announced feedback; a composed report persists across tab changes and clears with feedback after its inputs change.

**Matrix check**
- Applied dimensions: context and mechanics; agentic UX, trust, and accessibility; design systems and prototyping; research and strategy.
- Hard gates: no destructive/external write; accessibility and truthful provenance required; rendered evidence required before readiness.
- Evidence status: Verified repository inspection plus owner-approved direction.
- Validation still required: production deployment and post-deployment URL verification.

## Design Debt Review
- Critical or major open items: none after the accessibility and neuroinclusive fix round.
- Known limitation: the trip schedule and stop set remain bounded demonstration data and are labeled as not suitable for travel decisions.
- Known dependency: browser-side refresh depends on third-party CORS availability; each source has a visible fallback or unavailable state.
- Minor: several secondary async failure messages state what remains available but do not offer an inline retry.
- Minor: Planned outages do not automatically filter to the selected From and To stops.
- Minor: combobox instructions do not yet explicitly say that a typed station must be committed from the suggestions.
- Minor: shared error notices use the generic heading “Something went wrong” instead of a task-specific heading.
- Minor: the OpenStreetMap attribution link opens a new tab without an explicit new-tab cue.
- Research note: test whether a persistent map show/hide preference reduces sensory load for people who prefer a text-first interface.
- Validation gap: no lived-experience study with disabled or neurodivergent participants has been completed; do not claim WCAG conformance or rider readiness from expert and automated review alone.
