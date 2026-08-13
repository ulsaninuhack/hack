import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createBridgeServer } from '../src/server.mjs';
import { criticJsonSchema } from '../src/schema-contracts.mjs';

const TOKEN = 'bridge-test-token-with-at-least-thirty-two-characters';
const VALID_REQUEST = Object.freeze({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'Return JSON.' },
    { role: 'user', content: '{"message":"hello"}' },
  ],
  text: {
    format: {
      type: 'json_schema',
      name: 'contact_ops_observation_critic',
      strict: true,
      schema: criticJsonSchema,
    },
  },
  store: false,
});

async function withServer(callback, overrides = {}) {
  const calls = [];
  const decisionClient = overrides.decisionClient || {
    async analyzeStructured(input) {
      calls.push(input);
      return '{"missing_fields":[],"contradictions":[],"low_confidence_fields":[],"warnings":[]}';
    },
    close() {},
  };
  const server = createBridgeServer({
    token: TOKEN,
    decisionClient,
    logger: { info() {}, error() {} },
    ...overrides,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await callback({ origin, calls });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('bridge health is public but structured inference requires an exact bearer token', async () => {
  await withServer(async ({ origin }) => {
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', transport: 'codex-app-server' });

    const missing = await fetch(`${origin}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${origin}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}x`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(VALID_REQUEST),
    });
    assert.equal(wrong.status, 401);
  });
});

test('bridge accepts only the two ContactOps schemas and validates Codex JSON before returning it', async () => {
  await withServer(async ({ origin, calls }) => {
    const response = await fetch(`${origin}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(VALID_REQUEST),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'completed',
      output_text: '{"missing_fields":[],"contradictions":[],"low_confidence_fields":[],"warnings":[]}',
      model: 'gpt-5.5',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].schemaName, 'contact_ops_observation_critic');
    assert.deepEqual(calls[0].schema, VALID_REQUEST.text.format.schema);
    assert.deepEqual(calls[0].messages, VALID_REQUEST.input);
  }, { model: 'gpt-5.5' });
});

test('bridge rejects unsupported schemas, extra request fields, and malformed model output', async () => {
  await withServer(async ({ origin }) => {
    for (const body of [
      {
        ...VALID_REQUEST,
        text: { format: { ...VALID_REQUEST.text.format, name: 'arbitrary_prompt_proxy' } },
      },
      { ...VALID_REQUEST, extra: true },
      {
        ...VALID_REQUEST,
        text: {
          format: {
            ...VALID_REQUEST.text.format,
            schema: { type: 'object', additionalProperties: true },
          },
        },
      },
    ]) {
      const response = await fetch(`${origin}/v1/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
  });

  await withServer(async ({ origin }) => {
    const response = await fetch(`${origin}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(VALID_REQUEST),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: { code: 'MODEL_OUTPUT_INVALID', message: 'The model response did not match the requested schema.' },
    });
  }, {
    decisionClient: {
      async analyzeStructured() { return '{"ok":false,"extra":true}'; },
      close() {},
    },
  });
});

test('bridge enforces a small in-flight queue for the single Codex process', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  await withServer(async ({ origin }) => {
    const request = () => fetch(`${origin}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(VALID_REQUEST),
    });
    const first = request();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const overflow = await request();
    assert.equal(overflow.status, 429);
    release();
    assert.equal((await first).status, 200);
  }, {
    maxPending: 1,
    decisionClient: {
      async analyzeStructured() {
        await blocked;
        return '{"missing_fields":[],"contradictions":[],"low_confidence_fields":[],"warnings":[]}';
      },
      close() {},
    },
  });
});

test('bridge applies a global model-call limit even with a valid bearer token', async () => {
  await withServer(async ({ origin }) => {
    const request = () => fetch(`${origin}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(VALID_REQUEST),
    });
    assert.equal((await request()).status, 200);
    const limited = await request();
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'BRIDGE_RATE_LIMITED');
  }, { rateLimitPerMinute: 1 });
});
