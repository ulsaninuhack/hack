import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import Ajv from 'ajv';

import { CodexAppServerClient } from './codex-app-server-client.mjs';
import { isAllowedSchema } from './schema-contracts.mjs';

const MAX_BODY_BYTES = 96 * 1024;

class BridgeRequestError extends Error {}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeRequestError(`${label} must be an object.`);
  }
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) {
    throw new BridgeRequestError(`${label} contains unsupported fields.`);
  }
}

function validateRequest(value) {
  exactKeys(value, ['model', 'input', 'text', 'store'], 'request');
  if (typeof value.model !== 'string' || value.model.length < 1 || value.model.length > 100
      || value.store !== false
      || !Array.isArray(value.input)
      || value.input.length !== 2) {
    throw new BridgeRequestError('The structured request is invalid.');
  }
  for (const [index, message] of value.input.entries()) {
    exactKeys(message, ['role', 'content'], `input[${index}]`);
    const expectedRole = index === 0 ? 'system' : 'user';
    if (message.role !== expectedRole || typeof message.content !== 'string' || message.content.length > 40_000) {
      throw new BridgeRequestError('The structured messages are invalid.');
    }
  }
  exactKeys(value.text, ['format'], 'text');
  exactKeys(value.text.format, ['type', 'name', 'strict', 'schema'], 'text.format');
  const format = value.text.format;
  if (format.type !== 'json_schema' || format.strict !== true
      || !format.schema || typeof format.schema !== 'object' || Array.isArray(format.schema)
      || Buffer.byteLength(JSON.stringify(format.schema), 'utf8') > 40_000
      || !isAllowedSchema(format.name, format.schema)) {
    throw new BridgeRequestError('The structured output schema is invalid.');
  }
  return value;
}

function authorized(header, token) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readJson(request) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new BridgeRequestError('Request body is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BridgeRequestError('Request body must be valid JSON.');
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

export function createBridgeServer({
  token,
  decisionClient,
  model = 'gpt-5.5',
  maxPending = 4,
  rateLimitPerMinute = 30,
  logger = console,
}) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 512) {
    throw new TypeError('bridge token must contain 32 to 512 characters');
  }
  if (!decisionClient || typeof decisionClient.analyzeStructured !== 'function') {
    throw new TypeError('decision client must provide analyzeStructured');
  }
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 16) {
    throw new TypeError('maxPending must be between 1 and 16');
  }
  if (!Number.isSafeInteger(rateLimitPerMinute) || rateLimitPerMinute < 1 || rateLimitPerMinute > 120) {
    throw new TypeError('rateLimitPerMinute must be between 1 and 120');
  }
  const ajv = new Ajv({ allErrors: false, strict: true });
  let pending = 0;
  let requestCount = 0;
  let rateWindowStartedAt = Date.now();

  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      json(response, 200, { status: 'ok', transport: 'codex-app-server' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
      return;
    }
    if (!authorized(request.headers.authorization, token)) {
      json(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
      return;
    }
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      json(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'JSON is required.' } });
      return;
    }
    const now = Date.now();
    if (now - rateWindowStartedAt >= 60_000) {
      rateWindowStartedAt = now;
      requestCount = 0;
    }
    if (requestCount >= rateLimitPerMinute) {
      json(response, 429, { error: { code: 'BRIDGE_RATE_LIMITED', message: 'The model bridge rate limit was reached.' } });
      return;
    }
    requestCount += 1;
    if (pending >= maxPending) {
      json(response, 429, { error: { code: 'BRIDGE_BUSY', message: 'The model bridge is busy.' } });
      return;
    }

    pending += 1;
    try {
      const body = validateRequest(await readJson(request));
      let validate;
      try {
        validate = ajv.compile(body.text.format.schema);
      } catch {
        throw new BridgeRequestError('The structured output schema is invalid.');
      }
      const output = await decisionClient.analyzeStructured({
        messages: body.input,
        schemaName: body.text.format.name,
        schema: body.text.format.schema,
      });
      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        parsed = null;
      }
      if (!validate(parsed)) {
        json(response, 502, {
          error: {
            code: 'MODEL_OUTPUT_INVALID',
            message: 'The model response did not match the requested schema.',
          },
        });
        return;
      }
      json(response, 200, { status: 'completed', output_text: JSON.stringify(parsed), model });
    } catch (error) {
      if (error instanceof BridgeRequestError) {
        json(response, 400, { error: { code: 'INVALID_REQUEST', message: 'The request is invalid.' } });
      } else {
        logger.error?.({ message: 'Codex bridge request failed', error: error?.name || 'Error' });
        json(response, 503, { error: { code: 'BRIDGE_UNAVAILABLE', message: 'The model bridge is unavailable.' } });
      }
    } finally {
      pending -= 1;
    }
  });
  server.on('close', () => decisionClient.close?.());
  return server;
}

function loadToken(env) {
  const direct = String(env.CODEX_BRIDGE_TOKEN || '').trim();
  if (direct) return direct;
  const path = String(env.CODEX_BRIDGE_TOKEN_FILE || '').trim();
  if (!path) throw new Error('CODEX_BRIDGE_TOKEN or CODEX_BRIDGE_TOKEN_FILE is required.');
  return readFileSync(path, 'utf8').trim();
}

function start() {
  const port = Number(process.env.CODEX_BRIDGE_PORT || 8765);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CODEX_BRIDGE_PORT must be a valid TCP port.');
  }
  const model = String(process.env.CODEX_BRIDGE_MODEL || 'gpt-5.5').trim();
  const decisionClient = new CodexAppServerClient({
    codexBin: String(process.env.CODEX_BIN || 'codex').trim(),
    model,
    timeoutMs: Number(process.env.CODEX_BRIDGE_MODEL_TIMEOUT_MS || 25_000),
    reasoningEffort: String(process.env.CODEX_BRIDGE_REASONING_EFFORT || 'low').trim(),
  });
  const server = createBridgeServer({
    token: loadToken(process.env),
    decisionClient,
    model,
    maxPending: Number(process.env.CODEX_BRIDGE_MAX_PENDING || 4),
    rateLimitPerMinute: Number(process.env.CODEX_BRIDGE_RATE_LIMIT_PER_MINUTE || 30),
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`${JSON.stringify({ status: 'listening', host: '127.0.0.1', port, model })}\n`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
