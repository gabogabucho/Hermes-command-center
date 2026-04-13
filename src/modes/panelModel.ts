import type { IncidentSummary, OperatorActionId, OperatorActionSummary } from '../adapters/types';

export type ActionRunState = {
  action: OperatorActionId;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  updatedAt?: number;
  summary?: string;
  durationMs?: number;
  exitCode?: number | null;
  executablePath?: string;
  command?: string;
  outputLines: string[];
};

const severityRank = {
  critical: 0,
  warning: 1,
  info: 2,
} as const;

export function prioritizeIncidents(incidents: IncidentSummary[]) {
  return [...incidents].sort((left, right) => {
    const severityDelta = severityRank[left.severity] - severityRank[right.severity];

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

export function getIncidentCounts(incidents: IncidentSummary[]) {
  return incidents.reduce(
    (summary, incident) => {
      summary[incident.severity] += 1;
      return summary;
    },
    {
      critical: 0,
      warning: 0,
      info: 0,
    },
  );
}

export function getLatestActionRun(
  actions: OperatorActionSummary[],
  actionRuns: Partial<Record<OperatorActionId, ActionRunState>>,
) {
  return [...actions]
    .map((action) => actionRuns[action.id])
    .filter((run): run is ActionRunState => Boolean(run))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];
}

export function formatActionTimestamp(updatedAt?: number) {
  if (!updatedAt) {
    return 'No recent run';
  }

  return `Updated ${new Date(updatedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
