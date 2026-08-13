import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LiveCallError } from '../src/live-call-service.mjs';
import {
  createLiveKitTokenProvider,
  createLiveKitTokenProviderFromEnvironment,
} from '../src/livekit-provider.mjs';
import { createOpenAiRealtimeBridge } from '../src/openai-realtime-bridge.mjs';

describe('LiveKit token provider', () => {
  test('issues a short-lived, audio/data-only participant token with role metadata', async () => {
    const created = [];
    const grants = [];
    const tokenFactory = (apiKey, apiSecret, options) => {
      created.push({ apiKey, apiSecret, options });
      return {
        addGrant(grant) { grants.push(grant); },
        async toJwt() { return 'signed-livekit-token'; },
      };
    };
    const provider = createLiveKitTokenProvider({
      serverUrl: 'wss://care-test.livekit.cloud',
      apiKey: 'api-key-test',
      apiSecret: 'api-secret-test',
      tokenFactory,
      verifier: { async verify() { throw new Error('not used'); } },
    });

    const token = await provider.issueParticipant({
      role: 'resident',
      callId: '123abc',
      roomName: 'care-call-123abc',
      identity: 'resident-123abc',
      ttlSeconds: 1_800,
      canPublish: ['microphone', 'data'],
      canSubscribe: true,
    });

    assert.equal(token, 'signed-livekit-token');
    assert.deepEqual(created, [{
      apiKey: 'api-key-test',
      apiSecret: 'api-secret-test',
      options: {
        identity: 'resident-123abc',
        name: '연락 대상',
        ttl: 1_800,
        metadata: JSON.stringify({ version: 1, role: 'resident', call_id: '123abc' }),
      },
    }]);
    assert.deepEqual(grants, [{
      roomJoin: true,
      room: 'care-call-123abc',
      canPublish: true,
      canPublishData: true,
      canPublishSources: ['microphone'],
      canSubscribe: true,
    }]);
  });

  test('verifies claims and rejects forged identity/metadata combinations', async () => {
    const validClaims = {
      sub: 'surveyor-123abc',
      metadata: JSON.stringify({ version: 1, role: 'surveyor', call_id: '123abc' }),
      video: { room: 'care-call-123abc', roomJoin: true },
    };
    const provider = createLiveKitTokenProvider({
      serverUrl: 'wss://care-test.livekit.cloud',
      apiKey: 'api-key-test',
      apiSecret: 'api-secret-test',
      tokenFactory: () => { throw new Error('not used'); },
      verifier: { async verify() { return validClaims; } },
    });

    assert.deepEqual(await provider.verifyParticipant('signed-token'), {
      roomName: 'care-call-123abc',
      identity: 'surveyor-123abc',
      role: 'surveyor',
      callId: '123abc',
    });

    validClaims.sub = 'resident-123abc';
    await assert.rejects(() => provider.verifyParticipant('forged-token'), /통화 참여 정보를/);
  });

  test('rejects invalid configuration, grants, claims, and verifier failures', async () => {
    const valid = {
      serverUrl: 'wss://care-test.livekit.cloud', apiKey: 'key', apiSecret: 'secret-test',
      tokenFactory: () => ({ addGrant() {}, async toJwt() { return 'token'; } }),
      verifier: { async verify() { return {}; } },
    };
    assert.throws(() => createLiveKitTokenProvider({ ...valid, serverUrl: 'not-url' }), /valid URL/);
    assert.throws(() => createLiveKitTokenProvider({ ...valid, serverUrl: 'https://example.com' }), /wss or ws/);
    assert.throws(() => createLiveKitTokenProvider({ ...valid, apiKey: '' }), /API_KEY/);
    assert.throws(() => createLiveKitTokenProvider({ ...valid, apiSecret: '' }), /API_SECRET/);
    assert.throws(() => createLiveKitTokenProvider({ ...valid, tokenFactory: null }), /SDK adapters/);

    const provider = createLiveKitTokenProvider(valid);
    for (const input of [
      { role: 'other', callId: 'abc', identity: 'other-abc', roomName: 'care-call-abc', ttlSeconds: 60 },
      { role: 'resident', callId: 'abc', identity: 'wrong', roomName: 'care-call-abc', ttlSeconds: 60 },
      { role: 'resident', callId: 'abc', identity: 'resident-abc', roomName: 'wrong', ttlSeconds: 60 },
      { role: 'resident', callId: 'abc', identity: 'resident-abc', roomName: 'care-call-abc', ttlSeconds: 59 },
    ]) await assert.rejects(() => provider.issueParticipant(input), /Invalid LiveKit/);

    for (const claims of [
      { metadata: '{' },
      { sub: 'resident-abc', metadata: JSON.stringify({ version: 2, role: 'resident', call_id: 'abc' }), video: { room: 'care-call-abc' } },
      { sub: 'resident-abc', metadata: JSON.stringify({ version: 1, role: 'other', call_id: 'abc' }), video: { room: 'care-call-abc' } },
      { sub: 'resident-abc', metadata: JSON.stringify({ version: 1, role: 'resident', call_id: '..' }), video: { room: 'care-call-abc' } },
      { sub: 'wrong', metadata: JSON.stringify({ version: 1, role: 'resident', call_id: 'abc' }), video: { room: 'care-call-abc' } },
      { sub: 'resident-abc', metadata: JSON.stringify({ version: 1, role: 'resident', call_id: 'abc' }), video: { room: 'wrong' } },
      { sub: 'resident-abc', metadata: JSON.stringify({ version: 1, role: 'resident', call_id: 'abc' }), video: { room: 'care-call-abc', roomJoin: false } },
    ]) {
      const invalid = createLiveKitTokenProvider({ ...valid, verifier: { async verify() { return claims; } } });
      await assert.rejects(() => invalid.verifyParticipant('token'), LiveCallError);
    }
    const failed = createLiveKitTokenProvider({ ...valid, verifier: { async verify() { throw new Error('SDK failure'); } } });
    await assert.rejects(() => failed.verifyParticipant('token'), LiveCallError);
  });

  test('constructs the production SDK adapter and round-trips a signed participant role', async () => {
    const provider = await createLiveKitTokenProviderFromEnvironment({
      LIVEKIT_URL: 'wss://care-test.livekit.cloud',
      LIVEKIT_API_KEY: 'test-key',
      LIVEKIT_API_SECRET: 'test-secret-with-enough-length',
    });
    const token = await provider.issueParticipant({
      role: 'surveyor', callId: 'abc123', roomName: 'care-call-abc123', identity: 'surveyor-abc123',
      ttlSeconds: 120, canSubscribe: true,
    });
    assert.deepEqual(await provider.verifyParticipant(token), {
      roomName: 'care-call-abc123', identity: 'surveyor-abc123', role: 'surveyor', callId: 'abc123',
    });
  });
});

describe('OpenAI realtime transcription bridge', () => {
  test('exchanges SDP using the current transcription session contract without exposing the key', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return new Response('v=0\r\na=answer\r\n', {
        status: 201,
        headers: { 'Content-Type': 'application/sdp' },
      });
    };
    const bridge = createOpenAiRealtimeBridge({
      apiKey: 'openai-test-secret',
      fetchImpl,
    });

    const answer = await bridge.exchangeSdp({
      sdp: 'v=0\r\na=offer\r\n',
      safetyIdentifier: 'live-call:call-123:resident',
      model: 'gpt-live-transcribe',
      language: 'ko',
    });

    assert.equal(answer, 'v=0\r\na=answer\r\n');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/realtime/calls');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer openai-test-secret');
    assert.equal(calls[0].init.headers['OpenAI-Safety-Identifier'], 'live-call:call-123:resident');
    assert.equal(calls[0].init.body.get('sdp'), 'v=0\r\na=offer\r\n');
    assert.deepEqual(JSON.parse(calls[0].init.body.get('session')), {
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      output_modalities: ['text'],
      audio: {
        input: {
          transcription: {
            model: 'gpt-live-transcribe',
            languages: ['ko'],
            delay: 'low',
          },
          noise_reduction: { type: 'near_field' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 700,
            create_response: false,
            interrupt_response: false,
          },
        },
      },
    });
  });

  test('returns a stable Korean error and never includes provider response text', async () => {
    const bridge = createOpenAiRealtimeBridge({
      apiKey: 'openai-test-secret',
      fetchImpl: async () => new Response('provider says key openai-test-secret is invalid', { status: 401 }),
    });

    await assert.rejects(
      () => bridge.exchangeSdp({
        sdp: 'v=0\r\n',
        safetyIdentifier: 'live-call:call-123:resident',
        model: 'gpt-live-transcribe',
        language: 'ko',
      }),
      (error) => error.message === '실시간 전사를 시작하지 못했습니다.'
        && !error.message.includes('openai-test-secret'),
    );
  });

  test('validates bridge configuration and normalizes malformed SDP and network failures', async () => {
    assert.throws(() => createOpenAiRealtimeBridge(), /OPENAI_API_KEY/);
    assert.throws(() => createOpenAiRealtimeBridge({ apiKey: 'test-key', fetchImpl: null }), /fetchImpl/);
    assert.throws(() => createOpenAiRealtimeBridge({ apiKey: 'test-key', sessionModel: 'gpt-live-transcribe' }), /sessionModel/);

    for (const fetchImpl of [
      async () => new Response('not-sdp', { status: 201 }),
      async () => { throw new Error('network detail'); },
    ]) {
      const bridge = createOpenAiRealtimeBridge({ apiKey: 'openai-test-secret', fetchImpl });
      await assert.rejects(
        () => bridge.exchangeSdp({ sdp: 'v=0\r\n', safetyIdentifier: 'safe', model: 'gpt-live-transcribe', language: 'ko' }),
        (error) => error instanceof LiveCallError && !error.message.includes('network detail'),
      );
    }
  });
});
