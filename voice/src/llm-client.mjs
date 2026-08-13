import OpenAI from 'openai';

export class LlmClientConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmClientConfigurationError';
  }
}

/**
 * Text analysis is intentionally direct-to-OpenAI. The retired Mac mini bridge
 * variables are ignored so stale deployment configuration cannot silently put
 * the serialized home transport back on the production request path.
 */
export function createTextLlmClient({
  env = process.env,
  openAiFactory = (apiKey) => new OpenAI({ apiKey }),
} = {}) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new LlmClientConfigurationError('OPENAI_API_KEY is required for text analysis.');
  }
  return openAiFactory(apiKey);
}
