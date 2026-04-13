import { useEffect, useMemo, useState } from 'react';
import { invokeDoctor, invokeStatus, loadFleetSnapshot, type FleetLoadResult, type OperatorActionResponse } from '../adapters/probeAdapter';
import type {
  DiscoverySuggestion,
  FleetSnapshot,
  HermesInstanceRecord,
  HermesInstanceStatus,
  OperatorActionId,
  OperatorActionSummary,
} from '../adapters/types';
import { LiteMode } from '../modes/LiteMode';
import type { ActionRunState } from '../modes/panelModel';
import { ProMode } from '../modes/ProMode';

type SurfaceMode = 'lite' | 'pro';
type SurfaceOverride = 'auto' | SurfaceMode;

type ManualInstanceDraft = {
  name: string;
  path: string;
  baseUrl: string;
};

type SurfaceSignals = {
  viewportWidth: number;
  viewportHeight: number;
  colorDepth: number;
  hasHover: boolean;
  hasFinePointer: boolean;
  prefersReducedMotion: boolean;
};

type SurfaceSelectionResult = {
  mode: SurfaceMode;
  reason: string;
  signals: SurfaceSignals;
};

const emptyDraft: ManualInstanceDraft = {
  name: '',
  path: '',
  baseUrl: '',
};

function getMediaQueryMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(query).matches;
}

function readSurfaceSignals(): SurfaceSignals {
  if (typeof window === 'undefined') {
    return {
      viewportWidth: 1280,
      viewportHeight: 800,
      colorDepth: 24,
      hasHover: true,
      hasFinePointer: true,
      prefersReducedMotion: false,
    };
  }

  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    colorDepth: window.screen.colorDepth || 24,
    hasHover: getMediaQueryMatch('(hover: hover)'),
    hasFinePointer: getMediaQueryMatch('(pointer: fine)'),
    prefersReducedMotion: getMediaQueryMatch('(prefers-reduced-motion: reduce)'),
  };
}

function resolveAutoSurfaceSelection(signals: SurfaceSignals): SurfaceSelectionResult {
  const reasons: string[] = [];
  let liteScore = 0;

  if (signals.colorDepth <= 8) {
    liteScore += 3;
    reasons.push('limited color depth');
  }

  if (signals.viewportWidth < 960 || signals.viewportHeight < 720) {
    liteScore += 1;
    reasons.push('compact viewport');
  }

  if (!signals.hasHover || !signals.hasFinePointer) {
    liteScore += 1;
    reasons.push('touch-first or non-hover input');
  }

  if (signals.prefersReducedMotion) {
    liteScore += 1;
    reasons.push('reduced-motion preference');
  }

  if (liteScore >= 2) {
    return {
      mode: 'lite',
      reason: reasons.join(' · '),
      signals,
    };
  }

  return {
    mode: 'pro',
    reason: 'wide color display with room for denser telemetry',
    signals,
  };
}

function createScaffoldInstance(
  draft: ManualInstanceDraft,
  overrides?: Partial<HermesInstanceRecord['summary']> & { reasonLabel?: string },
): HermesInstanceRecord {
  const instanceName = draft.name.trim() || overrides?.name || 'New Hermes Instance';
  const instancePath = draft.path.trim();
  const instanceBaseUrl = draft.baseUrl.trim();
  const status = overrides?.status ?? ('degraded' satisfies HermesInstanceStatus);
  const id =
    overrides?.id ??
    `instance-${instanceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`;

  return {
    summary: {
      id,
      name: instanceName,
      environment: overrides?.environment ?? 'manual registration',
      status,
      source: overrides?.source ?? 'manual',
      connection: {
        path: instancePath || overrides?.connection?.path,
        baseUrl: instanceBaseUrl || overrides?.connection?.baseUrl,
        transport: overrides?.connection?.transport ?? 'manual scaffold registration',
      },
      capabilitySummary: overrides?.capabilitySummary ?? {
        available: 0,
        limited: 3,
        unavailable: 3,
      },
    },
    snapshot: {
      installation: {
        name: instanceName,
        environment: overrides?.environment ?? 'manual registration',
        target: overrides?.reasonLabel ?? 'Pending real probe and normalization',
      },
      capabilityReport: {
        transport: overrides?.connection?.transport ?? 'manual scaffold registration',
        capabilities: [
          { key: 'sessions.read', status: 'limited', note: 'Conceptual placeholder until a real adapter probes it' },
          { key: 'agents.read', status: 'limited', note: 'Registry entry created, live telemetry not connected yet' },
          { key: 'subagents.read', status: 'unavailable', note: 'No runtime handshake completed' },
          { key: 'alerts.read', status: 'limited', note: 'Static scaffold alert state only' },
          { key: 'actions.invoke', status: 'unavailable', note: 'Write workflows intentionally deferred' },
          { key: 'workspace.browse', status: 'unavailable', note: 'No backend integration yet' },
        ],
      },
      agents: [],
      subagents: [],
      alerts: [
        {
          id: `${id}-scaffold-alert`,
          label: `${instanceName} is registered as a scaffold-only instance`,
          severity: status === 'offline' ? 'critical' : 'info',
          source: 'instance registry',
          actionHint: 'Connect a real adapter and run capability probing',
        },
      ],
      incidents: [
        {
          id: `${id}-scaffold-incident`,
          category: 'actions',
          title: `${instanceName} is registered as a scaffold-only instance`,
          severity: status === 'offline' ? 'critical' : 'info',
          source: 'instance registry',
          summary: 'No local probe-backed Hermes home was verified for this instance yet.',
          actionHint: 'Connect a real adapter and run capability probing.',
        },
      ],
      queues: [
        { label: 'Pending telemetry', depth: 0, trend: 'awaiting probe' },
        { label: 'Pending actions', depth: 0, trend: 'read-only scaffold' },
        { label: 'Discovery tasks', depth: 1, trend: 'manual follow-up' },
      ],
      actions: [
        {
          id: 'hermes-doctor',
          label: 'Run Hermes doctor',
          commandLabel: 'hermes doctor',
          availability: 'blocked',
          scope: 'local-instance',
          note: 'Doctor is only available for probe-backed local Hermes installs.',
        },
        {
          id: 'hermes-status',
          label: 'Run Hermes status',
          commandLabel: 'hermes status',
          availability: 'blocked',
          scope: 'local-instance',
          note: 'Status is only available for probe-backed local Hermes installs.',
        },
      ],
    },
  };
}

function createInstanceFromSuggestion(suggestion: DiscoverySuggestion): HermesInstanceRecord {
  return createScaffoldInstance(
    {
      name: suggestion.name,
      path: suggestion.path ?? '',
      baseUrl: suggestion.baseUrl ?? '',
    },
    {
      id: suggestion.id,
      name: suggestion.name,
      environment: suggestion.environment,
      source: 'discovered',
      status: 'degraded',
      connection: {
        path: suggestion.path,
        baseUrl: suggestion.baseUrl,
        transport: suggestion.transport,
      },
      capabilitySummary: {
        available: suggestion.capabilityHints.length,
        limited: 0,
        unavailable: Math.max(0, 6 - suggestion.capabilityHints.length),
      },
      reasonLabel: suggestion.reason,
    },
  );
}

export function App() {
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  const [manualDraft, setManualDraft] = useState<ManualInstanceDraft>(emptyDraft);
  const [fleetSource, setFleetSource] = useState<FleetLoadResult | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [surfaceOverride, setSurfaceOverride] = useState<SurfaceOverride>('auto');
  const [surfaceSelection, setSurfaceSelection] = useState<SurfaceSelectionResult>(() =>
    resolveAutoSurfaceSelection(readSurfaceSignals()),
  );
  const [actionRunsByInstance, setActionRunsByInstance] = useState<Record<string, Partial<Record<OperatorActionId, ActionRunState>>>>({});

  const refreshFleet = async () => {
    setIsRefreshing(true);

    const resolvedFleet = await loadFleetSnapshot();

    setFleet(resolvedFleet.fleet);
    setFleetSource(resolvedFleet);
    setSelectedInstanceId((currentSelectedId) => {
      if (resolvedFleet.fleet.instances.some((instance) => instance.summary.id === currentSelectedId)) {
        return currentSelectedId;
      }

      return resolvedFleet.fleet.instances[0]?.summary.id ?? '';
    });
    setIsRefreshing(false);
  };

  useEffect(() => {
    void refreshFleet();
  }, []);

  useEffect(() => {
    const updateSurfaceSelection = () => {
      setSurfaceSelection(resolveAutoSurfaceSelection(readSurfaceSignals()));
    };

    updateSurfaceSelection();

    if (typeof window === 'undefined') {
      return undefined;
    }

    window.addEventListener('resize', updateSurfaceSelection);

    const mediaQueries = [
      window.matchMedia('(hover: hover)'),
      window.matchMedia('(pointer: fine)'),
      window.matchMedia('(prefers-reduced-motion: reduce)'),
    ];

    mediaQueries.forEach((query) => query.addEventListener('change', updateSurfaceSelection));

    return () => {
      window.removeEventListener('resize', updateSurfaceSelection);
      mediaQueries.forEach((query) => query.removeEventListener('change', updateSurfaceSelection));
    };
  }, []);

  const selectedInstance = useMemo(
    () => fleet?.instances.find((instance) => instance.summary.id === selectedInstanceId) ?? fleet?.instances[0],
    [fleet, selectedInstanceId],
  );

  const effectiveSurfaceMode: SurfaceMode = surfaceOverride === 'auto' ? surfaceSelection.mode : surfaceOverride;

  if (!fleet || !selectedInstance) {
    return (
      <main className="shell">
        <section className="hero-panel loading-panel">
          <div>
            <span className="eyebrow">Hermes Command Center</span>
            <h1>Loading command surface…</h1>
            <p className="lede">Resolving the standalone local probe adapter with mock fallback.</p>
          </div>
        </section>
      </main>
    );
  }

  const handleManualAdd = () => {
    if (!manualDraft.name.trim()) {
      return;
    }

    const instance = createScaffoldInstance(manualDraft);

    setFleet((currentFleet) => {
      if (!currentFleet) {
        return currentFleet;
      }

      return {
        ...currentFleet,
        instances: [...currentFleet.instances, instance],
      };
    });

    setSelectedInstanceId(instance.summary.id);
    setManualDraft(emptyDraft);
  };

  const handleSuggestionAdd = (suggestion: DiscoverySuggestion) => {
    const instance = createInstanceFromSuggestion(suggestion);

    setFleet((currentFleet) => {
      if (!currentFleet) {
        return currentFleet;
      }

      return {
        instances: [...currentFleet.instances, instance],
        discoverySuggestions: currentFleet.discoverySuggestions.filter(
          (candidate) => candidate.id !== suggestion.id,
        ),
      };
    });

    setSelectedInstanceId(instance.summary.id);
  };

  const handleActionResult = (payload: OperatorActionResponse): ActionRunState => ({
    action: payload.action,
    status: payload.status,
    updatedAt: Date.now(),
    summary: payload.summary,
    durationMs: payload.durationMs,
    exitCode: payload.exitCode,
    executablePath: payload.executablePath,
    command: payload.command,
    outputLines: payload.outputLines,
  });

  const handleRunAction = async (instance: HermesInstanceRecord, action: OperatorActionSummary) => {
    const invoke = action.id === 'hermes-status' ? invokeStatus : invokeDoctor;

    setActionRunsByInstance((current) => ({
      ...current,
      [instance.summary.id]: {
        ...current[instance.summary.id],
        [action.id]: {
          action: action.id,
          status: 'running',
          updatedAt: Date.now(),
          summary: `Running ${action.commandLabel}…`,
          command: action.commandLabel,
          outputLines: [],
        },
      },
    }));

    try {
      const payload = await invoke(instance.summary.id);
      setActionRunsByInstance((current) => ({
        ...current,
        [instance.summary.id]: {
          ...current[instance.summary.id],
          [action.id]: handleActionResult(payload),
        },
      }));
    } catch (error) {
      setActionRunsByInstance((current) => ({
        ...current,
        [instance.summary.id]: {
          ...current[instance.summary.id],
          [action.id]: {
            action: action.id,
            status: 'failed',
            updatedAt: Date.now(),
            summary: error instanceof Error ? error.message : `${action.commandLabel} failed.`,
            command: action.commandLabel,
            outputLines: [],
          },
        },
      }));
    }
  };

  const selectedActionRuns = actionRunsByInstance[selectedInstance.summary.id] ?? {};

  return (
    <main className="shell">
      <section className="hero-panel shell-banner">
        <div>
          <span className="eyebrow">Hermes Command Center</span>
          <h1>Operational command dashboard for live Hermes installs.</h1>
          <p className="lede">
            One normalized fleet model powers Pro dashboards for larger displays and Lite dashboards
            for monochrome or lower-capability hardware.
          </p>
        </div>

        <div className="hero-meta">
          <div className="meta-card">
            <span>Data source</span>
            <strong>{fleetSource?.label ?? 'Loading…'}</strong>
            <small>{fleetSource?.detail ?? 'Resolving local probe adapter.'}</small>
          </div>
          <div className="meta-card">
            <span>Selected instance</span>
            <strong>{selectedInstance.summary.name}</strong>
            <small>
              {selectedInstance.summary.environment} · {selectedInstance.summary.status}
            </small>
          </div>
          <div className="meta-card">
            <span>Fleet model</span>
            <strong>{fleet.instances.length} registered instances</strong>
            <small>{fleet.discoverySuggestions.length} discovery suggestions queued</small>
          </div>
          <div className="meta-card meta-card-action">
            <span>Surface contract</span>
            <strong>{effectiveSurfaceMode === 'pro' ? 'Pro recommended' : 'Lite recommended'}</strong>
            <small>
              {surfaceOverride === 'auto'
                ? `Auto-selected from ${surfaceSelection.reason}.`
                : `Manual override active. Auto mode would choose ${surfaceSelection.mode}.`}
            </small>
            <div className="segmented-control" role="group" aria-label="Surface selection override">
              <button
                type="button"
                className={`segmented-button ${surfaceOverride === 'auto' ? 'is-active' : ''}`}
                onClick={() => setSurfaceOverride('auto')}
              >
                Auto
              </button>
              <button
                type="button"
                className={`segmented-button ${surfaceOverride === 'lite' ? 'is-active' : ''}`}
                onClick={() => setSurfaceOverride('lite')}
              >
                Lite
              </button>
              <button
                type="button"
                className={`segmented-button ${surfaceOverride === 'pro' ? 'is-active' : ''}`}
                onClick={() => setSurfaceOverride('pro')}
              >
                Pro
              </button>
            </div>
          </div>
          <div className="meta-card meta-card-action">
            <span>Probe refresh</span>
            <strong>{fleetSource?.generatedAt ? 'Snapshot captured' : 'Fallback active'}</strong>
            <small>{fleetSource?.generatedAt ?? 'Mock data stays available when probe data is absent.'}</small>
            <button type="button" className="secondary-button inline-button" onClick={() => void refreshFleet()}>
              {isRefreshing ? 'Refreshing…' : 'Refresh probe'}
            </button>
          </div>
        </div>
      </section>

      <section className="dashboard-layout">
        <div className="control-column">
          <article className="panel fleet-panel fleet-panel-primary">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Command scope</span>
              <h2>Selected instance</h2>
            </div>
            <span className={`badge badge-${selectedInstance.summary.status}`}>
              {selectedInstance.summary.status}
            </span>
          </div>

          <label className="field-label" htmlFor="instance-selector">
            Current command target
          </label>
          <select
            id="instance-selector"
            className="field-input"
            value={selectedInstance.summary.id}
            onChange={(event) => setSelectedInstanceId(event.target.value)}
          >
            {fleet.instances.map((instance) => (
              <option key={instance.summary.id} value={instance.summary.id}>
                {instance.summary.name} — {instance.summary.environment}
              </option>
            ))}
          </select>

          <div className="registry-compact-card">
            <strong>{selectedInstance.snapshot.installation.name}</strong>
            <p>{selectedInstance.snapshot.installation.target}</p>
            <small>
              {selectedInstance.summary.connection.baseUrl ?? selectedInstance.summary.connection.path ?? 'No endpoint yet'}
            </small>
          </div>
        </article>

        <article className="panel fleet-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Fleet registry</span>
              <h2>Registered command targets</h2>
            </div>
            <span className="badge badge-pro">Normalized</span>
          </div>

          <div className="registry-list">
            {fleet.instances.map((instance) => (
              <button
                key={instance.summary.id}
                type="button"
                className={`registry-row ${instance.summary.id === selectedInstance.summary.id ? 'is-active' : ''}`}
                onClick={() => setSelectedInstanceId(instance.summary.id)}
              >
                <div>
                  <strong>{instance.summary.name}</strong>
                  <p>
                    {instance.summary.environment} · {instance.summary.source}
                  </p>
                </div>
                <span className={`status status-${instance.summary.status}`}>{instance.summary.status}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="panel fleet-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Manual registration</span>
              <h2>Add fallback target</h2>
            </div>
            <span className="badge badge-lite">Scaffold</span>
          </div>

          <div className="form-grid">
            <label>
              <span className="field-label">Name</span>
              <input
                className="field-input"
                value={manualDraft.name}
                onChange={(event) => setManualDraft((draft) => ({ ...draft, name: event.target.value }))}
                placeholder="Hermes Lab Node"
              />
            </label>
            <label>
              <span className="field-label">Path</span>
              <input
                className="field-input"
                value={manualDraft.path}
                onChange={(event) => setManualDraft((draft) => ({ ...draft, path: event.target.value }))}
                placeholder="C:/Hermes/lab"
              />
            </label>
            <label>
              <span className="field-label">Base URL</span>
              <input
                className="field-input"
                value={manualDraft.baseUrl}
                onChange={(event) => setManualDraft((draft) => ({ ...draft, baseUrl: event.target.value }))}
                placeholder="http://127.0.0.1:8787"
              />
            </label>
          </div>

          <button type="button" className="primary-button" onClick={handleManualAdd}>
            Save scaffold target
          </button>
        </article>

        <article className="panel fleet-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Discovery queue</span>
              <h2>Probe suggestions</h2>
            </div>
            <span className="badge badge-pro">Read-only</span>
          </div>

          <div className="suggestion-list">
            {fleet.discoverySuggestions.map((suggestion) => (
              <div key={suggestion.id} className="suggestion-card">
                <div>
                  <strong>{suggestion.name}</strong>
                  <p>{suggestion.reason}</p>
                  <small>
                    {suggestion.baseUrl ?? suggestion.path ?? 'Path or endpoint pending'} · {suggestion.transport}
                  </small>
                </div>
                <button type="button" className="secondary-button" onClick={() => handleSuggestionAdd(suggestion)}>
                  Add to registry
                </button>
              </div>
            ))}
          </div>
        </article>
        </div>

        <section className="mode-grid surface-column">
          <div className="surface-strategy-note panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Surface selection</span>
                <h2>Automatic Pro/Lite strategy</h2>
                <p className="panel-subtitle">
                  Brand names do not choose the surface. Capability signals do, with an explicit operator override.
                </p>
              </div>
              <span className={`badge ${effectiveSurfaceMode === 'pro' ? 'badge-pro' : 'badge-lite'}`}>
                {effectiveSurfaceMode === 'pro' ? 'Pro active' : 'Lite active'}
              </span>
            </div>
            <div className="surface-strategy-grid">
              <div className="surface-strategy-card">
                <strong>Auto rule</strong>
                <p>
                  Lite wins when two or more constrained-surface signals are present, or immediately when color depth is 8-bit or lower.
                </p>
              </div>
              <div className="surface-strategy-card">
                <strong>Current signals</strong>
                <p>
                  {surfaceSelection.signals.viewportWidth}×{surfaceSelection.signals.viewportHeight} · {surfaceSelection.signals.colorDepth}-bit ·{' '}
                  {surfaceSelection.signals.hasHover ? 'hover' : 'no hover'} ·{' '}
                  {surfaceSelection.signals.hasFinePointer ? 'fine pointer' : 'coarse pointer'} ·{' '}
                  {surfaceSelection.signals.prefersReducedMotion ? 'reduced motion' : 'standard motion'}
                </p>
              </div>
              <div className="surface-strategy-card">
                <strong>Why this recommendation</strong>
                <p>{surfaceSelection.reason}</p>
              </div>
            </div>
          </div>
          <LiteMode instance={selectedInstance} actionRuns={selectedActionRuns} onRunAction={handleRunAction} />
          <ProMode instance={selectedInstance} actionRuns={selectedActionRuns} onRunAction={handleRunAction} />
        </section>
      </section>
    </main>
  );
}
