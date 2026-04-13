import type { HermesInstanceRecord, OperatorActionId, OperatorActionSummary } from '../adapters/types';
import { formatActionTimestamp, getIncidentCounts, getLatestActionRun, prioritizeIncidents, type ActionRunState } from './panelModel';

type Props = {
  instance: HermesInstanceRecord;
  actionRuns: Partial<Record<OperatorActionId, ActionRunState>>;
  onRunAction: (instance: HermesInstanceRecord, action: OperatorActionSummary) => void;
};

export function LiteMode({ instance, actionRuns, onRunAction }: Props) {
  const { snapshot, summary } = instance;
  const probeSummary = snapshot.probeSummary;
  const prioritizedIncidents = prioritizeIncidents(snapshot.incidents);
  const primaryIncident = prioritizedIncidents[0];
  const latestActionRun = getLatestActionRun(snapshot.actions, actionRuns);
  const incidentCounts = getIncidentCounts(snapshot.incidents);

  return (
    <section className="panel mode-panel lite-mode-panel">
      <div className="module-grid lite-module-grid">
        <article className="dashboard-card lite-hero-card module-card-wide">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Control Pad</span>
              <h3>{summary.name}</h3>
            </div>
            <span className={`severity-pill severity-pill-${summary.status}`}>{summary.status}</span>
          </div>

          <div className="lite-status-row compact-lite-status-row">
            <article className="ink-card">
              <span>Incidents</span>
              <strong>{snapshot.incidents.length}</strong>
            </article>
            <article className="ink-card">
              <span>Agents</span>
              <strong>{snapshot.agents.length + snapshot.subagents.length}</strong>
            </article>
            <article className="ink-card">
              <span>Actions</span>
              <strong>{snapshot.actions.filter((action) => action.availability === 'available').length}</strong>
            </article>
          </div>

          <div className="status-stack">
            <small>{summary.connection.baseUrl ?? summary.connection.path ?? 'No endpoint registered yet'}</small>
            {probeSummary ? <small>{probeSummary.naming.source} · {probeSummary.naming.detail}</small> : null}
          </div>
        </article>

        <article className="dashboard-card module-card module-card-tall">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Primary Incident</span>
              <h3>Attention</h3>
            </div>
            <span className="severity-summary">
              {incidentCounts.critical} critical · {incidentCounts.warning} warning
            </span>
          </div>

          {primaryIncident ? (
            <article className={`incident-priority-card incident-priority-card-${primaryIncident.severity}`}>
              <div className="incident-priority-header">
                <span className={`severity-pill severity-pill-${primaryIncident.severity}`}>{primaryIncident.severity}</span>
                <span className="incident-category">{primaryIncident.category}</span>
              </div>
              <strong>{primaryIncident.title}</strong>
              <p>{primaryIncident.summary}</p>
              <small>{primaryIncident.actionHint}</small>
            </article>
          ) : (
            <div className="empty-state">No active incidents.</div>
          )}

          <div className="incident-list compact-incident-list">
            {prioritizedIncidents.slice(1, 4).map((incident) => (
              <article key={incident.id} className="incident-row incident-row-lite">
                <div>
                  <strong>{incident.title}</strong>
                  <p>{incident.source}</p>
                </div>
                <span className={`severity-pill severity-pill-${incident.severity}`}>{incident.severity}</span>
              </article>
            ))}
          </div>
        </article>

        <article className="dashboard-card module-card module-card-tall">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Quick Actions</span>
              <h3>Command Buttons</h3>
            </div>
            <span className="status status-online">fixed wrappers</span>
          </div>

          <div className="quick-actions-card">
            {snapshot.actions.map((action) => {
              const run = actionRuns[action.id];

              return (
                <div key={action.id} className="lite-action-row">
                  <button
                    type="button"
                    className="lite-action-button"
                    disabled={action.availability !== 'available' || run?.status === 'running'}
                    onClick={() => onRunAction(instance, action)}
                  >
                    <span>{run?.status === 'running' ? `Running ${action.commandLabel}…` : action.commandLabel}</span>
                    <strong>{action.availability === 'available' ? 'Run' : 'Blocked'}</strong>
                  </button>
                  <small>{run?.summary ?? action.note}</small>
                </div>
              );
            })}
          </div>

          {latestActionRun ? <div className="event-strip">{formatActionTimestamp(latestActionRun.updatedAt)} · {latestActionRun.summary}</div> : null}
        </article>

        <article className="dashboard-card module-card module-card-wide scroll-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Signal Strip</span>
              <h3>Operational Readout</h3>
            </div>
            <span className="status status-limited">compact</span>
          </div>

          <div className="stack-list">
            {probeSummary ? (
              <div className="list-row capability-row">
                <div>
                  <strong>Probe</strong>
                  <p>{probeSummary.readiness} · {probeSummary.configuration} · {probeSummary.activity.summary}</p>
                </div>
                <span className="status status-online">{probeSummary.activity.sessionCount}</span>
              </div>
            ) : null}

            {snapshot.queues.map((queue) => (
              <div key={queue.label} className="list-row capability-row">
                <div>
                  <strong>{queue.label}</strong>
                  <p>{queue.trend}</p>
                </div>
                <span className="queue-depth">{queue.depth}</span>
              </div>
            ))}

            {snapshot.capabilityReport.capabilities.slice(0, 4).map((capability) => (
              <div key={capability.key} className="list-row capability-row">
                <div>
                  <strong>{capability.key}</strong>
                  <p>{capability.note}</p>
                </div>
                <span className={`status status-${capability.status}`}>{capability.status}</span>
              </div>
            ))}
          </div>

          <ul className="mono-list compact-mono-list">
            {(
              (latestActionRun?.outputLines.length ?? 0) > 0
                ? latestActionRun?.outputLines
                : snapshot.subagents.map((subagent) => `${subagent.label} · ${subagent.status}`)
            )?.map((line, index) => (
              <li key={`${summary.id}-lite-line-${index}`}>
                <strong>{line}</strong>
                {(latestActionRun?.outputLines.length ?? 0) > 0 ? <span>{latestActionRun?.exitCode ?? '—'}</span> : <span />}
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
