import { readFileSync } from 'node:fs';

import OpenAI from 'openai';

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export class LlmClientConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmClientConfigurationError';
  }
}

export class CodexBridgeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CodexBridgeError';
  }
}

function parseTimeout(value) {
  const parsed = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 60_000) {
    throw new LlmClientConfigurationError(
      'CONTACT_OPS_CODEX_BRIDGE_TIMEOUT_MS must be an integer between 1000 and 60000.',
    );
  }
  return parsed;
}

function loadToken(env) {
  const direct = String(env.CONTACT_OPS_CODEX_BRIDGE_TOKEN || '').trim();
  const tokenFile = String(env.CONTACT_OPS_CODEX_BRIDGE_TOKEN_FILE || '').trim();
  let token = direct;
  if (!token && tokenFile) {
    try {
      token = readFileSync(tokenFile, 'utf8').trim();
    } catch {
      throw new LlmClientConfigurationError('The Codex bridge token file is unavailable.');
    }
  }
  if (token.length < 32 || token.length > 512) {
    throw new LlmClientConfigurationError('The Codex bridge token must contain 32 to 512 characters.');
  }
  return token;
}

function normalizeBridgeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LlmClientConfigurationError('CONTACT_OPS_CODEX_BRIDGE_URL must be a valid URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new LlmClientConfigurationError('The Codex bridge must use HTTPS outside localhost.');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/responses`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function readBoundedResponse(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new CodexBridgeError('The Codex bridge returned an invalid response.');
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof CodexBridgeError) throw error;
    throw new CodexBridgeError('The Codex bridge returned an invalid response.');
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function bridgeClient({ baseUrl, token, timeoutMs, fetchImpl }) {
  return Object.freeze({
    responses: Object.freeze({
      async create(request) {
        let response;
        try {
          response = await fetchImpl(baseUrl, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch {
          throw new CodexBridgeError('The Codex bridge is temporarily unavailable.');
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new CodexBridgeError('The Codex bridge is temporarily unavailable.');
        }
        if (!String(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
          await response.body?.cancel().catch(() => {});
          throw new CodexBridgeError('The Codex bridge returned an invalid response.');
        }
        let text;
        try {
          text = await readBoundedResponse(response);
        } catch {
          throw new CodexBridgeError('The Codex bridge returned an invalid response.');
        }
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new CodexBridgeError('The Codex bridge returned an invalid response.');
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)
            || payload.status !== 'completed'
            || typeof payload.output_text !== 'string'
            || payload.output_text.trim() === ''
            || typeof payload.model !== 'string') {
          throw new CodexBridgeError('The Codex bridge returned an invalid response.');
        }
        return payload;
      },
    }),
  });
}

export function createTextLlmClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  openAiFactory = (apiKey) => new OpenAI({ apiKey }),
} = {}) {
  const bridgeUrl = String(env.CONTACT_OPS_CODEX_BRIDGE_URL || '').trim();
  if (bridgeUrl) {
    if (typeof fetchImpl !== 'function') {
      throw new LlmClientConfigurationError('A fetch implementation is required for the Codex bridge.');
    }
    return bridgeClient({
      baseUrl: normalizeBridgeUrl(bridgeUrl),
      token: loadToken(env),
      timeoutMs: parseTimeout(env.CONTACT_OPS_CODEX_BRIDGE_TIMEOUT_MS),
      fetchImpl,
    });
  }

  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new LlmClientConfigurationError(
      'Configure CONTACT_OPS_CODEX_BRIDGE_URL and its token, or provide OPENAI_API_KEY.',
    );
  }
  return openAiFactory(apiKey);
}
