# Reference Manifest

## `web/src/styles.css`
STEAL: Canonical tokens, rules, targets, focus treatment, and high-contrast transit-signage hierarchy
IGNORE: Nothing; this is the product source of truth
Evidence: Verified local CSS, SHA-256 `1cfec9611cabe022a8bcc0e5c52dc992bed8db7df08b9503eca0dd11152530b5`

## `web/src/App.tsx`
STEAL: Shallow tab structure, disclosure placement, focus movement, and persistent mounted panels
IGNORE: Comments that describe only two panels; the current implementation has three
Evidence: Verified local source, SHA-256 `2bbcee2a29e351e1e269907fcd9741da736a1d9955824897163db5178c76ac0f`

## `web/src/components.tsx`
STEAL: Existing combobox, status, error, route, and non-color severity components
IGNORE: No new component family is inferred from one integration message
Evidence: Verified local source, SHA-256 `11961dd0b2f168d9ae5daadcb003d5517a3b0cbf58b53dce29c3644cdd0257b7`

## `web/src/TripMap.tsx`
STEAL: Text-equivalent map composition, non-interactive tile canvas, visible attribution, and endpoint status pairing
IGNORE: Leaflet's default keyboard and attribution controls, which conflict with the intentionally hidden visual map subtree
Evidence: Verified local source, SHA-256 `5aec6fbd83a642c86f90521c8b19cab6561d36252b39aabb458eb1e699e4363f`

## `docs/index.html`
STEAL: Matching project-page masthead, black/white rules, content measure, and project narrative
IGNORE: Stale mobile-app, single-train, and out-of-scope claims that no longer match the source
Evidence: Verified local source, SHA-256 `74305c3076bb73c9f6a7ae3d32e2d63b0239bdfa0d38be066adffbd89ceaf13f`
