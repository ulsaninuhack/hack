import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createContactOpsService } from '../src/contact-ops-service.mjs';
import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';

const CASE_ID = 'SYN-HH-2812551000-0001';
const SESSION_ID = 'p3-ai-adapter-session';

const household = {
  id: CASE_ID,
  synthetic: true,
  location: {
    geometry_zone_id: 'vworld_sgis_20250630:23010530',
    current_admin_dong_code_20260701: '2812551000',
  },
  contact: {
    next_contact_date: '2026-08-12',
    preferred_contact_method: 'phone',
    contact_cadence_days: 7,
    last_contact_date: '2026-08-05',
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
    악취_벌레: false,
    쓰레기_술병: false,
    인기척_없이_TV_불: false,
    외출_없음: false,
    연락_두절: false,
  },
  식사상태: '심각',
  위생상태: null,
  공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null,
  관계망_유무: null,
  연락_빈도: null,
};

const candidate = {
  case_id: CASE_ID,
  transcript: `${CASE_ID} 오늘 전화를 받지 않았고 우편물이 쌓여 있으며 식사를 못 했습니다.`,
  contact_result: 'no_answer',
  observations,
  free_text: '',
  critic: {
    missing_fields: ['위생상태'],
    contradictions: [],
    low_confidence_fields: [],
    warnings: [],
  },
  stripped_server_owned_fields: ['risk_score', 'visit_recommended'],
  requires_user_confirmation: true,
  confirmed: false,
};

function setup(selectedCandidate = candidate) {
  const calls = [];
  const aiAdapter = {
    async planContactOpsObservation(input) {
      calls.push(['plan', input]);
      return structuredClone(selectedCandidate);
    },
    assertContactOpsObservationCandidate(value) {
      calls.push(['assert', value]);
      if (value?.case_id !== CASE_ID || value?.confirmed !== false) throw new TypeError('invalid AI candidate');
      return structuredClone(value);
    },
  };
  const state = createMemoryContactOpsState({ households: [household] });
  return { calls, service: createContactOpsService({ state, aiAdapter }) };
}

describe('P3 Planner-Critic confirmation boundary', () => {
  test('returns a schema-validated candidate without mutating synthetic case state', async () => {
    const { calls, service } = setup();
    const before = await service.getCase({ sessionId: SESSION_ID, caseId: CASE_ID });
    const result = await service.createAiObservation({
      mode: 'candidate',
      sessionId: SESSION_ID,
      caseId: CASE_ID,
      expectedRevision: 0,
      contactDate: '2026-08-12',
      surveyorId: '연결단원 001',
      source: { kind: 'text', text: candidate.transcript },
    });
    const after = await service.getCase({ sessionId: SESSION_ID, caseId: CASE_ID });

    assert.equal(result.synthetic, true);
    assert.equal(result.displayMarker, '[합성]');
    assert.equal(result.revision, 0);
    assert.deepEqual(result.candidate.critic.missing_fields, ['위생상태']);
    assert.equal(result.candidate.requires_user_confirmation, true);
    assert.equal(result.candidate.confirmed, false);
    assert.equal(Object.hasOwn(result.candidate, 'risk_score'), false);
    assert.equal(Object.hasOwn(result.candidate, 'visit_recommended'), false);
    assert.equal(calls[0][1].caseId, CASE_ID);
    assert.deepEqual(after, before);
  });

  test('requires explicit confirmation before applying canonical facts through existing rules', async () => {
    const { service } = setup();
    await assert.rejects(() => service.createAiObservation({
      mode: 'confirm', sessionId: SESSION_ID, caseId: CASE_ID,
      expectedRevision: 0, contactDate: '2026-08-12', confirmed: false, candidate,
    }), /confirmation/i);

    const result = await service.createAiObservation({
      mode: 'confirm', sessionId: SESSION_ID, caseId: CASE_ID,
      expectedRevision: 0, contactDate: '2026-08-12', confirmed: true, candidate,
    });

    assert.equal(result.revision, 1);
    assert.equal(result.triage.급성도_점수, 62);
    assert.equal(result.household.workflow.visit_approval_status, 'recommended');
    assert.equal(result.triage.방문_승인_상태, '권고');
    assert.equal(Object.hasOwn(result, '종합_점수'), false);
  });

  test('confirmed lying-down and no-network candidates reach the existing scoring engine as 주시', async () => {
    const mappedCandidate = structuredClone(candidate);
    mappedCandidate.contact_result = 'connected_concern';
    mappedCandidate.observations.관찰_6징후.우편물_고지서_적체 = false;
    mappedCandidate.observations.관찰_6징후.외출_없음 = true;
    mappedCandidate.observations.관계망_유무 = '없음';
    const { service } = setup(mappedCandidate);

    const result = await service.createAiObservation({
      mode: 'confirm', sessionId: `${SESSION_ID}-social`, caseId: CASE_ID,
      expectedRevision: 0, contactDate: '2026-08-12', confirmed: true,
      candidate: mappedCandidate,
    });

    assert.equal(result.triage.급성도_점수, 37);
    assert.equal(result.triage.급성도_등급, '주시');
    assert.equal(result.triage.취약도_점수, 25);
    assert.ok(result.triage.점수_기여내역.some(({ 코드 }) => 코드 === '관계망_없음'));
  });

  test('rejects stale candidate generation, mismatched case IDs, and unavailable adapters', async () => {
    const { service } = setup();
    await assert.rejects(() => service.createAiObservation({
      mode: 'candidate', sessionId: SESSION_ID, caseId: CASE_ID,
      expectedRevision: 1, contactDate: '2026-08-12', surveyorId: '연결단원 001',
      source: { kind: 'text', text: candidate.transcript },
    }), (error) => error.code === 'STATE_CONFLICT');
    await assert.rejects(() => service.createAiObservation({
      mode: 'confirm', sessionId: SESSION_ID, caseId: CASE_ID,
      expectedRevision: 0, contactDate: '2026-08-12', confirmed: true,
      candidate: { ...candidate, case_id: 'SYN-HH-2812551000-0002' },
    }), /case|candidate/i);

    const noAdapter = createContactOpsService({ state: createMemoryContactOpsState({ households: [household] }) });
    await assert.rejects(() => noAdapter.createAiObservation({
      mode: 'candidate', sessionId: SESSION_ID, caseId: CASE_ID,
      expectedRevision: 0, contactDate: '2026-08-12', surveyorId: '연결단원 001',
      source: { kind: 'text', text: candidate.transcript },
    }), /AI adapter/i);
  });

  test('converts adapter internals into a generic confirmation-contract error', async () => {
    const state = createMemoryContactOpsState({ households: [household] });
    const service = createContactOpsService({ state, aiAdapter: {
      async planContactOpsObservation() { return candidate; },
      async assertContactOpsObservationCandidate() { throw new Error('raw planner payload detail'); },
    } });
    await assert.rejects(() => service.createAiObservation({
      mode: 'confirm', sessionId: SESSION_ID, caseId: CASE_ID,
      expectedRevision: 0, contactDate: '2026-08-12', confirmed: true, candidate,
    }), (error) => error instanceof TypeError
      && error.message === 'AI candidate failed the confirmation contract');
  });
});
