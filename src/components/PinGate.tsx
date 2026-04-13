import { useEffect, useState } from 'react';

const CORRECT_PIN = '1234';
const SESSION_KEY = 'hcc_unlocked';

type Props = {
  children: React.ReactNode;
};

const PAD_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['⌫', '0', '↵'],
];

function formatUptime(ts: number): string {
  const elapsed = Math.floor((Date.now() - ts) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PinGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; }
    catch { return false; }
  });
  const [input, setInput] = useState('');
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Keep the clock ticking on the lock screen
  useEffect(() => {
    if (unlocked) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [unlocked]);

  if (unlocked) return <>{children}</>;

  const press = (key: string) => {
    if (shake) return;

    if (key === '⌫') {
      setInput((p) => p.slice(0, -1));
      return;
    }

    if (key === '↵') {
      submit(input);
      return;
    }

    if (input.length >= 4) return;
    const next = input + key;
    setInput(next);
    if (next.length === 4) submit(next);
  };

  const submit = (pin: string) => {
    if (pin === CORRECT_PIN) {
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* noop */ }
      setUnlocked(true);
    } else {
      setShake(true);
      setAttempts((n) => n + 1);
      setInput('');
      setTimeout(() => setShake(false), 600);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') { press('⌫'); return; }
    if (e.key === 'Enter') { press('↵'); return; }
    if (/^[0-9]$/.test(e.key)) press(e.key);
  };

  const d = new Date(now);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pin input handled via keydown
    <div className="pin-gate" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="pin-bg-grid" aria-hidden />

      <div className="pin-clock">
        <div className="pin-time">{timeStr}</div>
        <div className="pin-date">{dateStr}</div>
      </div>

      <div className={`pin-panel${shake ? ' pin-shake' : ''}`}>
        <div className="pin-brand">
          <span className="pin-eyebrow">Hermes Fleet</span>
          <span className="pin-title">Command Center</span>
        </div>

        <div className="pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`pin-dot ${i < input.length ? 'pin-dot-filled' : ''}`}
            />
          ))}
        </div>

        {attempts > 0 && (
          <div className="pin-error">
            {attempts === 1 ? 'Wrong PIN. Try again.' : `Wrong PIN. ${attempts} attempts.`}
          </div>
        )}

        <div className="pin-pad">
          {PAD_KEYS.map((row, ri) => (
            <div key={ri} className="pin-row">
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`pin-key ${key === '↵' ? 'pin-key-enter' : ''} ${key === '⌫' ? 'pin-key-back' : ''}`}
                  onClick={() => press(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
