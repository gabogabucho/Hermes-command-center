import { useEffect, useState } from 'react';

export type LiveMetrics = {
  cpu: number;   // 0–100
  ram: number;   // 0–100
  net: number;   // 0–100 (relative throughput)
  uptime: number; // seconds since mount
};

function nudge(prev: number, min: number, max: number, drift: number, bias = 0): number {
  const delta = (Math.random() - 0.5 + bias) * drift;
  return Math.max(min, Math.min(max, prev + delta));
}

export function useLiveMetrics(): LiveMetrics {
  const [metrics, setMetrics] = useState<LiveMetrics>(() => ({
    cpu:    20 + Math.random() * 30,
    ram:    38 + Math.random() * 22,
    net:    5  + Math.random() * 25,
    uptime: 0,
  }));

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics((prev) => ({
        cpu:    nudge(prev.cpu,    3,  92, 9,   0.02),   // slight upward drift
        ram:    nudge(prev.ram,    28, 88, 2.5, 0.01),   // memory only grows slowly
        net:    nudge(prev.net,    0,  100, 18, 0),
        uptime: prev.uptime + 2,
      }));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return metrics;
}
