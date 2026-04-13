/**
 * profileProbe.mjs
 *
 * Reads Hermes profile data directly from the filesystem.
 * Philosophy: this is a MONITOR, not a UI. We only surface ops-relevant signals:
 * active profile, list of profiles, model/provider, session counts, cron jobs,
 * last activity. No message content, no workspace browsing.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ── Helpers ────────────────────────────────────────────────────────────────

async function pathExists(p) {
  if (!p) return false;
  try { await access(p); return true; } catch { return false; }
}

async function readTextSafe(p) {
  if (!(await pathExists(p))) return null;
  try { return await readFile(p, 'utf8'); } catch { return null; }
}

async function statSafe(p) {
  if (!(await pathExists(p))) return null;
  try { return await stat(p); } catch { return null; }
}

function parseYamlFlat(content) {
  const out = {};
  if (!content) return out;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);
    if (!m) continue;
    let val = m[2].trim().replace(/\s*#.*$/, '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

function formatRelAge(ts) {
  if (!ts) return null;
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

// ── Active profile ─────────────────────────────────────────────────────────

async function readActiveProfile(hermesHome) {
  const p = path.join(hermesHome, 'active_profile');
  const raw = await readTextSafe(p);
  return raw ? raw.trim() : null;
}

// ── Sessions: count + latest mtime ────────────────────────────────────────

async function inspectSessionsDir(sessionsDir) {
  if (!(await pathExists(sessionsDir))) return { count: 0, lastActiveAt: null };
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && (e.name.endsWith('.json') || e.name.endsWith('.db')));
    if (files.length === 0) return { count: files.length, lastActiveAt: null };
    const stats = await Promise.all(files.map(e => statSafe(path.join(sessionsDir, e.name))));
    const latest = stats.reduce((max, s) => (!s ? max : Math.max(max, s.mtimeMs || 0)), 0);
    return { count: files.length, lastActiveAt: latest || null };
  } catch {
    return { count: 0, lastActiveAt: null };
  }
}

// ── Cron jobs: read files in cron/ dir ────────────────────────────────────

async function inspectCronDir(cronDir) {
  if (!(await pathExists(cronDir))) return [];
  try {
    const entries = await readdir(cronDir, { withFileTypes: true });
    const jobs = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(cronDir, entry.name);
      const content = await readTextSafe(filePath);
      const fileStat = await statSafe(filePath);
      // Try to parse name and schedule from YAML/JSON content
      let name = path.basename(entry.name, path.extname(entry.name));
      let schedule = null;
      let enabled = true;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          name = parsed.name || parsed.title || name;
          schedule = parsed.schedule || parsed.cron || null;
          enabled = parsed.enabled !== false && parsed.active !== false;
        } catch {
          const yaml = parseYamlFlat(content);
          name = yaml.name || yaml.title || name;
          schedule = yaml.schedule || yaml.cron || null;
          enabled = yaml.enabled !== 'false' && yaml.active !== 'false';
        }
      }
      jobs.push({
        id: path.basename(entry.name),
        name,
        schedule,
        enabled,
        lastModifiedAt: fileStat?.mtimeMs ?? null,
        lastModifiedAgo: formatRelAge(fileStat?.mtimeMs ?? null),
      });
    }
    return jobs.sort((a, b) => (b.lastModifiedAt ?? 0) - (a.lastModifiedAt ?? 0));
  } catch {
    return [];
  }
}

// ── Skills count ───────────────────────────────────────────────────────────

async function countSkills(skillsDir) {
  if (!(await pathExists(skillsDir))) return 0;
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries.filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.yaml') || e.name.endsWith('.yml'))).length;
  } catch {
    return 0;
  }
}

// ── Memories count ─────────────────────────────────────────────────────────

async function countMemories(memoriesDir) {
  if (!(await pathExists(memoriesDir))) return 0;
  try {
    const entries = await readdir(memoriesDir, { withFileTypes: true });
    return entries.filter(e => e.isFile()).length;
  } catch {
    return 0;
  }
}

// ── Per-profile inspection ─────────────────────────────────────────────────

async function inspectProfile(profilePath, profileName, isActive) {
  const configPath = path.join(profilePath, 'config.yaml');
  const soulPath = path.join(profilePath, 'SOUL.md');
  const sessionsDir = path.join(profilePath, 'sessions');
  const cronDir = path.join(profilePath, 'cron');
  const skillsDir = path.join(profilePath, 'skills');
  const memoriesDir = path.join(profilePath, 'memories');
  const logsDir = path.join(profilePath, 'logs');

  const [configContent, soulContent, profileStat] = await Promise.all([
    readTextSafe(configPath),
    readTextSafe(soulPath),
    statSafe(profilePath),
  ]);

  const config = parseYamlFlat(configContent ?? '');
  const model = config.model || config.MODEL || config.llm_model || null;
  const provider = config.provider || config.PROVIDER || config.llm_provider || null;

  // Extract soul title from first heading
  let soulTitle = null;
  if (soulContent) {
    const match = soulContent.match(/^#{1,3}\s+(.+)$/m);
    if (match) soulTitle = match[1].trim();
  }

  const [sessions, cronJobs, skillCount, memoryCount, hasLogs] = await Promise.all([
    inspectSessionsDir(sessionsDir),
    inspectCronDir(cronDir),
    countSkills(skillsDir),
    countMemories(memoriesDir),
    pathExists(logsDir),
  ]);

  const lastActiveAt = sessions.lastActiveAt;

  return {
    id: profileName,
    name: soulTitle || profileName,
    path: profilePath,
    isActive,
    model,
    provider,
    sessions: {
      count: sessions.count,
      lastActiveAt,
      lastActiveAgo: formatRelAge(lastActiveAt),
    },
    cronJobs: {
      count: cronJobs.length,
      enabled: cronJobs.filter(j => j.enabled).length,
      jobs: cronJobs,
    },
    skillCount,
    memoryCount,
    hasLogs,
    createdAt: profileStat?.birthtimeMs ?? null,
  };
}

// ── Main export ────────────────────────────────────────────────────────────

export async function collectProfilesSnapshot() {
  const hermesHome = process.env.HERMES_HOME
    ? path.resolve(process.env.HERMES_HOME)
    : path.join(os.homedir(), '.hermes');

  const profilesDir = path.join(hermesHome, 'profiles');

  const [activeProfileName, profilesDirExists] = await Promise.all([
    readActiveProfile(hermesHome),
    pathExists(profilesDir),
  ]);

  if (!profilesDirExists) {
    return {
      hermesHome,
      activeProfile: activeProfileName,
      profiles: [],
      generatedAt: new Date().toISOString(),
    };
  }

  let profileNames = [];
  try {
    const entries = await readdir(profilesDir, { withFileTypes: true });
    profileNames = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  } catch {
    profileNames = [];
  }

  const profiles = await Promise.all(
    profileNames.map(name =>
      inspectProfile(
        path.join(profilesDir, name),
        name,
        name === activeProfileName,
      ).catch(() => ({
        id: name,
        name,
        path: path.join(profilesDir, name),
        isActive: name === activeProfileName,
        model: null,
        provider: null,
        sessions: { count: 0, lastActiveAt: null, lastActiveAgo: null },
        cronJobs: { count: 0, enabled: 0, jobs: [] },
        skillCount: 0,
        memoryCount: 0,
        hasLogs: false,
        createdAt: null,
        error: 'inspection failed',
      })),
    ),
  );

  // Sort: active first, then by last session activity
  profiles.sort((a, b) => {
    if (a.isActive) return -1;
    if (b.isActive) return 1;
    return (b.sessions.lastActiveAt ?? 0) - (a.sessions.lastActiveAt ?? 0);
  });

  return {
    hermesHome,
    activeProfile: activeProfileName,
    profileCount: profiles.length,
    profiles,
    generatedAt: new Date().toISOString(),
  };
}
