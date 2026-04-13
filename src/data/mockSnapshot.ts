import type {
  CapabilityReport,
  CapabilityStatus,
  CommandCenterSnapshot,
  FleetSnapshot,
  HermesInstanceRecord,
} from '../adapters/types';

function capabilitySummary(report: CapabilityReport) {
  return report.capabilities.reduce(
    (summary, capability) => {
      summary[capability.status] += 1;
      return summary;
    },
    {
      available: 0,
      limited: 0,
      unavailable: 0,
    } satisfies Record<CapabilityStatus, number>,
  );
}

function createInstance(instance: Omit<HermesInstanceRecord, 'summary'> & {
  summary: Omit<HermesInstanceRecord['summary'], 'capabilitySummary'>;
}): HermesInstanceRecord {
  return {
    ...instance,
    summary: {
      ...instance.summary,
      capabilitySummary: capabilitySummary(instance.snapshot.capabilityReport),
    },
  };
}

const primaryInstance = createInstance({
  summary: {
    id: 'primary-prod',
    name: 'Primary Ops',
    environment: 'production-like sandbox',
    status: 'online',
    source: 'seeded',
    connection: {
      path: 'C:/Hermes/primary',
      baseUrl: 'http://127.0.0.1:8787',
      transport: 'WebUI + gateway blend',
    },
  },
  snapshot: {
    installation: {
      name: 'Hermes Ops / Primary Install',
      environment: 'production-like sandbox',
      target: 'always-on admin control surface',
    },
    capabilityReport: {
      transport: 'adapter probe via mocked WebUI + gateway blend',
      capabilities: [
        { key: 'sessions.read', status: 'available', note: 'Session inventory visible' },
        { key: 'agents.read', status: 'available', note: 'Agent summaries available' },
        { key: 'subagents.read', status: 'available', note: 'Delegated workers visible' },
        { key: 'alerts.read', status: 'limited', note: 'Mocked alert feed only' },
        { key: 'actions.invoke', status: 'unavailable', note: 'Write actions intentionally deferred' },
        { key: 'workspace.browse', status: 'limited', note: 'Placeholder only in scaffold' },
      ],
    },
    agents: [
      {
        id: 'agent-01',
        label: 'Scheduler Overseer',
        role: 'Cron supervision',
        workspace: 'ops/runtime',
        status: 'healthy',
        lastActivity: '12s ago',
      },
      {
        id: 'agent-02',
        label: 'Review Dispatcher',
        role: 'Subagent routing',
        workspace: 'ops/reviews',
        status: 'busy',
        lastActivity: '3s ago',
      },
    ],
    subagents: [
      {
        id: 'subagent-11',
        label: 'Judge A',
        role: 'Adversarial review',
        workspace: 'ops/reviews',
        status: 'busy',
        lastActivity: '7s ago',
      },
      {
        id: 'subagent-12',
        label: 'Queue Inspector',
        role: 'Queue anomaly scan',
        workspace: 'ops/queues',
        status: 'warning',
        lastActivity: '31s ago',
      },
    ],
    alerts: [
      {
        id: 'alert-1',
        label: 'Subagent queue drift detected',
        severity: 'warning',
        source: 'gateway adapter',
        actionHint: 'Open triage dialog',
      },
      {
        id: 'alert-2',
        label: 'Write actions disabled for this install',
        severity: 'info',
        source: 'capability probe',
        actionHint: 'Display degraded mode notice',
      },
    ],
    incidents: [
      {
        id: 'incident-1',
        category: 'activity',
        title: 'Mock queue drift needs operator attention',
        severity: 'warning',
        source: 'mock gateway adapter',
        summary: 'The mock surface is signaling a small but visible queue imbalance.',
        actionHint: 'Use the doctor wrapper only on real local installs.',
      },
    ],
    queues: [
      { label: 'Live tasks', depth: 12, trend: '+2 / 5m' },
      { label: 'Pending reviews', depth: 4, trend: 'stable' },
      { label: 'Escalations', depth: 1, trend: '-1 / 15m' },
    ],
    actions: [
      {
        id: 'hermes-doctor',
        label: 'Run Hermes doctor',
        commandLabel: 'hermes doctor',
        availability: 'blocked',
        scope: 'local-instance',
        note: 'Mock data does not expose a real local Hermes executable.',
      },
      {
        id: 'hermes-status',
        label: 'Run Hermes status',
        commandLabel: 'hermes status',
        availability: 'blocked',
        scope: 'local-instance',
        note: 'Mock data does not expose a real local Hermes executable.',
      },
    ],
  },
});

const kindleRelayInstance = createInstance({
  summary: {
    id: 'kindle-relay',
    name: 'Kindle Relay',
    environment: 'field staging',
    status: 'degraded',
    source: 'seeded',
    connection: {
      path: 'D:/Hermes/kindle-relay',
      baseUrl: 'http://192.168.1.44:8787',
      transport: 'WebUI-only relay',
    },
  },
  snapshot: {
    installation: {
      name: 'Hermes Relay / Kindle Staging',
      environment: 'field staging',
      target: 'low-power mirrored operator surface',
    },
    capabilityReport: {
      transport: 'adapter probe via mocked WebUI-only surface',
      capabilities: [
        { key: 'sessions.read', status: 'available', note: 'Session roster is mirrored' },
        { key: 'agents.read', status: 'limited', note: 'Only top-level agents are summarized' },
        { key: 'subagents.read', status: 'limited', note: 'Subagent count only, sparse metadata' },
        { key: 'alerts.read', status: 'available', note: 'Alert cards available from relay cache' },
        { key: 'actions.invoke', status: 'unavailable', note: 'Relay is explicitly read-only' },
        { key: 'workspace.browse', status: 'unavailable', note: 'Workspace browsing not exposed' },
      ],
    },
    agents: [
      {
        id: 'agent-21',
        label: 'Wallboard Sync',
        role: 'Lite mirror refresh',
        workspace: 'devices/kindle',
        status: 'healthy',
        lastActivity: '29s ago',
      },
      {
        id: 'agent-22',
        label: 'Digest Courier',
        role: 'Summary routing',
        workspace: 'ops/digests',
        status: 'warning',
        lastActivity: '2m ago',
      },
    ],
    subagents: [
      {
        id: 'subagent-31',
        label: 'Paperwhite Sync Worker',
        role: 'E-ink packet shaping',
        workspace: 'devices/kindle',
        status: 'busy',
        lastActivity: '44s ago',
      },
    ],
    alerts: [
      {
        id: 'alert-3',
        label: 'Relay cache freshness slipping',
        severity: 'warning',
        source: 'relay monitor',
        actionHint: 'Inspect sync cadence before operator drift increases',
      },
    ],
    incidents: [
      {
        id: 'incident-2',
        category: 'health',
        title: 'Relay cache freshness slipping',
        severity: 'warning',
        source: 'mock relay monitor',
        summary: 'The mirrored surface is lagging slightly behind the source install.',
        actionHint: 'Doctor stays blocked because this is not a verified local install.',
      },
    ],
    queues: [
      { label: 'Mirrored sessions', depth: 6, trend: 'stable' },
      { label: 'Digest backlog', depth: 2, trend: '+1 / 30m' },
      { label: 'Recovery tasks', depth: 0, trend: 'clear' },
    ],
    actions: [
      {
        id: 'hermes-doctor',
        label: 'Run Hermes doctor',
        commandLabel: 'hermes doctor',
        availability: 'blocked',
        scope: 'local-instance',
        note: 'Relay mock entries stay read-only in the scaffold.',
      },
      {
        id: 'hermes-status',
        label: 'Run Hermes status',
        commandLabel: 'hermes status',
        availability: 'blocked',
        scope: 'local-instance',
        note: 'Relay mock entries stay read-only in the scaffold.',
      },
    ],
  },
});

const travelNodeInstance = createInstance({
  summary: {
    id: 'travel-node',
    name: 'Travel Node',
    environment: 'offline laptop',
    status: 'offline',
    source: 'manual',
    connection: {
      path: 'E:/Portable/Hermes',
      transport: 'filesystem-only registration',
    },
  },
  snapshot: {
    installation: {
      name: 'Hermes Travel Node',
      environment: 'offline laptop',
      target: 'portable fallback command surface',
    },
    capabilityReport: {
      transport: 'manual registration without live probe',
      capabilities: [
        { key: 'sessions.read', status: 'limited', note: 'Last-known local session cache only' },
        { key: 'agents.read', status: 'limited', note: 'Agent state is stale until reconnect' },
        { key: 'subagents.read', status: 'unavailable', note: 'No delegated worker telemetry offline' },
        { key: 'alerts.read', status: 'limited', note: 'Last synced alerts only' },
        { key: 'actions.invoke', status: 'unavailable', note: 'Writes blocked while disconnected' },
        { key: 'workspace.browse', status: 'limited', note: 'Local workspace path can be shown conceptually' },
      ],
    },
    agents: [
      {
        id: 'agent-41',
        label: 'Checkpoint Recorder',
        role: 'Portable session capture',
        workspace: 'portable/checkpoints',
        status: 'warning',
        lastActivity: '18m ago',
      },
    ],
    subagents: [],
    alerts: [
      {
        id: 'alert-4',
        label: 'Travel node has not checked in recently',
        severity: 'critical',
        source: 'manual registry',
        actionHint: 'Reconnect device or confirm intentional offline mode',
      },
    ],
    incidents: [
      {
        id: 'incident-3',
        category: 'readiness',
        title: 'Travel node has not checked in recently',
        severity: 'critical',
        source: 'manual registry',
        summary: 'This mock instance is offline and cannot safely accept local actions.',
        actionHint: 'Reconnect the device before expecting probe-backed actions.',
      },
    ],
    queues: [
      { label: 'Pending sync', depth: 9, trend: '+3 / 1h' },
      { label: 'Unsent reports', depth: 5, trend: 'stable' },
      { label: 'Escalations', depth: 0, trend: 'unknown' },
    ],
    actions: [
      {
        id: 'hermes-doctor',
        label: 'Run Hermes doctor',
        commandLabel: 'hermes doctor',
        availability: 'blocked',
        scope: 'local-instance',
        note: 'Offline mock registrations do not allow command execution.',
      },
      {
        id: 'hermes-status',
        label: 'Run Hermes status',
        commandLabel: 'hermes status',
        availability: 'blocked',
        scope: 'local-instance',
        note: 'Offline mock registrations do not allow command execution.',
      },
    ],
  },
});

export const mockFleetSnapshot: FleetSnapshot = {
  instances: [primaryInstance, kindleRelayInstance, travelNodeInstance],
  discoverySuggestions: [
    {
      id: 'dockside-mini',
      name: 'Dockside Mac mini',
      environment: 'office lab',
      reason: 'Detected local config folder and responding health endpoint',
      path: 'C:/Users/gabog/.hermes/dockside',
      baseUrl: 'http://dockside-mini.local:8787',
      transport: 'local config + WebUI health check',
      capabilityHints: ['sessions.read', 'agents.read', 'alerts.read'],
    },
    {
      id: 'review-cluster',
      name: 'Review Cluster',
      environment: 'shared staging',
      reason: 'Gateway metadata advertises delegated review workers',
      baseUrl: 'http://10.0.0.21:8791',
      transport: 'gateway metadata probe',
      capabilityHints: ['agents.read', 'subagents.read', 'alerts.read', 'workspace.browse'],
    },
  ],
};

export const mockSnapshot: CommandCenterSnapshot = mockFleetSnapshot.instances[0].snapshot;
