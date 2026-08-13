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
