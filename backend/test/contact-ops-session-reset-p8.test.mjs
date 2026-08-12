import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApiServer } from '../src/app.mjs';
import { createContactOpsService } from '../src/contact-ops-service.mjs';
import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';
import { createDataStore } from '../src/data-store.mjs';

const sessionA = 'p8-reset-session-alpha'; const sessionB = 'p8-reset-session-bravo'; const caseId = 'SYN-HH-2812551000-0001';
const household = { id: caseId, synthetic: true, location: { geometry_zone_id: 'zone:one', current_admin_dong_code_20260701: '2812551000', current_district_name_20260701: '테스트구', current_admin_dong_name_20260701: '테스트동', latitude: 37.4, longitude: 126.6 }, contact: { next_contact_date: '2026-08-12', preferred_contact_method: 'phone', contact_cadence_days: 7, last_contact_date: null, last_contact_result: 'not_attempted', consecutive_no_answer_count: 0 }, workflow: { follow_up_deadline: null, follow_up_status: 'none', visit_approval_status: null, transfer_status: 'not_required', visit_decision: null }, approved_visit_constraints: null };
const state = createMemoryContactOpsState({ households: [household] });
const service = createContactOpsService({ state });
const store = createDataStore({ summary: { schemaVersion: 1 }, zones: { type: 'FeatureCollection', features: [] }, facilities: { type: 'FeatureCollection', features: [] }, transit: { type: 'FeatureCollection', features: [] }, validation: { status: 'pass' } });
let server; let origin;
before(async () => { server = createApiServer({ store, contactOpsService: service, rateLimitPerMinute: 0, enableDemoSessionReset: true }); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); origin = `http://127.0.0.1:${server.address().port}`; });
after(async () => new Promise((resolve) => server.close(resolve)));
async function mutate(session, value) { return state.update({ sessionId: session, caseId, expectedRevision: 0 }, (current) => ({ ...current, contact: { ...current.contact, consecutive_no_answer_count: value } })); }

describe('P8 isolated synthetic session reset', () => {
  test('returns only one session to immutable revision-zero seed and is idempotent', async () => {
    await mutate(sessionA, 3); await mutate(sessionB, 4);
    const response = await fetch(`${origin}/api/v1/contact-ops/session-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': sessionA }, body: JSON.stringify({ expected_marker: '[합성]' }) });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.data.synthetic, true); assert.equal(body.data.displayMarker, '[합성]'); assert.equal(body.data.seed_case_count, 1); assert.equal(body.data.reset_override_count, 1);
    assert.equal((await state.get({ sessionId: sessionA, caseId })).revision, 0); assert.equal((await state.get({ sessionId: sessionA, caseId })).household.contact.consecutive_no_answer_count, 0);
    assert.equal((await state.get({ sessionId: sessionB, caseId })).household.contact.consecutive_no_answer_count, 4);
    const again = await fetch(`${origin}/api/v1/contact-ops/session-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': sessionA }, body: JSON.stringify({ expected_marker: '[합성]' }) });
    assert.equal((await again.json()).data.reset_override_count, 0);
  });
  test('requires the exact marker-only body and mutation session header', async () => {
    const wrong = await fetch(`${origin}/api/v1/contact-ops/session-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': sessionA }, body: JSON.stringify({ expected_marker: 'wrong' }) }); assert.equal(wrong.status, 400);
    const extra = await fetch(`${origin}/api/v1/contact-ops/session-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': sessionA }, body: JSON.stringify({ expected_marker: '[합성]', extra: true }) }); assert.equal(extra.status, 400);
    const absent = await fetch(`${origin}/api/v1/contact-ops/session-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_marker: '[합성]' }) }); assert.equal(absent.status, 400);
  });
  test('is absent unless the test-only gate is explicitly enabled', async () => {
    const productionLike = createApiServer({ store, contactOpsService: service, rateLimitPerMinute: 0 });
    await new Promise((resolve, reject) => { productionLike.once('error', reject); productionLike.listen(0, '127.0.0.1', resolve); });
    try {
      const response = await fetch(`http://127.0.0.1:${productionLike.address().port}/api/v1/contact-ops/session-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': sessionA }, body: JSON.stringify({ expected_marker: '[합성]' }) });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, 'NOT_FOUND');
    } finally {
      await new Promise((resolve) => productionLike.close(resolve));
    }
  });
});
