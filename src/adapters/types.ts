export type CapabilityKey =
  | 'sessions.read'
  | 'agents.read'
  | 'subagents.read'
  | 'alerts.read'
  | 'actions.invoke'
  | 'workspace.browse';

export type CapabilityStatus = 'available' | 'limited' | 'unavailable';
export type AgentStatus = 'healthy' | 'busy' | 'warning';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type HermesInstanceStatus = 'online' | 'degraded' | 'offline';
export type RegistrationSource = 'seeded' | 'manual' | 'discovered';
export type IncidentCategory = 'readiness' | 'configuration' | 'activity' | 'artifacts' | 'health' | 'actions';
export type OperatorActionAvailability = 'available' | 'blocked';
export type OperatorActionId = 'hermes-doctor' | 'hermes-status';

export interface CapabilityReport {
  transport: string;
  capabilities: Array<{
    key: CapabilityKey;
    status: CapabilityStatus;
    note: string;
  }>;
}

export interface InstallationSummary {
  name: string;
  environment: string;
  target: string;
}

export interface AgentSummary {
  id: string;
  label: string;
  role: string;
  workspace: string;
  status: AgentStatus;
  lastActivity: string;
}

export interface AlertSummary {
  id: string;
  label: string;
  severity: AlertSeverity;
  source: string;
  actionHint: string;
}

export interface IncidentSummary {
  id: string;
  category: IncidentCategory;
  severity: AlertSeverity;
  title: string;
  source: string;
  summary: string;
  actionHint: string;
}

export interface OperatorActionSummary {
  id: OperatorActionId;
  label: string;
  commandLabel: string;
  availability: OperatorActionAvailability;
  scope: 'local-instance';
  note: string;
}

export interface ProbeNamingSummary {
  source: string;
  detail: string;
}

export interface QueueSummary {
  label: string;
  depth: number;
  trend: string;
}

export type ProbeReadiness = 'empty' | 'configured' | 'active';
export type ProbeActivityStatus = 'none' | 'stale' | 'recent';

export interface ProbeArtifactSignal {
  label: string;
  present: boolean;
  detail?: string;
}

export interface ProbeStateDbTableSummary {
  name: string;
  rowCount?: number;
  latestTimestamp?: string;
}

export interface ProbeStateDbSummary {
  recognized: boolean;
  tableCount: number;
  tables: string[];
  fallbackReason?: string;
  inspectionError?: string;
  recentSessionIds?: string[];
  recentSources?: string[];
  lastActivityAt?: string;
  lastActivitySource?: string;
  tableSummaries: ProbeStateDbTableSummary[];
}

export interface ProbeSummary {
  readiness: ProbeReadiness;
  configuration: 'empty' | 'partial' | 'configured';
  naming: ProbeNamingSummary;
  profileCount: number;
  activity: {
    status: ProbeActivityStatus;
    summary: string;
    sessionCount: number;
    lastSeenAt?: string;
    lastSeenSource?: string;
  };
  stateDb?: ProbeStateDbSummary;
  artifactSignals: ProbeArtifactSignal[];
}

export interface CommandCenterSnapshot {
  installation: InstallationSummary;
  capabilityReport: CapabilityReport;
  agents: AgentSummary[];
  subagents: AgentSummary[];
  alerts: AlertSummary[];
  incidents: IncidentSummary[];
  queues: QueueSummary[];
  actions: OperatorActionSummary[];
  probeSummary?: ProbeSummary;
}

export interface HermesInstanceConnection {
  path?: string;
  baseUrl?: string;
  transport: string;
}

export interface HermesInstanceSummary {
  id: string;
  name: string;
  environment: string;
  status: HermesInstanceStatus;
  source: RegistrationSource;
  connection: HermesInstanceConnection;
  capabilitySummary: {
    available: number;
    limited: number;
    unavailable: number;
  };
}

export interface HermesInstanceRecord {
  summary: HermesInstanceSummary;
  snapshot: CommandCenterSnapshot;
}

export interface DiscoverySuggestion {
  id: string;
  name: string;
  environment: string;
  reason: string;
  path?: string;
  baseUrl?: string;
  transport: string;
  capabilityHints: CapabilityKey[];
}

export interface FleetSnapshot {
  instances: HermesInstanceRecord[];
  discoverySuggestions: DiscoverySuggestion[];
}

export interface HermesAdapter {
  id: string;
  label: string;
  getFleetSnapshot(): Promise<FleetSnapshot>;
}
