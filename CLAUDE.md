# SocialMediaAutomation

## Web UI — Bridge88 design system

All web UI in this repo follows the Bridge88 design system, which ships as a
project skill at `.claude/skills/bridge88-design/`:

- `README.md` — brand rules, tokens, voice, visual foundations
- `COMPONENTS.md` — prop contracts and usage for every component
- `components/` — the React UI kit (no build step, no deps beyond React)
- `bridge88.css` — tokens and base styles; import once at the app root

When building UI, read those rules and use the existing components. Never
hand-roll a component that already exists in the kit.

For production code, copy the kit into the app source (`src/bridge88/` is the
intended home) and import from there rather than from `.claude/`. Update the
paths above if that layout changes.
