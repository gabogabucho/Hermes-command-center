/**
 * Chat action — spawns `hermes chat -q "<message>"` and streams output via SSE.
 *
 * The hermes executable is located via the same probe resolution used by doctor/status.
 * On the server the executable lives at: /root/.hermes/hermes-agent/venv/bin/hermes
 *
 * SSE event format:
 *   data: {"chunk":"...text..."}       — partial output
 *   data: {"done":true,"exitCode":0}   — terminal event
 *   data: {"error":"..."}             — error event
 */
import { spawn } from 'node:child_process';
import { resolveDoctorInvocation } from './fleetProbe.mjs';

// Strip ANSI escape sequences from terminal output
function stripAnsi(str) {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

// Split a buffer into non-empty lines
function toLines(raw) {
  return stripAnsi(raw.toString('utf8'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// Filter out hermes startup banner, session info, and other boilerplate.
// The startup banner is a box drawn with ╭│╰ characters — any line starting
// with those border chars (after trimming) is part of the startup box.
function isBoilerplate(line) {
  // Box border lines (startup banner uses ╭ │ ╰ borders)
  if (/^[╭╮╰╯│╔╗╚╝═║]/.test(line)) return true;
  // Horizontal rule lines (8+ repeated ─ or = chars)
  if (/^[─━═]{8,}/.test(line)) return true;
  // Section headers like "─  ⚕ Hermes  ────"
  if (/^─\s+⚕/.test(line)) return true;
  // Common boilerplate prefixes
  if (/^(Query:|Initializing agent|Resume this session with:|hermes --resume|Session:\s|Duration:\s|Messages:\s)/.test(line)) return true;
  // Braille art characters from the ASCII logo
  if (/[⠀⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿]/.test(line)) return true;
  // Block art from the ASCII logo
  if (/^[█▀▄░▒▓\s]+$/.test(line)) return true;
  return false;
}

/**
 * Stream a hermes chat response as Server-Sent Events.
 * @param {string} instanceId
 * @param {string} message
 * @param {string | undefined} sessionName  — for --continue continuity
 * @param {import('http').ServerResponse} response
 */
export async function streamChatResponse(instanceId, message, sessionName, response) {
  // Locate the hermes binary via the same probe resolution used by doctor/status
  const resolved = await resolveDoctorInvocation(instanceId).catch(() => null);

  const executablePath = resolved?.executablePath ?? findFallbackHermes();

  if (!executablePath) {
    sendSseError(response, 'hermes executable not found. Run hermes doctor to diagnose.');
    return;
  }

  // Build args: hermes chat -q "<message>" [--continue <session>]
  const args = ['chat', '-q', message];
  if (sessionName) args.push('--continue', sessionName);

  const env = {
    ...process.env,
    ...(resolved?.hermesHome ? { HERMES_HOME: resolved.hermesHome } : {}),
    // Disable interactive prompts / colour so output is clean
    HERMES_QUIET: '1',
    NO_COLOR: '1',
    TERM: 'dumb',
    COLUMNS: '120',
  };

  let proc;
  try {
    proc = spawn(executablePath, args, {
      env,
      windowsHide: true,
      timeout: 120_000,
    });
  } catch (err) {
    sendSseError(response, `Failed to start hermes: ${err.message}`);
    return;
  }

  // Handle client disconnect
  response.on('close', () => {
    if (!proc.killed) proc.kill('SIGTERM');
  });

  proc.stdout.on('data', (chunk) => {
    for (const line of toLines(chunk)) {
      if (!isBoilerplate(line)) sendSseChunk(response, line);
    }
  });

  proc.stderr.on('data', (chunk) => {
    // Only surface non-noise stderr lines
    for (const line of toLines(chunk)) {
      if (line && !line.startsWith('╭') && !line.startsWith('│') && !line.startsWith('╰') && !line.includes('[0m')) {
        sendSseChunk(response, line);
      }
    }
  });

  proc.on('close', (code) => {
    sendSseDone(response, code ?? 0);
  });

  proc.on('error', (err) => {
    sendSseError(response, err.message);
  });
}

// ── SSE helpers ──────────────────────────────────────────────────────────────

function sendSseChunk(res, text) {
  try { res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`); } catch { /* already closed */ }
}

function sendSseDone(res, exitCode) {
  try {
    res.write(`data: ${JSON.stringify({ done: true, exitCode })}\n\n`);
    res.end();
  } catch { /* already closed */ }
}

function sendSseError(res, message) {
  try {
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  } catch { /* already closed */ }
}

// ── Fallback binary resolution ────────────────────────────────────────────────

const FALLBACK_CANDIDATES = [
  '/root/.hermes/hermes-agent/venv/bin/hermes',
  '/home/hermes/.hermes/hermes-agent/venv/bin/hermes',
  `${process.env.HOME ?? '/root'}/.hermes/hermes-agent/venv/bin/hermes`,
  `${process.env.HERMES_HOME ?? ''}/hermes-agent/venv/bin/hermes`,
];

import { existsSync } from 'node:fs';

function findFallbackHermes() {
  for (const candidate of FALLBACK_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}
