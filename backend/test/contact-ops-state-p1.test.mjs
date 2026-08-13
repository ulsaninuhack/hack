import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';

function syntheticHousehold(overrides = {}) {
  const base = {
    id: 'SYN-HH-2812551000-0001',
    synthetic: true,
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

function initialContactOpsRecord() {
  return {
    revision: 7,
    household: syntheticHousehold({
      contact: {
        consecutive_no_answer_count: 4,
      },
      workflow: {
        follow_up_status: 'pending',
      },
    }),
    observations: {
      관찰_6징후: { 연락_두절: true },
      식사상태: '확인_필요',
    },
    triage: {
      급성도_점수: 3,
      취약도_점수: 5,
    },
    updated_at: '2026-08-13T00:00:00.000Z',
  };
}

describe('P1 synthetic ContactOps memory state', () => {
  test('namespaces immutable synthetic seed state by opaque demo session and starts at revision zero', async () => {
    const state = createMemoryContactOpsState({ households: [syntheticHousehold()] });

    const first = await state.get({ sessionId: 'demo-session-alpha', caseId: 'SYN-HH-2812551000-0001' });
    const second = await state.get({ sessionId: 'demo-session-bravo', caseId: 'SYN-HH-2812551000-0001' });

    assert.equal(first.revision, 0);
    assert.equal(first.triage, null);
    assert.equal(first.synthetic, true);
    assert.equal(second.revision, 0);
    assert.notStrictEqual(first.household, second.household);
    assert.equal(first.household.id, 'SYN-HH-2812551000-0001');
  });

  test('uses an initial record as the resettable baseline for every untouched session', async () => {
    const baseline = initialContactOpsRecord();
    const state = createMemoryContactOpsState({
      households: [syntheticHousehold()],
      initialRecords: [baseline],
    });

    const untouched = await state.get({
      sessionId: 'memory-baseline-session',
      caseId: baseline.household.id,
    });
    const listed = await state.list({ sessionId: 'memory-baseline-session' });

    assert.equal(untouched.revision, baseline.revision);
    assert.deepEqual(untouched.household, baseline.household);
    assert.deepEqual(untouched.observations, baseline.observations);
    assert.deepEqual(untouched.triage, baseline.triage);
    assert.equal(untouched.updated_at, baseline.updated_at);
    assert.equal(listed[0].revision, baseline.revision);
    assert.deepEqual(listed[0].household, baseline.household);

    const updated = await state.update(
      {
        sessionId: 'memory-baseline-session',
        caseId: baseline.household.id,
        expectedRevision: baseline.revision,
      },
      (current) => ({
        ...current,
        contact: {
          ...current.contact,
          consecutive_no_answer_count: current.contact.consecutive_no_answer_count + 1,
        },
      }),
    );

    assert.equal(updated.revision, baseline.revision + 1);
    assert.equal(updated.household.contact.consecutive_no_answer_count, 5);
    assert.deepEqual(updated.observations, baseline.observations);
    assert.deepEqual(updated.triage, baseline.triage);

    const reset = await state.resetSession({ sessionId: 'memory-baseline-session' });
    const restored = await state.get({
      sessionId: 'memory-baseline-session',
      caseId: baseline.household.id,
    });

    assert.equal(reset.reset_override_count, 1);
    assert.equal(restored.revision, baseline.revision);
    assert.deepEqual(restored.household, baseline.household);
    assert.deepEqual(restored.observations, baseline.observations);
    assert.deepEqual(restored.triage, baseline.triage);
    assert.equal(restored.updated_at, baseline.updated_at);
  });

  test('uses expected_revision to make duplicate mutation submissions conflict instead of double-applying', async () => {
    const state = createMemoryContactOpsState({ households: [syntheticHousehold()] });
    const request = {
      sessionId: 'isolated-e2e-session',
      caseId: 'SYN-HH-2812551000-0001',
      expectedRevision: 0,
    };

    const updated = await state.update(request, (current) => ({
      ...current,
      contact: {
        ...current.contact,
        consecutive_no_answer_count: current.contact.consecutive_no_answer_count + 1,
      },
    }));
    assert.equal(updated.revision, 1);
    assert.equal(updated.household.contact.consecutive_no_answer_count, 2);

    await assert.rejects(
      () => state.update(request, (current) => current),
      (error) => error?.code === 'STATE_CONFLICT',
    );
  });

  test('refuses non-synthetic seeds, IDs, and session identifiers that are not opaque bounded demo namespaces', () => {
    assert.throws(
      () => createMemoryContactOpsState({ households: [syntheticHousehold({ synthetic: false })] }),
      /synthetic/i,
    );
    assert.throws(
      () => createMemoryContactOpsState({ households: [syntheticHousehold({ id: 'PERSON-1' })] }),
      /synthetic|case/i,
    );
  });
  test('rejects missing cases, invalid list sessions, and invalid update arguments', async () => {
    const state = createMemoryContactOpsState({ households: [syntheticHousehold()] });
    await assert.rejects(() => state.get({ sessionId: 'valid-memory-session', caseId: 'SYN-HH-2812551000-9999' }), (error) => error.code === 'CASE_NOT_FOUND');
    await assert.rejects(() => state.list({ sessionId: 'short' }), /session/);
    await assert.rejects(() => state.update({ sessionId: 'valid-memory-session', caseId: 'SYN-HH-2812551000-0001', expectedRevision: -1 }, () => ({})), /expected/);
    await assert.rejects(() => state.update({ sessionId: 'valid-memory-session', caseId: 'SYN-HH-2812551000-0001', expectedRevision: 0 }, null), /transition/);
  });
});
