import { readFile } from 'node:fs/promises';

import {
  applyManagerVisitDecision,
  applyStructuredContactResult,
  buildTodayContactQueue,
  evaluateDeterministicRules,
} from '../src/contact-ops.mjs';

const fixturePath = new URL('../../public/data/synthetic-households.json', import.meta.url);
const dataset = JSON.parse(await readFile(fixturePath, 'utf8'));
const referenceDate = dataset.scenario_reference_date;
const queue = buildTodayContactQueue(dataset.households, referenceDate);
const selected = queue.find(({ household }) => (
  household.contact.preferred_contact_method === 'phone'
  && household.contact.consecutive_no_answer_count === 1
  && household.workflow.visit_approval_status === null
));

if (!selected) {
  throw new Error('No due synthetic phone task with one prior no-answer was found');
}

console.log(
  `[1] 오늘 연락대상 큐: ${queue.length}건, 선택 ${selected.household.id}`,
);

const recorded = applyStructuredContactResult(selected.household, {
  contact_date: referenceDate,
  contact_result: 'no_answer',
});
console.log(
  `[2] 더미 연락결과: ${recorded.contact.last_contact_result}, `
    + `연속 미응답 ${recorded.contact.consecutive_no_answer_count}회`,
);

const evaluation = evaluateDeterministicRules(recorded, referenceDate);
console.log(
  `[3] 규칙 검사: ${evaluation.findings.map(({ code }) => code).join(', ')}`,
);
console.log(
  `[4] 방문 승격 권고: `
    + `${evaluation.household.workflow.visit_approval_status} (자동 승인 없음)`,
);

const adminDongCode = evaluation.household.location.current_admin_dong_code_20260701;
const approved = applyManagerVisitDecision(evaluation.household, {
  decision: 'approved',
  decided_by: 'demo-manager',
  decided_at: `${referenceDate}T09:00:00+09:00`,
  note: '반복 미응답 규칙 권고를 담당자가 검토하여 승인',
  max_route_distance_km: 4,
  assigned_worker_ids: [`SYN-W-${adminDongCode}-01`],
});
console.log(
  `[5] 담당자 명시 승인: ${approved.workflow.visit_approval_status}, `
    + `방문 제약 ${approved.approved_visit_constraints.max_route_distance_km}km`,
);
