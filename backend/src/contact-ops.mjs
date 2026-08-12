const FINAL_CONTACT_RESULTS = new Set([
  'connected_ok',
  'connected_concern',
  'no_answer',
  'refused',
  'invalid_contact',
]);

const FOLLOW_UP_RESULTS = new Map([
  ['no_answer', 'follow_up_required_after_no_answer'],
  ['connected_concern', 'follow_up_required_after_concern'],
  ['invalid_contact', 'follow_up_required_after_invalid_contact'],
]);

function assertIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must be an ISO date (YYYY-MM-DD)`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${label} must be a valid ISO date`);
  }
}

function addDays(date, days) {
  assertIsoDate(date, 'date');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function cloneHousehold(household) {
  if (!household || typeof household !== 'object' || Array.isArray(household)) {
    throw new TypeError('household must be an object');
  }
  if (!household.contact || !household.workflow) {
    throw new TypeError('household must include contact and workflow');
  }
  return structuredClone(household);
}

function finding(code) {
  return { code, source: 'deterministic_rule' };
}

export function buildTodayContactQueue(households, referenceDate) {
  if (!Array.isArray(households)) {
    throw new TypeError('households must be an array');
  }
  assertIsoDate(referenceDate, 'referenceDate');

  return households
    .map((household) => {
      const nextContactDate = household?.contact?.next_contact_date;
      const followUpDeadline = household?.workflow?.follow_up_deadline;
      const followUpStatus = household?.workflow?.follow_up_status;
      const activeFollowUp = ['required', 'overdue'].includes(followUpStatus);
      const followUpMissingDeadline = activeFollowUp && followUpDeadline == null;
      const scheduledDue = typeof nextContactDate === 'string'
        && nextContactDate <= referenceDate;
      const followUpDue = activeFollowUp
        && typeof followUpDeadline === 'string'
        && followUpDeadline <= referenceDate;

      if (!scheduledDue && !followUpDue && !followUpMissingDeadline) return null;

      const dueReasons = [];
      if (scheduledDue) dueReasons.push('scheduled_contact');
      if (followUpDue) dueReasons.push('follow_up_deadline');
      if (followUpMissingDeadline) dueReasons.push('follow_up_missing_deadline');

      const dueDates = [
        scheduledDue ? nextContactDate : null,
        followUpDue ? followUpDeadline : null,
      ].filter(Boolean);

      return {
        household,
        household_id: household.id,
        preferred_contact_method: household.contact.preferred_contact_method,
        due_reasons: dueReasons,
        earliest_due_date: followUpMissingDeadline ? '' : dueDates.sort()[0],
        priority: followUpMissingDeadline
          ? -1
          : followUpDeadline < referenceDate && followUpDue
            ? 0
            : followUpDue
              ? 1
              : 2,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.priority - right.priority
      || left.earliest_due_date.localeCompare(right.earliest_due_date)
      || String(left.household_id).localeCompare(String(right.household_id))
    ));
}

export function applyStructuredContactResult(household, result) {
  const updated = cloneHousehold(household);
  const contactResult = result?.contact_result;
  const contactDate = result?.contact_date;

  if (!FINAL_CONTACT_RESULTS.has(contactResult)) {
    throw new TypeError('contact_result must be a final contact_result');
  }
  assertIsoDate(contactDate, 'contact_date');

  const cadenceDays = updated.contact.contact_cadence_days;
  if (!Number.isInteger(cadenceDays) || cadenceDays <= 0) {
    throw new TypeError('contact_cadence_days must be a positive integer');
  }

  updated.contact.last_contact_date = contactDate;
  updated.contact.last_contact_result = contactResult;
  updated.contact.consecutive_no_answer_count = contactResult === 'no_answer'
    ? (updated.contact.consecutive_no_answer_count ?? 0) + 1
    : 0;
  updated.contact.next_contact_date = addDays(contactDate, cadenceDays);

  return updated;
}

export function evaluateDeterministicRules(household, referenceDate) {
  const updated = cloneHousehold(household);
  assertIsoDate(referenceDate, 'referenceDate');
  const findings = [];
  const { contact, workflow } = updated;
  const result = contact.last_contact_result;

  if (['required', 'overdue'].includes(workflow.follow_up_status)
      && workflow.follow_up_deadline == null) {
    findings.push(finding('follow_up_missing_deadline'));
  }

  if (FOLLOW_UP_RESULTS.has(result)
      && ['none', 'completed'].includes(workflow.follow_up_status)) {
    workflow.follow_up_status = 'required';
    workflow.follow_up_deadline = addDays(contact.last_contact_date, 1);
    findings.push(finding(FOLLOW_UP_RESULTS.get(result)));
  }

  if (result === 'connected_ok'
      && ['required', 'overdue'].includes(workflow.follow_up_status)) {
    workflow.follow_up_status = 'completed';
    workflow.follow_up_deadline = null;
    findings.push(finding('follow_up_completed_after_contact'));
  }

  if (result === 'connected_concern'
      && !['recommended', 'requested', 'transferred'].includes(workflow.transfer_status)) {
    workflow.transfer_status = 'recommended';
    findings.push(finding('transfer_recommended_after_concern'));
  }

  if (result === 'invalid_contact'
      && !['recommended', 'requested', 'transferred'].includes(workflow.transfer_status)) {
    workflow.transfer_status = 'recommended';
    findings.push(finding('transfer_recommended_after_invalid_contact'));
  }

  if (result === 'no_answer'
      && contact.consecutive_no_answer_count >= 2
      && workflow.visit_approval_status === null) {
    workflow.visit_approval_status = 'recommended';
    findings.push(finding('visit_recommended_after_repeated_no_answer'));
  }

  if (['required', 'overdue'].includes(workflow.follow_up_status)
      && typeof workflow.follow_up_deadline === 'string'
      && workflow.follow_up_deadline < referenceDate) {
    workflow.follow_up_status = 'overdue';
    findings.push(finding('follow_up_overdue'));
  }

  return { household: updated, findings };
}

export function applyManagerVisitDecision(household, managerDecision) {
  const updated = cloneHousehold(household);
  if (updated.workflow.visit_approval_status !== 'recommended') {
    throw new Error('manager decision requires a recommended visit');
  }

  const decision = managerDecision?.decision;
  if (!['approved', 'rejected'].includes(decision)) {
    throw new TypeError('decision must be approved or rejected');
  }

  const decidedBy = managerDecision.decided_by;
  const decidedAt = managerDecision.decided_at;
  const note = managerDecision.note;
  if (typeof decidedBy !== 'string' || decidedBy.length === 0 || decidedBy.length > 100) {
    throw new TypeError('decided_by must be a non-empty string up to 100 characters');
  }
  if (typeof decidedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(decidedAt)
      || Number.isNaN(Date.parse(decidedAt))) {
    throw new TypeError('decided_at must be a valid date-time');
  }
  if (typeof note !== 'string' || note.length > 500) {
    throw new TypeError('note must be a string up to 500 characters');
  }

  if (decision === 'approved') {
    const maxRouteDistanceKm = managerDecision.max_route_distance_km;
    if (!Number.isFinite(maxRouteDistanceKm) || maxRouteDistanceKm <= 0) {
      throw new TypeError('approved decision requires positive max_route_distance_km');
    }
    const assignedWorkerIds = managerDecision.assigned_worker_ids;
    if (!Array.isArray(assignedWorkerIds)
        || assignedWorkerIds.length === 0
        || new Set(assignedWorkerIds).size !== assignedWorkerIds.length
        || assignedWorkerIds.some((id) => (
          typeof id !== 'string' || !/^SYN-W-\d{10}-01$/.test(id)
        ))) {
      throw new TypeError('approved decision requires unique assigned_worker_ids');
    }
    updated.approved_visit_constraints = {
      max_route_distance_km: maxRouteDistanceKm,
      assigned_worker_ids: [...assignedWorkerIds],
      routing_interpretation: 'approved_visit_only_not_person_risk',
    };
  } else {
    updated.approved_visit_constraints = null;
  }

  updated.workflow.visit_approval_status = decision;
  updated.workflow.visit_decision = {
    decision,
    decided_by: decidedBy,
    decided_at: decidedAt,
    note,
  };
  return updated;
}
