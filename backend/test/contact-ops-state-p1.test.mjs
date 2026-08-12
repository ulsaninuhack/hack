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

describe('P1 synthetic ContactOps memory state', () => {
  test('namespaces immutable synthetic seed state by opaque demo session and starts at revision zero', async () => {
    const state = createMemoryContactOpsState({ households: [syntheticHousehold()] });

    const first = await state.get({ sessionId: 'demo-session-alpha', caseId: 'SYN-HH-2812551000-0001' });
    const second = await state.get({ sessionId: 'demo-session-bravo', caseId: 'SYN-HH-2812551000-0001' });

    assert.equal(first.revision, 0);
    assert.equal(first.synthetic, true);
    assert.equal(second.revision, 0);
    assert.notStrictEqual(first.household, second.household);
    assert.equal(first.household.id, 'SYN-HH-2812551000-0001');
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
