# System Compliance

Canonical source: `web/src/styles.css`, `web/src/App.tsx`, `web/src/components.tsx`, `web/src/TripMap.tsx`, and the corresponding project-page rules in `docs/index.html`
Registry fingerprint: `styles:a6b3e396 app:4e7b3eab components:11961dd0 map:5aec6fbd docs:70c25731`
Allowed token namespaces: CSS custom properties declared on `:root`, semantic severity classes, theme-adapted `--mta-*-ui` interaction accents, existing spacing and measure rules
Allowed components/variants: `Masthead`, `Tabs`, `Planner`, `StationCombobox`, `Switch`, `TripCard`, `TransferCard`, `Loading`, `ErrorNotice`, `ReadAloud`, `Alternatives`, and existing static page button/link patterns
Composition rules: Keep one `main`; preserve tab/tabpanel ownership; place a native “About this demo” provenance disclosure before task controls without repeating the landing-page warning; keep any source-refresh failure visible when the disclosure is closed; keep status text adjacent to the data it qualifies; use written labels plus shape/glyph for severity; use MTA interaction color only with a non-color state cue; reuse the existing wrapper and rules
Documented gaps: None for this revision; interaction feedback composes existing controls and state selectors without adding a component family
Escalation owner: Hillary Esposito, owner
