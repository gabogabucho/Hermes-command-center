import { useEffect, useState } from 'react';

export type LiveMetrics = {
  cpu:            number;  // 0–100 %
  ram:            number;  // 0–100 %
  netKbps:        number;  // kilobytes per second
  uptimeSeconds:  number;  // seconds
  isReal:         boolean; // true = live /proc data, false = simulated
};

const INITIAL: LiveMetrics = { cpu: 0, ram: 0, netKbps: 0, uptimeSeconds: 0, isReal: false };
const POLL_MS = 2_000;

export function useLiveMetrics(): LiveMetrics {
  const [metrics, setMetrics] = useState<LiveMetrics>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/system');
        if (!res.ok || cancelled) return;
        const data = await res.json() as {
          cpuPct: number; ramPct: number; netKbps: number;
          uptimeSeconds: number; isReal: boolean;
        };
        if (!cancelled) {
          setMetrics({
            cpu:           data.cpuPct,
            ram:           data.ramPct,
            netKbps:       data.netKbps,
            uptimeSeconds: data.uptimeSeconds,
            isReal:        data.isReal,
          });
        }
      } catch { /* server not ready yet, keep previous values */ }
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return metrics;
}
