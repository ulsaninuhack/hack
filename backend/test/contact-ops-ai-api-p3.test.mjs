import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createApiServer } from '../src/app.mjs';
import { createDataStore } from '../src/data-store.mjs';

const CASE_ID = 'SYN-HH-2812551000-0001';
const store = createDataStore({
  summary: { schemaVersion: 1, project: 'test', metricGuardrail: 'test', counts: {} },
  zones: { type: 'FeatureCollection', features: [] },
  facilities: { type: 'FeatureCollection', features: [] },
  transit: { type: 'FeatureCollection', features: [] },
  validation: { status: 'pass' },
});
const calls = [];
const service = {
  async createAiObservation(input) {
    calls.push(input);
    return { synthetic: true, displayMarker: '[합성]', revision: 0, candidate: { confirmed: false } };
  },
};

let server;
let origin;
before(async () => {
  server = createApiServer({ store, contactOpsService: service, rateLimitPerMinute: 0 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));

async function post(body) {
  const response = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/ai-observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': 'p3-ai-http-session' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

describe('P3 AI observation HTTP contract', () => {
  test('maps consented masked text into candidate mode', async () => {
    const result = await post({
      mode: 'candidate', expected_revision: 0, contact_date: '2026-08-12',
      surveyor_id: '연결단원 001', consented_masked_text: `${CASE_ID} 미응답`,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.synthetic, true);
    assert.deepEqual(calls.at(-1).source, { kind: 'text', text: `${CASE_ID} 미응답` });
  });

  test('maps a bounded validated file reference and exact confirmation contract', async () => {
    const audio = await post({
      mode: 'candidate', expected_revision: 0, contact_date: '2026-08-12',
      surveyor_id: '연결단원 001', validated_file_reference: 'contact-0001.wav',
    });
    assert.equal(audio.response.status, 200);
    assert.deepEqual(calls.at(-1).source, { kind: 'audio', fileReference: 'contact-0001.wav' });

    const mobileAudio = await post({
      mode: 'candidate', expected_revision: 0, contact_date: '2026-08-12',
      surveyor_id: '연결단원 001', validated_file_reference: 'contact-0001.m4a',
    });
    assert.equal(mobileAudio.response.status, 200);
    assert.deepEqual(calls.at(-1).source, { kind: 'audio', fileReference: 'contact-0001.m4a' });

    const confirm = await post({
      mode: 'confirm', expected_revision: 0, contact_date: '2026-08-12',
      confirmed: true, candidate: { confirmed: false },
    });
    assert.equal(confirm.response.status, 200);
    assert.equal(calls.at(-1).confirmed, true);
  });

  test('rejects ambiguous sources, path traversal, extra fields, and missing confirmation', async () => {
    for (const body of [
      { mode: 'candidate', expected_revision: 0, contact_date: '2026-08-12', surveyor_id: '연결단원 001', consented_masked_text: 'x', validated_file_reference: 'x.wav' },
      { mode: 'candidate', expected_revision: 0, contact_date: '2026-08-12', surveyor_id: '연결단원 001', validated_file_reference: '../x.wav' },
      { mode: 'candidate', expected_revision: 0, contact_date: '2026-08-12', surveyor_id: '연결단원 001', consented_masked_text: 'x', approval: true },
      { mode: 'confirm', expected_revision: 0, contact_date: '2026-08-12', confirmed: false, candidate: { confirmed: false } },
    ]) {
      const result = await post(body);
      assert.equal(result.response.status, 400);
      assert.equal(result.body.error.code, 'INVALID_BODY');
    }
  });
});
