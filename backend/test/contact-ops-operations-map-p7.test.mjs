import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createApiServer } from '../src/app.mjs';
import { createContactOpsService } from '../src/contact-ops-service.mjs';
import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';
import { createDataStore } from '../src/data-store.mjs';

const sessionId = 'p7-operations-map-session';
function indicators(score) {
  return {
    older_population_share: { contribution: score },
    one_person_household_share: { contribution: 0 },
    residential_building_30_plus_share: { contribution: 0 },
    basic_livelihood_context_density: { contribution: 0 },
  };
}
const structuralContext = {
  schema_version: 'structural-context-p7-v1', model_output_label: '[MODEL OUTPUT — UNVALIDATED]',
  zone_count: 156, current_admin_dong_count: 162,
  zones: [
    { geometry_zone_id: 'zone:one', score_0_50: 21, completeness: { ratio: 1 }, indicators: indicators(21) },
    { geometry_zone_id: 'zone:two', score_0_50: 0, completeness: { ratio: 0 }, indicators: indicators(0) },
    ...Array.from({ length: 154 }, (_, index) => ({ geometry_zone_id: `zone:empty-${index}`, score_0_50: 0, completeness: { ratio: 0 }, indicators: indicators(0) })),
  ],
};
function household(id, zoneId, dong, triage = null) {
  return {
    id, synthetic: true, location: { geometry_zone_id: zoneId, current_admin_dong_code_20260701: dong, current_district_name_20260701: '테스트구', current_admin_dong_name_20260701: '테스트동', latitude: 37.4, longitude: 126.6 },
    contact: { next_contact_date: '2026-08-12', preferred_contact_method: 'phone', contact_cadence_days: 7, last_contact_date: null, last_contact_result: 'not_attempted', consecutive_no_answer_count: 0 },
    workflow: { follow_up_deadline: null, follow_up_status: 'none', visit_approval_status: null, transfer_status: 'not_required', visit_decision: null }, approved_visit_constraints: null,
    __triage: triage,
  };
}
const cases = [
  household('SYN-HH-2812551000-0001', 'zone:one', '2812551000'),
  household('SYN-HH-2812551000-0002', 'zone:one', '2812551000'),
  household('SYN-HH-2812552000-0001', 'zone:two', '2812552000'),
];
const state = createMemoryContactOpsState({ households: cases });
for (const item of cases) {
  if (item.__triage) continue;
}
// State is deliberately wrapped so the test can model persisted scored and unscored records.
const persisted = [
  { synthetic: true, revision: 2, household: cases[0], triage: { 급성도_점수: 75, 취약도_점수: 40, 급성도_등급: '방문권고-우선', 마지막_연결_후_경과일: 2, 점수_기여내역: [{ 축: '급성도', 코드: 'a', 가산점: 75 }, { 축: '취약도', 코드: 'v', 가산점: 40 }] } },
  { synthetic: true, revision: 3, household: cases[1], triage: { 급성도_점수: 75, 취약도_점수: 80, 급성도_등급: '방문권고-우선', 마지막_연결_후_경과일: 4, 점수_기여내역: [{ 축: '급성도', 코드: 'b', 가산점: 75 }, { 축: '취약도', 코드: 'w', 가산점: 80 }] } },
  { synthetic: true, revision: 0, household: cases[2], triage: null },
];
const service = createContactOpsService({
  state: { ...state, async list() { return structuredClone(persisted); } },
  structuralContext,
  scenarioReferenceDate: '2026-08-12',
});
const store = createDataStore({ summary: { schemaVersion: 1 }, zones: { type: 'FeatureCollection', features: [] }, facilities: { type: 'FeatureCollection', features: [] }, transit: { type: 'FeatureCollection', features: [] }, validation: { status: 'pass' } });
let server; let origin;
before(async () => { server = createApiServer({ store, contactOpsService: service, rateLimitPerMinute: 0 }); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); origin = `http://127.0.0.1:${server.address().port}`; });
after(async () => new Promise((resolve) => server.close(resolve)));

describe('P7 operations-map API', () => {
  test('returns every public zone with session scores over a labeled deterministic scenario fallback', async () => {
    const response = await fetch(`${origin}/api/v1/contact-ops/operations-map`, { headers: { 'X-Demo-Session-ID': sessionId } });
    const body = await response.json(); const zones = body.data.zones;
    assert.equal(response.status, 200); assert.equal(body.data.synthetic, true); assert.equal(body.data.displayMarker, '[합성]');
    assert.equal(body.data.geometry_zone_count, 156); assert.equal(body.data.current_admin_dong_count, 162); assert.equal(zones.length, 156);
    const one = zones.find(({ geometry_zone_id }) => geometry_zone_id === 'zone:one');
    assert.equal(one.operations.aggregation, 'zone_max_priority_context');
    assert.equal(one.operations.acute_color_metric, 75); assert.equal(one.operations.vulnerability_size_metric, 80);
    assert.equal(one.operations.acute_max_case_id, 'SYN-HH-2812551000-0001'); assert.equal(one.operations.vulnerability_max_case_id, 'SYN-HH-2812551000-0002');
    assert.equal(one.operations.scored_case_count, 2); assert.equal(one.operations.unscored_case_count, 0);
    assert.equal(one.operations.session_scored_case_count, 2); assert.equal(one.operations.scenario_scored_case_count, 0);
    assert.equal(one.operations.acute_metric_source, 'session_recorded'); assert.equal(one.operations.vulnerability_metric_source, 'session_recorded');
    const two = zones.find(({ geometry_zone_id }) => geometry_zone_id === 'zone:two');
    assert.equal(Number.isInteger(two.operations.acute_color_metric), true); assert.equal(Number.isInteger(two.operations.vulnerability_size_metric), true);
    assert.equal(two.operations.scenario_label, '[합성 시나리오]'); assert.equal(two.operations.scenario_reference_date, '2026-08-12');
    assert.equal(two.operations.scenario_scored_case_count, 1); assert.equal(two.operations.session_scored_case_count, 0); assert.equal(two.operations.unscored_case_count, 0);
    assert.equal(two.operations.acute_metric_source, 'synthetic_scenario'); assert.equal(two.operations.vulnerability_metric_source, 'synthetic_scenario');
    assert.equal(two.public_structural_context.model_output_label, '[MODEL OUTPUT — UNVALIDATED]');
    assert.equal(body.data.scenario_reference_date, '2026-08-12');
    assert.equal(JSON.stringify(body.data).includes('composite'), false);
  });
  test('accepts no query parameters', async () => {
    assert.equal((await fetch(`${origin}/api/v1/contact-ops/operations-map?x=1`, { headers: { 'X-Demo-Session-ID': sessionId } })).status, 400);
  });
});
