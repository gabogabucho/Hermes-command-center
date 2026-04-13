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

  return (
    <section className="panel pro-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Pro</span>
          <h2>Richer-capability command dashboard</h2>
          <p className="panel-subtitle">Operational density for monitors, wallboards, tablets, and larger screens</p>
        </div>
        <span className="badge badge-pro">Large-screen target</span>
      </div>

      <div className="pro-grid">
        <article className="metric-card accent metric-card-incident">
          <span>Incidents</span>
          <strong>{snapshot.incidents.length}</strong>
          <small>{incidentCounts.critical} critical · {incidentCounts.warning} warning · {incidentCounts.info} info</small>
        </article>
        <article className="metric-card">
          <span>Selected instance</span>
          <strong>{summary.name}</strong>
          <small>{summary.connection.transport}</small>
        </article>
        <article className="metric-card">
          <span>Action posture</span>
          <strong>{snapshot.actions.filter((action) => action.availability === 'available').length} ready</strong>
          <small>{formatActionTimestamp(latestActionRun?.updatedAt)}</small>
        </article>
      </div>

      <div className="ops-grid">
        <div className="surface-card ops-console-card">
          <div className="section-heading">
            <h3>Command actions</h3>
            <span className={`severity-pill severity-pill-${summary.status}`}>{summary.status}</span>
          </div>
          <p className="ops-console-copy">Selected target: {summary.name} · {snapshot.installation.target}</p>

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
                      {run?.status === 'running' ? 'Running…' : 'Run now'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {latestActionRun?.executablePath ? (
            <div className="ops-footnote">
              <strong>Resolved executable</strong>
              <p>{latestActionRun.executablePath}</p>
            </div>
          ) : null}
        </div>

        <div className="surface-card inbox-card">
          <div className="section-heading">
            <h3>Priority incident queue</h3>
            <span className="severity-summary">{summary.name}</span>
          </div>

          {prioritizedIncidents.length > 0 ? (
            <div className="incident-list">
              {prioritizedIncidents.map((incident, index) => (
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
              ))}
            </div>
          ) : (
            <p>No incidents are active for this instance.</p>
          )}
        </div>
      </div>

      <div className="split-columns">
        <div className="surface-card">
          <h3>Live agents</h3>
          {snapshot.agents.length > 0 ? (
            snapshot.agents.map((agent) => (
              <div key={agent.id} className="list-row">
                <div>
                  <strong>{agent.label}</strong>
                  <p>{agent.role}</p>
                </div>
                <span className={`status status-${agent.status}`}>{agent.status}</span>
              </div>
            ))
          ) : (
            <div className="list-row capability-row">
              <div>
                <strong>Read-only artifact view</strong>
                <p>{probeSummary?.activity.summary ?? 'No live agent roster is exposed by the probe yet.'}</p>
              </div>
              <span className={`status status-${summary.status}`}>{summary.status}</span>
            </div>
          )}
        </div>

        <div className="surface-card">
          <h3>Capability status</h3>
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
      </div>

      {probeSummary ? (
        <div className="surface-card probe-surface">
          <h3>Official Hermes signal readout</h3>

          <div className="probe-meta-grid">
            <article className="metric-card">
              <span>Readiness</span>
              <strong>{probeSummary.readiness}</strong>
              <small>{probeSummary.configuration} config footprint</small>
            </article>
            <article className="metric-card">
              <span>Recent session artifacts</span>
              <strong>{probeSummary.activity.sessionCount}</strong>
              <small>{probeSummary.activity.lastSeenSource ?? 'No official activity source yet'}</small>
            </article>
            <article className="metric-card">
              <span>Profiles detected</span>
              <strong>{probeSummary.profileCount}</strong>
              <small>{probeSummary.activity.summary}</small>
            </article>
            <article className="metric-card">
              <span>Naming signal</span>
              <strong>{probeSummary.naming.source}</strong>
              <small>{probeSummary.naming.detail}</small>
            </article>
          </div>

          <div className="signal-list">
            {prioritizedIncidents.map((incident) => (
              <div key={incident.id} className="list-row capability-row">
                <div>
                  <strong>{incident.title}</strong>
                  <p>
                    {incident.category} · {incident.summary}
                  </p>
                </div>
                <span className={`status status-${incident.severity}`}>{incident.severity}</span>
              </div>
            ))}

            {stateDbSummary ? (
              <div className="list-row capability-row">
                <div>
                  <strong>state.db context</strong>
                  <p>
                    {stateDbSummary.recognized
                      ? `${stateDbSummary.tableCount} table(s) inspected${
                          recentStateDbSources.length > 0 ? ` · recent sources: ${recentStateDbSources.join(', ')}` : ''
                        }${recentStateDbSessions.length > 0 ? ` · sessions: ${recentStateDbSessions.join(', ')}` : ''}`
                      : stateDbSummary.fallbackReason ?? 'state.db was detected, but only limited schema evidence is available.'}
                  </p>
                </div>
                <span className={`status status-${stateDbSummary.recognized ? 'available' : 'limited'}`}>
                  {stateDbSummary.recognized ? 'inspected' : 'limited'}
                </span>
              </div>
            ) : null}

            {probeSummary.artifactSignals.map((signal) => (
              <div key={signal.label} className="list-row capability-row">
                <div>
                  <strong>{signal.label}</strong>
                  <p>{signal.detail ?? (signal.present ? 'Detected from the standard Hermes home layout.' : 'Not detected in this snapshot.')}</p>
                </div>
                <span className={`status status-${signal.present ? 'available' : 'unavailable'}`}>
                  {signal.present ? 'present' : 'missing'}
                </span>
              </div>
            ))}
          </div>

          {(latestActionRun?.outputLines.length ?? 0) > 0 ? (
            <div className="surface-card">
              <h3>Action output summary</h3>
              <ul className="mono-list compact-mono-list">
                {latestActionRun.outputLines.map((line, index) => (
                  <li key={`${summary.id}-doctor-line-${index}`}>
                    <strong>{line}</strong>
                    <span>{latestActionRun.exitCode ?? '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
