import { useEffect, useRef, useState } from 'react';
import type { HermesInstanceRecord, OperatorActionId, OperatorActionSummary } from '../adapters/types';
import { useLiveMetrics } from '../hooks/useLiveMetrics';
import { useProfiles } from '../hooks/useProfiles';
import { formatActionTimestamp, getIncidentCounts, getLatestActionRun, prioritizeIncidents, type ActionRunState } from './panelModel';

type ChatEntry = { role: 'user' | 'agent'; text: string };

async function sendChatMessage(
  instanceId: string,
  message: string,
  onChunk: (text: string) => void,
  onDone: (exitCode: number) => void,
  onError: (err: string) => void,
) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId, message }),
    });

    if (!res.ok || !res.body) {
      onError(`HTTP ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const line = part.replace(/^data:\s*/, '').trim();
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.chunk) onChunk(evt.chunk);
          if (evt.done) onDone(evt.exitCode ?? 0);
          if (evt.error) onError(evt.error);
        } catch { /* ignore malformed SSE */ }
      }
    }
  } catch (err) {
    onError(err instanceof Error ? err.message : 'fetch failed');
  }
}

type Props = {
  instance: HermesInstanceRecord;
  actionRuns: Partial<Record<OperatorActionId, ActionRunState>>;
  onRunAction: (instance: HermesInstanceRecord, action: OperatorActionSummary) => void;
};

function statusDot(status: string) {
  if (status === 'available' || status === 'healthy' || status === 'online' || status === 'succeeded') return 'dot-green';
  if (status === 'limited' || status === 'warning' || status === 'degraded' || status === 'busy') return 'dot-yellow';
  return 'dot-red';
}

function gaugeColor(pct: number): string {
  if (pct < 55) return 'gauge-green';
  if (pct < 78) return 'gauge-yellow';
  return 'gauge-red';
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ECG waveform: 4 beats at x-offsets 0, 100, 200, 300 (100-unit period, viewBox 0 0 200 80)
// Baseline y=65. P wave (y≈55), QRS spike (y=8→72), T wave (y≈42).
const ECG_PATH =
  'M0,65 L15,65 Q18,55 22,65 L38,65 L40,68 L44,8 L48,72 L52,65 L65,65 Q72,42 82,65 L100,65 ' +
  'L115,65 Q118,55 122,65 L138,65 L140,68 L144,8 L148,72 L152,65 L165,65 Q172,42 182,65 L200,65 ' +
  'L215,65 Q218,55 222,65 L238,65 L240,68 L244,8 L248,72 L252,65 L265,65 Q272,42 282,65 L300,65 ' +
  'L315,65 Q318,55 322,65 L338,65 L340,68 L344,8 L348,72 L352,65 L365,65 Q372,42 382,65 L400,65';

function EkgLine({ status }: { status: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isOffline = status === 'offline';

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (isOffline) svg.pauseAnimations();
    else svg.unpauseAnimations();
  }, [isOffline]);

  return (
    <div className={`ops-ekg${isOffline ? ' ekg-flat' : ''}`} aria-hidden>
      <svg
        ref={svgRef}
        className="ekg-svg"
        viewBox="0 0 200 80"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            from="0 0"
            to="-100 0"
            dur="1.4s"
            repeatCount="indefinite"
          />
          <path className="ekg-line" d={ECG_PATH} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
      <span className="ekg-label">{isOffline ? 'flat' : 'live'}</span>
    </div>
  );
}

function formatNet(kbps: number): string {
  if (kbps < 1000) return `${kbps}kb/s`;
  return `${(kbps / 1024).toFixed(1)}Mb/s`;
}

export function ProMode({ instance, actionRuns, onRunAction }: Props) {
  const { snapshot, summary } = instance;
  const probeSummary = snapshot.probeSummary;
  const latestActionRun = getLatestActionRun(snapshot.actions, actionRuns);
  const prioritizedIncidents = prioritizeIncidents(snapshot.incidents);
  const incidentCounts = getIncidentCounts(snapshot.incidents);
  const queueLoad = snapshot.queues.reduce((total, q) => total + q.depth, 0);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const metrics = useLiveMetrics();
  const { snapshot: profilesSnapshot } = useProfiles();
  const terminalRef = useRef<HTMLDivElement>(null);

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = chatInput.trim();
    if (!msg || isChatting) return;
    setChatInput('');
    setIsChatting(true);

    // Add user message
    setChatHistory((prev) => [...prev, { role: 'user', text: msg }]);

    // Placeholder for streaming agent response
    setChatHistory((prev) => [...prev, { role: 'agent', text: '' }]);

    await sendChatMessage(
      summary.id,
      msg,
      (chunk) => {
        setChatHistory((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'agent') {
            updated[updated.length - 1] = { role: 'agent', text: last.text + (last.text ? '\n' : '') + chunk };
          }
          return updated;
        });
        setTimeout(() => {
          if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }, 0);
      },
      () => setIsChatting(false),
      (err) => {
        setChatHistory((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'agent') {
            updated[updated.length - 1] = { role: 'agent', text: `Error: ${err}` };
          }
          return updated;
        });
        setIsChatting(false);
      },
    );
  };

  // Terminal shows chat history OR last action output OR subagent status
  const terminalLines: ChatEntry[] = chatHistory.length > 0
    ? chatHistory.slice(-6)
    : latestActionRun?.outputLines?.length
      ? latestActionRun.outputLines.slice(-3).map((t) => ({ role: 'agent' as const, text: t }))
      : snapshot.subagents.slice(0, 2).map((s) => ({ role: 'agent' as const, text: `${s.label} · ${s.status} · ${s.lastActivity}` }));

  return (
    <div className="ops-console">

      {/* ── Vitals strip ─────────────────────────────────────────── */}
      <div className="ops-vitals">
        <div className={`vital-chip ${incidentCounts.critical > 0 ? 'vital-critical' : ''}`}>
          <span>Incidents</span>
          <strong>{snapshot.incidents.length}</strong>
          <small>{incidentCounts.critical}c · {incidentCounts.warning}w</small>
        </div>

        <div className="vital-chip">
          <span>Queue Load</span>
          <strong>{queueLoad}</strong>
          <small>{snapshot.queues.length} lanes</small>
        </div>

        <div className="vital-chip">
          <span>Agents</span>
          <strong>{snapshot.agents.length}</strong>
          <small>{snapshot.subagents.length} sub</small>
        </div>

        <div className="vital-chip">
          <span>Actions</span>
          <strong style={{ color: snapshot.actions.filter((a) => a.availability === 'available').length > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
            {snapshot.actions.filter((a) => a.availability === 'available').length} ready
          </strong>
          <small>{formatActionTimestamp(latestActionRun?.updatedAt)}</small>
        </div>

        <div className="vital-chip vital-chip-wide">
          <span>Transport</span>
          <strong>{summary.connection.transport?.split(' ')[0] ?? '—'}</strong>
          <small>{summary.connection.baseUrl ?? summary.connection.path ?? 'local'}</small>
        </div>

        {/* Live system metrics */}
        <div className="vital-chip vital-gauge-chip">
          <span>CPU {!metrics.isReal && <em className="gauge-sim">~sim</em>}</span>
          <div className="gauge-track">
            <div className={`gauge-fill ${gaugeColor(metrics.cpu)}`} style={{ width: `${metrics.cpu}%` }} />
          </div>
          <strong className={gaugeColor(metrics.cpu)}>{Math.round(metrics.cpu)}%</strong>
        </div>

        <div className="vital-chip vital-gauge-chip">
          <span>RAM {!metrics.isReal && <em className="gauge-sim">~sim</em>}</span>
          <div className="gauge-track">
            <div className={`gauge-fill ${gaugeColor(metrics.ram)}`} style={{ width: `${metrics.ram}%` }} />
          </div>
          <strong className={gaugeColor(metrics.ram)}>{Math.round(metrics.ram)}%</strong>
        </div>

        <div className="vital-chip vital-gauge-chip">
          <span>Net I/O {!metrics.isReal && <em className="gauge-sim">~sim</em>}</span>
          <div className="gauge-track">
            <div className="gauge-fill gauge-net" style={{ width: `${Math.min(100, metrics.netKbps / 1000)}%` }} />
          </div>
          <strong className="gauge-net-text">{formatNet(metrics.netKbps)}</strong>
        </div>

        <div className="vital-chip vital-uptime">
          <span>Uptime</span>
          <strong className="uptime-value">{formatUptime(metrics.uptimeSeconds)}</strong>
          <small>{metrics.isReal ? 'system' : 'session'}</small>
        </div>
      </div>

      {/* ── Main grid ────────────────────────────────────────────── */}
      <div className="ops-grid">

        {/* Modules column */}
        <div className="ops-modules">
          <div className="ops-panel-label">Modules</div>

          {snapshot.capabilityReport.capabilities.map((cap) => (
            <div key={cap.key} className="module-row">
              <span className={`module-dot ${statusDot(cap.status)}`} />
              <div className="module-row-body">
                <span className="module-key">{cap.key}</span>
                <span className="module-note">{cap.note}</span>
              </div>
              <span className={`status status-${cap.status}`}>{cap.status}</span>
            </div>
          ))}

          <div className="ops-panel-divider" />

          {probeSummary ? (
            <>
              <div className="module-row">
                <span className="module-dot dot-green" />
                <div className="module-row-body">
                  <span className="module-key">probe</span>
                  <span className="module-note">{probeSummary.readiness} · {probeSummary.configuration}</span>
                </div>
                <span className="status status-available">{probeSummary.activity.sessionCount} sess</span>
              </div>
              {probeSummary.stateDb ? (
                <div className="module-row">
                  <span className={`module-dot ${probeSummary.stateDb.recognized ? 'dot-green' : 'dot-yellow'}`} />
                  <div className="module-row-body">
                    <span className="module-key">state.db</span>
                    <span className="module-note">
                      {probeSummary.stateDb.recognized
                        ? `${probeSummary.stateDb.tableCount} tables`
                        : (probeSummary.stateDb.fallbackReason ?? 'limited schema')}
                    </span>
                  </div>
                  <span className={`status status-${probeSummary.stateDb.recognized ? 'available' : 'limited'}`}>
                    {probeSummary.stateDb.recognized ? 'ok' : 'limited'}
                  </span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="module-row">
              <span className="module-dot dot-yellow" />
              <div className="module-row-body">
                <span className="module-key">probe</span>
                <span className="module-note">not connected</span>
              </div>
              <span className="status status-limited">mock</span>
            </div>
          )}

          <div className="ops-panel-divider" />

          {snapshot.queues.map((queue) => (
            <div key={queue.label} className="module-row">
              <span className={`module-dot ${queue.depth === 0 ? 'dot-green' : queue.depth < 5 ? 'dot-yellow' : 'dot-red'}`} />
              <div className="module-row-body">
                <span className="module-key">{queue.label}</span>
                <span className="module-note">{queue.trend}</span>
              </div>
              <strong className="module-depth">{queue.depth}</strong>
            </div>
          ))}

          {/* ── Profiles section ─────────────────────────────────── */}
          {profilesSnapshot && profilesSnapshot.profiles.length > 0 && (
            <>
              <div className="ops-panel-divider" />
              <div className="ops-panel-label">
                Profiles
                <span className="ops-incident-meta">{profilesSnapshot.profileCount} total</span>
              </div>

              {profilesSnapshot.profiles.map((profile) => {
                const cronEnabled = profile.cronJobs.enabled;
                const cronTotal = profile.cronJobs.count;
                return (
                  <div key={profile.id} className={`module-row ${profile.isActive ? 'profile-row-active' : ''}`}>
                    <span className={`module-dot ${profile.isActive ? 'dot-green' : 'dot-yellow'}`} />
                    <div className="module-row-body">
                      <span className="module-key">
                        {profile.name}
                        {profile.isActive && <span className="profile-active-badge"> ●</span>}
                      </span>
                      <span className="module-note">
                        {profile.model ?? 'no model'}{profile.provider ? ` · ${profile.provider}` : ''}
                        {profile.sessions.lastActiveAgo ? ` · ${profile.sessions.lastActiveAgo}` : ''}
                      </span>
                    </div>
                    <div className="profile-meta-badges">
                      {profile.sessions.count > 0 && (
                        <span className="profile-badge profile-badge-sessions" title="Sessions">
                          {profile.sessions.count}s
                        </span>
                      )}
                      {cronTotal > 0 && (
                        <span
                          className={`profile-badge ${cronEnabled > 0 ? 'profile-badge-cron-on' : 'profile-badge-cron-off'}`}
                          title={`${cronEnabled}/${cronTotal} cron jobs enabled`}
                        >
                          ⏱{cronEnabled}
                        </span>
                      )}
                      {profile.memoryCount > 0 && (
                        <span className="profile-badge profile-badge-mem" title="Memory files">
                          ◈{profile.memoryCount}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Incidents column */}
        <div className="ops-incidents">
          <div className="ops-panel-label">
            Incidents
            {snapshot.incidents.length > 0 && (
              <span className={`ops-incident-count ${incidentCounts.critical > 0 ? 'count-critical' : 'count-warning'}`}>
                {snapshot.incidents.length}
              </span>
            )}
          </div>

          {prioritizedIncidents.length === 0 ? (
            <div className="ops-all-clear">
              <span className="all-clear-dot" />
              All systems clear
            </div>
          ) : (
            prioritizedIncidents.slice(0, 4).map((incident, i) => (
              <article key={incident.id} className={`ops-incident ${i === 0 ? 'ops-incident-top' : ''}`}>
                <div className="ops-incident-head">
                  <span className={`severity-pill severity-pill-${incident.severity}`}>{incident.severity}</span>
                  <span className="ops-incident-cat">{incident.category}</span>
                </div>
                <strong className="ops-incident-title">{incident.title}</strong>
                <p className="ops-incident-hint">{incident.actionHint}</p>
              </article>
            ))
          )}
        </div>

        {/* Actions column */}
        <div className="ops-actions">
          <div className="ops-panel-label">Quick Fix</div>

          {snapshot.actions.map((action) => {
            const run = actionRuns[action.id];
            const isRunning = run?.status === 'running';
            const isReady = action.availability === 'available';

            return (
              <div key={action.id} className="ops-action-item">
                <div className="ops-action-meta">
                  <code className="ops-action-cmd">{action.commandLabel}</code>
                  <span className={`status status-${isRunning ? 'running' : isReady ? 'available' : 'limited'}`}>
                    {isRunning ? 'running' : isReady ? 'ready' : action.availability}
                  </span>
                </div>
                <button
                  type="button"
                  className={`ops-run-btn ${isReady ? 'ops-run-ready' : ''}`}
                  disabled={!isReady || isRunning}
                  onClick={() => onRunAction(instance, action)}
                >
                  {isRunning ? '⟳ Running…' : `▶ ${action.label}`}
                </button>
                {run?.summary ? <p className="ops-action-result">{run.summary}</p> : <p className="ops-action-result">{action.note}</p>}
              </div>
            );
          })}

          {latestActionRun ? (
            <div className="ops-last-run">
              <span>{formatActionTimestamp(latestActionRun.updatedAt)}</span>
              <span className={latestActionRun.exitCode === 0 ? 'exit-ok' : 'exit-fail'}>
                exit {latestActionRun.exitCode ?? '—'}
              </span>
              {latestActionRun.durationMs ? <span>{latestActionRun.durationMs}ms</span> : null}
            </div>
          ) : null}

          <div className="ops-panel-divider" />

          <div className="ops-panel-label" style={{ marginTop: 4 }}>Agents</div>
          {snapshot.agents.map((agent) => (
            <div key={agent.id} className="module-row">
              <span className={`module-dot ${statusDot(agent.status)}`} />
              <div className="module-row-body">
                <span className="module-key">{agent.label}</span>
                <span className="module-note">{agent.lastActivity}</span>
              </div>
              <span className={`status status-${agent.status}`}>{agent.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Terminal strip ────────────────────────────────────────── */}
      <div className="ops-terminal">
        <EkgLine status={summary.status} />

        <div className="ops-terminal-body">
          <div className="ops-terminal-output ops-chat-output" ref={terminalRef}>
            {terminalLines.map((entry, i) => (
              <span
                key={i}
                className={`terminal-line ${entry.role === 'user' ? 'terminal-line-user' : 'terminal-line-agent'}`}
              >
                {entry.role === 'user' ? '› ' : '⬡ '}{entry.text}
              </span>
            ))}
            {isChatting && <span className="terminal-line terminal-line-agent">⬡ <span className="terminal-cursor">▌</span></span>}
            {!isChatting && chatHistory.length === 0 && <span className="terminal-cursor">▌</span>}
          </div>

          <form className="ops-terminal-input" onSubmit={(e) => { void handleChat(e); }}>
            <span className="terminal-prompt">›</span>
            <input
              className="terminal-field"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={isChatting ? 'Hermes is thinking…' : 'ask hermes anything · hermes doctor · hermes status…'}
              spellCheck={false}
              autoComplete="off"
              disabled={isChatting}
            />
            <button type="submit" className="terminal-send" disabled={isChatting}>
              {isChatting ? '…' : 'Send'}
            </button>
          </form>
        </div>
      </div>

    </div>
  );
}
