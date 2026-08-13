import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LiveCallError,
  createLiveCallService,
} from '../src/live-call-service.mjs';

const CASE_ID = 'SYN-HH-2812551000-0001';
const SESSION_ID = 'live-call-test-session';

function harness(overrides = {}) {
  const issued = [];
  const invites = new Map();
  const tokenProvider = {
    serverUrl: 'wss://care-test.livekit.cloud',
    async issueParticipant(input) {
      issued.push(input);
      return `token-for-${input.role}`;
    },
    async verifyParticipant(token) {
      if (token !== 'valid-livekit-token') throw new LiveCallError(401, 'LIVE_CALL_UNAUTHORIZED', '통화 참여 정보를 확인할 수 없습니다.');
      return {
        roomName: 'care-call-fixed',
        identity: 'resident-call-fixed',
        role: 'resident',
        callId: 'call-fixed',
      };
    },
  };
  const bridgeCalls = [];
  const realtimeBridge = {
    async exchangeSdp(input) {
      bridgeCalls.push(input);
      return 'answer-sdp';
    },
  };
  const caseAccess = {
    async assertReadable(input) {
      assert.deepEqual(input, {
        sessionId: SESSION_ID,
        caseId: CASE_ID,
        expectedRevision: 7,
      });
    },
  };
  const inviteStore = {
    async saveInvite(input) {
      invites.set(input.inviteCode, structuredClone(input));
    },
    async getInvite({ inviteCode }) {
      const value = invites.get(inviteCode);
      return value ? {
        callId: value.callId,
        roomName: value.roomName,
        expiresAt: value.expiresAt,
      } : null;
    },
  };
  const service = createLiveCallService({
    tokenProvider,
    realtimeBridge,
    caseAccess,
    inviteStore,
    randomCallId: () => 'fixed',
    randomInviteCode: () => 'invitecode0123456789abcdef012345',
    now: () => new Date('2026-08-13T01:00:00.000Z'),
    ...overrides,
  });
  return { service, issued, bridgeCalls, invites };
}

describe('live call service', () => {
  test('creates a two-person audio room with server-controlled speaker roles', async () => {
    const { service, issued, invites } = harness();

    const result = await service.createCall({
      sessionId: SESSION_ID,
      caseId: CASE_ID,
      expectedRevision: 7,
    });

    assert.equal(result.provider, 'livekit');
    assert.equal(result.server_url, 'wss://care-test.livekit.cloud');
    assert.equal(result.room_name, 'care-call-fixed');
    assert.equal(result.call_id, 'fixed');
    assert.equal(result.host.role, 'surveyor');
    assert.equal(result.host.participant_token, 'token-for-surveyor');
    assert.equal(result.guest.role, 'resident');
    assert.equal(result.guest.invite_code, 'invitecode0123456789abcdef012345');
    assert.equal(JSON.stringify(result).includes('token-for-resident'), false);
    assert.equal(result.transcription.model, 'gpt-live-transcribe');
    assert.equal(result.transcription.language, 'ko');
    assert.equal(result.expires_at, '2026-08-13T01:30:00.000Z');
    assert.deepEqual(issued.map(({ role, roomName, canPublish }) => ({ role, roomName, canPublish })), [
      { role: 'surveyor', roomName: 'care-call-fixed', canPublish: ['microphone', 'data'] },
    ]);
    assert.ok(issued.every((entry) => entry.ttlSeconds === 1_800));
    assert.ok(issued.every((entry) => entry.canSubscribe === true));
    assert.deepEqual(invites.get('invitecode0123456789abcdef012345'), {
      inviteCode: 'invitecode0123456789abcdef012345',
      callId: 'fixed',
      roomName: 'care-call-fixed',
      expiresAt: '2026-08-13T01:30:00.000Z',
    });
    assert.equal(JSON.stringify(result).includes(SESSION_ID), false);
  });

  test('redeems a short invite code for a fresh resident token without exposing room secrets in the URL', async () => {
    const { service, issued } = harness();
    await service.createCall({ sessionId: SESSION_ID, caseId: CASE_ID, expectedRevision: 7 });

    const result = await service.redeemInvite({ inviteCode: 'invitecode0123456789abcdef012345' });

    assert.deepEqual(result, {
      provider: 'livekit',
      call_id: 'fixed',
      server_url: 'wss://care-test.livekit.cloud',
      expires_at: '2026-08-13T01:30:00.000Z',
      participant: { role: 'resident', participant_token: 'token-for-resident' },
    });
    assert.equal(issued.at(-1).role, 'resident');
    assert.equal(issued.at(-1).roomName, 'care-call-fixed');
    assert.equal(issued.at(-1).ttlSeconds, 1_800);
  });

  test('rejects missing, unknown, and expired invite codes before issuing a guest token', async () => {
    const { service, issued } = harness();
    await assert.rejects(() => service.redeemInvite({ inviteCode: 'short' }), LiveCallError);
    await assert.rejects(
      () => service.redeemInvite({ inviteCode: 'unknowninvitecode0123456789012345' }),
      (error) => error instanceof LiveCallError && error.status === 410,
    );

    const expired = harness({ now: () => new Date('2026-08-13T02:00:00.000Z') });
    expired.invites.set('expiredinvitecode0123456789012345', {
      inviteCode: 'expiredinvitecode0123456789012345', callId: 'fixed', roomName: 'care-call-fixed',
      expiresAt: '2026-08-13T01:30:00.000Z',
    });
    await assert.rejects(
      () => expired.service.redeemInvite({ inviteCode: 'expiredinvitecode0123456789012345' }),
      (error) => error instanceof LiveCallError && error.status === 410,
    );
    assert.equal(issued.length, 0);
    assert.equal(expired.issued.length, 0);
  });

  test('verifies the LiveKit participant token before proxying bounded SDP to OpenAI', async () => {
    const { service, bridgeCalls } = harness();

    const result = await service.exchangeRealtimeSdp({
      participantToken: 'valid-livekit-token',
      sdp: 'v=0\r\na=group:BUNDLE 0\r\n',
    });

    assert.equal(result, 'answer-sdp');
    assert.deepEqual(bridgeCalls, [{
      sdp: 'v=0\r\na=group:BUNDLE 0\r\n',
      safetyIdentifier: 'live-call:call-fixed:resident',
      model: 'gpt-live-transcribe',
      language: 'ko',
    }]);
  });

  test('rejects missing credentials and malformed or oversized SDP without provider calls', async () => {
    const { service, bridgeCalls } = harness();
    const invalid = [
      { participantToken: '', sdp: 'v=0\r\n' },
      { participantToken: 'valid-livekit-token', sdp: '' },
      { participantToken: 'valid-livekit-token', sdp: 'not-an-sdp' },
      { participantToken: 'valid-livekit-token', sdp: `v=0\r\n${'a'.repeat(64_001)}` },
    ];

    for (const input of invalid) {
      await assert.rejects(() => service.exchangeRealtimeSdp(input), LiveCallError);
    }
    assert.equal(bridgeCalls.length, 0);
  });

  test('rejects invalid service adapters, create inputs, call IDs, and verified participant claims', async () => {
    assert.throws(() => createLiveCallService(), /tokenProvider is required/);
    assert.throws(() => createLiveCallService({ tokenProvider: {} }), /realtimeBridge is required/);
    assert.throws(() => createLiveCallService({ tokenProvider: {}, realtimeBridge: {} }), /caseAccess is required/);
    assert.throws(() => createLiveCallService({ tokenProvider: {}, realtimeBridge: {}, caseAccess: {} }), /inviteStore is required/);
    assert.throws(() => createLiveCallService({ tokenProvider: {}, realtimeBridge: {}, caseAccess: {}, inviteStore: {} }), /tokenProvider does not match/);
    assert.throws(() => createLiveCallService({
      tokenProvider: { serverUrl: 'wss://x', issueParticipant() {}, verifyParticipant() {} },
      realtimeBridge: {}, caseAccess: {}, inviteStore: {},
    }), /realtimeBridge does not match/);
    assert.throws(() => createLiveCallService({
      tokenProvider: { serverUrl: 'wss://x', issueParticipant() {}, verifyParticipant() {} },
      realtimeBridge: { exchangeSdp() {} }, caseAccess: {}, inviteStore: {},
    }), /inviteStore does not match/);

    const { service } = harness();
    for (const input of [
      { sessionId: 'short', caseId: CASE_ID, expectedRevision: 7 },
      { sessionId: SESSION_ID, caseId: 'CASE-1', expectedRevision: 7 },
      { sessionId: SESSION_ID, caseId: CASE_ID, expectedRevision: -1 },
    ]) await assert.rejects(() => service.createCall(input), LiveCallError);

    const invalidId = harness({ randomCallId: () => '../bad' }).service;
    await assert.rejects(() => invalidId.createCall({ sessionId: SESSION_ID, caseId: CASE_ID, expectedRevision: 7 }), /randomCallId/);
    const invalidInvite = harness({ randomInviteCode: () => 'short' }).service;
    await assert.rejects(() => invalidInvite.createCall({ sessionId: SESSION_ID, caseId: CASE_ID, expectedRevision: 7 }), /randomInviteCode/);

    for (const participant of [null, { role: 'other', callId: 'x' }, { role: 'resident' }]) {
      const invalidParticipant = harness({
        tokenProvider: {
          serverUrl: 'wss://care-test.livekit.cloud',
          async issueParticipant() { return 'token'; },
          async verifyParticipant() { return participant; },
        },
      }).service;
      await assert.rejects(
        () => invalidParticipant.exchangeRealtimeSdp({ participantToken: 'valid-livekit-token', sdp: 'v=0\r\n' }),
        LiveCallError,
      );
    }
  });

  test('uses opaque default call identifiers and current time when clocks are not injected', async () => {
    const base = harness();
    const service = createLiveCallService({
      tokenProvider: {
        serverUrl: 'wss://care-test.livekit.cloud',
        async issueParticipant(input) { return `token-${input.role}`; },
        async verifyParticipant() { return { role: 'resident', callId: 'fixed' }; },
      },
      realtimeBridge: { async exchangeSdp() { return 'answer'; } },
      caseAccess: { async assertReadable(input) { await base.service.createCall(input); } },
      inviteStore: { async saveInvite() {}, async getInvite() { return null; } },
    });
    const result = await service.createCall({ sessionId: SESSION_ID, caseId: CASE_ID, expectedRevision: 7 });
    assert.match(result.call_id, /^[a-f0-9]{32}$/);
    assert.match(result.guest.invite_code, /^[a-f0-9]{32}$/);
    assert.ok(Date.parse(result.expires_at) > Date.now());
  });
});
