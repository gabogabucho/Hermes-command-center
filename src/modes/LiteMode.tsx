import type { HermesInstanceRecord, OperatorActionId, OperatorActionSummary } from '../adapters/types';
import { formatActionTimestamp, getIncidentCounts, getLatestActionRun, prioritizeIncidents, type ActionRunState } from './panelModel';

type Props = {
  instance: HermesInstanceRecord;
  actionRuns: Partial<Record<OperatorActionId, ActionRunState>>;
  onRunAction: (instance: HermesInstanceRecord, action: OperatorActionSummary) => void;
};

export function LiteMode({ instance, actionRuns, onRunAction }: Props) {
  const { snapshot, summary } = instance;
  const prioritizedIncidents = prioritizeIncidents(snapshot.incidents);
  const primaryIncident = prioritizedIncidents[0];
  const latestActionRun = getLatestActionRun(snapshot.actions, actionRuns);
  const incidentCounts = getIncidentCounts(snapshot.incidents);
  const queueLoad = snapshot.queues.reduce((t, q) => t + q.depth, 0);

  return (
    <div className="ops-console ops-console-lite">

      {/* Vitals row */}
      <div className="ops-vitals">
        <div className={`vital-chip ${incidentCounts.critical > 0 ? 'vital-critical' : ''}`}>
          <span>Incidents</span>
          <strong>{snapshot.incidents.length}</strong>
        </div>
        <div className="vital-chip">
          <span>Queue</span>
          <strong>{queueLoad}</strong>
        </div>
        <div className="vital-chip">
          <span>Agents</span>
          <strong>{snapshot.agents.length + snapshot.subagents.length}</strong>
        </div>
        <div className="vital-chip">
          <span>Actions</span>
          <strong style={{ color: snapshot.actions.filter((a) => a.availability === 'available').length > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
            {snapshot.actions.filter((a) => a.availability === 'available').length} rdy
          </strong>
        </div>
      </div>

      {/* Main 2-col */}
      <div className="ops-grid ops-grid-lite">
        {/* Primary incident */}
        <div className="ops-incidents">
          <div className="ops-panel-label">
            Top Incident
            <span className="ops-incident-meta">{incidentCounts.critical}c · {incidentCounts.warning}w</span>
          </div>

          {primaryIncident ? (
            <article className={`ops-incident ops-incident-top incident-priority-card-${primaryIncident.severity}`}>
              <div className="ops-incident-head">
                <span className={`severity-pill severity-pill-${primaryIncident.severity}`}>{primaryIncident.severity}</span>
                <span className="ops-incident-cat">{primaryIncident.category}</span>
              </div>
              <strong className="ops-incident-title">{primaryIncident.title}</strong>
              <p className="ops-incident-hint">{primaryIncident.actionHint}</p>
            </article>
          ) : (
            <div className="ops-all-clear">
              <span className="all-clear-dot" />
              All clear
            </div>
          )}

          {prioritizedIncidents.slice(1, 3).map((inc) => (
            <article key={inc.id} className="ops-incident">
              <div className="ops-incident-head">
                <span className={`severity-pill severity-pill-${inc.severity}`}>{inc.severity}</span>
                <span className="ops-incident-cat">{inc.category}</span>
              </div>
              <strong className="ops-incident-title">{inc.title}</strong>
            </article>
          ))}
        </div>

        {/* Actions */}
        <div className="ops-actions">
          <div className="ops-panel-label">Quick Fix</div>

          {snapshot.actions.map((action) => {
            const run = actionRuns[action.id];
            const isRunning = run?.status === 'running';
            const isReady = action.availability === 'available';

            return (
              <div key={action.id} className="ops-action-item">
                <code className="ops-action-cmd">{action.commandLabel}</code>
                <button
                  type="button"
                  className={`ops-run-btn ${isReady ? 'ops-run-ready' : ''}`}
                  disabled={!isReady || isRunning}
                  onClick={() => onRunAction(instance, action)}
                >
                  {isRunning ? '⟳' : isReady ? '▶ Run' : 'Blocked'}
                </button>
                <p className="ops-action-result">{run?.summary ?? action.note}</p>
              </div>
            );
          })}

          {latestActionRun ? (
            <div className="ops-last-run">
              <span>{formatActionTimestamp(latestActionRun.updatedAt)}</span>
              <span className={latestActionRun.exitCode === 0 ? 'exit-ok' : 'exit-fail'}>
                exit {latestActionRun.exitCode ?? '—'}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Terminal strip */}
      <div className="ops-terminal">
        <div className="ops-terminal-output">
          {(latestActionRun?.outputLines ?? snapshot.subagents.map((s) => `${s.label} · ${s.status}`))
            .slice(-3)
            .map((line, i) => <span key={i} className="terminal-line">{line}</span>)}
          <span className="terminal-cursor">▌</span>
        </div>
        <div className="ops-terminal-input ops-terminal-readonly">
          <span className="terminal-prompt">›</span>
          <span className="terminal-status-line">
            {summary.connection.baseUrl ?? summary.connection.path ?? 'local'} · {summary.connection.transport}
          </span>
        </div>
      </div>

    </div>
  );
}
