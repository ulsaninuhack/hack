import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createApiServer } from '../src/app.mjs';
import { createContactOpsService } from '../src/contact-ops-service.mjs';
import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';
import { createDataStore } from '../src/data-store.mjs';

const CASE_ID = 'SYN-HH-2812551000-0001';
const WORKER_ID = 'SYN-W-2812551000-01';
const SESSION_ID = 'integration-session-alpha';
const OTHER_SESSION_ID = 'integration-session-bravo';

const household = {
  id: CASE_ID,
  synthetic: true,
  location: {
    geometry_zone_id: 'vworld_sgis_20250630:23010530',
    current_admin_dong_code_20260701: '2812551000',
    current_admin_dong_name_20260701: '신포동',
    current_district_name_20260701: '제물포구',
  },
  contact: {
    next_contact_date: '2026-08-12',
    preferred_contact_method: 'phone',
    contact_cadence_days: 7,
    last_contact_date: '2026-08-11',
    last_contact_result: 'no_answer',
    consecutive_no_answer_count: 1,
  },
  workflow: {
    follow_up_deadline: null,
    follow_up_status: 'none',
    visit_approval_status: null,
    transfer_status: 'not_required',
    visit_decision: null,
  },
  approved_visit_constraints: null,
};

const observations = {
  관찰_6징후: {
    우편물_고지서_적체: true,
    악취_벌레: true,
    쓰레기_술병: true,
    인기척_없이_TV_불: false,
    외출_없음: false,
    연락_두절: false,
  },
  식사상태: null,
  위생상태: null,
  공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null,
  관계망_유무: null,
  연락_빈도: null,
};

const unconfirmedObservations = {
  관찰_6징후: {
    우편물_고지서_적체: false,
    악취_벌레: false,
    쓰레기_술병: false,
    인기척_없이_TV_불: false,
    외출_없음: false,
    연락_두절: false,
  },
  식사상태: null,
  위생상태: null,
  공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null,
  관계망_유무: null,
  연락_빈도: null,
};

const mapStore = createDataStore({
  summary: { schemaVersion: 1, project: 'test', metricGuardrail: 'test', counts: {} },
  zones: { type: 'FeatureCollection', features: [] },
  facilities: { type: 'FeatureCollection', features: [] },
  transit: { type: 'FeatureCollection', features: [] },
  validation: { status: 'pass' },
});

let server;
let origin;

before(async () => {
  const state = createMemoryContactOpsState({ households: [household] });
  server = createApiServer({
    store: mapStore,
    contactOpsService: createContactOpsService({ state }),
    rateLimitPerMinute: 0,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve) => server.close(resolve)));

async function request(path, { method = 'GET', sessionId = SESSION_ID, body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      'X-Demo-Session-ID': sessionId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, payload: await response.json() };
}

describe('P1 real HTTP → service → memory-state vertical slice', () => {
  test('reorders through separate scores, conflicts a duplicate, and approves only by manager action', async () => {
    const today = await request(`/api/v1/contact-ops/today?referenceDate=2026-08-12&workerId=${WORKER_ID}`);
    assert.equal(today.response.status, 200);
    assert.equal(today.payload.data.synthetic, true);
    assert.equal(today.payload.data.displayMarker, '[합성]');
    assert.equal(today.payload.data.items[0].household_id, CASE_ID);
    assert.equal(today.payload.data.items[0].revision, 0);

    const contactBody = {
      expected_revision: 0,
      contact_date: '2026-08-12',
      contact_result: 'no_answer',
      observations,
    };
    const contacted = await request(`/api/v1/contact-ops/cases/${CASE_ID}/contact-results`, {
      method: 'POST',
      body: contactBody,
    });
    assert.equal(contacted.response.status, 200);
    assert.equal(contacted.payload.data.revision, 1);
    assert.equal(contacted.payload.data.triage.급성도_점수, 61);
    assert.equal(contacted.payload.data.triage.취약도_점수, 0);
    assert.equal(contacted.payload.data.triage.방문_승인_상태, '권고');
    assert.equal(contacted.payload.data.household.workflow.visit_approval_status, 'recommended');
    assert.equal(JSON.stringify(contacted.payload).includes('종합_점수'), false);

    const duplicate = await request(`/api/v1/contact-ops/cases/${CASE_ID}/contact-results`, {
      method: 'POST',
      body: contactBody,
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.payload.error.code, 'STATE_CONFLICT');

    const approved = await request(`/api/v1/contact-ops/cases/${CASE_ID}/visit-decisions`, {
      method: 'POST',
      body: {
        expected_revision: 1,
        decision: 'approved',
        decided_by: 'synthetic-manager',
        decided_at: '2026-08-12T09:00:00Z',
        note: '합성 시나리오 담당자 승인',
        assigned_worker_ids: [WORKER_ID],
      },
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.data.revision, 2);
    assert.equal(approved.payload.data.household.workflow.visit_approval_status, 'approved');
    assert.equal(approved.payload.data.triage.방문_승인_상태, '승인');
    assert.deepEqual(
      approved.payload.data.household.approved_visit_constraints.assigned_worker_ids,
      [WORKER_ID],
    );

    const isolated = await request(`/api/v1/contact-ops/cases/${CASE_ID}`, {
      sessionId: OTHER_SESSION_ID,
    });
    assert.equal(isolated.response.status, 200);
    assert.equal(isolated.payload.data.revision, 0);
    assert.equal(isolated.payload.data.household.workflow.visit_approval_status, null);
  });

  test('keeps an approved urgent visit grade when refusal yields no confirmable details', async () => {
    const sessionId = 'integration-session-visit-refusal';
    const urgent = await request(`/api/v1/contact-ops/cases/${CASE_ID}/contact-results`, {
      method: 'POST',
      sessionId,
      body: {
        expected_revision: 0,
        contact_date: '2026-08-12',
        contact_result: 'no_answer',
        observations: {
          ...observations,
          관찰_6징후: Object.fromEntries(
            Object.keys(observations.관찰_6징후).map((key) => [key, true]),
          ),
          식사상태: '심각',
        },
      },
    });
    assert.equal(urgent.response.status, 200);
    assert.equal(urgent.payload.data.triage.급성도_등급, '방문권고-우선');
    const urgentScore = urgent.payload.data.triage.급성도_점수;
    const urgentContributions = urgent.payload.data.triage.점수_기여내역;
    const missedCount = urgent.payload.data.household.contact.consecutive_no_answer_count;

    const approved = await request(`/api/v1/contact-ops/cases/${CASE_ID}/visit-decisions`, {
      method: 'POST',
      sessionId,
      body: {
        expected_revision: 1,
        decision: 'approved',
        decided_by: 'synthetic-manager',
        decided_at: '2026-08-12T09:00:00Z',
        note: '시급 방문 승인',
        assigned_worker_ids: [WORKER_ID],
      },
    });
    assert.equal(approved.response.status, 200);

    const refused = await request(`/api/v1/contact-ops/cases/${CASE_ID}/contact-results`, {
      method: 'POST',
      sessionId,
      body: {
        expected_revision: 2,
        contact_date: '2026-08-12',
        contact_result: 'refused',
        observations: unconfirmedObservations,
      },
    });
    assert.equal(refused.response.status, 200);
    assert.equal(refused.payload.data.household.contact.last_contact_result, 'refused');
    assert.equal(refused.payload.data.household.contact.consecutive_no_answer_count, missedCount);
    assert.equal(refused.payload.data.triage.급성도_점수, urgentScore);
    assert.equal(refused.payload.data.triage.급성도_등급, '방문권고-우선');
    assert.deepEqual(refused.payload.data.triage.점수_기여내역, urgentContributions);
    assert.deepEqual(refused.payload.data.observations, urgent.payload.data.observations);
  });
});
