# System Compliance

Canonical source: `web/src/styles.css`, `web/src/App.tsx`, `web/src/components.tsx`, `web/src/TripMap.tsx`, and the corresponding project-page rules in `docs/index.html`
Registry fingerprint: `styles:1cfec961 app:2bbcee2a components:11961dd0 map:5aec6fbd docs:74305c30`
Allowed token namespaces: CSS custom properties declared on `:root`, semantic severity classes, existing spacing and measure rules
Allowed components/variants: `Masthead`, `Tabs`, `Planner`, `StationCombobox`, `Switch`, `TripCard`, `TransferCard`, `Loading`, `ErrorNotice`, `ReadAloud`, `Alternatives`, and existing static page button/link patterns
Composition rules: Keep one `main`; preserve tab/tabpanel ownership; place a native “About this demo” provenance disclosure before task controls without repeating the landing-page warning; keep any source-refresh failure visible when the disclosure is closed; keep status text adjacent to the data it qualifies; use written labels plus shape/glyph for severity; reuse the existing wrapper and rules
Documented gaps: None for this revision; the native disclosure and neutral ruled row use existing tokens and interaction patterns without adding a component family
Escalation owner: Hillary Esposito, owner
