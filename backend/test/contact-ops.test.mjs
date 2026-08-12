import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';

import {
  applyManagerVisitDecision,
  applyStructuredContactResult,
  buildTodayContactQueue,
  evaluateDeterministicRules,
} from '../src/contact-ops.mjs';

function syntheticHousehold(overrides = {}) {
  const base = {
    id: 'SYN-HH-2812551000-0001',
    synthetic: true,
    location: {
      current_admin_dong_name_20260701: '신포동',
      latitude: 37.47,
      longitude: 126.62,
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

describe('today contact queue', () => {
  test('queues scheduled contacts and due follow-ups, prioritizing overdue work', () => {
    const scheduled = syntheticHousehold({ id: 'scheduled' });
    const overdue = syntheticHousehold({
      id: 'overdue',
      contact: { next_contact_date: '2026-08-20' },
      workflow: {
        follow_up_deadline: '2026-08-11',
        follow_up_status: 'required',
      },
    });
    const dueByBoth = syntheticHousehold({
      id: 'both',
      workflow: {
        follow_up_deadline: '2026-08-12',
        follow_up_status: 'required',
      },
    });
    const future = syntheticHousehold({
      id: 'future',
      contact: { next_contact_date: '2026-08-13' },
    });

    const queue = buildTodayContactQueue(
      [scheduled, future, dueByBoth, overdue],
      '2026-08-12',
    );

    assert.deepEqual(queue.map((item) => item.household.id), [
      'overdue',
      'both',
      'scheduled',
    ]);
    assert.deepEqual(queue[0].due_reasons, ['follow_up_deadline']);
    assert.deepEqual(queue[1].due_reasons, [
      'scheduled_contact',
      'follow_up_deadline',
    ]);
    assert.equal(queue[2].preferred_contact_method, 'phone');
  });

  test('does not queue a completed follow-up whose next contact is in the future', () => {
    const household = syntheticHousehold({
      contact: { next_contact_date: '2026-08-20' },
      workflow: {
        follow_up_deadline: '2026-08-10',
        follow_up_status: 'completed',
      },
    });

    assert.deepEqual(buildTodayContactQueue([household], '2026-08-12'), []);
  });

  test('queues a required or overdue follow-up without a deadline at highest priority', () => {
    const missingRequired = syntheticHousehold({
      id: 'missing-required',
      contact: { next_contact_date: '2026-08-20' },
      workflow: { follow_up_status: 'required', follow_up_deadline: null },
    });
    const missingOverdue = syntheticHousehold({
      id: 'missing-overdue',
      contact: { next_contact_date: '2026-08-20' },
      workflow: { follow_up_status: 'overdue', follow_up_deadline: null },
    });
    const datedOverdue = syntheticHousehold({
      id: 'dated-overdue',
      contact: { next_contact_date: '2026-08-20' },
      workflow: { follow_up_status: 'overdue', follow_up_deadline: '2026-08-11' },
    });

    const queue = buildTodayContactQueue(
      [datedOverdue, missingRequired, missingOverdue],
      '2026-08-12',
    );

    assert.deepEqual(queue.map(({ household_id }) => household_id), [
      'missing-overdue',
      'missing-required',
      'dated-overdue',
    ]);
    assert.deepEqual(queue[0].due_reasons, ['follow_up_missing_deadline']);
    assert.deepEqual(queue[1].due_reasons, ['follow_up_missing_deadline']);
    assert.ok(queue[0].priority < queue[2].priority);
  });

  test('does not treat null deadlines as malformed for none or completed follow-up states', () => {
    const normalStates = ['none', 'completed'].map((followUpStatus) => syntheticHousehold({
      id: followUpStatus,
      contact: { next_contact_date: '2026-08-20' },
      workflow: { follow_up_status: followUpStatus, follow_up_deadline: null },
    }));

    assert.deepEqual(buildTodayContactQueue(normalStates, '2026-08-12'), []);
  });
});

describe('structured contact-result application', () => {
  test('records a no-answer, increments the streak, and schedules by cadence', () => {
    const household = syntheticHousehold();

    const updated = applyStructuredContactResult(household, {
      contact_date: '2026-08-12',
      contact_result: 'no_answer',
    });

    assert.deepEqual(updated.contact, {
      next_contact_date: '2026-08-19',
      preferred_contact_method: 'phone',
      contact_cadence_days: 7,
      last_contact_date: '2026-08-12',
      last_contact_result: 'no_answer',
      consecutive_no_answer_count: 2,
    });
    assert.equal(updated.workflow.visit_approval_status, null);
    assert.equal(updated.approved_visit_constraints, null);
    assert.equal(household.contact.consecutive_no_answer_count, 1);
  });

  test('a connected result resets the consecutive no-answer count', () => {
    const updated = applyStructuredContactResult(syntheticHousehold(), {
      contact_date: '2026-08-12',
      contact_result: 'connected_ok',
    });

    assert.equal(updated.contact.consecutive_no_answer_count, 0);
    assert.equal(updated.contact.last_contact_result, 'connected_ok');
  });

  test('rejects non-final and unknown contact results', () => {
    assert.throws(
      () => applyStructuredContactResult(syntheticHousehold(), {
        contact_date: '2026-08-12',
        contact_result: 'not_attempted',
      }),
      /final contact_result/,
    );
    assert.throws(
      () => applyStructuredContactResult(syntheticHousehold(), {
        contact_date: '2026-08-12',
        contact_result: 'ai_guessed_concern',
      }),
      /final contact_result/,
    );
  });
});

describe('deterministic rule graph', () => {
  test('two no-answers recommend a visit but never approve it', () => {
    const recorded = applyStructuredContactResult(syntheticHousehold(), {
      contact_date: '2026-08-12',
      contact_result: 'no_answer',
    });

    const evaluation = evaluateDeterministicRules(recorded, '2026-08-12');

    assert.deepEqual(evaluation.findings.map((finding) => finding.code), [
      'follow_up_required_after_no_answer',
      'visit_recommended_after_repeated_no_answer',
    ]);
    assert.equal(evaluation.household.workflow.follow_up_status, 'required');
    assert.equal(evaluation.household.workflow.follow_up_deadline, '2026-08-13');
    assert.equal(evaluation.household.workflow.visit_approval_status, 'recommended');
    assert.equal(evaluation.household.workflow.visit_decision, null);
    assert.equal(evaluation.household.approved_visit_constraints, null);
  });

  test('marks an unresolved follow-up overdue only after its deadline', () => {
    const household = syntheticHousehold({
      workflow: {
        follow_up_deadline: '2026-08-11',
        follow_up_status: 'required',
      },
    });

    const evaluation = evaluateDeterministicRules(household, '2026-08-12');

    assert.equal(evaluation.household.workflow.follow_up_status, 'overdue');
    assert.ok(evaluation.findings.some(({ code }) => code === 'follow_up_overdue'));
  });

  test('connected concern requires follow-up and recommends transfer, not a visit', () => {
    const recorded = applyStructuredContactResult(syntheticHousehold(), {
      contact_date: '2026-08-12',
      contact_result: 'connected_concern',
    });

    const evaluation = evaluateDeterministicRules(recorded, '2026-08-12');

    assert.equal(evaluation.household.workflow.follow_up_status, 'required');
    assert.equal(evaluation.household.workflow.follow_up_deadline, '2026-08-13');
    assert.equal(evaluation.household.workflow.transfer_status, 'recommended');
    assert.equal(evaluation.household.workflow.visit_approval_status, null);
    assert.deepEqual(evaluation.findings.map(({ code }) => code), [
      'follow_up_required_after_concern',
      'transfer_recommended_after_concern',
    ]);
  });

  test('invalid contact requires follow-up and recommends an administrative transfer', () => {
    const recorded = applyStructuredContactResult(syntheticHousehold(), {
      contact_date: '2026-08-12',
      contact_result: 'invalid_contact',
    });

    const evaluation = evaluateDeterministicRules(recorded, '2026-08-12');

    assert.equal(evaluation.household.workflow.follow_up_status, 'required');
    assert.equal(evaluation.household.workflow.transfer_status, 'recommended');
    assert.equal(evaluation.household.workflow.visit_approval_status, null);
    assert.ok(evaluation.findings.some(
      ({ code }) => code === 'transfer_recommended_after_invalid_contact',
    ));
  });

  test('connected ok completes an outstanding follow-up without changing visit approval', () => {
    const household = syntheticHousehold({
      workflow: {
        follow_up_deadline: '2026-08-12',
        follow_up_status: 'overdue',
        visit_approval_status: 'recommended',
      },
    });
    const recorded = applyStructuredContactResult(household, {
      contact_date: '2026-08-12',
      contact_result: 'connected_ok',
    });

    const evaluation = evaluateDeterministicRules(recorded, '2026-08-12');

    assert.equal(evaluation.household.workflow.follow_up_status, 'completed');
    assert.equal(evaluation.household.workflow.follow_up_deadline, null);
    assert.equal(evaluation.household.workflow.visit_approval_status, 'recommended');
  });

  test('emits a fail-visible finding when active follow-up has no deadline', () => {
    for (const followUpStatus of ['required', 'overdue']) {
      const household = syntheticHousehold({
        contact: {
          last_contact_date: null,
          last_contact_result: 'not_attempted',
          next_contact_date: '2026-08-20',
        },
        workflow: {
          follow_up_status: followUpStatus,
          follow_up_deadline: null,
        },
      });

      const evaluation = evaluateDeterministicRules(household, '2026-08-12');

      assert.deepEqual(evaluation.findings.map(({ code }) => code), [
        'follow_up_missing_deadline',
      ]);
      assert.equal(evaluation.household.workflow.follow_up_status, followUpStatus);
      assert.equal(evaluation.household.workflow.follow_up_deadline, null);
    }
  });

  test('does not emit missing-deadline findings for none or completed states', () => {
    for (const followUpStatus of ['none', 'completed']) {
      const household = syntheticHousehold({
        contact: {
          last_contact_date: null,
          last_contact_result: 'not_attempted',
          next_contact_date: '2026-08-20',
        },
        workflow: {
          follow_up_status: followUpStatus,
          follow_up_deadline: null,
        },
      });

      const evaluation = evaluateDeterministicRules(household, '2026-08-12');

      assert.ok(!evaluation.findings.some(({ code }) => (
        code === 'follow_up_missing_deadline'
      )));
    }
  });
});

describe('explicit manager visit decision', () => {
  test('an explicit approval is the only operation that creates route constraints', () => {
    const recommended = syntheticHousehold({
      workflow: { visit_approval_status: 'recommended' },
    });

    const approved = applyManagerVisitDecision(recommended, {
      decision: 'approved',
      decided_by: 'manager-demo',
      decided_at: '2026-08-12T09:00:00+09:00',
      note: '반복 미응답으로 방문 승인',
      max_route_distance_km: 4.5,
      assigned_worker_ids: ['SYN-W-2812551000-01'],
    });

    assert.equal(approved.workflow.visit_approval_status, 'approved');
    assert.deepEqual(approved.workflow.visit_decision, {
      decision: 'approved',
      decided_by: 'manager-demo',
      decided_at: '2026-08-12T09:00:00+09:00',
      note: '반복 미응답으로 방문 승인',
    });
    assert.deepEqual(approved.approved_visit_constraints, {
      max_route_distance_km: 4.5,
      assigned_worker_ids: ['SYN-W-2812551000-01'],
      routing_interpretation: 'approved_visit_only_not_person_risk',
    });
  });

  test('an explicit rejection records the decision without route constraints', () => {
    const recommended = syntheticHousehold({
      workflow: { visit_approval_status: 'recommended' },
    });

    const rejected = applyManagerVisitDecision(recommended, {
      decision: 'rejected',
      decided_by: 'manager-demo',
      decided_at: '2026-08-12T09:05:00+09:00',
      note: '재전화 후 재검토',
    });

    assert.equal(rejected.workflow.visit_approval_status, 'rejected');
    assert.deepEqual(rejected.workflow.visit_decision, {
      decision: 'rejected',
      decided_by: 'manager-demo',
      decided_at: '2026-08-12T09:05:00+09:00',
      note: '재전화 후 재검토',
    });
    assert.equal(rejected.approved_visit_constraints, null);
  });

  test('cannot approve a visit before rules recommend it', () => {
    assert.throws(
      () => applyManagerVisitDecision(syntheticHousehold(), {
        decision: 'approved',
        decided_by: 'manager-demo',
        decided_at: '2026-08-12T09:00:00+09:00',
        note: '',
        max_route_distance_km: 4,
        assigned_worker_ids: ['SYN-W-2812551000-01'],
      }),
      /recommended visit/,
    );
  });

  test('approval requires a positive maximum route distance', () => {
    const recommended = syntheticHousehold({
      workflow: { visit_approval_status: 'recommended' },
    });

    assert.throws(
      () => applyManagerVisitDecision(recommended, {
        decision: 'approved',
        decided_by: 'manager-demo',
        decided_at: '2026-08-12T09:00:00+09:00',
        note: '',
        assigned_worker_ids: ['SYN-W-2812551000-01'],
      }),
      /max_route_distance_km/,
    );
    assert.throws(
      () => applyManagerVisitDecision(recommended, {
        decision: 'approved',
        decided_by: 'manager-demo',
        decided_at: '2026-08-12T09:00:00+09:00',
        note: '',
        max_route_distance_km: 0,
        assigned_worker_ids: ['SYN-W-2812551000-01'],
      }),
      /max_route_distance_km/,
    );
  });

  test('manager metadata and assigned worker IDs conform to the fixture schema', () => {
    const recommended = syntheticHousehold({
      workflow: { visit_approval_status: 'recommended' },
    });
    const otherwiseValid = {
      decision: 'approved',
      decided_by: 'manager-demo',
      decided_at: '2026-08-12T09:00:00+09:00',
      note: '',
      max_route_distance_km: 4,
      assigned_worker_ids: ['SYN-W-2812551000-01'],
    };

    assert.throws(
      () => applyManagerVisitDecision(recommended, {
        ...otherwiseValid,
        decided_at: '2026-08-12',
      }),
      /decided_at/,
    );
    assert.throws(
      () => applyManagerVisitDecision(recommended, {
        ...otherwiseValid,
        assigned_worker_ids: ['worker-without-synthetic-contract'],
      }),
      /assigned_worker_ids/,
    );
  });
});

describe('text vertical-slice demo', () => {
  test('runs queue through explicit manager approval using the generated fixture', () => {
    const result = spawnSync(process.execPath, ['scripts/demo-contact-ops.mjs'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[1\] 오늘 연락대상 큐/);
    assert.match(result.stdout, /\[2\] 더미 연락결과: no_answer/);
    assert.match(result.stdout, /\[3\] 규칙 검사/);
    assert.match(result.stdout, /\[4\] 방문 승격 권고: recommended \(자동 승인 없음\)/);
    assert.match(result.stdout, /\[5\] 담당자 명시 승인: approved/);
  });
});
