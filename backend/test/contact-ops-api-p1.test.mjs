import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createApiServer } from '../src/app.mjs';
import { createDataStore } from '../src/data-store.mjs';

const store = createDataStore({
  summary: { schemaVersion: 1, project: 'test', metricGuardrail: 'test', counts: {} },
  zones: { type: 'FeatureCollection', features: [] },
  facilities: { type: 'FeatureCollection', features: [] },
  transit: { type: 'FeatureCollection', features: [] },
  validation: { status: 'pass' },
});

const syntheticResponse = { synthetic: true, displayMarker: '[합성]', revision: 1 };
const observations = {
  관찰_6징후: { 우편물_고지서_적체: false, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
  식사상태: null, 위생상태: null, 공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
};
const calls = [];
const contactOpsService = {
  async getToday(input) { calls.push(['today', input]); return { ...syntheticResponse, items: [] }; },
  async getCase(input) { calls.push(['case', input]); return syntheticResponse; },
  async recordContactResult(input) { calls.push(['contact', input]); return syntheticResponse; },
  async recalculateTriage(input) { calls.push(['recalculate', input]); return syntheticResponse; },
  async getVisitRecommendations(input) { calls.push(['recommendations', input]); return { ...syntheticResponse, items: [] }; },
  async recordVisitDecision(input) { calls.push(['decision', input]); return syntheticResponse; },
  async createAiObservation(input) { calls.push(['ai', input]); return { ...syntheticResponse, candidate: {} }; },
};

let server;
let baseUrl;

before(async () => {
  server = createApiServer({
    store,
    contactOpsService,
    corsOrigins: ['https://care.example'],
    rateLimitPerMinute: 0,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve) => server.close(resolve)));

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: response.status === 204 ? null : await response.json() };
}

function mutation(path, body, headers = {}) {
  return request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Demo-Session-ID': 'p1-http-session-01',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('P1 frozen ContactOps HTTP contract', () => {
  test('uses the exact read routes and synthetic display envelope', async () => {
    for (const path of [
      '/api/v1/contact-ops/today?referenceDate=2026-08-12&workerId=SYN-W-2812551000-01',
      '/api/v1/contact-ops/cases/SYN-HH-2812551000-0001',
      '/api/v1/contact-ops/visit-recommendations?district=미추홀구',
    ]) {
      const { response, body } = await request(path, { headers: { 'X-Demo-Session-ID': 'p1-http-session-01' } });
      assert.equal(response.status, 200);
      assert.equal(body.data.synthetic, true);
      assert.equal(body.data.displayMarker, '[합성]');
    }
  });

  test('requires the exact session header and bounded synthetic case IDs', async () => {
    const missing = await request('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001');
    assert.equal(missing.response.status, 200);

    const invalid = await mutation('/api/v1/contact-ops/cases/real-person/contact-results', {
      expected_revision: 0, contact_date: '2026-08-12', contact_result: 'no_answer', observations,
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, 'INVALID_PATH');

    const noSession = await request('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: 0, contact_date: '2026-08-12', contact_result: 'no_answer', observations }),
    });
    assert.equal(noSession.response.status, 400);
    assert.equal(noSession.body.error.code, 'INVALID_SESSION');
  });

  test('validates JSON and content type before any mutation service call', async () => {
    const beforeCalls = calls.length;
    const malformed = await mutation('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', '{');
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.body.error.code, 'INVALID_JSON');

    const wrongType = await request('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', {
      method: 'POST', headers: { 'X-Demo-Session-ID': 'p1-http-session-01', 'Content-Type': 'text/plain' }, body: '{}',
    });
    assert.equal(wrongType.response.status, 415);
    assert.equal(wrongType.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(calls.length, beforeCalls);
  });

  test('maps exact mutation body fields and keeps non-synthetic payloads out', async () => {
    const ok = await mutation('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', {
      expected_revision: 0, contact_date: '2026-08-12', contact_result: 'no_answer', observations,
    });
    assert.equal(ok.response.status, 200);
    assert.equal(calls.at(-1)[0], 'contact');
    assert.equal(calls.at(-1)[1].expectedRevision, 0);

    const nonSynthetic = await mutation('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', {
      expected_revision: 1, contact_date: '2026-08-12', contact_result: 'no_answer', observations, synthetic: false,
    });
    assert.equal(nonSynthetic.response.status, 400);
    assert.equal(nonSynthetic.body.error.code, 'INVALID_BODY');
  });

  test('supports the remaining exact mutation paths and POST preflight only', async () => {
    const base = { expected_revision: 0 };
    for (const [suffix, body] of [
      ['/triage/recalculate', { ...base, reference_date: '2026-08-12' }],
      ['/visit-decisions', { ...base, decision: 'rejected', decided_by: 'manager', decided_at: '2026-08-12T09:00:00Z', note: 'demo' }],
    ]) {
      const result = await mutation(`/api/v1/contact-ops/cases/SYN-HH-2812551000-0001${suffix}`, body);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.data.synthetic, true);
    }
    const ai = await mutation('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/ai-observations', { ...base, consented_masked_text: 'synthetic observation' });
    assert.equal(ai.response.status, 501);
    assert.equal(ai.body.error.code, 'FEATURE_NOT_AVAILABLE');
    const preflight = await request('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', {
      method: 'OPTIONS', headers: {
        Origin: 'https://care.example', 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-demo-session-id',
      },
    });
    assert.equal(preflight.response.status, 204);
    assert.match(preflight.response.headers.get('access-control-allow-methods'), /POST/);
  });

  test('keeps static map reads available when the ContactOps service is unavailable', async () => {
    const unavailable = createApiServer({ store, contactOpsService: null, rateLimitPerMinute: 0 });
    await new Promise((resolve, reject) => {
      unavailable.once('error', reject); unavailable.listen(0, '127.0.0.1', resolve);
    });
    const port = unavailable.address().port;
    const summary = await fetch(`http://127.0.0.1:${port}/api/v1/summary`);
    const ops = await fetch(`http://127.0.0.1:${port}/api/v1/contact-ops/cases/SYN-HH-2812551000-0001`);
    assert.equal(summary.status, 200);
    assert.equal(ops.status, 503);
    await new Promise((resolve) => unavailable.close(resolve));
  });

  test('returns frozen 400, 404, and 409 service errors without breaking the JSON envelope', async () => {
    const errors = createApiServer({ store, rateLimitPerMinute: 0, contactOpsService: {
      ...contactOpsService,
      async getCase() { const error = new Error('missing'); error.code = 'CASE_NOT_FOUND'; throw error; },
      async recordContactResult() { const error = new Error('stale'); error.code = 'STATE_CONFLICT'; throw error; },
      async getVisitRecommendations() { throw new TypeError('bad district'); },
    } });
    await new Promise((resolve, reject) => { errors.once('error', reject); errors.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${errors.address().port}`;
    const headers = { 'X-Demo-Session-ID': 'p1-http-session-01', 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${origin}/api/v1/contact-ops/cases/SYN-HH-2812551000-0001`, { headers })).status, 404);
    assert.equal((await fetch(`${origin}/api/v1/contact-ops/visit-recommendations?district=x`, { headers })).status, 400);
    assert.equal((await fetch(`${origin}/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results`, { method: 'POST', headers, body: JSON.stringify({ expected_revision: 0, contact_date: '2026-08-12', contact_result: 'no_answer', observations }) })).status, 409);
    await new Promise((resolve) => errors.close(resolve));
  });

  test('keeps static map routes strictly GET-only and rejects invalid operation dates and duplicate query inputs', async () => {
    assert.equal((await request('/api/v1/summary', { method: 'POST' })).response.status, 405);
    assert.equal((await request('/api/v1/contact-ops/today?referenceDate=2026-02-31')).response.status, 400);
    assert.equal((await request('/api/v1/contact-ops/today?referenceDate=2026-08-12&referenceDate=2026-08-13')).response.status, 400);
  });
});
