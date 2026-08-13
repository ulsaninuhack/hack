import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createApiServer } from '../src/app.mjs';
import { createDataStore } from '../src/data-store.mjs';

const CASE_ID = 'SYN-HH-2812551000-0001';
const SESSION_ID = 'live-call-api-session';
const store = createDataStore({
  summary: { schemaVersion: 1, project: 'test', metricGuardrail: 'test', counts: {} },
  zones: { type: 'FeatureCollection', features: [] },
  facilities: { type: 'FeatureCollection', features: [] },
  transit: { type: 'FeatureCollection', features: [] },
  validation: { status: 'pass' },
});
const calls = [];
const liveCallService = {
  async createCall(input) {
    calls.push({ method: 'createCall', input });
    return {
      provider: 'livekit', call_id: 'fixed', room_name: 'care-call-fixed',
      server_url: 'wss://care-test.livekit.cloud', expires_at: '2026-08-13T01:30:00.000Z',
      transcription: { provider: 'openai', model: 'gpt-live-transcribe', language: 'ko' },
      host: { role: 'surveyor', participant_token: 'host-token' },
      guest: { role: 'resident', invite_code: 'invitecode0123456789abcdef012345' },
    };
  },
  async redeemInvite(input) {
    calls.push({ method: 'redeemInvite', input });
    return {
      provider: 'livekit', call_id: 'fixed', server_url: 'wss://care-test.livekit.cloud',
      expires_at: '2026-08-13T01:30:00.000Z',
      participant: { role: 'resident', participant_token: 'guest-token' },
    };
  },
  async joinDemoCall() {
    calls.push({ method: 'joinDemoCall' });
    return {
      provider: 'livekit', call_id: 'demo-stage', server_url: 'wss://care-test.livekit.cloud',
      expires_at: '2026-08-13T01:30:00.000Z',
      participant: { role: 'resident', participant_token: 'guest-token' },
    };
  },
  async exchangeRealtimeSdp(input) {
    calls.push({ method: 'exchangeRealtimeSdp', input });
    return 'v=0\r\na=answer\r\n';
  },
};

let server;
let origin;
before(async () => {
  server = createApiServer({ store, liveCallService, rateLimitPerMinute: 0 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));

describe('live call HTTP contract', () => {
  test('creates a call without mutating contact observations or approvals', async () => {
    const response = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/live-calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': SESSION_ID },
      body: JSON.stringify({ expected_revision: 7 }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.host.participant_token, 'host-token');
    assert.equal(body.data.guest.invite_code, 'invitecode0123456789abcdef012345');
    assert.equal(JSON.stringify(body).includes('guest-token'), false);
    assert.deepEqual(calls.at(-1), {
      method: 'createCall',
      input: { sessionId: SESSION_ID, caseId: CASE_ID, expectedRevision: 7 },
    });
    assert.equal(JSON.stringify(body).includes('approved'), false);
    assert.equal(JSON.stringify(body).includes('observations'), false);
  });

  test('exchanges a short bodyless invite code for resident credentials', async () => {
    const response = await fetch(`${origin}/api/v1/contact-ops/live-calls/invites/invitecode0123456789abcdef012345`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.data.participant.participant_token, 'guest-token');
    assert.deepEqual(calls.at(-1), {
      method: 'redeemInvite', input: { inviteCode: 'invitecode0123456789abcdef012345' },
    });
  });

  test('opens the fixed bodyless demo entrance without putting a credential in the URL', async () => {
    const response = await fetch(`${origin}/api/v1/contact-ops/live-calls/demo`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.data.call_id, 'demo-stage');
    assert.equal(body.data.participant.participant_token, 'guest-token');
    assert.deepEqual(calls.at(-1), { method: 'joinDemoCall' });
    assert.equal(response.url.includes('guest-token'), false);
  });

  test('creates the surveyor side of the same fixed demo room only on explicit request', async () => {
    const response = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/live-calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': SESSION_ID },
      body: JSON.stringify({ expected_revision: 7, demo_entry: true }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), {
      method: 'createCall',
      input: { sessionId: SESSION_ID, caseId: CASE_ID, expectedRevision: 7, demoEntry: true },
    });
  });

  test('proxies raw SDP only after bearer-token verification in the live-call service', async () => {
    const response = await fetch(`${origin}/api/v1/contact-ops/live-calls/realtime-sdp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-livekit-token',
        'Content-Type': 'application/sdp',
      },
      body: 'v=0\r\na=offer\r\n',
    });

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('content-type'), 'application/sdp; charset=utf-8');
    assert.equal(await response.text(), 'v=0\r\na=answer\r\n');
    assert.deepEqual(calls.at(-1), {
      method: 'exchangeRealtimeSdp',
      input: { participantToken: 'valid-livekit-token', sdp: 'v=0\r\na=offer\r\n' },
    });
  });

  test('rejects missing bearer credentials, wrong media type, and extra create fields', async () => {
    const noAuth = await fetch(`${origin}/api/v1/contact-ops/live-calls/realtime-sdp`, {
      method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: 'v=0\r\n',
    });
    assert.equal(noAuth.status, 401);

    const wrongType = await fetch(`${origin}/api/v1/contact-ops/live-calls/realtime-sdp`, {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(wrongType.status, 415);

    const extra = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/live-calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': SESSION_ID },
      body: JSON.stringify({ expected_revision: 7, auto_submit: true }),
    });
    assert.equal(extra.status, 400);

    const malformedInvite = await fetch(`${origin}/api/v1/contact-ops/live-calls/invites/short`, { method: 'POST' });
    assert.equal(malformedInvite.status, 400);

    const inviteWithBody = await fetch(`${origin}/api/v1/contact-ops/live-calls/invites/invitecode0123456789abcdef012345`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(inviteWithBody.status, 413);

    const demoWithBody = await fetch(`${origin}/api/v1/contact-ops/live-calls/demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(demoWithBody.status, 413);

    const demoWithQuery = await fetch(`${origin}/api/v1/contact-ops/live-calls/demo?room=other`, { method: 'POST' });
    assert.equal(demoWithQuery.status, 400);
  });

  test('allows Authorization in the operations preflight contract', async () => {
    const response = await fetch(`${origin}/api/v1/contact-ops/live-calls/realtime-sdp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
  });
});
