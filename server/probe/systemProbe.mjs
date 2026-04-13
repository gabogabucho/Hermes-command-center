/**
 * System metrics probe — reads /proc/stat, /proc/meminfo, /proc/net/dev, /proc/uptime.
 * Falls back to simulated random-walk data on non-Linux systems (Windows dev).
 */
import { readFile } from 'node:fs/promises';

const IS_LINUX = process.platform === 'linux';

// ── CPU ───────────────────────────────────────────────────────────────────────

let prevCpu = null;

async function readCpuStat() {
  const raw = await readFile('/proc/stat', 'utf8');
  const fields = raw.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  // fields: user nice system idle iowait irq softirq steal guest guest_nice
  const idle  = fields[3] + (fields[4] ?? 0); // idle + iowait
  const total = fields.reduce((a, b) => a + b, 0);
  return { idle, total };
}

async function getCpuPct() {
  if (!IS_LINUX) return null;
  try {
    const curr = await readCpuStat();
    if (!prevCpu) { prevCpu = curr; return 0; }
    const dIdle  = curr.idle  - prevCpu.idle;
    const dTotal = curr.total - prevCpu.total;
    prevCpu = curr;
    if (dTotal === 0) return 0;
    return Math.round((1 - dIdle / dTotal) * 100);
  } catch { return 0; }
}

// ── RAM ───────────────────────────────────────────────────────────────────────

async function getRamPct() {
  if (!IS_LINUX) return null;
  try {
    const raw = await readFile('/proc/meminfo', 'utf8');
    const kv = Object.fromEntries(
      raw.split('\n').filter(Boolean).map((l) => {
        const [k, ...v] = l.split(':');
        return [k.trim(), parseInt(v.join('').trim(), 10)];
      }),
    );
    const total     = kv['MemTotal'];
    const available = kv['MemAvailable'] ?? kv['MemFree'];
    if (!total || available == null) return 0;
    return Math.round((1 - available / total) * 100);
  } catch { return 0; }
}

// ── Network ───────────────────────────────────────────────────────────────────

let prevNet = null;

async function getNetKbps() {
  if (!IS_LINUX) return null;
  try {
    const raw   = await readFile('/proc/net/dev', 'utf8');
    const lines = raw.split('\n').slice(2); // skip header
    let totalBytes = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const iface = parts[0].replace(':', '');
      if (iface === 'lo') continue;
      totalBytes += parseInt(parts[1], 10) + parseInt(parts[9], 10); // rx + tx bytes
    }
    const now = Date.now();
    if (!prevNet) { prevNet = { bytes: totalBytes, ts: now }; return 0; }
    const elapsed = (now - prevNet.ts) / 1000;
    const kbps    = ((totalBytes - prevNet.bytes) / elapsed) / 1024;
    prevNet = { bytes: totalBytes, ts: now };
    return Math.max(0, Math.round(kbps));
  } catch { return 0; }
}

// ── Uptime ────────────────────────────────────────────────────────────────────

async function getUptimeSeconds() {
  if (!IS_LINUX) return null;
  try {
    const raw = await readFile('/proc/uptime', 'utf8');
    return Math.floor(parseFloat(raw.split(' ')[0]));
  } catch { return 0; }
}

// ── Simulated fallback (random-walk for dev) ──────────────────────────────────

let sim = { cpu: 25, ram: 48, netKbps: 120, uptime: 0, ts: Date.now() };

function getSimMetrics() {
  const now = Date.now();
  const dt  = (now - sim.ts) / 1000;
  sim.ts  = now;
  const nudge = (v, lo, hi, drift) =>
    Math.max(lo, Math.min(hi, v + (Math.random() - 0.5) * drift));
  sim.cpu    = nudge(sim.cpu,    3,  90, 9);
  sim.ram    = nudge(sim.ram,    28, 88, 2.5);
  sim.netKbps = nudge(sim.netKbps, 0, 5000, 300);
  sim.uptime += dt;
  return { cpuPct: Math.round(sim.cpu), ramPct: Math.round(sim.ram), netKbps: Math.round(sim.netKbps), uptimeSeconds: Math.round(sim.uptime) };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function collectSystemMetrics() {
  const [cpuPct, ramPct, netKbps, uptimeSeconds] = await Promise.all([
    getCpuPct(),
    getRamPct(),
    getNetKbps(),
    getUptimeSeconds(),
  ]);

  // If any real read returned null we're not on Linux — use simulated data
  if (cpuPct === null) {
    const s = getSimMetrics();
    return { ...s, isReal: false, generatedAt: new Date().toISOString() };
  }

  return {
    cpuPct,
    ramPct,
    netKbps,
    uptimeSeconds,
    isReal: true,
    generatedAt: new Date().toISOString(),
  };
}
