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
    <section className="panel lite-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Lite</span>
          <h2>Low-capability command dashboard</h2>
          <p className="panel-subtitle">Focused on {summary.name}</p>
        </div>
        <span className="badge badge-lite">Low-capability target</span>
      </div>

      <div className="dialog-card lite-instance-card">
        <div className="section-heading">
          <h3>Selected instance</h3>
          <span className={`severity-pill severity-pill-${summary.status}`}>{summary.status}</span>
        </div>
        <p>{snapshot.installation.name}</p>
        <small>{summary.connection.baseUrl ?? summary.connection.path ?? 'No endpoint registered yet'}</small>
        {probeSummary ? <small>{probeSummary.naming.source} · {probeSummary.naming.detail}</small> : null}
      </div>

      <div className="lite-status-row">
        <article className="ink-card">
          <span>Agents</span>
          <strong>{snapshot.agents.length}</strong>
        </article>
        <article className="ink-card">
          <span>Subagents</span>
          <strong>{snapshot.subagents.length}</strong>
        </article>
        <article className="ink-card">
          <span>Incidents</span>
          <strong>{snapshot.incidents.length}</strong>
        </article>
      </div>

      <div className="dialog-card incident-tray incident-tray-lite">
        <div className="section-heading">
          <h3>Incident tray</h3>
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
          <p>No active incidents.</p>
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
      </div>

      <div className="dialog-card quick-actions-card">
        <div className="section-heading">
          <h3>Command actions</h3>
          <span className="severity-summary">For {summary.name}</span>
        </div>
        <p>Only fixed local wrappers are exposed for the selected instance.</p>
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
                <strong>{action.availability === 'available' ? 'Ready' : 'Blocked'}</strong>
              </button>
              <small>{run?.summary ?? action.note}</small>
            </div>
          );
        })}
        {latestActionRun ? <small>{formatActionTimestamp(latestActionRun.updatedAt)} · {latestActionRun.summary}</small> : null}
      </div>

      {probeSummary ? (
        <div className="dialog-card">
          <h3>Official signal readout</h3>
          <p>
            {probeSummary.readiness} · {probeSummary.configuration}
          </p>
          <small>{probeSummary.activity.summary}</small>
        </div>
      ) : null}

      <ul className="mono-list">
        {(
          (latestActionRun?.outputLines.length ?? 0) > 0
            ? latestActionRun?.outputLines
            : snapshot.subagents.map((subagent) => `${subagent.label} · ${subagent.status}`)
        )?.map((line, index) => (
          <li key={`${summary.id}-lite-line-${index}`}>
            <strong>{line}</strong>
            {(latestActionRun?.outputLines.length ?? 0) > 0 ? null : <span />}
          </li>
        ))}
      </ul>
    </section>
  );
}
