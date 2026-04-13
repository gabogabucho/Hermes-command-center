import { useRef, useState } from 'react';
import type { HermesInstanceRecord, OperatorActionId, OperatorActionSummary } from '../adapters/types';
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

export function LiteMode({ instance, actionRuns, onRunAction }: Props) {
  const { snapshot, summary } = instance;
  const prioritizedIncidents = prioritizeIncidents(snapshot.incidents);
  const primaryIncident = prioritizedIncidents[0];
  const latestActionRun = getLatestActionRun(snapshot.actions, actionRuns);
  const incidentCounts = getIncidentCounts(snapshot.incidents);
  const queueLoad = snapshot.queues.reduce((t, q) => t + q.depth, 0);

  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = chatInput.trim();
    if (!msg || isChatting) return;
    setChatInput('');
    setIsChatting(true);
    setChatHistory((prev) => [...prev, { role: 'user', text: msg }]);
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

  const terminalLines: ChatEntry[] = chatHistory.length > 0
    ? chatHistory.slice(-6)
    : latestActionRun?.outputLines?.length
      ? latestActionRun.outputLines.slice(-3).map((t) => ({ role: 'agent' as const, text: t }))
      : [];

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
              placeholder={isChatting ? 'Hermes is thinking…' : 'ask hermes…'}
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
