# Hermes Command Center Architecture

## Positioning

Hermes Command Center is a standalone product that operates **on top of** an existing Hermes installation. It does not replace Hermes WebUI and should not assume all Hermes deployments expose identical surfaces or even require Hermes WebUI to be present.

## Architecture goals

- Decouple UI from any single Hermes API shape
- Support partial/degraded installs through capability probing
- Normalize operational data for both Lite and Pro surfaces
- Support both single-instance and multi-instance operator mental models from the same shell
- Keep Lite and Pro as presentation modes over a shared domain model
- Frame surfaces by device capability rather than a single branded hardware target

## Layer model

1. **Presentation layer**
   - Instance selector and fleet shell
   - Lite mode
   - Pro mode
   - Shared app shell and operator framing

2. **Domain layer**
   - Normalized fleet registry
   - Selected-instance command center snapshot
   - Session, agent, subagent, alert, action, and capability abstractions

3. **Adapter layer**
   - Local artifact probe adapter
   - Future Hermes runtime adapter
   - Future Hermes WebUI integration adapter
   - Future Hermes gateway adapter
   - Mock adapter for local development

4. **Capability probe layer**
   - Detects local install artifacts, optional health endpoints, and feature support
   - Produces a capability matrix, normalized incidents, and explicit safe-action availability consumed by the UI

## Adapter contract

The scaffold starts with a conceptual adapter contract:

```ts
type CapabilityKey =
  | 'sessions.read'
  | 'agents.read'
  | 'subagents.read'
  | 'alerts.read'
  | 'actions.invoke'
  | 'workspace.browse';

interface HermesInstanceRecord {
  summary: HermesInstanceSummary;
  snapshot: CommandCenterSnapshot;
}

interface FleetSnapshot {
  instances: HermesInstanceRecord[];
  discoverySuggestions: DiscoverySuggestion[];
}

interface HermesAdapter {
  id: string;
  label: string;
  getFleetSnapshot(): Promise<FleetSnapshot>;
}
```

Key expectations:

- `getFleetSnapshot()` returns normalized instances plus discovery candidates.
- Each `HermesInstanceRecord` contains registry metadata and one normalized snapshot for the selected instance view.
- Adapters may be layered or chained if multiple surfaces are available.

## First real adapter: local artifact probe

The first production-owned adapter in this repo is a small local probe exposed by the repo's own dev/preview server integration at `/api/fleet`.

It intentionally avoids importing or depending on `hermes-webui` internals. Instead it inspects Hermes-owned artifacts directly:

- the default Hermes home at `~/.hermes`
- profile-backed instance homes under `~/.hermes/profiles/*`
- `HERMES_HOME` values from the process environment or local config files
- official state/config artifacts documented by Hermes Agent such as `config.yaml`, `.env`, `auth.json`, `SOUL.md`, `state.db`, `sessions/`, `logs/`, `cron/`, `memories/`, `skills/`, and `profiles/`
- optional install inference from `~/.local/bin/hermes`
- optional localhost `/health` check when a loopback URL can be inferred

This gives the Command Center a standalone read-only MVP while preserving future room for richer adapters.

### Conservative instance naming

The probe now names instances from official/local Hermes signals only, in this order:

1. profile directory name for `~/.hermes/profiles/*`
2. top-level `name` in `config.yaml` when present
3. first clear `SOUL.md` heading when it is obviously more specific than a generic title
4. default-root fallback `Hermes Home` for `~/.hermes`
5. prettified local directory name as the final fallback

This intentionally removes looser env-var naming guesses so the UI stays grounded in standard Hermes artifacts.

The current probe intentionally stays at filesystem-signal depth for official artifacts:

- `config.yaml`, `.env`, `auth.json`, `SOUL.md` → configuration footprint
- `state.db` schema discovery + minimal recognized session/message metadata → official CLI/session-store recency/context signal
- `sessions/` file count + newest transcript mtime → gateway session presence/recency
- `logs/` file count + newest mtime → basic runtime recency hint
- `profiles/` subdirectory count → profile-backed instance discovery

It does **not** depend on `hermes-webui` storage formats and does **not** parse bespoke repo-owned files. `state.db` inspection stays read-only, table-first, and intentionally conservative: if `sessions` / `messages` are not obviously recognizable, the probe keeps only limited evidence instead of guessing the schema.

## Capability model

Capability probing should answer:

- Which backend surfaces are reachable?
- Which operator actions are safe to expose?
- Which features are missing and must degrade gracefully?
- Which surface should be preferred for the current device and capability mix?
- Which local install artifacts suggest a Hermes instance even before a live API handshake exists?

## Normalized data model

### FleetSnapshot

- `instances`: registered Hermes installs
- `discoverySuggestions`: potential installs surfaced by discovery mechanisms

### HermesInstanceSummary

- stable instance id
- display name and environment
- fleet status (`online`, `degraded`, `offline`)
- registration source (`seeded`, `manual`, `discovered`)
- connection metadata (`path`, `baseUrl`, `transport`)
- capability summary counts for registry views

### CommandCenterSnapshot

- `installation`: identity and environment summary
- `capabilities`: feature availability and confidence
- `agents`: active top-level agents
- `subagents`: child workers or delegated tasks
- `alerts`: operational warnings or incidents
- `queues`: throughput and backlog signals
- `actions`: user-invokable operator actions

### Agent summary

- stable id
- display label
- role or task
- current status
- last activity time
- relation to workspace/session

### Alert summary

- severity
- label
- source
- acknowledgement state
- recommended operator action

### Incident summary

- severity and normalized category (`readiness`, `configuration`, `activity`, `artifacts`, `health`, `actions`)
- title, source, and short operator-facing summary
- explicit action hint derived from official Hermes signals only

### Operator action summary

- fixed action id (`hermes-doctor` or `hermes-status`)
- explicit availability (`available` or `blocked`)
- fixed command label rather than freeform command strings
- conservative note explaining exactly why the action is or is not exposed

## Lite vs Pro interpretation

Lite and Pro consume the same selected normalized snapshot but prioritize different rendering behaviors based on device capability:

- **Lite** prefers status tiles, dialogs, and binary operator choices for monochrome, e-ink, smaller, or otherwise constrained devices.
- **Pro** prefers dense panels, grouped telemetry, and richer comparative context for monitors, tablets, wallboards, and other larger-capability screens.

The app shell owns instance selection. The mode surfaces should not implement their own parallel instance stores.

## Single-instance and multi-instance coexistence

The domain intentionally treats a single install as a fleet of one:

- single-instance operators still choose one active instance and work normally
- multi-instance operators keep a registry and switch the current shell scope
- the selected instance snapshot is the contract consumed by Lite and Pro

This prevents a future migration from "one install" to "fleet view" from requiring a model rewrite.

## Near-term implementation path

1. Keep a mock fleet adapter as the fallback dev source.
2. Add persisted instance registry storage.
3. Extend the local artifact probe to parse minimal `state.db` session metadata and richer readiness evidence.
4. Split adapters by backend surface.
5. Introduce optional runtime/API enrichers without making them hard dependencies.
6. Keep command invocation contracts explicit and narrow — only local `hermes doctor` and `hermes status` are wrapped, with no arbitrary command execution and no `--fix` automation.
