import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LlmClientConfigurationError,
  createTextLlmClient,
} from '../src/llm-client.mjs';

const REQUEST = Object.freeze({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'Return JSON.' },
    { role: 'user', content: '{"message":"hello"}' },
  ],
  text: {
    format: {
      type: 'json_schema',
      name: 'neighbor_connector_voice_record',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
    },
  },
  store: false,
});

test('Codex bridge client sends one authenticated bounded Responses request', async () => {
  const calls = [];
  const client = createTextLlmClient({
    env: {
      CONTACT_OPS_CODEX_BRIDGE_URL: 'https://macmini.example.test/base/',
      CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'test-token-with-at-least-thirty-two-characters',
      CONTACT_OPS_CODEX_BRIDGE_TIMEOUT_MS: '1234',
      OPENAI_API_KEY: 'unused-while-bridge-is-healthy',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        status: 'completed',
        output_text: '{"ok":true}',
        model: 'gpt-5.5',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    openAiFactory: () => assert.fail('healthy bridge requests must not use OpenAI'),
  });

  const response = await client.responses.create(REQUEST);

  assert.equal(response.output_text, '{"ok":true}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://macmini.example.test/base/v1/responses');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-token-with-at-least-thirty-two-characters');
  assert.deepEqual(JSON.parse(calls[0].init.body), REQUEST);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('Codex bridge configuration rejects public plaintext URLs and weak secrets', () => {
  assert.throws(
    () => createTextLlmClient({
      env: {
        CONTACT_OPS_CODEX_BRIDGE_URL: 'http://macmini.example.test',
        CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'test-token-with-at-least-thirty-two-characters',
      },
    }),
    LlmClientConfigurationError,
  );
  assert.throws(
    () => createTextLlmClient({
      env: {
        CONTACT_OPS_CODEX_BRIDGE_URL: 'https://macmini.example.test',
        CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'short',
      },
    }),
    LlmClientConfigurationError,
  );
});

test('Codex bridge failures stay generic and never echo remote response bodies', async () => {
  const client = createTextLlmClient({
    env: {
      CONTACT_OPS_CODEX_BRIDGE_URL: 'https://macmini.example.test',
      CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'test-token-with-at-least-thirty-two-characters',
    },
    fetchImpl: async () => new Response('remote internal secret', { status: 503 }),
  });

  await assert.rejects(
    () => client.responses.create(REQUEST),
    (error) => /temporarily unavailable/i.test(error.message)
      && !/remote internal secret/i.test(error.message),
  );
});

test('OpenAI retries the same text request when the Codex bridge is unavailable', async () => {
  const openAiCalls = [];
  let factoryCalls = 0;
  const client = createTextLlmClient({
    env: {
      CONTACT_OPS_CODEX_BRIDGE_URL: 'https://macmini.example.test',
      CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'test-token-with-at-least-thirty-two-characters',
      OPENAI_API_KEY: 'existing-transcription-key',
    },
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    openAiFactory: (apiKey) => {
      factoryCalls += 1;
      assert.equal(apiKey, 'existing-transcription-key');
      return {
        responses: {
          async create(request) {
            openAiCalls.push(request);
            return {
              status: 'completed',
              output_text: '{"ok":true}',
              model: 'gpt-4o-mini',
            };
          },
        },
      };
    },
  });

  assert.equal(factoryCalls, 0, 'OpenAI client must stay lazy while the bridge is healthy');
  const response = await client.responses.create(REQUEST);

  assert.equal(response.output_text, '{"ok":true}');
  assert.equal(factoryCalls, 1);
  assert.deepEqual(openAiCalls, [REQUEST]);
});

test('OpenAI retries on bridge HTTP 503/504 and reuses one lazy client', async () => {
  let factoryCalls = 0;
  let openAiCalls = 0;
  let bridgeStatus = 503;
  const client = createTextLlmClient({
    env: {
      CONTACT_OPS_CODEX_BRIDGE_URL: 'https://macmini.example.test',
      CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'test-token-with-at-least-thirty-two-characters',
      OPENAI_API_KEY: 'existing-transcription-key',
    },
    fetchImpl: async () => new Response('unavailable', { status: bridgeStatus }),
    openAiFactory: () => {
      factoryCalls += 1;
      return {
        responses: {
          async create() {
            openAiCalls += 1;
            return { status: 'completed', output_text: '{"ok":true}', model: 'gpt-4o-mini' };
          },
        },
      };
    },
  });

  await client.responses.create(REQUEST);
  bridgeStatus = 504;
  await client.responses.create(REQUEST);

  assert.equal(factoryCalls, 1);
  assert.equal(openAiCalls, 2);
});

test('OpenAI never masks bridge authentication, rate, model, or response-contract failures', async () => {
  const env = {
    CONTACT_OPS_CODEX_BRIDGE_URL: 'https://macmini.example.test',
    CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'test-token-with-at-least-thirty-two-characters',
    OPENAI_API_KEY: 'existing-transcription-key',
  };
  const responses = [
    new Response('unauthorized', { status: 401 }),
    new Response('busy', { status: 429 }),
    new Response('invalid model output', { status: 502 }),
    new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }),
  ];

  for (const bridgeResponse of responses) {
    let fallbackCalls = 0;
    const client = createTextLlmClient({
      env,
      fetchImpl: async () => bridgeResponse,
      openAiFactory: () => {
        fallbackCalls += 1;
        return { responses: { create: async () => ({}) } };
      },
    });

    await assert.rejects(() => client.responses.create(REQUEST));
    assert.equal(fallbackCalls, 0);
  }
});

test('Bridge availability failures remain closed when no OpenAI key is configured', async () => {
  const client = createTextLlmClient({
    env: {
      CONTACT_OPS_CODEX_BRIDGE_URL: 'https://macmini.example.test',
      CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'test-token-with-at-least-thirty-two-characters',
    },
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });

  await assert.rejects(
    () => client.responses.create(REQUEST),
    (error) => /temporarily unavailable/i.test(error.message),
  );
});

test('Codex bridge rejects non-JSON and oversized response streams', async () => {
  const env = {
    CONTACT_OPS_CODEX_BRIDGE_URL: 'https://macmini.example.test',
    CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'test-token-with-at-least-thirty-two-characters',
  };
  for (const response of [
    new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    new Response('x'.repeat(257 * 1024), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ]) {
    const client = createTextLlmClient({ env, fetchImpl: async () => response });
    await assert.rejects(
      () => client.responses.create(REQUEST),
      (error) => /invalid response/i.test(error.message),
    );
  }
});

test('OpenAI remains the explicit fallback when no Codex bridge is configured', () => {
  const sentinel = { responses: { create() {} } };
  const client = createTextLlmClient({
    env: { OPENAI_API_KEY: 'test-openai-key' },
    openAiFactory: (apiKey) => {
      assert.equal(apiKey, 'test-openai-key');
      return sentinel;
    },
  });

  assert.equal(client, sentinel);
  assert.throws(
    () => createTextLlmClient({ env: {}, openAiFactory: () => sentinel }),
    LlmClientConfigurationError,
  );
});
