import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';
import { createContactOpsService } from '../src/contact-ops-service.mjs';

function syntheticHousehold(overrides = {}) {
  const base = {
    id: 'SYN-HH-2812551000-0001',
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
  return {
    ...base,
    ...overrides,
    contact: { ...base.contact, ...overrides.contact },
    workflow: { ...base.workflow, ...overrides.workflow },
  };
}
const observations = {
  관찰_6징후: { 우편물_고지서_적체: false, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
  식사상태: null, 위생상태: null, 공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
};

describe('P1 ContactOps service guards', () => {
  test('rejects an invalid state port and malformed six-sign observation DTO', async () => {
    assert.throws(() => createContactOpsService({ state: {} }), /state/);
    const state = createMemoryContactOpsState({ households: [syntheticHousehold()] }); const service = createContactOpsService({ state });
    await assert.rejects(() => service.recordContactResult({ sessionId: 'p1-observation-invalid', caseId: 'SYN-HH-2812551000-0001', expectedRevision: 0, contactDate: '2026-08-12', contactResult: 'no_answer', observations: { ...observations, 관찰_6징후: { ...observations.관찰_6징후, 외출_없음: 'yes' } } }), /six canonical/);
  });
  test('filters today queue by worker dong and exposes separate persisted triage axes', async () => {
    const other = syntheticHousehold({ id: 'SYN-HH-2812552000-0001', location: { geometry_zone_id: 'zone:2', current_admin_dong_code_20260701: '2812552000' } });
    const state = createMemoryContactOpsState({ households: [syntheticHousehold(), other] });
    const service = createContactOpsService({ state });
    const result = await service.getToday({ sessionId: 'p1-today-worker-test', referenceDate: '2026-08-12', workerId: 'SYN-W-2812551000-01' });
    assert.equal(result.items.length, 1); assert.equal(result.items[0].triage.급성도_점수, 0); assert.equal(Object.hasOwn(result.items[0].triage, '종합_점수'), false);
    const all = await service.getToday({ sessionId: 'p1-today-worker-test', referenceDate: '2026-08-12' }); assert.equal(all.items.length, 2);
  });
  test('persists a canonical contact result with a revision, deterministic follow-up, and no composite score or auto-approval', async () => {
    const state = createMemoryContactOpsState({ households: [syntheticHousehold()] });
    const service = createContactOpsService({ state });

    const result = await service.recordContactResult({
      sessionId: 'p1-contract-test',
      caseId: 'SYN-HH-2812551000-0001',
      expectedRevision: 0,
      contactDate: '2026-08-12',
      contactResult: 'no_answer',
      observations,
    });

    assert.equal(result.synthetic, true);
    assert.equal(result.revision, 1);
    assert.equal(result.household.contact.consecutive_no_answer_count, 2);
    assert.equal(result.household.workflow.follow_up_status, 'required');
    assert.equal(result.household.workflow.visit_approval_status, null);
    assert.equal(Object.hasOwn(result, '종합_점수'), false);
  });

  test('does not allow a manager decision before a persisted recommendation', async () => {
    const state = createMemoryContactOpsState({ households: [syntheticHousehold()] });
    const service = createContactOpsService({ state });

    await assert.rejects(
      () => service.recordVisitDecision({
        sessionId: 'p1-manager-guard',
        caseId: 'SYN-HH-2812551000-0001',
        expectedRevision: 0,
        decision: 'approved',
        decidedBy: 'manager-demo',
        decidedAt: '2026-08-12T09:00:00Z',
        note: 'synthetic test',
        assignedWorkerIds: ['SYN-W-2812551000-01'],
        maxRouteDistanceKm: 4,
      }),
      /recommended/i,
    );
  });

  test('records rejection without route constraints after a persisted recommendation', async () => {
    const recommended = syntheticHousehold({
      workflow: { visit_approval_status: 'recommended' },
    });
    const state = createMemoryContactOpsState({ households: [recommended] });
    const service = createContactOpsService({ state });

    const result = await service.recordVisitDecision({
      sessionId: 'p1-rejection-test',
      caseId: 'SYN-HH-2812551000-0001',
      expectedRevision: 0,
      decision: 'rejected',
      decidedBy: 'manager-demo',
      decidedAt: '2026-08-12T09:00:00Z',
      note: 'synthetic test',
    });

    assert.equal(result.revision, 1);
    assert.equal(result.household.workflow.visit_approval_status, 'rejected');
    assert.equal(result.household.approved_visit_constraints, null);
  });

  test('keeps the persisted triage projection aligned with an explicit manager decision', async () => {
    const recommended = syntheticHousehold({
      workflow: { visit_approval_status: 'recommended' },
    });
    const state = createMemoryContactOpsState({ households: [recommended] });
    const key = {
      sessionId: 'p1-triage-decision',
      caseId: recommended.id,
      expectedRevision: 0,
    };
    await state.update(key, (household) => ({
      household,
      triage: { 방문_승인_상태: '권고' },
    }));
    const service = createContactOpsService({ state });

    const result = await service.recordVisitDecision({
      ...key,
      expectedRevision: 1,
      decision: 'rejected',
      decidedBy: 'manager-demo',
      decidedAt: '2026-08-12T09:00:00Z',
      note: 'synthetic test',
    });

    assert.equal(result.household.workflow.visit_approval_status, 'rejected');
    assert.equal(result.triage.방문_승인_상태, '반려');
  });

  test('recalculates persisted canonical observations and only recommends, never approves', async () => {
    const state = createMemoryContactOpsState({ households: [syntheticHousehold()] }); const service = createContactOpsService({ state });
    await service.recordContactResult({ sessionId: 'p1-recalculate-test', caseId: 'SYN-HH-2812551000-0001', expectedRevision: 0, contactDate: '2026-08-12', contactResult: 'no_answer', observations: { ...observations, 관찰_6징후: { ...observations.관찰_6징후, 우편물_고지서_적체: true, 악취_벌레: true, 쓰레기_술병: true } } });
    const result = await service.recalculateTriage({ sessionId: 'p1-recalculate-test', caseId: 'SYN-HH-2812551000-0001', expectedRevision: 1, referenceDate: '2026-08-12' });
    assert.ok(result.triage.급성도_점수 >= 55); assert.equal(result.household.workflow.visit_approval_status, 'recommended');
  });
  test('gets cases, recommendation queue, and rejects malformed observations or unknown districts', async () => {
    const recommended = syntheticHousehold({ workflow: { visit_approval_status: 'recommended' } });
    const state = createMemoryContactOpsState({ households: [recommended] }); const service = createContactOpsService({ state });
    const key = { sessionId: 'p1-service-extra-test', caseId: recommended.id };
    assert.equal((await service.getCase(key)).synthetic, true);
    assert.equal((await service.getVisitRecommendations({ sessionId: key.sessionId })).items.length, 1);
    await assert.rejects(() => service.getVisitRecommendations({ sessionId: key.sessionId, district: 'unknown' }), /district/);
    await assert.rejects(() => service.recordContactResult({ ...key, expectedRevision: 0, contactDate: '2026-08-12', contactResult: 'no_answer', observations: {} }), /observation/);
  });
});
