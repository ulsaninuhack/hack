import {
  applyManagerVisitDecision,
  applyStructuredContactResult,
  buildTodayContactQueue,
  evaluateDeterministicRules,
  applyTriageVisitRecommendation,
} from './contact-ops.mjs';
import { buildTriageQueue } from './contact-triage-scoring.mjs';

const OBSERVATION_KEYS = ['관찰_6징후', '식사상태', '위생상태', '공과금_2개월_이상_체납', '최근_건강_정신_괴로움', '관계망_유무', '연락_빈도'];
const SIGN_KEYS = ['우편물_고지서_적체', '악취_벌레', '쓰레기_술병', '인기척_없이_TV_불', '외출_없음', '연락_두절'];

function assertExactObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== OBSERVATION_KEYS.length
      || OBSERVATION_KEYS.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError('observations must use the exact canonical observation DTO');
  }
  if (!value.관찰_6징후 || typeof value.관찰_6징후 !== 'object'
      || Object.keys(value.관찰_6징후).length !== SIGN_KEYS.length
      || SIGN_KEYS.some((key) => typeof value.관찰_6징후[key] !== 'boolean')) {
    throw new TypeError('observations.관찰_6징후 must contain the six canonical boolean signs');
  }
}

function triageInput(household, observations, referenceDate) {
  const last = household.contact.last_contact_date;
  const elapsed = last && ['connected_ok', 'connected_concern'].includes(household.contact.last_contact_result)
    ? Math.max(0, Math.round((Date.parse(`${referenceDate}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000)) : null;
  return {
    계약_버전: 'contact-triage-scoring-input-v0.1.0', 합성_운영데이터: true,
    케이스_id: household.id, 기준일: referenceDate,
    ...observations,
    연속_미응답_횟수: household.contact.consecutive_no_answer_count,
    개인_평소_응답률: null, 평소_응답률_대비_급락: null,
    마지막_연결_후_경과일: elapsed, 재연락_기한: household.workflow.follow_up_deadline,
    방문_승인_상태: household.workflow.visit_approval_status === 'approved' ? '승인'
      : household.workflow.visit_approval_status === 'rejected' ? '반려' : null,
    동단위_구조취약도: {
      지도구역_id: household.location.geometry_zone_id,
      현행_행정동_코드_20260701: household.location.current_admin_dong_code_20260701,
      점수: 0, 기준일_메모: '합성 P1 기본값: 공개 구조 맥락 점수 미주입',
      기여내역: ['고령비율', '1인가구비율', '노후주택', '기초수급_밀도']
        .map((코드) => ({ 코드, 가산점: 0, 출처: '공개_동단위_집계' })),
    },
  };
}

function response(record, { findings = [] } = {}) {
  return {
    synthetic: true,
    displayMarker: '[합성]',
    revision: record.revision,
    household: record.household,
    observations: record.observations,
    triage: record.triage,
    findings,
  };
}

function contactPayload({ contactDate, contactResult }) {
  return { contact_date: contactDate, contact_result: contactResult };
}

function decisionPayload(input) {
  return {
    decision: input.decision,
    decided_by: input.decidedBy,
    decided_at: input.decidedAt,
    note: input.note,
    ...(input.decision === 'approved' ? {
      assigned_worker_ids: input.assignedWorkerIds,
      max_route_distance_km: input.maxRouteDistanceKm,
    } : {}),
  };
}

export function createContactOpsService({ state }) {
  if (!state || typeof state.get !== 'function' || typeof state.list !== 'function' || typeof state.update !== 'function') {
    throw new TypeError('state must provide get, list, and update');
  }
  return Object.freeze({
    async getCase({ sessionId, caseId }) {
      return response(await state.get({ sessionId, caseId }));
    },
    async getToday({ sessionId, referenceDate, workerId = null }) {
      const records = await state.list({ sessionId });
      const eligible = workerId === null ? records : records.filter(({ household }) => workerId === `SYN-W-${household.location.current_admin_dong_code_20260701}-01`);
      const queue = buildTodayContactQueue(eligible.map(({ household }) => household), referenceDate)
        .map((item) => {
          const record = eligible.find(({ household }) => household.id === item.household.id);
          const triage = record.triage || buildTriageQueue([triageInput(item.household, record.observations, referenceDate)])[0];
          return { ...item, triage, revision: record.revision };
        }).sort((left, right) => right.triage.급성도_점수 - left.triage.급성도_점수
          || right.triage.취약도_점수 - left.triage.취약도_점수
          || (right.triage.마지막_연결_후_경과일 ?? -1) - (left.triage.마지막_연결_후_경과일 ?? -1)
          || left.household_id.localeCompare(right.household_id));
      return {
        synthetic: true,
        displayMarker: '[합성]',
        worker_id: workerId,
        items: queue.map(({ household, ...item }) => ({
          ...item,
        })),
      };
    },
    async recordContactResult(input) {
      assertExactObservation(input.observations);
      const record = await state.update(input, (household, current) => {
        const recorded = applyStructuredContactResult(household, contactPayload(input));
        const evaluated = evaluateDeterministicRules(recorded, input.contactDate);
        const triage = buildTriageQueue([triageInput(evaluated.household, input.observations, input.contactDate)])[0];
        return { household: applyTriageVisitRecommendation(evaluated.household, triage), observations: input.observations, triage };
      });
      return response(record);
    },
    async recordVisitDecision(input) {
      const approvalStatus = input.decision === 'approved' ? '승인' : '반려';
      const record = await state.update(input, (household, current) => ({
        household: applyManagerVisitDecision(household, decisionPayload(input)),
        observations: current.observations,
        triage: current.triage === null
          ? null
          : { ...current.triage, 방문_승인_상태: approvalStatus },
      }));
      return response(record);
    },
    async recalculateTriage(input) {
      const record = await state.update(input, (household, current) => {
        const triage = buildTriageQueue([triageInput(household, current.observations, input.referenceDate)])[0];
        return { household: applyTriageVisitRecommendation(household, triage), observations: current.observations, triage };
      });
      return response(record);
    },
    async getVisitRecommendations({ sessionId, district = null }) {
      const records = await state.list({ sessionId });
      if (district !== null && !records.some(({ household }) => household.location.current_district_name_20260701 === district)) {
        throw new TypeError('district is not a synthetic district');
      }
      return {
        synthetic: true, displayMarker: '[합성]',
        items: records.filter(({ household }) => household.workflow.visit_approval_status === 'recommended'
          && (!district || household.location.current_district_name_20260701 === district)).map((record) => response(record)),
      };
    },
  });
}
