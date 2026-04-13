import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveDoctorInvocation, resolveStatusInvocation } from './fleetProbe.mjs';

const execFileAsync = promisify(execFile);
const OUTPUT_LINE_LIMIT = 12;
const ACTIONS = {
  'hermes-doctor': {
    command: 'doctor',
    commandLabel: 'hermes doctor',
    fallbackSummary: 'hermes doctor completed successfully.',
    failureSummary: 'hermes doctor failed.',
    resolve: resolveDoctorInvocation,
  },
  'hermes-status': {
    command: 'status',
    commandLabel: 'hermes status',
    fallbackSummary: 'hermes status completed successfully.',
    failureSummary: 'hermes status failed.',
    resolve: resolveStatusInvocation,
  },
};

function collectPreviewLines(...chunks) {
  return chunks
    .flatMap((chunk) => String(chunk || '').split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, OUTPUT_LINE_LIMIT);
}

function buildFailurePayload({ actionId, commandLabel, instanceId, message, code, executablePath, outputLines = [], durationMs = 0, exitCode = null }) {
  return {
    ok: false,
    action: actionId,
    instanceId,
    status: 'failed',
    code,
    summary: message,
    executablePath,
    command: commandLabel,
    exitCode,
    durationMs,
    outputLines,
  };
}

async function runFixedAction(actionId, instanceId) {
  const action = ACTIONS[actionId];
  const resolved = await action.resolve(instanceId);
  if (!resolved.ok) {
    return buildFailurePayload({
      actionId,
      commandLabel: action.commandLabel,
      instanceId,
      message: resolved.message,
      code: resolved.code,
    });
  }

  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(resolved.executablePath, [action.command], {
      env: {
        ...process.env,
        HERMES_HOME: resolved.hermesHome,
      },
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 256 * 1024,
    });

    const outputLines = collectPreviewLines(stdout, stderr);
    return {
      ok: true,
      action: actionId,
      instanceId,
      status: 'succeeded',
      summary: outputLines[0] ?? action.fallbackSummary,
      executablePath: resolved.executablePath,
      command: action.commandLabel,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      outputLines,
    };
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? error.stdout : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? error.stderr : '';
    const exitCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'number' ? error.code : null;
    const outputLines = collectPreviewLines(stderr, stdout, error instanceof Error ? error.message : action.failureSummary);
    return buildFailurePayload({
      actionId,
      commandLabel: action.commandLabel,
      instanceId,
      message: outputLines[0] ?? action.failureSummary,
      code: `${action.command}_failed`,
      executablePath: resolved.executablePath,
      outputLines,
      durationMs: Date.now() - startedAt,
      exitCode,
    });
  }
}

export async function runDoctorAction(instanceId) {
  return runFixedAction('hermes-doctor', instanceId);
}

export async function runStatusAction(instanceId) {
  return runFixedAction('hermes-status', instanceId);
}
