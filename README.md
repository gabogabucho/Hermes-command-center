# Hermes Command Center

Hermes Command Center is a standalone control-surface product for operators running an already-functional Hermes installation. It is not a mode inside `hermes-webui`; it is a separate repo and deployment target focused on monitoring, orchestration visibility, and fast intervention for live agents and subagents.

This repository is MIT-licensed open source software. The product contract and UI scaffold are intended to stay transparent, forkable, and capability-driven rather than tied to one vendor device family.

The UI is explicitly framed as a command dashboard product: the first screen should remain operationally useful without scrolling, and sections should prefer fixed dashboard regions with internal overflow over one long page.

## Product concept

The product frames Hermes as an always-on operational cockpit organized by device capability:

- **Pro** — the richer command surface chosen for displays and inputs that can support denser telemetry and more simultaneous panels.
- **Lite** — the reduced command surface chosen for constrained, monochrome, low-motion, touch-first, or otherwise lower-capability environments.

Both surfaces sit on top of Hermes through adapter contracts and capability probing rather than assuming one fixed backend shape.

## Pro/Lite automatic surface-selection contract

Pro vs Lite is a **surface-selection strategy**, not a brand or hardware SKU distinction.

The intended contract is:

1. **An explicit user override always wins** (`Auto`, `Lite`, or `Pro`).
2. In **Auto** mode, Hermes Command Center evaluates the current display/input surface instead of checking device brand names.
3. The selection uses practical capability signals:
   - viewport width and height
   - display color depth
   - pointer precision and hover support
   - reduced-motion preference
4. **Lite is selected immediately** when the detected color depth is `8-bit` or lower, because that strongly suggests an e-ink, monochrome, or otherwise constrained display surface.
5. Otherwise, **Lite is selected when two or more constrained-surface signals are present**:
   - viewport width below `960px`
   - viewport height below `720px`
   - no hover support or no fine pointer
   - `prefers-reduced-motion: reduce`
6. **Pro is selected** when Lite does not win. In practice this means a wider color display with enough room and interaction fidelity for denser telemetry.

This contract is the product-level definition even when runtime implementation is still evolving. The goal is to keep the surface decision explainable, testable, and independent from brand labels such as Kindle, tablet, monitor, or wallboard.

From day 1 the scaffold supports both mental models:

- **Single-instance mode** — pick one Hermes install and operate as if it is the only target.
- **Multi-instance mode** — keep a normalized fleet registry and switch the active shell scope without changing Lite or Pro rendering contracts.

## Core use cases

- Monitor active agents and subagents from a wall-mounted or desk-side command surface.
- See runtime health, queue pressure, recent activity, and intervention opportunities.
- Confirm whether a Hermes install exposes WebUI APIs, gateway APIs, direct runtime APIs, or only partial capabilities.
- Switch between multiple Hermes instances while keeping one selected operational scope in the shell.
- Register an instance manually or review auto-discovery suggestions from the local probe layer.
- Offer different UI density levels without changing the underlying operational model.

## Surface profiles

### Lite

- E-ink friendly layout
- Monochrome palette
- Large tap targets
- Low-motion interaction model
- Icon/dialog-driven actions
- Designed for persistent glanceability over deep navigation
- Suitable for Kindle-class readers as one example, but not limited to them
- Framed as the lower-capability dashboard surface rather than a device-branded mode
- Preferred automatically when the current surface looks constrained by viewport, motion preference, pointer/hover capability, or color depth

### Pro

- Monitor/tablet/wallboard responsive workspace
- Richer-capability command dashboard framing
- Denser telemetry and richer panels
- Better suited for multi-stream monitoring and future command workflows
- Preferred automatically when the current surface has sufficient space, color depth, and interaction fidelity for dense operational layouts

## Dashboard layout principles

- First screen should expose command posture, selected target, incident posture, and operator actions without requiring page scroll.
- Prefer viewport-aware panel layouts with internal scrolling for deep lists.
- Preserve glanceability across monitor, tablet, wallboard, and constrained-device targets.
- Keep shell copy in English and avoid backend-scope expansion in UI refinements.

## Architecture summary

Hermes Command Center assumes:

1. Hermes is already installed and functional.
2. This project does **not** own the Hermes runtime.
3. The UI talks to Hermes through **adapters**.
4. Adapters perform **capability probing** to discover what each connected install can do.
5. The UI keeps a normalized **instance registry** plus a selected-instance snapshot.
6. Lite and Pro render the same selected instance from shared normalized data.

See `docs/architecture.md` for adapter contracts and normalized data shapes.

## Fleet model in the scaffold

The current MVP now includes a first real local probe adapter plus scaffold fallback:

- normalized instance records with status, transport, base URL/path metadata, and capability summary
- local filesystem/env probe for common Hermes install artifacts
- optional localhost `/health` readiness check when a loopback base URL can be inferred
- mock adapter data for multiple Hermes instances when probe data is unavailable or empty
- app-shell instance selector
- registered-instances panel
- fallback manual add flow (`name`, `path`, `base URL`)
- discovery suggestion cards sourced by the probe

This remains read-first. There is still no write-path backend or persistent registry yet.

## Stack

- React 18
- TypeScript
- Vite 5
- Lightweight custom CSS for the initial shell

## Project structure

```text
src/
  adapters/        # capability contracts and mock fleet adapter
  app/             # shell and composition
  data/            # mocked fleet + selected instance state
  modes/           # Lite and Pro surfaces
  styles/          # global styling
```

## Getting started

```bash
npm install
npm run dev
```

The Vite dev server now exposes repo-owned probe endpoints at `/api/fleet` and `/api/probe/health`.
The frontend tries real probe data first and falls back to the mock fleet when the probe is unavailable or finds no confident instances.

Run the probe directly:

```bash
npm run probe:once
```

Build validation:

```bash
npm run build
```

The current scaffold also exposes the Pro/Lite recommendation in the UI, including an `Auto / Lite / Pro` override control so the contract is visible even before all runtime behavior is fully implemented.

## Initial roadmap

### Phase 0 — scaffold

- Establish product identity
- Create Lite and Pro shell views
- Define adapter and capability contracts
- Normalize initial mock data model

### Phase 1 — live connectivity

- Implement Hermes install discovery
- Add capability probe flows
- Persist instance registration and selection
- Connect real session/agent/subagent data
- Introduce degraded-mode handling for partial backends

### Phase 2 — operator workflows

- Incident triage flows
- Intervention dialogs and approvals
- Alert routing and escalation views
- Persistent wallboard mode for Lite

### Phase 3 — premium command center

- Pro analytics panels
- Multi-workspace visibility
- Historical state comparison
- Role-aware operations surfaces

## Design direction

The visual direction draws selectively from:

- **Astro UXDS** for mission-control framing
- **Carbon** for structured dashboard discipline
- **Primer** for pragmatic information hierarchy
- **Fluent** for approachable productivity patterns
- **Cloudscape** for operational clarity at scale

Lite should remain distinct: monochrome, quiet, tactile, and purposefully reduced rather than a downgraded Pro skin. Kindle-class e-ink readers remain a useful example, not the defining label. See `docs/design-brief.md`.

## Current real probe behavior

The standalone probe adapter currently detects and derives read-only snapshots from:

- the official default Hermes home at `~/.hermes`
- profile-backed instances under `~/.hermes/profiles/*`
- `HERMES_HOME` when explicitly set in the environment
- `HERMES_HOME` values derived from local `.env`, `.env.example`, or `config.yaml`
- the standard Hermes home layout documented by Hermes Agent, including `config.yaml`, `.env`, `auth.json`, `SOUL.md`, `state.db`, `sessions/`, `logs/`, `cron/`, `memories/`, `skills/`, and `profiles/`
- optional install inference from `~/.local/bin/hermes` when the global CLI symlink points into a Hermes-managed virtualenv
- optional localhost `/health` responses when a loopback base URL can be inferred from local config

The richer probe snapshot stays intentionally conservative and only uses official/default Hermes signals:

- `config.yaml`, `.env`, `auth.json`, and `SOUL.md` to estimate whether an instance looks empty, partially configured, or configured
- `state.db` schema discovery plus minimal read-only session/message metadata when the official SQLite layout is recognizable
- `sessions/` transcript file count and newest file mtime for recent gateway session evidence
- `logs/` file presence/count and newest file mtime for basic runtime recency hints
- `profiles/` directory count for multi-agent profile discovery under the standard Hermes home layout

### Naming heuristics

Instance names now stay deliberately conservative and repo-owned:

1. **Profile instances** use the official profile directory name from `~/.hermes/profiles/<name>`.
2. **Any instance with `config.yaml: name`** may use that exact top-level name.
3. **Any instance with a clear `SOUL.md` heading** may use that heading when it is more specific than a generic title like `Hermes` or `SOUL`.
4. **The default root `~/.hermes` home** falls back to `Hermes Home` when no clearer official/local signal exists.
5. Other local candidates fall back to a prettified directory name.

The probe does **not** invent composite names from arbitrary env vars or undocumented repo-specific metadata.

From those signals, the probe now infers:

- basic readiness (`empty`, `configured`, `active`)
- configuration footprint quality (`empty`, `partial`, `configured`)
- recent session presence and transcript count
- latest observed activity source/recency from `sessions/`, recognized `state.db` session/message timestamps, `state.db` mtime fallback, or `logs/`
- more meaningful alerts when a discovered `~/.hermes` path is missing the expected official artifacts
- normalized incidents in these categories: `readiness`, `configuration`, `activity`, `artifacts`, `health`, and `actions`
- explicit local action capability checks for the safe `hermes doctor` and `hermes status` wrappers

## Safe local action wrappers: `hermes doctor` and `hermes status`

The first action set is intentionally narrow and explicit:

- the UI can trigger **only** `hermes doctor` and `hermes status`
- it runs against the **selected local Hermes instance** only
- it resolves the executable from official/local install signals when possible
- it sets `HERMES_HOME` to the selected local instance path before invocation
- it does **not** pass `--fix`
- it does **not** allow arbitrary commands or arbitrary CLI arguments
- it returns a small running/success/failure summary plus a short output preview instead of a full logs console

Current executable resolution order is conservative:

1. a Hermes-managed virtualenv launcher under an inferred install root (`venv/bin/hermes` or `venv/Scripts/hermes*`)
2. the standard local launcher path `~/.local/bin/hermes` (or Windows-style `hermes.exe` / `hermes.cmd` when present)

If no executable can be resolved, the action stays blocked and the incident/action summary explains why.

What it does **not** do yet:

- query remote Hermes APIs as a requirement
- depend on `hermes-webui` internals or import its code
- parse transcript payload bodies or assume undocumented SQLite columns beyond the minimal `sessions` / `messages` evidence that is defensively discovered at runtime
- parse live agent/subagent lists from runtime payloads
- expose arbitrary command execution
- run `hermes doctor --fix`
- run any other Hermes CLI subcommand
- persist command history or build a full logs UX for action output

### `state.db` scope

When `state.db` is present, the probe now opens it in read-only mode and first discovers tables defensively. If the database exposes an obvious Hermes-style `sessions` and/or `messages` layout, the snapshot may include only these minimal signals:

- table presence and sampled table names
- cheap row counts for recognizable tables
- latest `started_at` / `timestamp` values when those columns exist
- a few recent session ids or `source` markers when those columns are obvious

If the schema is different, locked, unreadable, or otherwise unrecognized, the probe does not fail. It keeps the file-level `state.db` evidence, records that the schema was not recognized, and continues with the rest of the read-only artifact probe.
