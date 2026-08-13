import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createApiServer } from '../src/app.mjs';
import { createContactOpsService } from '../src/contact-ops-service.mjs';
import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';
import { createDataStore } from '../src/data-store.mjs';
import { createThreeTierService } from '../src/three-tier-service.mjs';

const REFERENCE_DATE = '2026-08-12';

function household(id, overrides = {}) {
  const dongCode = id.slice(7, 17);
  const jemulpo = dongCode === '2812551000';
  return {
    id,
    synthetic: true,
    location: {
      current_admin_dong_code_20260701: dongCode,
      current_admin_dong_name_20260701: jemulpo ? '신포동' : '삼산1동',
      current_district_name_20260701: jemulpo ? '제물포구' : '부평구',
      geometry_zone_id: jemulpo ? 'vworld_sgis_20250630:23010530' : 'vworld_sgis_20250630:23060110',
      latitude: 37.46, longitude: 126.61,
      road_address: jemulpo ? '인천광역시 제물포구 답동로 7-2' : '인천광역시 부평구 삼산로 11',
      building_name: '', apartment_reference: false, not_real_resident: true,
      ...overrides.location,
    },
    contact: {
      next_contact_date: REFERENCE_DATE, preferred_contact_method: 'phone',
      contact_cadence_days: 7, last_contact_date: '2026-08-11',
      last_contact_result: 'no_answer', consecutive_no_answer_count: 1,
      ...overrides.contact,
    },
    visit_context: {
      preferred_visit_time_window: { start: '13:00', end: '16:00' },
      preferred_worker_gender: 'any', stairs_present: false,
      service_duration_minutes: 40, requires_two_person_team: false,
      requires_public_official_companion: true,
      ...overrides.visit_context,
    },
    workflow: {
      follow_up_deadline: null, follow_up_status: 'none',
      visit_approval_status: null, transfer_status: 'not_required', visit_decision: null,
      ...overrides.workflow,
    },
    approved_visit_constraints: overrides.approved_visit_constraints ?? null,
  };
}

const households = [
  household('SYN-HH-2812551000-0001'),
  household('SYN-HH-2812551000-0002', { contact: { preferred_contact_method: 'visit' } }),
  household('SYN-HH-2812551000-0003', { contact: { next_contact_date: '2026-08-20' } }),
  household('SYN-HH-2826051000-0001'),
];

const workers = [
  {
    id: 'SYN-W-2812551000-01', synthetic: true, display_name: '연결단원 001', role: 'neighbor_connector',
    location: { current_admin_dong_code_20260701: '2812551000', current_admin_dong_name_20260701: '신포동', current_district_name_20260701: '제물포구', latitude: 37.47, longitude: 126.62 },
    constraints: { stairs_allowed: true, available_time_window: { start: '13:00', end: '17:00' }, max_daily_approved_visits: 2, assigned_admin_dong_codes_20260701: ['2812551000'], travel_modes: ['walking'] },
  },
  {
    id: 'SYN-W-2826051000-01', synthetic: true, display_name: '연결단원 002', role: 'neighbor_connector',
    location: { current_admin_dong_code_20260701: '2826051000', current_admin_dong_name_20260701: '삼산1동', current_district_name_20260701: '부평구', latitude: 37.5, longitude: 126.72 },
    constraints: { stairs_allowed: true, available_time_window: { start: '09:00', end: '18:00' }, max_daily_approved_visits: 2, assigned_admin_dong_codes_20260701: ['2826051000'], travel_modes: ['walking'] },
  },
];

const store = createDataStore({
  summary: {
    schemaVersion: 1,
    counts: {},
    distributions: { facilityDistrict: { 제물포구: 171, 부평구: 390 } },
  },
  zones: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[126.5, 37.4], [126.7, 37.4], [126.7, 37.5], [126.5, 37.4]]] }, properties: { geometry_zone_id: 'vworld_sgis_20250630:23010530', current_district_name_20260701: '제물포구', total_population: 10000, population_age_65_plus: 2000, total_households: 5000, one_person_households: 1500, one_person_households_age_65_plus: 648 } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[126.7, 37.5], [126.8, 37.5], [126.8, 37.6], [126.7, 37.5]]] }, properties: { geometry_zone_id: 'vworld_sgis_20250630:23060110', current_district_name_20260701: '부평구', total_population: 20000, population_age_65_plus: 3000, total_households: 8000, one_person_households: 2000, one_person_households_age_65_plus: 700 } },
    ],
  },
  facilities: { type: 'FeatureCollection', features: [] },
  transit: { type: 'FeatureCollection', features: [] },
  validation: { status: 'pass' },
});

const structuralContext = {
  zones: [
    { geometry_zone_id: 'vworld_sgis_20250630:23010530', score_0_50: 20, indicators: { older_population_share: { contribution: 5 }, one_person_household_share: { contribution: 5 }, residential_building_30_plus_share: { contribution: 5 }, basic_livelihood_context_density: { contribution: 5, raw_numerator: 100, raw_denominator: 2000, missing: false } } },
    { geometry_zone_id: 'vworld_sgis_20250630:23060110', score_0_50: 30, indicators: { older_population_share: { contribution: 10 }, one_person_household_share: { contribution: 10 }, residential_building_30_plus_share: { contribution: 10 }, basic_livelihood_context_density: { contribution: 0, raw_numerator: null, raw_denominator: null, missing: true } } },
  ],
};

let server;
let baseUrl;

const fakeOperationsMap = {
  synthetic: true,
  displayMarker: '[합성]',
  geometry_zone_count: 2,
  current_admin_dong_count: 2,
  zones: [{
    geometry_zone_id: 'vworld_sgis_20250630:23010530',
    operations: {
      acute_color_metric: 62,
      acute_max_case_id: 'SYN-HH-2812551000-0001',
      vulnerability_size_metric: 25,
      vulnerability_max_case_id: 'SYN-HH-2812551000-0001',
      scored_case_count: 1,
    },
  }],
};

before(async () => {
  const state = createMemoryContactOpsState({ households });
  server = createApiServer({
    store,
    contactOpsService: createContactOpsService({ state }),
    threeTierService: createThreeTierService({
      state, store, structuralContext, workers,
      operationsMapProvider: async () => structuredClone(fakeOperationsMap),
      now: () => '2026-08-12T09:00:00.000Z',
    }),
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

async function get(path, session) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'X-Demo-Session-ID': session } });
  return { response, body: await response.json() };
}

async function post(path, body, session, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Session-ID': session, ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

const concernObservations = {
  관찰_6징후: { 우편물_고지서_적체: true, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
  식사상태: '심각', 위생상태: null, 공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
};

describe('three-tier today lanes API', () => {
  const session = 'three-tier-lanes-session-01';

  test('auto-assigns phone work and gates visits behind center confirm-or-escalate (배정 파이프라인)', async () => {
    const before = await get(`/api/v1/contact-ops/three-tier/today-lanes?referenceDate=${REFERENCE_DATE}&workerId=SYN-W-2812551000-01`, session);
    assert.equal(before.response.status, 200);
    assert.deepEqual(before.body.data.lanes.phone.map((item) => item.case_id), ['SYN-HH-2812551000-0001']);
    assert.deepEqual(before.body.data.lanes.visit, []);
    assert.deepEqual(before.body.data.pending_confirmation, { phone: 0, visit: 1 });
    assert.equal(before.body.data.assignment_rule, '전화는 자동 배정 · 방문은 동 행정복지센터 확인 또는 상급기관 신고');

    const confirm = await post('/api/v1/contact-ops/three-tier/assignment-confirmations', {
      dong_code: '2812551000', reference_date: REFERENCE_DATE, confirmed_by: '동센터 담당자', case_ids: null,
    }, session);
    assert.equal(confirm.response.status, 200);

    const { response, body } = await get(`/api/v1/contact-ops/three-tier/today-lanes?referenceDate=${REFERENCE_DATE}&workerId=SYN-W-2812551000-01`, session);
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.pending_confirmation, { phone: 0, visit: 0 });
    const lanes = body.data.lanes;
    assert.deepEqual(lanes.phone.map((item) => item.case_id), ['SYN-HH-2812551000-0001']);
    assert.deepEqual(lanes.visit.map((item) => item.case_id), ['SYN-HH-2812551000-0002']);
    assert.equal(body.data.lane_rule, '방문 레인에는 승인된 방문 또는 방문 선호 예정 업무만 포함');
    for (const item of [...lanes.phone, ...lanes.visit]) {
      assert.match(item.virtual_phone.display_number, /^010-0000-\d{4}$/);
      assert.equal(item.virtual_phone.label, '[가상]');
      assert.equal(item.virtual_phone.dialable, false);
      assert.equal(item.location.address_note, '공공 주거용 건물 주소 참조 · 실제 거주자와 연결되지 않음');
      assert.equal(item.location.road_address, '인천광역시 제물포구 답동로 7-2');
      assert.equal(item.location.building_name, null);
      assert.equal(item.last_contact.result_label, '연락 안 됨');
    }
    assert.equal(lanes.phone[0].visit_context, undefined);
    assert.deepEqual(lanes.visit[0].visit_context.preferred_visit_time_window, { start: '13:00', end: '16:00' });
    assert.equal(lanes.visit[0].visit_context.requires_public_official_companion, true);
  });

  test('validates worker and date query parameters', async () => {
    const badWorker = await get(`/api/v1/contact-ops/three-tier/today-lanes?referenceDate=${REFERENCE_DATE}&workerId=real-worker`, session);
    assert.equal(badWorker.response.status, 400);
    const missingWorker = await get(`/api/v1/contact-ops/three-tier/today-lanes?referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(missingWorker.response.status, 400);
    const badDate = await get('/api/v1/contact-ops/three-tier/today-lanes?referenceDate=today&workerId=SYN-W-2812551000-01', session);
    assert.equal(badDate.response.status, 400);
    const unknownWorker = await get(`/api/v1/contact-ops/three-tier/today-lanes?referenceDate=${REFERENCE_DATE}&workerId=SYN-W-9999999999-01`, session);
    assert.equal(unknownWorker.response.status, 400);
    const extraQuery = await get(`/api/v1/contact-ops/three-tier/today-lanes?referenceDate=${REFERENCE_DATE}&workerId=SYN-W-2812551000-01&x=1`, session);
    assert.equal(extraQuery.response.status, 400);
  });

  test('an escalated visit case leaves the surveyor lanes and records the rule-table agency', async () => {
    const escalationSession = 'three-tier-escalation-session-01';
    const confirm = await post('/api/v1/contact-ops/three-tier/assignment-confirmations', {
      dong_code: '2812551000', reference_date: REFERENCE_DATE, confirmed_by: '동센터 담당자', case_ids: null,
    }, escalationSession);
    assert.equal(confirm.response.status, 200);

    const escalate = await post('/api/v1/contact-ops/three-tier/escalations', {
      case_id: 'SYN-HH-2812551000-0002', reported_by: '동센터 담당자',
    }, escalationSession);
    assert.equal(escalate.response.status, 200);
    assert.equal(escalate.body.data.escalation.status, '신고됨');
    assert.equal(typeof escalate.body.data.escalation.agency, 'string');
    assert.equal(escalate.body.data.escalation.reported_by, '동센터 담당자');

    const after = await get(`/api/v1/contact-ops/three-tier/today-lanes?referenceDate=${REFERENCE_DATE}&workerId=SYN-W-2812551000-01`, escalationSession);
    assert.deepEqual(after.body.data.lanes.visit, []);
    assert.deepEqual(after.body.data.lanes.phone.map((item) => item.case_id), ['SYN-HH-2812551000-0001']);
    assert.deepEqual(after.body.data.pending_confirmation, { phone: 0, visit: 0 });

    const inbox = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=2812551000&referenceDate=${REFERENCE_DATE}`, escalationSession);
    const visitRow = inbox.body.data.assignment_proposal.lanes.visit
      .find((proposal) => proposal.case_id === 'SYN-HH-2812551000-0002');
    assert.equal(visitRow.escalation.status, '신고됨');
    assert.equal(inbox.body.data.assignment_proposal.lanes.phone[0].escalation, undefined);

    const badCase = await post('/api/v1/contact-ops/three-tier/escalations', {
      case_id: 'not-a-case', reported_by: '동센터 담당자',
    }, escalationSession);
    assert.equal(badCase.response.status, 400);
    const noActor = await post('/api/v1/contact-ops/three-tier/escalations', {
      case_id: 'SYN-HH-2812551000-0002', reported_by: '',
    }, escalationSession);
    assert.equal(noActor.response.status, 400);
  });
});

describe('three-tier center inbox and explicit confirmations (INV14)', () => {
  const session = 'three-tier-center-session-01';

  test('walks 제출 → 보고 카드 → 명시적 확인 → 완료율 반영', async () => {
    const empty = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=2812551000&referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(empty.response.status, 200);
    assert.equal(empty.body.data.audience, '동 행정복지센터용');
    assert.equal(empty.body.data.report_cards.length, 0);
    assert.equal(empty.body.data.summary.처리_완료율_pct, null);
    assert.equal(empty.body.data.assignment_proposal.status, 'proposed');

    const recorded = await post('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', {
      expected_revision: 0, contact_date: REFERENCE_DATE, contact_result: 'no_answer', observations: concernObservations,
    }, session);
    assert.equal(recorded.response.status, 200);
    assert.equal(recorded.body.data.triage.급성도_점수, 62);
    const secondRecord = await post('/api/v1/contact-ops/cases/SYN-HH-2812551000-0002/contact-results', {
      expected_revision: 0,
      contact_date: REFERENCE_DATE,
      contact_result: 'connected_ok',
      observations: {
        관찰_6징후: { 우편물_고지서_적체: false, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
        식사상태: '양호', 위생상태: '양호', 공과금_2개월_이상_체납: false,
        최근_건강_정신_괴로움: false, 관계망_유무: '있음', 연락_빈도: '주_1회_이상',
      },
    }, session);
    assert.equal(secondRecord.response.status, 200);

    const inbox = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=2812551000&referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(inbox.body.data.report_cards.length, 2);
    const card = inbox.body.data.report_cards[0];
    assert.deepEqual(inbox.body.data.report_cards.map((item) => item.등급), ['방문권고', '정상'],
      'inbox sorts report cards by acute score descending');
    // 전화 확인 / 방문 확인 분리: 전화 업무 보고는 phone, 방문 선호 업무 보고는 visit
    assert.deepEqual(inbox.body.data.report_cards.map((item) => item.report_lane), ['phone', 'visit']);
    assert.deepEqual(inbox.body.data.report_cards.map((item) => item.escalation), [null, null]);
    assert.equal(card.등급, '방문권고');
    assert.equal(card.acknowledgement.status, '미확인');
    assert.ok(card.권고_기관.some((item) => item.기관 === '보건소·의료 연계'));
    assert.equal(inbox.body.data.summary.보고_대기_수, 2);
    assert.equal(inbox.body.data.summary.방문승인_대기_수, 1);

    const conflict = await post('/api/v1/contact-ops/three-tier/report-acknowledgements', {
      case_id: 'SYN-HH-2812551000-0001', expected_revision: 0, acknowledged_by: '동센터 담당자',
    }, session);
    assert.equal(conflict.response.status, 409);

    const acknowledged = await post('/api/v1/contact-ops/three-tier/report-acknowledgements', {
      case_id: 'SYN-HH-2812551000-0001', expected_revision: 1, acknowledged_by: '동센터 담당자',
    }, session);
    assert.equal(acknowledged.response.status, 200);
    assert.deepEqual(acknowledged.body.data.acknowledgement, {
      status: '확인', acknowledged_by: '동센터 담당자',
      acknowledged_at: '2026-08-12T09:00:00.000Z', revision: 1,
    });

    const done = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=2812551000&referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(done.body.data.summary.처리_완료율_pct, 50);
    assert.equal(done.body.data.summary.보고_확인_수, 1);
    assert.equal(done.body.data.report_cards[0].acknowledgement.status, '확인');
    assert.equal(done.body.data.report_cards[1].acknowledgement.status, '미확인');

    const preview = await get('/api/v1/contact-ops/three-tier/report-cards/SYN-HH-2812551000-0001', session);
    assert.equal(preview.response.status, 200);
    assert.equal(preview.body.data.destination, '동 행정복지센터 인박스');
    assert.equal(preview.body.data.report_card.acknowledgement.status, '확인');
  });

  test('rejects acknowledgements without a report card and confirms assignments explicitly', async () => {
    const fresh = 'three-tier-center-session-02';
    const unrecorded = await post('/api/v1/contact-ops/three-tier/report-acknowledgements', {
      case_id: 'SYN-HH-2812551000-0002', expected_revision: 0, acknowledged_by: '동센터 담당자',
    }, fresh);
    assert.equal(unrecorded.response.status, 400);

    const confirmAll = await post('/api/v1/contact-ops/three-tier/assignment-confirmations', {
      dong_code: '2812551000', reference_date: REFERENCE_DATE, confirmed_by: '동센터 담당자', case_ids: null,
    }, fresh);
    assert.equal(confirmAll.response.status, 200);
    assert.equal(confirmAll.body.data.assignment_proposal.status, 'confirmed');
    for (const lane of ['phone', 'visit']) {
      for (const proposal of confirmAll.body.data.assignment_proposal.lanes[lane]) {
        assert.equal(proposal.status, 'confirmed');
        assert.equal(proposal.confirmed_by, '동센터 담당자');
        assert.equal(proposal.confirmed_at, '2026-08-12T09:00:00.000Z');
      }
    }

    const partialSession = 'three-tier-center-session-03';
    const partial = await post('/api/v1/contact-ops/three-tier/assignment-confirmations', {
      dong_code: '2812551000', reference_date: REFERENCE_DATE, confirmed_by: '동센터 담당자', case_ids: ['SYN-HH-2812551000-0001'],
    }, partialSession);
    assert.equal(partial.body.data.assignment_proposal.status, 'partially_confirmed');
    assert.equal(partial.body.data.assignment_proposal.confirmed_count, 1);
    const lanes = partial.body.data.assignment_proposal.lanes;
    assert.equal(lanes.phone[0].status, 'confirmed');
    assert.equal(lanes.visit[0].status, 'proposed');

    const badCase = await post('/api/v1/contact-ops/three-tier/assignment-confirmations', {
      dong_code: '2812551000', reference_date: REFERENCE_DATE, confirmed_by: '동센터 담당자', case_ids: ['SYN-HH-2826051000-0001'],
    }, partialSession);
    assert.equal(badCase.response.status, 400);
    const noActor = await post('/api/v1/contact-ops/three-tier/assignment-confirmations', {
      dong_code: '2812551000', reference_date: REFERENCE_DATE, confirmed_by: ' ', case_ids: null,
    }, partialSession);
    assert.equal(noActor.response.status, 400);
    const badDong = await post('/api/v1/contact-ops/three-tier/assignment-confirmations', {
      dong_code: '12', reference_date: REFERENCE_DATE, confirmed_by: '동센터 담당자', case_ids: null,
    }, partialSession);
    assert.equal(badDong.response.status, 400);
  });

  test('proposals appearing after a confirm-all still require explicit confirmation (INV14)', async () => {
    const late = 'three-tier-center-session-05';
    const confirmAll = await post('/api/v1/contact-ops/three-tier/assignment-confirmations', {
      dong_code: '2812551000', reference_date: REFERENCE_DATE, confirmed_by: '동센터 담당자', case_ids: null,
    }, late);
    assert.equal(confirmAll.body.data.assignment_proposal.status, 'confirmed');

    const recorded = await post('/api/v1/contact-ops/cases/SYN-HH-2812551000-0003/contact-results', {
      expected_revision: 0, contact_date: REFERENCE_DATE, contact_result: 'no_answer', observations: concernObservations,
    }, late);
    assert.equal(recorded.response.status, 200);
    assert.equal(recorded.body.data.household.workflow.visit_approval_status, 'recommended');
    const approved = await post('/api/v1/contact-ops/cases/SYN-HH-2812551000-0003/visit-decisions', {
      expected_revision: 1, decision: 'approved', decided_by: 'synthetic-manager',
      decided_at: `${REFERENCE_DATE}T09:00:00Z`, note: '합성 검증',
      assigned_worker_ids: ['SYN-W-2812551000-01'], max_route_distance_km: 2,
    }, late);
    assert.equal(approved.response.status, 200);

    const inbox = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=2812551000&referenceDate=${REFERENCE_DATE}`, late);
    const proposal = inbox.body.data.assignment_proposal;
    assert.equal(proposal.status, 'partially_confirmed',
      'a proposal that entered the batch after confirm-all must not be auto-confirmed');
    const lateVisit = proposal.lanes.visit.find((item) => item.case_id === 'SYN-HH-2812551000-0003');
    assert.equal(lateVisit.approved_visit, true);
    assert.equal(lateVisit.status, 'proposed');
    for (const item of [...proposal.lanes.phone, ...proposal.lanes.visit]) {
      if (item.case_id !== 'SYN-HH-2812551000-0003') assert.equal(item.status, 'confirmed');
    }
  });

  test('a new report revision resets the acknowledgement to 미확인 (INV14)', async () => {
    const session = 'three-tier-center-session-06';
    await post('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', {
      expected_revision: 0, contact_date: REFERENCE_DATE, contact_result: 'no_answer', observations: concernObservations,
    }, session);
    const acknowledged = await post('/api/v1/contact-ops/three-tier/report-acknowledgements', {
      case_id: 'SYN-HH-2812551000-0001', expected_revision: 1, acknowledged_by: '동센터 담당자',
    }, session);
    assert.equal(acknowledged.response.status, 200);
    const before = await get('/api/v1/contact-ops/three-tier/report-cards/SYN-HH-2812551000-0001', session);
    assert.equal(before.body.data.report_card.acknowledgement.status, '확인');

    const again = await post('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/contact-results', {
      expected_revision: 1, contact_date: REFERENCE_DATE, contact_result: 'connected_concern', observations: concernObservations,
    }, session);
    assert.equal(again.response.status, 200);
    const after = await get('/api/v1/contact-ops/three-tier/report-cards/SYN-HH-2812551000-0001', session);
    assert.equal(after.body.data.report_card.revision, 2);
    assert.equal(after.body.data.report_card.acknowledgement.status, '미확인',
      'an unreviewed new report must not inherit an old acknowledgement');
    const inbox = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=2812551000&referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(inbox.body.data.summary.보고_확인_수, 0);
  });

  test('fresh sessions always restart from proposal state (INV14)', async () => {
    const fresh = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=2812551000&referenceDate=${REFERENCE_DATE}`, 'three-tier-center-session-04');
    assert.equal(fresh.body.data.assignment_proposal.status, 'proposed');
    assert.equal(fresh.body.data.report_cards.length, 0);
  });

  test('rejects unknown dong codes and malformed inbox queries', async () => {
    const unknown = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=9999999999&referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(unknown.response.status, 400);
    const shortCode = await get(`/api/v1/contact-ops/three-tier/center-inbox?dongCode=12&referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(shortCode.response.status, 400);
    const badBody = await post('/api/v1/contact-ops/three-tier/report-acknowledgements', { case_id: 'SYN-HH-2812551000-0001' }, session);
    assert.equal(badBody.response.status, 400);
    const badCaseId = await post('/api/v1/contact-ops/three-tier/report-acknowledgements', {
      case_id: 'nope', expected_revision: 1, acknowledged_by: '동센터 담당자',
    }, session);
    assert.equal(badCaseId.response.status, 400);
    const badRevision = await post('/api/v1/contact-ops/three-tier/report-acknowledgements', {
      case_id: 'SYN-HH-2812551000-0001', expected_revision: -1, acknowledged_by: '동센터 담당자',
    }, session);
    assert.equal(badRevision.response.status, 400);
  });
});

describe('three-tier district rollups (INV17) and AI summary (INV19)', () => {
  const session = 'three-tier-city-session-01';

  test('district aggregates expose rollups only, never case identifiers', async () => {
    const { response, body } = await get(`/api/v1/contact-ops/three-tier/district-aggregates?referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(response.status, 200);
    const raw = JSON.stringify(body.data);
    assert.equal(/SYN-HH-/.test(raw), false, 'city rollups must not contain case IDs');
    assert.equal(body.data.case_detail_access, 'none_district_rollup_only');
    assert.deepEqual(body.data.districts.map((item) => item.district), ['부평구', '제물포구']);
    assert.equal(body.data.staffing_review.title, '증원 검토 후보');
    assert.equal(body.data.staffing_review.composite_score, null);
    const jemulpo = body.data.districts.find((item) => item.district === '제물포구');
    assert.equal(jemulpo.structure.welfare_facility_count, 171);
    assert.equal(jemulpo.operations.worker_count, 1);
  });

  test('city operations map strips zone max-case IDs at the API layer (INV17)', async () => {
    const { response, body } = await get('/api/v1/contact-ops/three-tier/city-operations-map', session);
    assert.equal(response.status, 200);
    const raw = JSON.stringify(body.data);
    assert.equal(/SYN-HH-/.test(raw), false, 'city operations map must not carry case IDs');
    assert.equal(body.data.case_detail_access, 'none_district_rollup_only');
    assert.equal(body.data.zones.length, 1);
    assert.equal(body.data.zones[0].operations.acute_color_metric, 62);
    assert.equal('acute_max_case_id' in body.data.zones[0].operations, false);
    assert.equal('vulnerability_max_case_id' in body.data.zones[0].operations, false);
    const extraQuery = await get('/api/v1/contact-ops/three-tier/city-operations-map?x=1', session);
    assert.equal(extraQuery.response.status, 400);
  });

  test('city operations map reports 400 when no provider is wired', async () => {
    const state = createMemoryContactOpsState({ households });
    const bare = createThreeTierService({ state, store, structuralContext, workers });
    await assert.rejects(
      () => bare.getCityOperationsMap({ sessionId: 'three-tier-city-session-02' }),
      TypeError,
    );
  });

  test('district AI summary quotes injected aggregates deterministically with the required label', async () => {
    const first = await get(`/api/v1/contact-ops/three-tier/district-ai-summary?district=${encodeURIComponent('제물포구')}&referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(first.response.status, 200);
    assert.equal(first.body.data.label, '[AI 생성 · 관측 집계 해석 · 개인 예측 아님]');
    assert.equal(first.body.data.generator, 'codex_authored_v1');
    assert.match(first.body.data.summary_text, /제물포구/);
    assert.ok(first.body.data.summary_text.includes(first.body.data.input_metrics.노인인구_비율_퍼센트));
    assert.ok(first.body.data.mixed_snapshot_warnings.length === 2);
    const second = await get(`/api/v1/contact-ops/three-tier/district-ai-summary?district=${encodeURIComponent('제물포구')}&referenceDate=${REFERENCE_DATE}`, session);
    assert.deepEqual(first.body.data, second.body.data);
    const unknown = await get(`/api/v1/contact-ops/three-tier/district-ai-summary?district=${encodeURIComponent('없는구')}&referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(unknown.response.status, 400);
    const missingDistrict = await get(`/api/v1/contact-ops/three-tier/district-ai-summary?referenceDate=${REFERENCE_DATE}`, session);
    assert.equal(missingDistrict.response.status, 400);
  });
});

describe('three-tier route guards', () => {
  test('unknown routes, methods, and content types fail loudly', async () => {
    const session = 'three-tier-guard-session-01';
    const unknown = await get('/api/v1/contact-ops/three-tier/unknown', session);
    assert.equal(unknown.response.status, 404);
    const unknownPost = await post('/api/v1/contact-ops/three-tier/unknown', {}, session);
    assert.equal(unknownPost.response.status, 404);
    const wrongType = await fetch(`${baseUrl}/api/v1/contact-ops/three-tier/assignment-confirmations`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Demo-Session-ID': session }, body: 'x',
    });
    assert.equal(wrongType.status, 415);
    const wrongMethod = await fetch(`${baseUrl}/api/v1/contact-ops/three-tier/center-inbox`, { method: 'PUT', headers: { 'X-Demo-Session-ID': session } });
    assert.equal(wrongMethod.status, 405);
    const badReportCase = await get('/api/v1/contact-ops/three-tier/report-cards/not-a-case', session);
    assert.equal(badReportCase.response.status, 400);
    const unrecordedCard = await get('/api/v1/contact-ops/three-tier/report-cards/SYN-HH-2812551000-0002', session);
    assert.equal(unrecordedCard.response.status, 400);
  });

  test('reports 503 when the three-tier adapter is not wired', async () => {
    const bare = createApiServer({ store, contactOpsService: null, rateLimitPerMinute: 0 });
    await new Promise((resolve, reject) => {
      bare.once('error', reject);
      bare.listen(0, '127.0.0.1', resolve);
    });
    const port = bare.address().port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/contact-ops/three-tier/district-aggregates?referenceDate=${REFERENCE_DATE}`);
      assert.equal(response.status, 503);
    } finally {
      await new Promise((resolve) => bare.close(resolve));
    }
  });

  test('service construction validates its dependencies', () => {
    const state = createMemoryContactOpsState({ households });
    assert.throws(() => createThreeTierService({ state: null, store, workers }), TypeError);
    assert.throws(() => createThreeTierService({ state, store: null, workers }), TypeError);
    assert.throws(() => createThreeTierService({ state, store, workers: [] }), TypeError);
  });

  test('records real timestamps when no clock is injected', async () => {
    const state = createMemoryContactOpsState({ households });
    const service = createThreeTierService({ state, store, structuralContext, workers });
    const confirmed = await service.confirmAssignment({
      sessionId: 'three-tier-clock-session-01', dongCode: '2812551000',
      referenceDate: REFERENCE_DATE, confirmedBy: '동센터 담당자', caseIds: null,
    });
    const stamp = confirmed.assignment_proposal.lanes.phone[0].confirmed_at;
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
