# Market Whales OS — Design System

This internal operating system is visually inspired by the calm density and predictable interaction patterns of Exness. It does not copy Exness branding, logos, proprietary assets, or claim affiliation.

## Product character

- Light, quiet, data-first interface.
- Dense enough for daily team operations without looking crowded.
- Flat surfaces and fine separators instead of decorative cards and shadows.
- One yellow accent for the primary action or current progress; statuses always include text or an icon.
- RTL-first at every viewport from 320px upward.

## Tokens

| Role | Value |
|---|---|
| Primary ink | `#141D22` |
| Secondary ink | `#26343B` |
| Muted text | `#6C8595` |
| Subtle text | `#91A3B0` |
| Page | `#FFFFFF` |
| Canvas | `#F7F8F9` |
| Soft surface | `rgba(108, 133, 149, .08)` |
| Active surface | `rgba(108, 133, 149, .12)` |
| Border | `rgba(20, 29, 34, .12)` |
| Strong border | `rgba(20, 29, 34, .20)` |
| Primary action | `#FFD600` |

Typography uses the bundled `IBM Plex Sans Arabic` family. Headings are medium rather than extra-bold; numbers and English dates remain legible and aligned.

## Layout contract

- A 64px global header spans the full application.
- A 248px white sidebar groups navigation by job: operation, content, CRM, team, administration.
- Page titles are compact and followed by data surfaces, not marketing hero blocks.
- Operational collections use report/table rows on desktop and compact record cards on mobile.
- Deep records may expand or open a focused detail page. Default views expose only the next useful action.

## Components

- Buttons are 40px high, 4px radius, no shadows or lift animation.
- Inputs are 40px minimum, 4px radius, visible label and focus ring.
- Panels use 6–8px radius, 1px border, no decorative shadow.
- KPI rows are contiguous flat tiles separated by hairlines.
- Filters use segmented controls or compact toolbars above the related report.
- Primary actions use yellow; danger actions use red only when the consequence is destructive.

## Interaction and accessibility

- Every interactive element has visible keyboard focus.
- Never encode state by color alone.
- No layout-shifting hover effects.
- Respect `prefers-reduced-motion`.
- Avoid horizontal page overflow; wide reports scroll inside their own container and become labeled record cards on mobile.
