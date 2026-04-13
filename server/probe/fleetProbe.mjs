import { access, readFile, readdir, readlink, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const KNOWN_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0']);
const execFileAsync = promisify(execFile);
const PYTHON_EXECUTABLES = [
  { command: 'python', args: [] },
  { command: 'python3', args: [] },
  { command: 'py', args: ['-3'] },
];
const STATE_DB_RECENT_LIMIT = 3;
const STATE_DB_TABLE_SAMPLE_LIMIT = 8;
const SAFE_LOCAL_ACTIONS = [
  {
    id: 'hermes-doctor',
    label: 'Run Hermes doctor',
    commandLabel: 'hermes doctor',
    note: 'Runs the official Hermes CLI doctor command against this selected local instance without --fix.',
  },
  {
    id: 'hermes-status',
    label: 'Run Hermes status',
    commandLabel: 'hermes status',
    note: 'Runs the official Hermes CLI status command against this selected local instance and returns a short summary only.',
  },
];

async function pathExists(targetPath) {
  if (!targetPath) return false;
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(targetPath) {
  if (!(await pathExists(targetPath))) return null;
  return readFile(targetPath, 'utf8');
}

async function statIfExists(targetPath) {
  if (!(await pathExists(targetPath))) return null;
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}

function pushUnique(list, seen, targetPath, source, metadata = {}) {
  if (!targetPath) return;
  const normalized = path.resolve(targetPath);
  if (seen.has(normalized)) return;
  seen.add(normalized);
  list.push({ path: normalized, source, ...metadata });
}

function parseEnvFile(content) {
  const parsed = {};
  if (!content) return parsed;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separatorIndex = line.indexOf('=');
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function resolveHomeLikePath(rawValue) {
  if (!rawValue) return undefined;
  if (rawValue.startsWith('~/')) return path.join(os.homedir(), rawValue.slice(2));
  return rawValue;
}

function stripInlineComment(rawValue) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
    if (char === '#' && !inSingle && !inDouble) {
      return rawValue.slice(0, index).trim();
    }
  }
  return rawValue.trim();
}

function parseYamlFile(content) {
  const parsed = {};
  if (!content) return parsed;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = stripInlineComment(rawValue);
    if (!value) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function prettifyName(rawValue) {
  return (
    rawValue
      .replace(/^\.+/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Hermes Instance'
  );
}

function normalizeWhitespace(rawValue) {
  return String(rawValue || '').replace(/\s+/g, ' ').trim();
}

function isGenericSoulTitle(rawValue) {
  const normalized = normalizeWhitespace(rawValue).toLowerCase();
  if (!normalized) return true;
  return new Set(['soul', 'soul.md', 'hermes', 'hermes soul', 'profile', 'default']).has(normalized);
}

function extractSoulTitle(content) {
  if (!content) return undefined;
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    const candidate = normalizeWhitespace(headingMatch ? headingMatch[1] : line);
    if (!candidate || isGenericSoulTitle(candidate)) continue;
    if (headingMatch) return candidate;
    if (candidate.length <= 80) return candidate;
  }
  return undefined;
}

function resolveDisplayName({ candidate, candidatePath, parsedConfig, soulTitle }) {
  const defaultRootPath = path.join(os.homedir(), '.hermes');
  const configName = typeof parsedConfig.name === 'string' ? normalizeWhitespace(parsedConfig.name) : undefined;
  if (candidate.kind === 'profile' && candidate.profileName) {
    return {
      displayName: prettifyName(candidate.profileName),
      naming: {
        source: 'profile directory',
        detail: `Using the official profile directory name from ~/.hermes/profiles/${candidate.profileName}.`,
      },
    };
  }

  if (configName) {
    return {
      displayName: configName,
      naming: {
        source: 'config.yaml name',
        detail: 'Using the top-level name field from config.yaml.',
      },
    };
  }

  if (soulTitle) {
    return {
      displayName: soulTitle,
      naming: {
        source: 'SOUL.md heading',
        detail: 'Using the first clear heading from SOUL.md as the local friendly name.',
      },
    };
  }

  if (candidate.kind === 'root' && path.resolve(candidatePath) === path.resolve(defaultRootPath)) {
    return {
      displayName: 'Hermes Home',
      naming: {
        source: 'default Hermes home',
        detail: 'Falling back to the standard ~/.hermes root instance label.',
      },
    };
  }

  if (candidate.kind === 'root') {
    return {
      displayName: 'Hermes Root Instance',
      naming: {
        source: 'root fallback',
        detail: 'No explicit friendly name signal was found, so the root instance keeps a conservative fallback.',
      },
    };
  }

  return {
    displayName: prettifyName(path.basename(candidatePath)),
    naming: {
      source: 'directory name',
      detail: 'Using the local instance directory name as a conservative fallback.',
    },
  };
}

function normalizeId(rawValue) {
  return rawValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function summarizeCapabilities(capabilities) {
  return capabilities.reduce(
    (summary, capability) => {
      summary[capability.status] += 1;
      return summary;
    },
    { available: 0, limited: 0, unavailable: 0 },
  );
}

function buildBaseUrl(envConfig) {
  if (envConfig.HERMES_BASE_URL) return envConfig.HERMES_BASE_URL;
  if (envConfig.HERMES_WEBUI_BASE_URL) return envConfig.HERMES_WEBUI_BASE_URL;
  const host = envConfig.HERMES_HOST || envConfig.HERMES_WEBUI_HOST || envConfig.HOST;
  const port = envConfig.HERMES_PORT || envConfig.HERMES_WEBUI_PORT || envConfig.PORT;
  if (host && port) return `http://${host}:${port}`;
  return undefined;
}

function formatRelativeAge(timestamp) {
  if (!timestamp) return 'no recent activity signal';
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return 'under a minute ago';
  if (deltaMs < 3_600_000) return `${Math.max(1, Math.round(deltaMs / 60_000))}m ago`;
  if (deltaMs < 86_400_000) return `${Math.max(1, Math.round(deltaMs / 3_600_000))}h ago`;
  return `${Math.max(1, Math.round(deltaMs / 86_400_000))}d ago`;
}

function formatTimestamp(timestamp) {
  return timestamp ? new Date(timestamp).toISOString() : undefined;
}

function formatCount(value, noun) {
  if (!Number.isFinite(value)) return undefined;
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function pickLatestSignal(signals) {
  return signals.filter((signal) => Number.isFinite(signal.timestamp)).sort((a, b) => b.timestamp - a.timestamp)[0];
}

function classifyActivity(timestamp) {
  if (!timestamp) return 'none';
  return Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000 ? 'recent' : 'stale';
}

async function runPythonJson(script, args = []) {
  let lastError = null;

  for (const candidate of PYTHON_EXECUTABLES) {
    try {
      const { stdout } = await execFileAsync(candidate.command, [...candidate.args, '-c', script, ...args], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      break;
    }
  }

  throw lastError ?? new Error('No supported Python runtime is available.');
}

async function inspectStateDb(stateDbPath) {
  if (!stateDbPath || !(await pathExists(stateDbPath))) return null;

  const pythonScript = String.raw`
import json
import sqlite3
import sys
from urllib.parse import quote

db_path = sys.argv[1]
limit = int(sys.argv[2])
table_sample_limit = int(sys.argv[3])

result = {
    "recognized": False,
    "tableCount": 0,
    "tables": [],
    "tableSummaries": [],
    "recentSessionIds": [],
    "recentSources": [],
}

def has_columns(columns, required):
    return all(column in columns for column in required)

try:
    uri = "file:" + quote(db_path.replace("\\", "/"), safe="/:") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=1)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    tables = [row[0] for row in cur.fetchall()]
    result["tableCount"] = len(tables)
    result["tables"] = tables[:table_sample_limit]

    session_columns = []
    message_columns = []

    if "sessions" in tables:
        cur.execute("PRAGMA table_info(sessions)")
        session_columns = [row[1] for row in cur.fetchall()]
        session_summary = {"name": "sessions"}
        try:
            cur.execute("SELECT COUNT(*) FROM sessions")
            session_summary["rowCount"] = cur.fetchone()[0]
        except Exception:
            pass

        if "started_at" in session_columns:
            try:
                cur.execute("SELECT MAX(started_at) FROM sessions")
                latest_started_at = cur.fetchone()[0]
                if latest_started_at is not None:
                    session_summary["latestTimestamp"] = latest_started_at
                    result.setdefault("sessionLatestStartedAt", latest_started_at)
            except Exception:
                pass

        result["tableSummaries"].append(session_summary)

    if "messages" in tables:
        cur.execute("PRAGMA table_info(messages)")
        message_columns = [row[1] for row in cur.fetchall()]
        message_summary = {"name": "messages"}
        try:
            cur.execute("SELECT COUNT(*) FROM messages")
            message_summary["rowCount"] = cur.fetchone()[0]
        except Exception:
            pass

        if "timestamp" in message_columns:
            try:
                cur.execute("SELECT MAX(timestamp) FROM messages")
                latest_message_at = cur.fetchone()[0]
                if latest_message_at is not None:
                    message_summary["latestTimestamp"] = latest_message_at
                    result.setdefault("messageLatestAt", latest_message_at)
            except Exception:
                pass

        result["tableSummaries"].append(message_summary)

    recognized_tables = []
    if has_columns(session_columns, ["id", "source", "started_at"]):
        recognized_tables.append("sessions")
    if has_columns(message_columns, ["session_id", "timestamp"]):
        recognized_tables.append("messages")

    result["recognized"] = len(recognized_tables) > 0
    result["recognizedTables"] = recognized_tables

    if has_columns(session_columns, ["id", "source", "started_at"]):
        order_sql = "started_at DESC"
        if has_columns(message_columns, ["session_id", "timestamp"]):
            order_sql = "COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = sessions.id), started_at) DESC"
        cur.execute(
            f"SELECT id, source FROM sessions ORDER BY {order_sql} LIMIT ?",
            (limit,),
        )
        session_rows = cur.fetchall()
        result["recentSessionIds"] = [row["id"] for row in session_rows if row["id"]]
        seen_sources = []
        for row in session_rows:
            source = row["source"]
            if source and source not in seen_sources:
                seen_sources.append(source)
        result["recentSources"] = seen_sources

    conn.close()
except Exception as exc:
    result["inspectionError"] = str(exc)

print(json.dumps(result))
`;

  try {
    const raw = await runPythonJson(pythonScript, [stateDbPath, String(STATE_DB_RECENT_LIMIT), String(STATE_DB_TABLE_SAMPLE_LIMIT)]);
    const tableSummaries = Array.isArray(raw.tableSummaries)
      ? raw.tableSummaries
          .filter((table) => table && typeof table.name === 'string')
          .map((table) => ({
            name: table.name,
            rowCount: Number.isFinite(table.rowCount) ? table.rowCount : undefined,
            latestTimestamp: formatTimestamp(Number.isFinite(table.latestTimestamp) ? table.latestTimestamp : undefined),
          }))
      : [];
    const lastActivityCandidates = [
      { source: 'state.db messages', timestamp: Number.isFinite(raw.messageLatestAt) ? raw.messageLatestAt : undefined },
      { source: 'state.db sessions', timestamp: Number.isFinite(raw.sessionLatestStartedAt) ? raw.sessionLatestStartedAt : undefined },
    ];
    const lastActivity = pickLatestSignal(lastActivityCandidates);

    return {
      recognized: Boolean(raw.recognized),
      tableCount: Number.isFinite(raw.tableCount) ? raw.tableCount : 0,
      tables: Array.isArray(raw.tables) ? raw.tables.filter((table) => typeof table === 'string') : [],
      inspectionError: typeof raw.inspectionError === 'string' && raw.inspectionError ? raw.inspectionError : undefined,
      recentSessionIds: Array.isArray(raw.recentSessionIds) ? raw.recentSessionIds.filter((value) => typeof value === 'string').slice(0, STATE_DB_RECENT_LIMIT) : [],
      recentSources: Array.isArray(raw.recentSources) ? raw.recentSources.filter((value) => typeof value === 'string').slice(0, STATE_DB_RECENT_LIMIT) : [],
      tableSummaries,
      lastActivityAt: lastActivity?.timestamp,
      lastActivitySource: lastActivity?.source,
    };
  } catch (error) {
    return {
      recognized: false,
      tableCount: 0,
      tables: [],
      inspectionError: error instanceof Error ? error.message : 'state.db inspection failed',
      recentSessionIds: [],
      recentSources: [],
      tableSummaries: [],
      lastActivityAt: undefined,
      lastActivitySource: undefined,
    };
  }
}

function summarizeStateDbSignal(stateDbInfo, stateDbStats) {
  if (!stateDbInfo && !stateDbStats) return undefined;
  if (stateDbInfo?.recognized) {
    const summaryParts = [formatCount(stateDbInfo.tableCount, 'table')];
    const sessionsTable = stateDbInfo.tableSummaries.find((table) => table.name === 'sessions');
    const messagesTable = stateDbInfo.tableSummaries.find((table) => table.name === 'messages');
    if (Number.isFinite(sessionsTable?.rowCount)) summaryParts.push(`${sessionsTable.rowCount} sessions`);
    if (Number.isFinite(messagesTable?.rowCount)) summaryParts.push(`${messagesTable.rowCount} messages`);
    if (stateDbInfo.lastActivityAt) {
      summaryParts.push(`latest DB activity ${formatRelativeAge(Date.parse(stateDbInfo.lastActivityAt))}`);
    } else if (stateDbStats?.mtimeMs) {
      summaryParts.push(`file updated ${formatRelativeAge(stateDbStats.mtimeMs)}`);
    }
    return summaryParts.filter(Boolean).join(' · ');
  }

  if (stateDbInfo?.tableCount > 0) {
    return `${formatCount(stateDbInfo.tableCount, 'table') ?? 'table layout detected'} · schema not recognized${
      stateDbStats?.mtimeMs ? ` · file updated ${formatRelativeAge(stateDbStats.mtimeMs)}` : ''
    }`;
  }

  if (stateDbInfo?.inspectionError) {
    return `present but unreadable · ${stateDbInfo.inspectionError}`;
  }

  return stateDbStats?.mtimeMs ? `updated ${formatRelativeAge(stateDbStats.mtimeMs)}` : 'present';
}

function describeConfigurationState({ hasConfig, hasEnvFile, hasAuthFile, hasSoulFile }) {
  const configuredSignals = [hasConfig, hasEnvFile, hasAuthFile, hasSoulFile].filter(Boolean).length;
  if (configuredSignals === 0) return 'empty';
  if (hasConfig || configuredSignals >= 2) return 'configured';
  return 'partial';
}

async function summarizeDirectoryFiles(targetDir, { exclude = new Set() } = {}) {
  if (!(await pathExists(targetDir))) {
    return { exists: false, fileCount: 0, latestFileAt: undefined };
  }

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && !exclude.has(entry.name));
    const stats = await Promise.all(files.map((entry) => statIfExists(path.join(targetDir, entry.name))));
    const latestTimestamp = stats.reduce((latest, current) => {
      if (!current) return latest;
      return Math.max(latest, current.mtimeMs || 0);
    }, 0);
    return {
      exists: true,
      fileCount: files.length,
      latestFileAt: latestTimestamp || undefined,
    };
  } catch {
    return { exists: true, fileCount: 0, latestFileAt: undefined };
  }
}

function inferInstanceFromPath(targetPath) {
  if (!targetPath) return null;
  let current = path.resolve(targetPath);
  let previous = null;

  while (current && current !== previous) {
    const parent = path.dirname(current);
    if (path.basename(current) === '.hermes') {
      return { instancePath: current, kind: 'root', hermesHome: current };
    }
    if (path.basename(parent) === 'profiles') {
      return {
        instancePath: current,
        kind: 'profile',
        profileName: path.basename(current),
        hermesHome: path.dirname(parent),
      };
    }
    previous = current;
    current = parent;
  }

  return null;
}

function inferInstallRootFromHermesBinary(binaryTargetPath) {
  if (!binaryTargetPath) return undefined;
  const resolved = path.resolve(binaryTargetPath);
  const binDir = path.dirname(resolved);
  if (path.basename(binDir) !== 'bin') return undefined;
  const venvDir = path.dirname(binDir);
  if (path.basename(venvDir) !== 'venv') return undefined;
  return path.dirname(venvDir);
}

async function inspectHermesBinary(binaryPath) {
  if (!(await pathExists(binaryPath))) return null;
  try {
    const linkTarget = await readlink(binaryPath);
    const resolvedTarget = path.resolve(path.dirname(binaryPath), linkTarget);
    const inferredInstallRoot = inferInstallRootFromHermesBinary(resolvedTarget);
    const inferredInstance = inferInstanceFromPath(inferredInstallRoot || resolvedTarget);
    return {
      binaryPath,
      resolvedTarget,
      inferredInstallRoot,
      ...inferredInstance,
    };
  } catch {
    return null;
  }
}

async function resolveDoctorExecutable({ inferredInstallRoot } = {}) {
  const home = os.homedir();
  const candidatePaths = [
    inferredInstallRoot ? path.join(inferredInstallRoot, 'venv', 'bin', 'hermes') : null,
    inferredInstallRoot ? path.join(inferredInstallRoot, 'venv', 'Scripts', 'hermes.exe') : null,
    inferredInstallRoot ? path.join(inferredInstallRoot, 'venv', 'Scripts', 'hermes.cmd') : null,
    inferredInstallRoot ? path.join(inferredInstallRoot, 'venv', 'Scripts', 'hermes') : null,
    path.join(home, '.local', 'bin', 'hermes'),
    path.join(home, '.local', 'bin', 'hermes.exe'),
    path.join(home, '.local', 'bin', 'hermes.cmd'),
  ].filter(Boolean);

  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

function buildBlockedAction(actionDefinition, note, executablePath) {
  return {
    id: actionDefinition.id,
    label: actionDefinition.label,
    commandLabel: actionDefinition.commandLabel,
    availability: 'blocked',
    scope: 'local-instance',
    note,
    executablePath,
  };
}

function buildAvailableAction(actionDefinition, executablePath) {
  return {
    id: actionDefinition.id,
    label: actionDefinition.label,
    commandLabel: actionDefinition.commandLabel,
    availability: 'available',
    scope: 'local-instance',
    note: actionDefinition.note,
    executablePath,
  };
}

async function resolveSafeActions(context) {
  const executablePath = await resolveDoctorExecutable({ inferredInstallRoot: context.inferredInstallRoot });
  if (!context.candidatePath) {
    return SAFE_LOCAL_ACTIONS.map((actionDefinition) =>
      buildBlockedAction(actionDefinition, 'This action requires a selected local Hermes home path.', undefined),
    );
  }

  if (!executablePath) {
    return SAFE_LOCAL_ACTIONS.map((actionDefinition) =>
      buildBlockedAction(actionDefinition, 'No local Hermes CLI executable was resolved from the official install signals yet.', undefined),
    );
  }

  return SAFE_LOCAL_ACTIONS.map((actionDefinition) => buildAvailableAction(actionDefinition, executablePath));
}

async function discoverHermesHomeHints(instancePath) {
  const envFilePath = path.join(instancePath, '.env');
  const envExamplePath = path.join(instancePath, '.env.example');
  const configPath = path.join(instancePath, 'config.yaml');
  const [envFileContent, envExampleContent, configContent] = await Promise.all([
    readTextIfExists(envFilePath),
    readTextIfExists(envExamplePath),
    readTextIfExists(configPath),
  ]);

  const merged = {
    ...parseYamlFile(configContent),
    ...parseEnvFile(envExampleContent),
    ...parseEnvFile(envFileContent),
  };

  return [
    resolveHomeLikePath(merged.HERMES_HOME),
    resolveHomeLikePath(merged.hermes_home),
    resolveHomeLikePath(merged.home),
  ].filter(Boolean);
}

async function probeHealth(baseUrl) {
  if (!baseUrl) return { ok: false, reason: 'No base URL derived from local artifacts.' };
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return { ok: false, reason: 'Derived base URL is invalid.' };
  }
  if (!KNOWN_LOCAL_HOSTS.has(parsedUrl.hostname)) {
    return { ok: false, reason: 'Skipping non-local health probe for first MVP.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(new URL('/health', parsedUrl), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {}
    if (!response.ok) {
      return { ok: false, reason: `Health endpoint returned HTTP ${response.status}.`, payload };
    }
    return { ok: true, reason: 'Local health endpoint responded successfully.', payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'Local health probe timed out.' };
    }
    return { ok: false, reason: error instanceof Error ? error.message : 'Local health probe failed.' };
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverCandidatePaths() {
  const candidates = [];
  const seen = new Set();
  const processedHomes = new Set();
  const queuedHomes = [];
  const home = os.homedir();

  function queueHermesHome(targetPath, source) {
    if (!targetPath) return;
    const normalized = path.resolve(targetPath);
    if (processedHomes.has(normalized)) return;
    processedHomes.add(normalized);
    queuedHomes.push({ path: normalized, source });
  }

  function addInstanceCandidate(targetPath, source, metadata = {}) {
    if (!targetPath) return;
    const inferred = inferInstanceFromPath(targetPath);
    if (inferred) {
      pushUnique(candidates, seen, inferred.instancePath, source, {
        kind: inferred.kind,
        profileName: inferred.profileName,
        hermesHome: inferred.hermesHome,
        ...metadata,
      });
      return;
    }

    pushUnique(candidates, seen, targetPath, source, { kind: 'custom', ...metadata });
  }

  queueHermesHome(path.join(home, '.hermes'), 'default:~/.hermes');
  queueHermesHome(resolveHomeLikePath(process.env.HERMES_HOME), 'env:HERMES_HOME');

  const hermesConfigPath = resolveHomeLikePath(process.env.HERMES_CONFIG_PATH);
  if (hermesConfigPath) {
    const configContent = await readTextIfExists(hermesConfigPath);
    const configHints = parseYamlFile(configContent);
    queueHermesHome(resolveHomeLikePath(configHints.HERMES_HOME || configHints.hermes_home || configHints.home), 'config:HERMES_CONFIG_PATH');
  }

  const hermesBinary = await inspectHermesBinary(path.join(home, '.local', 'bin', 'hermes'));
  if (hermesBinary?.instancePath) {
    addInstanceCandidate(hermesBinary.instancePath, 'bin:~/.local/bin/hermes', {
      inferredInstallRoot: hermesBinary.inferredInstallRoot,
      binaryTarget: hermesBinary.resolvedTarget,
    });
  }
  if (hermesBinary?.hermesHome) {
    queueHermesHome(hermesBinary.hermesHome, 'bin:~/.local/bin/hermes');
  }

  while (queuedHomes.length > 0) {
    const current = queuedHomes.shift();
    if (!current || !(await pathExists(current.path))) continue;

    const inferred = inferInstanceFromPath(current.path);
    const currentKind = inferred?.kind || (path.basename(current.path) === '.hermes' ? 'root' : 'custom');
    addInstanceCandidate(current.path, current.source, {
      kind: currentKind,
      profileName: inferred?.profileName,
      hermesHome: inferred?.hermesHome,
    });

    const hintPaths = await discoverHermesHomeHints(current.path);
    for (const hintPath of hintPaths) {
      queueHermesHome(hintPath, `derived:${current.path}`);
    }

    const profilesDir = path.join(current.path, 'profiles');
    if (!(await pathExists(profilesDir))) continue;

    try {
      const entries = await readdir(profilesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        addInstanceCandidate(path.join(profilesDir, entry.name), `profiles:${current.path}`, {
          kind: 'profile',
          profileName: entry.name,
          hermesHome: current.path,
        });
      }
    } catch {}
  }

  return candidates;
}

function buildCapabilityReport(context) {
  const availableActionCount = context.actions.filter((action) => action.availability === 'available').length;
  const capabilities = [
    {
      key: 'sessions.read',
      status:
        context.health.ok || context.sessionCount > 0 || context.stateDbExists
          ? 'available'
          : context.stateDirExists || context.sessionsDirExists
            ? 'limited'
            : 'unavailable',
      note: context.health.ok
        ? 'Live readiness probe succeeded and local session storage is inspectable.'
        : context.sessionCount > 0
          ? `Detected ${context.sessionCount} gateway transcript artifact(s) in sessions/.`
          : context.stateDbExists
            ? 'Detected the official SQLite session store at state.db.'
            : context.stateDirExists || context.sessionsDirExists
              ? 'Hermes home exists, but no confirmed session payloads were found yet.'
              : 'No Hermes state directory was found.',
    },
    {
      key: 'agents.read',
      status: context.health.ok ? 'limited' : context.hasConfig || context.hasEnvFile || context.stateDbExists ? 'limited' : 'unavailable',
      note: context.health.ok
        ? 'Runtime looks reachable, but this MVP does not query agent lists yet.'
        : context.hasConfig || context.hasEnvFile
          ? 'Official Hermes config artifacts suggest a runnable install, pending richer runtime probing.'
          : context.stateDbExists
            ? 'Session state exists in SQLite, but live agent enumeration is still out of scope.'
            : 'No reliable runtime artifact for agent inspection was found.',
    },
    {
      key: 'subagents.read',
      status: context.health.ok ? 'limited' : context.sessionCount > 0 || context.stateDbExists ? 'limited' : 'unavailable',
      note: context.health.ok
        ? 'Future runtime probe can enrich delegated worker data.'
        : context.sessionCount > 0
          ? 'Gateway transcript artifacts imply recent activity history, but delegated worker parsing is not implemented yet.'
          : context.stateDbExists
            ? 'CLI and platform sessions exist in state.db, but delegated worker parsing is not implemented yet.'
            : 'No delegated worker evidence detected from official local artifacts.',
    },
    {
      key: 'alerts.read',
      status: context.health.ok || context.logsDirExists ? 'available' : context.hasEnvFile || context.hasConfig ? 'limited' : 'unavailable',
      note: context.health.ok
        ? 'Health probe allows readiness-derived alerts.'
        : context.logsDirExists
          ? 'Official Hermes logs are present for basic readiness warnings.'
          : context.hasEnvFile || context.hasConfig
            ? 'Config artifacts allow readiness warnings, but not live alert streaming.'
            : 'No alert-capable Hermes signals were inferred from official artifacts.',
    },
    {
      key: 'actions.invoke',
      status: availableActionCount > 0 ? 'limited' : 'unavailable',
      note:
        availableActionCount > 0
          ? 'Only the explicit local hermes doctor and hermes status wrappers are enabled for this MVP.'
          : context.actions[0]?.note ?? 'No safe local Hermes CLI wrapper is enabled yet.',
    },
    {
      key: 'workspace.browse',
      status: context.workspacePathExists ? 'limited' : 'unavailable',
      note: context.workspacePathExists
        ? 'Default workspace path was inferred from local config, but browsing is not implemented yet.'
        : 'No validated workspace path was found in local artifacts.',
    },
  ];
  return { transport: context.transport, capabilities };
}

function buildIncidents(context, displayName) {
  const incidents = [];
  if (context.readiness === 'empty') {
    incidents.push({
      id: `${context.id}-empty-home`,
      category: 'readiness',
      title: `${displayName} has ~/.hermes but is missing the documented Hermes install artifacts`,
      severity: 'critical',
      source: 'official install layout probe',
      summary: 'The default Hermes home exists, but the expected official artifacts are mostly absent.',
      actionHint: 'Look for config.yaml, .env, state.db, sessions/, logs/, or a populated profile before treating this as a real instance.',
    });
  }
  if (context.health.ok) {
    incidents.push({
      id: `${context.id}-health-ok`,
      category: 'health',
      title: `${displayName} responded to a local health probe`,
      severity: 'info',
      source: 'local readiness probe',
      summary: 'A loopback /health endpoint answered successfully for this local instance.',
      actionHint: 'Safe candidate for richer runtime inspection next.',
    });
  } else {
    incidents.push({
      id: `${context.id}-health-missing`,
      category: 'health',
      title: `${displayName} has no confirmed live health response`,
      severity: context.hasServerPy || context.hasEnvFile ? 'warning' : 'critical',
      source: 'artifact readiness probe',
      summary: context.baseUrl ? `No successful local /health response was confirmed for ${context.baseUrl}.` : 'No local base URL could be confirmed from official artifacts.',
      actionHint: context.baseUrl
        ? 'Verify the configured local endpoint or start the Hermes surface.'
        : 'Add or confirm local runtime configuration before enabling deeper reads.',
    });
  }
  if (context.configurationState !== 'configured') {
    incidents.push({
      id: `${context.id}-config-state`,
      category: 'configuration',
      title:
        context.configurationState === 'empty'
          ? 'No config.yaml, .env, auth.json, or SOUL.md were found'
          : 'Only a partial Hermes configuration footprint was detected',
      severity: context.configurationState === 'empty' ? 'critical' : 'warning',
      source: 'official config probe',
      summary:
        context.configurationState === 'empty'
          ? 'The standard configuration artifacts were not found in the selected Hermes home.'
          : 'Some official configuration artifacts exist, but the footprint is incomplete.',
      actionHint:
        context.configurationState === 'empty'
          ? 'Run the official Hermes setup flow or restore the documented config files.'
          : 'Confirm the instance has its expected config.yaml and secret/auth artifacts.',
    });
  }
  if (!context.stateDbExists && context.sessionCount === 0) {
    incidents.push({
      id: `${context.id}-session-store-missing`,
      category: 'artifacts',
      title: `${displayName} has no confirmed state.db or sessions/ transcript activity yet`,
      severity: context.configurationState === 'configured' ? 'warning' : 'info',
      source: 'official session storage probe',
      summary: 'Neither the official SQLite store nor gateway transcript artifacts were visible in this snapshot.',
      actionHint: 'A configured install may still be idle, but no official session storage signals are visible yet.',
    });
  }
  if (context.sessionCount > 0) {
    incidents.push({
      id: `${context.id}-sessions`,
      category: 'artifacts',
      title: `${context.sessionCount} gateway transcript artifact(s) detected in sessions/`,
      severity: 'info',
      source: 'filesystem probe',
      summary: 'The standard sessions/ directory contains transcript evidence from recent Hermes activity.',
      actionHint: 'Use session artifacts as the next enrichment source.',
    });
  }
  if (context.lastActivity.status === 'stale') {
    incidents.push({
      id: `${context.id}-stale-activity`,
      category: 'activity',
      title: `${displayName} shows only stale official activity signals`,
      severity: 'warning',
      source: 'activity recency probe',
      summary: 'The newest recognized activity signal is older than the recent-activity threshold.',
      actionHint: context.lastActivity.summary,
    });
  }

  for (const action of context.actions) {
    incidents.push({
      id: `${context.id}-${action.id}-${action.availability === 'available' ? 'ready' : 'blocked'}`,
      category: 'actions',
      title:
        action.availability === 'available'
          ? `Safe local ${action.commandLabel} wrapper is available`
          : `Safe local ${action.commandLabel} wrapper is not available yet`,
      severity: action.availability === 'available' ? 'info' : 'warning',
      source: 'command center action policy',
      summary: action.note,
      actionHint:
        action.availability === 'available'
          ? `The wrapper runs ${action.commandLabel} only, against the selected local instance, with HERMES_HOME set explicitly.`
          : 'Resolve a local Hermes CLI install before enabling this fixed wrapper.',
    });
  }

  return incidents;
}

function buildAlertsFromIncidents(incidents) {
  return incidents.map((incident) => ({
    id: incident.id,
    label: incident.title,
    severity: incident.severity,
    source: incident.source,
    actionHint: incident.actionHint,
  }));
}

async function inspectCandidate(candidate, order) {
  const candidatePath = candidate.path;
  if (!(await pathExists(candidatePath))) return null;
  let candidateStats;
  try {
    candidateStats = await stat(candidatePath);
  } catch {
    return null;
  }
  if (!candidateStats.isDirectory()) return null;

  const basename = path.basename(candidatePath);
  const envFilePath = path.join(candidatePath, '.env');
  const envExamplePath = path.join(candidatePath, '.env.example');
  const packageJsonPath = path.join(candidatePath, 'package.json');
  const directConfigPath = path.join(candidatePath, 'config.yaml');
  const authFilePath = path.join(candidatePath, 'auth.json');
  const soulFilePath = path.join(candidatePath, 'SOUL.md');
  const cronDir = path.join(candidatePath, 'cron');
  const logsDir = path.join(candidatePath, 'logs');
  const memoriesDir = path.join(candidatePath, 'memories');
  const skillsDir = path.join(candidatePath, 'skills');
  const profilesDir = path.join(candidatePath, 'profiles');

  const [envFileContent, envExampleContent, packageJsonContent, soulFileContent] = await Promise.all([
    readTextIfExists(envFilePath),
    readTextIfExists(envExamplePath),
    readTextIfExists(packageJsonPath),
    readTextIfExists(soulFilePath),
  ]);

  const configContent = await readTextIfExists(directConfigPath);
  const hasEnvFile = Boolean(envFileContent);
  const parsedEnv = {
    ...parseYamlFile(configContent),
    ...parseEnvFile(envExampleContent),
    ...parseEnvFile(envFileContent),
  };
  const inferredHome = inferInstanceFromPath(candidatePath);
  const hermesHome =
    resolveHomeLikePath(parsedEnv.HERMES_HOME) ||
    resolveHomeLikePath(parsedEnv.hermes_home) ||
    inferredHome?.instancePath ||
    candidatePath;
  const stateDir = hermesHome;
  const workspacePath = resolveHomeLikePath(parsedEnv.HERMES_WEBUI_DEFAULT_WORKSPACE);
  const configPath = resolveHomeLikePath(parsedEnv.HERMES_CONFIG_PATH) || path.join(hermesHome, 'config.yaml');
  const sessionsDir = stateDir ? path.join(stateDir, 'sessions') : undefined;
  const stateDbPath = stateDir ? path.join(stateDir, 'state.db') : undefined;

  const [stateDirExists, workspacePathExists, configExists, sessionsDirExists, cronDirExists, logsDirExists, memoriesDirExists, skillsDirExists, profilesDirExists, stateDbExists, authFileExists, soulFileExists] = await Promise.all([
    pathExists(stateDir),
    pathExists(workspacePath),
    pathExists(configPath),
    pathExists(sessionsDir),
    pathExists(cronDir),
    pathExists(logsDir),
    pathExists(memoriesDir),
    pathExists(skillsDir),
    pathExists(profilesDir),
    pathExists(stateDbPath),
    pathExists(authFilePath),
    pathExists(soulFilePath),
  ]);

  const [sessionSummary, logsSummary, stateDbStats, configStats, envStats, profilesSummary, stateDbInfo] = await Promise.all([
    summarizeDirectoryFiles(sessionsDir, { exclude: new Set(['sessions.json']) }),
    summarizeDirectoryFiles(logsDir),
    statIfExists(stateDbPath),
    statIfExists(configPath),
    statIfExists(envFilePath),
    profilesDirExists ? readdir(profilesDir, { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isDirectory()).length).catch(() => 0) : Promise.resolve(0),
    inspectStateDb(stateDbPath),
  ]);
  const sessionCount = sessionSummary.fileCount;

  let packageName;
  try {
    packageName = packageJsonContent ? JSON.parse(packageJsonContent).name : undefined;
  } catch {
    packageName = undefined;
  }

  const hasOfficialStateLayout = [sessionsDirExists, cronDirExists, logsDirExists, memoriesDirExists, skillsDirExists, stateDbExists].some(Boolean);
  const baseUrl = buildBaseUrl(parsedEnv);
  const health = await probeHealth(baseUrl);
  const isSelfRepo = packageName === 'hermes-command-center';
  const configurationState = describeConfigurationState({
    hasConfig: configExists,
    hasEnvFile,
    hasAuthFile: authFileExists,
    hasSoulFile: soulFileExists,
  });
  const latestActivitySignal = pickLatestSignal([
    { source: 'sessions/', timestamp: sessionSummary.latestFileAt },
    { source: stateDbInfo?.lastActivitySource, timestamp: stateDbInfo?.lastActivityAt },
    { source: 'state.db', timestamp: stateDbStats?.mtimeMs },
    { source: 'logs/', timestamp: logsSummary.latestFileAt },
  ]);
  const lastActivity = {
    status: classifyActivity(latestActivitySignal?.timestamp),
    timestamp: latestActivitySignal?.timestamp,
    source: latestActivitySignal?.source,
    summary: latestActivitySignal?.timestamp
      ? `${latestActivitySignal.source} changed ${formatRelativeAge(latestActivitySignal.timestamp)}.`
      : 'No recent session, state.db, or log-file activity was detected from official Hermes artifacts.',
  };
  const readiness =
    health.ok || sessionCount > 0 || stateDbExists || lastActivity.status !== 'none'
      ? 'active'
      : configurationState === 'empty'
        ? 'empty'
        : 'configured';
  const hasHermesArtifact =
    hasEnvFile || configExists || authFileExists || soulFileExists || stateDirExists || hasOfficialStateLayout || Boolean(baseUrl) || basename === '.hermes' || candidate.kind === 'profile';
  const score = [
    candidate.kind === 'root' ? 3 : 0,
    candidate.kind === 'profile' ? 4 : 0,
    hasEnvFile ? 2 : 0,
    packageName && /hermes/i.test(packageName) ? 2 : 0,
    configExists ? 1 : 0,
    stateDirExists ? 1 : 0,
    sessionsDirExists ? 2 : 0,
    stateDbExists ? 2 : 0,
    cronDirExists ? 1 : 0,
    logsDirExists ? 1 : 0,
    memoriesDirExists ? 1 : 0,
    skillsDirExists ? 1 : 0,
    authFileExists ? 1 : 0,
    soulFileExists ? 1 : 0,
    profilesDirExists && candidate.kind === 'root' ? 1 : 0,
    health.ok ? 2 : 0,
    /hermes/i.test(candidatePath) ? 1 : 0,
  ].reduce((total, value) => total + value, 0);

  if (isSelfRepo || !hasHermesArtifact || score < 2) return null;

  const soulTitle = extractSoulTitle(soulFileContent);
  const { displayName, naming } = resolveDisplayName({
    candidate,
    candidatePath,
    parsedConfig: parseYamlFile(configContent),
    soulTitle,
  });
  const id = normalizeId(`${displayName}-${order}`);
  const transportParts = ['local artifact probe'];
  if (candidate.kind === 'root') transportParts.push('root instance');
  if (candidate.kind === 'profile') transportParts.push('profile instance');
  if (stateDirExists) transportParts.push('Hermes home');
  if (hasOfficialStateLayout) transportParts.push('official state layout');
  if (stateDbExists) transportParts.push('state.db');
  if (health.ok) transportParts.push('localhost health');
  const transport = transportParts.join(' + ');
  const actions = await resolveSafeActions({
    candidatePath,
    inferredInstallRoot: candidate.inferredInstallRoot,
  });

  const capabilityReport = buildCapabilityReport({
    transport,
    health,
    sessionCount,
    stateDirExists,
    stateDbExists,
    sessionsDirExists,
    logsDirExists,
    workspacePathExists,
    hasServerPy: false,
    hasEnvFile,
    hasConfig: configExists,
    actions,
  });
  const status = health.ok ? 'online' : hasOfficialStateLayout || stateDirExists || configExists || authFileExists || soulFileExists ? 'degraded' : 'offline';
  const targetLabel = health.ok
    ? 'Local Hermes surface responded and is ready for read-only monitoring.'
    : sessionCount > 0
      ? `Read-only artifact snapshot from ${sessionCount} gateway transcript file(s) under sessions/.`
      : stateDbExists
        ? `Read-only artifact snapshot from the official SQLite session store at ${stateDbPath}.`
        : configurationState === 'empty'
          ? 'Default Hermes home exists, but it does not yet resemble the documented Hermes install layout.'
          : candidate.kind === 'root'
            ? 'Root Hermes home detected from the official installation layout.'
            : candidate.kind === 'profile'
              ? 'Profile-backed Hermes instance detected from the official installation layout.'
              : 'Install artifacts found, but live readiness is not yet confirmed.';

  const probeSummary = {
    readiness,
    configuration: configurationState,
    naming,
    profileCount: profilesSummary,
    activity: {
      status: lastActivity.status,
      summary: lastActivity.summary,
      sessionCount,
      lastSeenAt: formatTimestamp(lastActivity.timestamp),
      lastSeenSource: lastActivity.source,
    },
    stateDb: stateDbExists
      ? {
          recognized: Boolean(stateDbInfo?.recognized),
          tableCount: stateDbInfo?.tableCount ?? 0,
          tables: stateDbInfo?.tables ?? [],
          fallbackReason: !stateDbInfo?.recognized
            ? stateDbInfo?.tableCount
              ? 'state.db is present, but the table layout does not match the minimal known Hermes session/message pattern.'
              : stateDbInfo?.inspectionError
                ? 'state.db is present, but the probe could only retain limited evidence because inspection failed.'
                : 'state.db is present, but no recognized Hermes session/message tables were found.'
            : undefined,
          inspectionError: stateDbInfo?.inspectionError,
          recentSessionIds: stateDbInfo?.recentSessionIds ?? [],
          recentSources: stateDbInfo?.recentSources ?? [],
          lastActivityAt: formatTimestamp(stateDbInfo?.lastActivityAt),
          lastActivitySource: stateDbInfo?.lastActivitySource,
          tableSummaries: stateDbInfo?.tableSummaries ?? [],
        }
      : undefined,
    artifactSignals: [
      { label: 'config.yaml', present: configExists, detail: configExists && configStats ? `updated ${formatRelativeAge(configStats.mtimeMs)}` : undefined },
      { label: '.env', present: hasEnvFile, detail: hasEnvFile && envStats ? `updated ${formatRelativeAge(envStats.mtimeMs)}` : undefined },
      { label: 'auth.json', present: authFileExists },
      { label: 'SOUL.md', present: soulFileExists },
      { label: 'state.db', present: stateDbExists, detail: stateDbExists ? summarizeStateDbSignal(stateDbInfo, stateDbStats) : undefined },
      { label: 'sessions/', present: sessionsDirExists, detail: sessionsDirExists ? `${sessionCount} transcript file(s)` : undefined },
      { label: 'logs/', present: logsDirExists, detail: logsDirExists ? `${logsSummary.fileCount} log file(s)` : undefined },
      { label: 'profiles/', present: profilesDirExists, detail: profilesDirExists ? `${profilesSummary} profile dir(s)` : undefined },
    ],
  };
  const incidents = buildIncidents({
    id,
    health,
    hasServerPy: false,
    hasEnvFile,
    hasConfig: configExists,
    sessionCount,
    stateDbExists,
    readiness,
    configurationState,
    baseUrl,
    lastActivity,
    actions,
  }, displayName);

  return {
    summary: {
      id,
      name: displayName,
      environment: health.ok
        ? candidate.kind === 'profile' && candidate.profileName
          ? `profile:${candidate.profileName}`
          : candidate.kind === 'root'
            ? 'root'
            : 'local ready'
        : candidate.kind === 'profile' && candidate.profileName
          ? `profile:${candidate.profileName}`
          : candidate.kind === 'root'
            ? 'root'
            : 'local artifact candidate',
      status,
      source: candidate.source.startsWith('env:') ? 'manual' : 'discovered',
      connection: { path: candidatePath, baseUrl, transport },
      capabilitySummary: summarizeCapabilities(capabilityReport.capabilities),
    },
    snapshot: {
      installation: {
        name: displayName,
        environment:
          candidate.kind === 'root'
            ? 'root instance'
            : candidate.kind === 'profile' && candidate.profileName
              ? `profile instance (${candidate.profileName})`
              : health.ok
                ? 'local ready'
                : 'local artifact candidate',
        target: targetLabel,
      },
      capabilityReport,
      agents: [],
      subagents: [],
      alerts: buildAlertsFromIncidents(incidents),
      incidents,
      queues: [
        {
          label: 'Session artifacts',
          depth: sessionCount,
          trend: sessionCount > 0 ? lastActivity.summary : stateDbExists ? 'state.db present' : 'not detected',
        },
        { label: 'Profiles', depth: profilesSummary, trend: profilesDirExists ? 'under ~/.hermes/profiles' : 'not detected' },
        { label: 'Probe confidence', depth: score, trend: candidate.source },
        { label: 'Health reachability', depth: health.ok ? 1 : 0, trend: health.reason },
      ],
      actions,
      probeSummary,
    },
    probeDetails: {
      id,
      candidatePath,
      source: candidate.source,
      configPath: configExists ? configPath : undefined,
      hermesHome: hermesHome && (await pathExists(hermesHome)) ? hermesHome : undefined,
      stateDir: stateDirExists ? stateDir : undefined,
      workspacePath: workspacePathExists ? workspacePath : undefined,
      sessionsDir: sessionsDirExists ? sessionsDir : undefined,
      stateDbPath: stateDbExists ? stateDbPath : undefined,
      stateDbInfo: stateDbExists ? probeSummary.stateDb : undefined,
      sessionCount,
      lastActivityAt: probeSummary.activity.lastSeenAt,
      lastActivitySource: probeSummary.activity.lastSeenSource,
      readiness,
      configurationState,
      kind: candidate.kind,
      profileName: candidate.profileName,
      inferredInstallRoot: candidate.inferredInstallRoot,
      binaryTarget: candidate.binaryTarget,
      doctorExecutablePath: actions.find((action) => action.id === 'hermes-doctor')?.executablePath,
      statusExecutablePath: actions.find((action) => action.id === 'hermes-status')?.executablePath,
      health,
      score,
    },
  };
}

function buildSuggestionFromInstance(instance) {
  const hints = instance.snapshot.capabilityReport.capabilities
    .filter((capability) => capability.status !== 'unavailable')
    .map((capability) => capability.key);
  if (instance.summary.status === 'online') return null;
  return {
    id: `${instance.summary.id}-suggestion`,
    name: instance.summary.name,
    environment: instance.summary.environment,
    reason: instance.snapshot.installation.target,
    path: instance.summary.connection.path,
    baseUrl: instance.summary.connection.baseUrl,
    transport: instance.summary.connection.transport,
    capabilityHints: hints,
  };
}

async function resolveActionInvocation(instanceId, actionId) {
  const snapshot = await collectHermesFleetSnapshot();
  const matched = snapshot.diagnostics.matchedCandidates.find((candidate) => candidate.id === instanceId);
  const instance = snapshot.fleetSnapshot.instances.find((candidate) => candidate.summary.id === instanceId);

  if (!matched || !instance) {
    return {
      ok: false,
      code: 'instance_not_found',
      message: 'The selected Hermes instance could not be resolved from the current local probe snapshot.',
    };
  }

  if (!instance.summary.connection.path) {
    return {
      ok: false,
      code: 'path_missing',
      message: 'The selected Hermes instance does not expose a local Hermes home path yet.',
    };
  }

  const executablePath =
    actionId === 'hermes-status'
      ? matched.statusExecutablePath || matched.doctorExecutablePath
      : matched.doctorExecutablePath;

  if (!executablePath) {
    return {
      ok: false,
      code: `${actionId.replace(/^hermes-/, '')}_unavailable`,
      message: 'No local Hermes CLI executable was resolved from the official install signals for this action.',
    };
  }

  return {
    ok: true,
    instance,
    executablePath,
    hermesHome: instance.summary.connection.path,
  };
}

export async function resolveDoctorInvocation(instanceId) {
  return resolveActionInvocation(instanceId, 'hermes-doctor');
}

export async function resolveStatusInvocation(instanceId) {
  return resolveActionInvocation(instanceId, 'hermes-status');
}

export async function collectHermesFleetSnapshot() {
  const candidates = await discoverCandidatePaths();
  const records = [];
  for (const [index, candidate] of candidates.entries()) {
    const inspected = await inspectCandidate(candidate, index + 1);
    if (inspected) records.push(inspected);
  }

  const dedupedRecords = [];
  const seenKeys = new Set();
  for (const record of records) {
    const dedupeKey = `${record.summary.connection.path || ''}|${record.summary.connection.baseUrl || ''}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);
    dedupedRecords.push(record);
  }

  const instances = dedupedRecords.map(({ probeDetails, ...instance }) => instance);
  const discoverySuggestions = dedupedRecords.map((record) => buildSuggestionFromInstance(record)).filter(Boolean);

  return {
    source: 'probe',
    generatedAt: new Date().toISOString(),
    fleetSnapshot: { instances, discoverySuggestions },
    diagnostics: {
      scannedCandidates: candidates.map((candidate) => candidate.path),
      matchedCandidates: dedupedRecords.map((record) => record.probeDetails),
      instanceCount: instances.length,
      suggestionCount: discoverySuggestions.length,
    },
  };
}
