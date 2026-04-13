import { mockAdapter } from './mockAdapter';
import type { FleetSnapshot, OperatorActionId } from './types';

export type FleetDataSource = 'probe' | 'mock';

export interface FleetLoadResult {
  fleet: FleetSnapshot;
  source: FleetDataSource;
  label: string;
  detail: string;
  generatedAt?: string;
}

type FleetProbeResponse = {
  source: 'probe';
  generatedAt: string;
  fleetSnapshot: FleetSnapshot;
};

export type OperatorActionResponse = {
  ok: boolean;
  action: OperatorActionId;
  instanceId: string;
  status: 'succeeded' | 'failed';
  code?: string;
  summary: string;
  executablePath?: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  outputLines: string[];
};

async function invokeAction(actionId: OperatorActionId, instanceId: string): Promise<OperatorActionResponse> {
  const endpoint = actionId === 'hermes-status' ? '/api/actions/status' : '/api/actions/doctor';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ instanceId }),
  });

  const payload = (await response.json()) as OperatorActionResponse;
  if (!response.ok) {
    return payload;
  }

  return payload;
}

async function loadMockFleet(detail: string): Promise<FleetLoadResult> {
  return {
    fleet: await mockAdapter.getFleetSnapshot(),
    source: 'mock',
    label: 'Mock fallback',
    detail,
  };
}

export async function loadFleetSnapshot(): Promise<FleetLoadResult> {
  try {
    const response = await fetch('/api/fleet', { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Probe API returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as FleetProbeResponse;
    const instanceCount = payload.fleetSnapshot.instances.length;

    if (instanceCount === 0) {
      return loadMockFleet('Probe API responded, but no local Hermes instances were confidently identified yet.');
    }

    return {
      fleet: payload.fleetSnapshot,
      source: 'probe',
      label: 'Local probe',
      detail: `Detected ${instanceCount} local instance(s) and ${payload.fleetSnapshot.discoverySuggestions.length} discovery suggestion(s).`,
      generatedAt: payload.generatedAt,
    };
  } catch (error) {
    return loadMockFleet(
      `Using mock fleet because the local probe API is unavailable${error instanceof Error ? `: ${error.message}` : '.'}`,
    );
  }
}

export async function invokeDoctor(instanceId: string): Promise<OperatorActionResponse> {
  return invokeAction('hermes-doctor', instanceId);
}

export async function invokeStatus(instanceId: string): Promise<OperatorActionResponse> {
  return invokeAction('hermes-status', instanceId);
}
