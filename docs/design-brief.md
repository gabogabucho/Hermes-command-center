# Hermes Command Center Design Brief

## Experience intent

Hermes Command Center should feel like an operator instrument, not a generic SaaS dashboard. It should communicate vigilance, control, and calm under load.

The shell should behave like a command dashboard first: key operational status, command actions, and incident posture should fit in the initial viewport on typical desktop and tablet sizes, with internal panel scroll used before global page scroll.

## Reference systems

- **Astro UXDS** — mission-oriented framing and control-room mood
- **Carbon** — dashboard rigor and information grouping
- **Primer** — legible hierarchy and practical UI language
- **Fluent** — approachable productivity ergonomics
- **Cloudscape** — enterprise operational patterns and panel structure

## Distinction for Lite

Lite must remain visibly separate from the Pro surface and be framed by capability, not by a single hardware brand:

- monochrome-first
- low-motion
- chunky layout rhythm
- icon/dialog-driven task completion
- glanceable state over dashboard density
- readable from arm's length on e-ink and other constrained display hardware

It should feel like an operational placard or embedded appliance, not a compressed desktop app. Kindle-class readers are one good Lite example, alongside other monochrome or lower-capability displays.

## Distinction for Pro

Pro should feel premium, dense, and operationally serious on monitors, wallboards, tablets, and other richer-capability devices:

- layered panels
- stronger status gradients
- richer context panes
- support for future split views and drill-down workflows

## Initial visual brief

- Dark premium shell for the command center frame
- High-contrast neutral palette with restrained accent colors
- Monospace touches for runtime details
- Rounded cards, not playful widgets
- Typography and spacing that can scale from wallboard to desktop
- Instance/fleet controls should feel like shell scope selectors, not tenant-switcher SaaS chrome
- Dashboard regions should preserve glanceability with fixed-height sections and limited page-level scrolling
