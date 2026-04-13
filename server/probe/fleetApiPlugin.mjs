import { collectHermesFleetSnapshot } from './fleetProbe.mjs';
import { collectProfilesSnapshot } from './profileProbe.mjs';
import { runDoctorAction, runStatusAction } from './doctorAction.mjs';
import { streamChatResponse } from './chatAction.mjs';
import { collectSystemMetrics } from './systemProbe.mjs';

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload, null, 2));
}

async function handleFleetRequest(_request, response) {
  try {
    const payload = await collectHermesFleetSnapshot();
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 500, {
      source: 'probe',
      error: error instanceof Error ? error.message : 'Unknown probe failure.',
    });
  }
}

async function handleHealthRequest(_request, response) {
  try {
    const payload = await collectHermesFleetSnapshot();
    sendJson(response, 200, {
      status: 'ok',
      adapter: 'local-hermes-probe',
      generatedAt: payload.generatedAt,
      instances: payload.diagnostics.instanceCount,
      suggestions: payload.diagnostics.suggestionCount,
    });
  } catch (error) {
    sendJson(response, 500, {
      status: 'error',
      adapter: 'local-hermes-probe',
      error: error instanceof Error ? error.message : 'Unknown probe failure.',
    });
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

async function handleDoctorRequest(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const instanceId = typeof payload.instanceId === 'string' ? payload.instanceId.trim() : '';

    if (!instanceId) {
      sendJson(response, 400, {
        ok: false,
        action: 'hermes-doctor',
        status: 'failed',
        code: 'instance_required',
        summary: 'A selected instance id is required.',
      });
      return;
    }

    const result = await runDoctorAction(instanceId);
    sendJson(response, result.ok ? 200 : 400, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      action: 'hermes-doctor',
      status: 'failed',
      code: 'action_error',
      summary: error instanceof Error ? error.message : 'Unknown action failure.',
    });
  }
}

async function handleStatusRequest(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const instanceId = typeof payload.instanceId === 'string' ? payload.instanceId.trim() : '';

    if (!instanceId) {
      sendJson(response, 400, {
        ok: false,
        action: 'hermes-status',
        status: 'failed',
        code: 'instance_required',
        summary: 'A selected instance id is required.',
      });
      return;
    }

    const result = await runStatusAction(instanceId);
    sendJson(response, result.ok ? 200 : 400, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      action: 'hermes-status',
      status: 'failed',
      code: 'action_error',
      summary: error instanceof Error ? error.message : 'Unknown action failure.',
    });
  }
}

async function handleProfilesRequest(_request, response) {
  try {
    const payload = await collectProfilesSnapshot();
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 500, {
      source: 'profile-probe',
      error: error instanceof Error ? error.message : 'Profile probe failure.',
    });
  }
}

async function handleSystemRequest(_request, response) {
  try {
    const payload = await collectSystemMetrics();
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 500, {
      source: 'system-probe',
      error: error instanceof Error ? error.message : 'System probe failure.',
    });
  }
}

async function handleAuthRequest(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }
  try {
    const { pin } = await readJsonBody(request);
    // PIN is read from HCC_PIN env var at runtime — never shipped in the bundle.
    // Fallback to '1234' only in development (when HCC_PIN is unset).
    const expected = process.env.HCC_PIN ?? '1234';
    if (typeof pin === 'string' && pin === expected) {
      sendJson(response, 200, { ok: true });
    } else {
      sendJson(response, 401, { ok: false });
    }
  } catch {
    sendJson(response, 400, { ok: false, error: 'Bad request.' });
  }
}

async function handleChatRequest(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    const instanceId = typeof payload.instanceId === 'string' ? payload.instanceId.trim() : '';
    const sessionName = typeof payload.sessionName === 'string' ? payload.sessionName.trim() : undefined;

    if (!message) {
      sendJson(response, 400, { error: 'message is required.' });
      return;
    }

    // Set SSE headers
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.statusCode = 200;
    response.flushHeaders?.();

    await streamChatResponse(instanceId, message, sessionName, response);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : 'Chat action failed.' });
    }
  }
}

function registerFleetRoutes(server) {
  server.middlewares.use('/api/fleet', (request, response) => {
    void handleFleetRequest(request, response);
  });
  server.middlewares.use('/api/probe/health', (request, response) => {
    void handleHealthRequest(request, response);
  });
  server.middlewares.use('/api/actions/doctor', (request, response) => {
    void handleDoctorRequest(request, response);
  });
  server.middlewares.use('/api/actions/status', (request, response) => {
    void handleStatusRequest(request, response);
  });
  server.middlewares.use('/api/profiles', (request, response) => {
    void handleProfilesRequest(request, response);
  });
  server.middlewares.use('/api/auth', (request, response) => {
    void handleAuthRequest(request, response);
  });
  server.middlewares.use('/api/system', (request, response) => {
    void handleSystemRequest(request, response);
  });
  server.middlewares.use('/api/chat', (request, response) => {
    void handleChatRequest(request, response);
  });
}

export function fleetApiPlugin() {
  return {
    name: 'fleet-api-plugin',
    configureServer(server) {
      registerFleetRoutes(server);
    },
    configurePreviewServer(server) {
      registerFleetRoutes(server);
    },
  };
}
