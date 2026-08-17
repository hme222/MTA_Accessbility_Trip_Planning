# System Compliance

Canonical source: `web/src/styles.css`, `web/src/App.tsx`, `web/src/components.tsx`, and the corresponding project-page rules in `docs/index.html`
Registry fingerprint: `styles:d91236e2 app:b2c582f8 components:13fb78d5 docs:74305c30`
Allowed token namespaces: CSS custom properties declared on `:root`, semantic severity classes, existing spacing and measure rules
Allowed components/variants: `Masthead`, `Tabs`, `Planner`, `StationCombobox`, `Switch`, `TripCard`, `TransferCard`, `Loading`, `ErrorNotice`, `ReadAloud`, `Alternatives`, and existing static page button/link patterns
Composition rules: Keep one `main`; preserve tab/tabpanel ownership; place mode provenance before task controls; keep status text adjacent to the data it qualifies; use written labels plus shape/glyph for severity; reuse the existing wrapper and rules
Documented gaps: No existing component states whether the app is using snapshot or live data; compose a bounded status strip from canonical tokens without adding a component family
Escalation owner: Hillary Esposito, owner
