import type { HermesInstanceRecord, OperatorActionId, OperatorActionSummary } from '../adapters/types';
import { formatActionTimestamp, getIncidentCounts, getLatestActionRun, prioritizeIncidents, type ActionRunState } from './panelModel';

type Props = {
  instance: HermesInstanceRecord;
  actionRuns: Partial<Record<OperatorActionId, ActionRunState>>;
  onRunAction: (instance: HermesInstanceRecord, action: OperatorActionSummary) => void;
};

export function ProMode({ instance, actionRuns, onRunAction }: Props) {
  const { snapshot, summary } = instance;
  const probeSummary = snapshot.probeSummary;
  const stateDbSummary = probeSummary?.stateDb;
  const recentStateDbSources = stateDbSummary?.recentSources ?? [];
  const recentStateDbSessions = stateDbSummary?.recentSessionIds ?? [];
  const latestActionRun = getLatestActionRun(snapshot.actions, actionRuns);
  const prioritizedIncidents = prioritizeIncidents(snapshot.incidents);
  const incidentCounts = getIncidentCounts(snapshot.incidents);
  const queueLoad = snapshot.queues.reduce((total, queue) => total + queue.depth, 0);

  return (
    <section className="panel mode-panel pro-mode-panel">
      <div className="module-grid pro-module-grid">
        <article className="dashboard-card module-card module-card-wide hero-module">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Ops Overview</span>
              <h3>{summary.name}</h3>
            </div>
            <span className={`severity-pill severity-pill-${summary.status}`}>{summary.status}</span>
          </div>

          <div className="metric-row four-up">
            <article className="metric-card accent metric-card-incident">
              <span>Incident Stack</span>
              <strong>{snapshot.incidents.length}</strong>
              <small>{incidentCounts.critical} critical · {incidentCounts.warning} warning</small>
            </article>
            <article className="metric-card">
              <span>Agents Live</span>
              <strong>{snapshot.agents.length}</strong>
              <small>{snapshot.subagents.length} subagents</small>
            </article>
            <article className="metric-card">
              <span>Queue Load</span>
              <strong>{queueLoad}</strong>
              <small>{snapshot.queues.length} monitored lanes</small>
            </article>
            <article className="metric-card">
              <span>Action Posture</span>
              <strong>{snapshot.actions.filter((action) => action.availability === 'available').length} ready</strong>
              <small>{formatActionTimestamp(latestActionRun?.updatedAt)}</small>
            </article>
          </div>
        </article>

        <article className="dashboard-card module-card module-card-wide scroll-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Action Matrix</span>
              <h3>Command Deck</h3>
            </div>
            <span className="status status-online">{summary.connection.transport}</span>
          </div>

          <div className="ops-action-grid">
            {snapshot.actions.map((action) => {
              const run = actionRuns[action.id];
              const tone = run?.status === 'failed' ? 'critical' : action.availability === 'available' ? 'available' : 'limited';

              return (
                <article key={action.id} className={`action-tile action-tile-${tone}`}>
                  <div>
                    <span className="action-tile-label">{action.commandLabel}</span>
                    <strong>{action.label}</strong>
                    <p>{run?.summary ?? action.note}</p>
                  </div>
                  <div className="action-tile-footer">
                    <span className={`status status-${tone}`}>{run?.status ?? action.availability}</span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={action.availability !== 'available' || run?.status === 'running'}
                      onClick={() => onRunAction(instance, action)}
                    >
                      {run?.status === 'running' ? 'Running…' : 'Run'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {latestActionRun?.executablePath ? <div className="event-strip">Executable · {latestActionRun.executablePath}</div> : null}
        </article>

        <article className="dashboard-card module-card scroll-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Incident Queue</span>
              <h3>Priority Board</h3>
            </div>
            <span className="status status-warning">{prioritizedIncidents.length}</span>
          </div>

          <div className="incident-list">
            {prioritizedIncidents.length > 0 ? (
              prioritizedIncidents.map((incident, index) => (
                <article key={incident.id} className={`incident-row ${index === 0 ? 'is-priority' : ''}`}>
                  <div>
                    <div className="incident-row-meta">
                      <span className={`severity-pill severity-pill-${incident.severity}`}>{incident.severity}</span>
                      <span className="incident-category">{incident.category}</span>
                    </div>
                    <strong>{incident.title}</strong>
                    <p>{incident.summary}</p>
                    <small>{incident.actionHint}</small>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">No active incidents.</div>
            )}
          </div>
        </article>

        <article className="dashboard-card module-card scroll-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Fleet Runtime</span>
              <h3>Agents & Queues</h3>
            </div>
            <span className="status status-available">live</span>
          </div>

          <div className="stack-list two-tone-list">
            {snapshot.agents.map((agent) => (
              <div key={agent.id} className="list-row capability-row">
                <div>
                  <strong>{agent.label}</strong>
                  <p>{agent.role} · {agent.workspace}</p>
                </div>
                <span className={`status status-${agent.status}`}>{agent.status}</span>
              </div>
            ))}

            {snapshot.queues.map((queue) => (
              <div key={queue.label} className="list-row capability-row">
                <div>
                  <strong>{queue.label}</strong>
                  <p>{queue.trend}</p>
                </div>
                <span className="queue-depth">{queue.depth}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-card module-card scroll-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Capability Matrix</span>
              <h3>Availability</h3>
            </div>
            <span className="status status-limited">read-only</span>
          </div>

          <div className="stack-list">
            {snapshot.capabilityReport.capabilities.map((capability) => (
              <div key={capability.key} className="list-row capability-row">
                <div>
                  <strong>{capability.key}</strong>
                  <p>{capability.note}</p>
                </div>
                <span className={`status status-${capability.status}`}>{capability.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-card module-card module-card-wide scroll-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Signal Readout</span>
              <h3>Probe & Output</h3>
            </div>
            <span className="status status-online">{probeSummary?.readiness ?? 'mock'}</span>
          </div>

          {probeSummary ? (
            <div className="probe-meta-grid compact-probe-grid">
              <article className="metric-card">
                <span>Readiness</span>
                <strong>{probeSummary.readiness}</strong>
                <small>{probeSummary.configuration}</small>
              </article>
              <article className="metric-card">
                <span>Sessions</span>
                <strong>{probeSummary.activity.sessionCount}</strong>
                <small>{probeSummary.activity.lastSeenSource ?? 'No recent source'}</small>
              </article>
              <article className="metric-card">
                <span>Profiles</span>
                <strong>{probeSummary.profileCount}</strong>
                <small>{probeSummary.naming.source}</small>
              </article>
            </div>
          ) : null}

          <div className="stack-list">
            {stateDbSummary ? (
              <div className="list-row capability-row">
                <div>
                  <strong>state.db</strong>
                  <p>
                    {stateDbSummary.recognized
                      ? `${stateDbSummary.tableCount} table(s) · ${recentStateDbSources.join(', ') || 'no recent sources'} · ${recentStateDbSessions.join(', ') || 'no session ids'}`
                      : stateDbSummary.fallbackReason ?? 'Limited schema evidence only.'}
                  </p>
                </div>
                <span className={`status status-${stateDbSummary.recognized ? 'available' : 'limited'}`}>
                  {stateDbSummary.recognized ? 'inspected' : 'limited'}
                </span>
              </div>
            ) : null}

            {probeSummary?.artifactSignals.map((signal) => (
              <div key={signal.label} className="list-row capability-row">
                <div>
                  <strong>{signal.label}</strong>
                  <p>{signal.detail ?? (signal.present ? 'Detected' : 'Missing')}</p>
                </div>
                <span className={`status status-${signal.present ? 'available' : 'unavailable'}`}>
                  {signal.present ? 'present' : 'missing'}
                </span>
              </div>
            ))}

            {(latestActionRun?.outputLines.length ?? 0) > 0 ? (
              <ul className="mono-list compact-mono-list">
                {latestActionRun?.outputLines.map((line, index) => (
                  <li key={`${summary.id}-doctor-line-${index}`}>
                    <strong>{line}</strong>
                    <span>{latestActionRun.exitCode ?? '—'}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
