import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LlmClientConfigurationError,
  createTextLlmClient,
} from '../src/llm-client.mjs';

test('stale bridge settings cannot override the direct OpenAI transport', () => {
  let factoryApiKey;
  const directClient = { responses: { create: async () => ({}) } };
  const client = createTextLlmClient({
    env: {
      OPENAI_API_KEY: ' direct-openai-key ',
      CONTACT_OPS_CODEX_BRIDGE_URL: 'https://retired.example/bridge',
      CONTACT_OPS_CODEX_BRIDGE_TOKEN: 'x'.repeat(32),
    },
    openAiFactory(apiKey) {
      factoryApiKey = apiKey;
      return directClient;
    },
  });

  assert.equal(client, directClient);
  assert.equal(factoryApiKey, 'direct-openai-key');
});

test('direct text analysis fails closed without an OpenAI API key', () => {
  assert.throws(
    () => createTextLlmClient({ env: {}, openAiFactory: () => ({}) }),
    (error) => error instanceof LlmClientConfigurationError
      && error.message === 'OPENAI_API_KEY is required for text analysis.',
  );
});
