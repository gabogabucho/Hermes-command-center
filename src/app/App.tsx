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
import { PinGate } from '../components/PinGate';
import { LiteMode } from '../modes/LiteMode';
import { getIncidentCounts, type ActionRunState } from '../modes/panelModel';
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
      <main className="shell loading-shell">
        <section className="dashboard-card loading-card">
          <span className="eyebrow">Hermes Command Center</span>
          <h1>Loading command dashboard…</h1>
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
        discoverySuggestions: currentFleet.discoverySuggestions.filter((candidate) => candidate.id !== suggestion.id),
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
  const incidentCounts = getIncidentCounts(selectedInstance.snapshot.incidents);
  const queueDepth = selectedInstance.snapshot.queues.reduce((total, queue) => total + queue.depth, 0);
  const availableActionCount = selectedInstance.snapshot.actions.filter((action) => action.availability === 'available').length;
  const latestRun = Object.values(selectedActionRuns)
    .filter((run): run is ActionRunState => Boolean(run))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];

  return (
    <main className="ops-shell">
      {/* ── Ops bar ──────────────────────────────────────────────── */}
      <header className="ops-bar">
        <div className="ops-brand">
          <span className="ops-eyebrow">Hermes Fleet</span>
          <span className="ops-logo">Command Center</span>
        </div>

        <select
          className="ops-instance-select"
          value={selectedInstance.summary.id}
          onChange={(event) => setSelectedInstanceId(event.target.value)}
          aria-label="Select instance"
        >
          {fleet.instances.map((instance) => (
            <option key={instance.summary.id} value={instance.summary.id}>
              {instance.summary.name} — {instance.summary.environment}
            </option>
          ))}
        </select>

        <span className={`ops-status-badge status-${selectedInstance.summary.status}`}>
          <span className={`live-dot ${selectedInstance.summary.status !== 'online' ? (selectedInstance.summary.status === 'degraded' ? 'live-dot-orange' : 'live-dot-red') : ''}`} />
          {selectedInstance.summary.status}
        </span>

        <div className="ops-bar-meta">
          <span className="ops-meta-item">
            <span className="ops-meta-label">Fleet</span>
            <strong>{fleet.instances.length}</strong>
          </span>
          <span className="ops-meta-item">
            <span className="ops-meta-label">Source</span>
            <strong>{fleetSource?.generatedAt ? 'probe' : 'mock'}</strong>
          </span>
        </div>

        <div className="ops-mode-control" role="group" aria-label="Surface mode">
          {(['auto', 'lite', 'pro'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`ops-mode-btn ${surfaceOverride === mode ? 'is-active' : ''}`}
              onClick={() => setSurfaceOverride(mode)}
            >
              {mode}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="ops-refresh-btn"
          onClick={() => void refreshFleet()}
          disabled={isRefreshing}
        >
          {isRefreshing ? '…' : '↻'}
        </button>
      </header>

      {/* ── Main console ─────────────────────────────────────────── */}
      <div className="ops-main">
        {effectiveSurfaceMode === 'pro' ? (
          <ProMode instance={selectedInstance} actionRuns={selectedActionRuns} onRunAction={handleRunAction} />
        ) : (
          <LiteMode instance={selectedInstance} actionRuns={selectedActionRuns} onRunAction={handleRunAction} />
        )}
      </div>
    </main>
  );
}
