# Direction Lock

Path: B
Layout topology: compact full-width signage hero followed by a single-column planner in the shared 1080px wrapper
Primary carrier: data
Density: row 44px minimum; section 48px minimum; related gap 12px; unrelated gap 32px
Palette strategy: mono+1 with semantic status colors
Palette values: canonical custom properties in `web/src/styles.css`, including `--paper`, `--surface`, `--panel`, `--text`, `--text-soft`, `--accent`, `--go`, `--warn`, and `--stop`
Type stack: display `--sans`; body `--sans`; no third face
Type scale: ratio approximately 1.25; canonical rem and clamp values already defined in `web/src/styles.css`
Radius: canonical 2px focus treatment and existing small control radii only
Depth: borders only
Motion budget: animates opacity and supported disclosure transitions; never animates layout-critical position or required meaning; duration 200ms maximum
Grid: landing-page 1080px `.wrap` rhythm and existing planner grid rules; no new component grid

Approved by: Hillary Esposito, owner
Approved on: 2026-08-17
