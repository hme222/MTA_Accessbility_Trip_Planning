# Design Brief: Accessible MTA Interaction Color

## Problem Statement
The planner is clear and minimal, but its normal and interactive states feel too static for a portfolio demonstration. Add delight without turning brand color into decoration or weakening accessibility.

## Users
Portfolio and hackathon reviewers need to understand the concept quickly. Riders may use the interface with a screen reader, keyboard, limited motor control, low vision, color-vision differences, motion sensitivity, cognitive load, or a bright or dark display environment.

## Design Direction
Use a restrained, feedback-only color system. The black-and-white transit-signage base remains dominant. MTA blue, red, green, and yellow appear in hover, focus, selected, pressed, checked, and expanded states. Color always accompanies a structural cue such as weight, underline, inset rail, background, focus outline, arrow rotation, or pressed movement.

### Alternatives considered
- **Color-washed surfaces:** energetic but competes with accessibility status colors and makes the planner harder to scan.
- **Feedback-only MTA accents — chosen:** adds delight at the exact moment the interface responds while preserving quiet authority.
- **Route-coded page sections:** strongly branded but implies transit-line meaning where none exists and raises cognitive load.

## Constraints
- WCAG 2.2 AA is the implementation target; ADA is the legal context, not a color specification.
- Text contrast remains at least 4.5:1 and meaningful UI boundaries at least 3:1.
- Color is never the only indicator of state.
- All targets remain at least 44px.
- Motion is under 200ms, non-essential, and removed for `prefers-reduced-motion`.
- Dark mode and `prefers-contrast: more` receive adapted behavior.

## Existing Design System
House Style Path B in `.designpowers/house-style/` and the canonical tokens and states in `web/src/styles.css`.

## Taste Direction
Quiet authority with one controlled moment of transit-specific joy. Interaction should feel like an MTA line arriving at the platform, not like a multicolor dashboard.

## Interaction Specification
| Element | Hover/focus | Selected/open/pressed | Non-color cue |
|---|---|---|---|
| Tabs | Neutral surface plus route-color rail | Bold label plus route-color rule | Weight, rule, and `aria-selected` |
| Primary buttons | Yellow platform-edge inset | Short press movement | Existing label, border, and button semantics |
| Combobox option | Blue inset rail plus pale surface | Active option remains announced | Background and `aria-selected` |
| Demo and ramp disclosures | Blue/green inset rail | Arrow rotates and surface changes | Native `details`, arrow direction |
| Equipment and bus disclosures | Red/green inset rail | Arrow rotates and surface changes | Native `details`, labels, arrow direction |
| Report choice | Blue inset rail plus pale surface | Native radio remains checked | Radio control and checked state |

## Laws of UX Trace
**Source status:** Practitioner synthesis using the Laws of UX framework.

- **Aesthetic-Usability Effect:** restrained delight should improve perceived polish. Counter-risk: decoration can obscure function. Acceptance: color is limited to responsive states and semantic hierarchy remains readable without it.
- **Von Restorff Effect:** reserve the strongest yellow accent for the primary action. Counter-risk: too many accents erase priority. Acceptance: secondary actions and disclosures use narrower contextual rails.
- **Fitts's Law:** richer feedback must not shrink or crowd targets. Acceptance: all measured interactive targets remain at least 44×44px.

## Success Criteria
- The interface feels more responsive and MTA-specific in rendered hover, focus, selected, and expanded states.
- Automated WCAG checks report no violations.
- Manual contrast checks pass for each new interaction pairing.
- Keyboard focus remains obvious without relying on hover.
- Reduced-motion, dark, high-contrast, 320px reflow, and 200% zoom states remain usable.

## Out of Scope
Changing route-bullet brand colors, changing semantic outage/accessibility colors, adding looping animation, adding sound, changing layout, or adding another preference control.

Approved by: Hillary Esposito through direct owner request, 2026-08-17.
