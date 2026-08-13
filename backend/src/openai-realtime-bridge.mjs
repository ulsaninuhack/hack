import { LiveCallError } from './live-call-service.mjs';

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const DEFAULT_REALTIME_SESSION_MODEL = 'gpt-realtime-2.1';

function sessionConfig({ model, language, sessionModel }) {
  return {
    type: 'realtime',
    model: sessionModel,
    output_modalities: ['text'],
    audio: {
      input: {
        transcription: { model, languages: [language], delay: 'low' },
        noise_reduction: { type: 'near_field' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.65,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,
          create_response: false,
          interrupt_response: false,
        },
      },
    },
  };
}

export function createOpenAiRealtimeBridge({
  apiKey,
  fetchImpl = fetch,
  sessionModel = DEFAULT_REALTIME_SESSION_MODEL,
} = {}) {
  if (typeof apiKey !== 'string' || apiKey.length < 8) throw new Error('OPENAI_API_KEY is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof sessionModel !== 'string' || !/^gpt-realtime-[A-Za-z0-9._-]+$/.test(sessionModel)) {
    throw new TypeError('sessionModel must be a realtime model identifier');
  }

  return Object.freeze({
    async exchangeSdp({ sdp, safetyIdentifier, model, language }) {
      const form = new FormData();
      form.set('sdp', sdp);
      form.set('session', JSON.stringify(sessionConfig({ model, language, sessionModel })));
      try {
        const response = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'OpenAI-Safety-Identifier': safetyIdentifier,
          },
          body: form,
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          throw new LiveCallError(502, 'REALTIME_TRANSCRIPTION_UNAVAILABLE', '실시간 전사를 시작하지 못했습니다.');
        }
        const answer = await response.text();
        if (!/^v=0(?:\r?\n|$)/.test(answer)) {
          throw new LiveCallError(502, 'REALTIME_TRANSCRIPTION_UNAVAILABLE', '실시간 전사를 시작하지 못했습니다.');
        }
        return answer;
      } catch (error) {
        if (error instanceof LiveCallError) throw error;
        throw new LiveCallError(502, 'REALTIME_TRANSCRIPTION_UNAVAILABLE', '실시간 전사를 시작하지 못했습니다.');
      }
    },
  });
}

export { DEFAULT_REALTIME_SESSION_MODEL, OPENAI_REALTIME_CALLS_URL };
