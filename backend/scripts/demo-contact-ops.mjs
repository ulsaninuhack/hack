import { readFile } from 'node:fs/promises';

import {
  applyManagerVisitDecision,
  applyStructuredContactResult,
  applyTriageVisitRecommendation,
  buildTodayContactQueue,
  evaluateDeterministicRules,
} from '../src/contact-ops.mjs';
import { buildTriageQueue } from '../src/contact-triage-scoring.mjs';

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

const adminDongCode = evaluation.household.location.current_admin_dong_code_20260701;
const triageItem = buildTriageQueue([{
  계약_버전: 'contact-triage-scoring-input-v0.1.0',
  합성_운영데이터: true,
  케이스_id: evaluation.household.id,
  기준일: referenceDate,
  관찰_6징후: {
    우편물_고지서_적체: true,
    악취_벌레: false,
    쓰레기_술병: false,
    인기척_없이_TV_불: false,
    외출_없음: false,
    연락_두절: false,
  },
  식사상태: '심각',
  위생상태: '양호',
  공과금_2개월_이상_체납: false,
  최근_건강_정신_괴로움: false,
  관계망_유무: '있음',
  연락_빈도: '주_1회_이상',
  연속_미응답_횟수: evaluation.household.contact.consecutive_no_answer_count,
  개인_평소_응답률: 0.8,
  평소_응답률_대비_급락: false,
  마지막_연결_후_경과일: null,
  재연락_기한: evaluation.household.workflow.follow_up_deadline,
  방문_승인_상태: null,
  동단위_구조취약도: {
    지도구역_id: evaluation.household.location.geometry_zone_id,
    현행_행정동_코드_20260701: adminDongCode,
    점수: 0,
    기준일_메모: '텍스트 데모는 공개 동단위 정규화 점수를 주입하지 않음',
    기여내역: [
      { 코드: '고령비율', 가산점: 0, 출처: '공개_동단위_집계' },
      { 코드: '1인가구비율', 가산점: 0, 출처: '공개_동단위_집계' },
      { 코드: '노후주택', 가산점: 0, 출처: '공개_동단위_집계' },
      { 코드: '기초수급_밀도', 가산점: 0, 출처: '공개_동단위_집계' },
    ],
  },
}])[0];
const recommended = applyTriageVisitRecommendation(evaluation.household, triageItem);
console.log(
  `[4] 2축 트리아지: 급성도 ${triageItem.급성도_점수}, `
    + `취약도 ${triageItem.취약도_점수}, 방문 승격 권고 `
    + `${recommended.workflow.visit_approval_status} (자동 승인 없음)`,
);

const approved = applyManagerVisitDecision(recommended, {
  decision: 'approved',
  decided_by: 'demo-manager',
  decided_at: `${referenceDate}T09:00:00+09:00`,
  note: '급성도 점수 권고를 담당자가 검토하여 승인',
  max_route_distance_km: 4,
  assigned_worker_ids: [`SYN-W-${adminDongCode}-01`],
});
console.log(
  `[5] 담당자 명시 승인: ${approved.workflow.visit_approval_status}, `
    + `방문 제약 ${approved.approved_visit_constraints.max_route_distance_km}km`,
);
