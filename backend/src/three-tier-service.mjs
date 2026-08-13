import {
  buildAssignmentProposals,
  buildDistrictAggregates,
  buildDistrictAiSummaryInput,
  buildReportCard,
  buildStaffingReview,
  contactResultLabel,
  createDistrictAiSummaryAdapter,
  deriveVirtualPhone,
} from './three-tier-ops.mjs';

const DONG_CODE_PATTERN = /^\d{10}$/;
const WORKER_ID_PATTERN = /^SYN-W-\d{10}-01$/;
const MAX_TRACKED_SESSIONS = 500;

// P1 three-tier adapter service. Derives 제안/보고 views from the frozen
// contact-ops state and keeps only explicit human confirmations as extra
// session-scoped memory. This confirmation memory is deliberately in-memory
// demo state (not Firestore) and is documented as such in the handoff.

function assertActor(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 100) {
    throw new TypeError(`${label} must be a non-empty string up to 100 characters`);
  }
}

function assertIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new TypeError(`${label} must be a valid ISO date`);
  }
}

function createSessionMemory() {
  const sessions = new Map();
  const forSession = (sessionId) => {
    if (!sessions.has(sessionId)) {
      if (sessions.size >= MAX_TRACKED_SESSIONS) {
        sessions.delete(sessions.keys().next().value);
      }
      sessions.set(sessionId, { assignmentConfirmations: new Map(), reportAcknowledgements: new Map() });
    }
    const memory = sessions.get(sessionId);
    sessions.delete(sessionId);
    sessions.set(sessionId, memory);
    return memory;
  };
  return { forSession };
}

function laneItem(record, proposal, referenceDate) {
  const { household, triage } = record;
  const item = {
    synthetic: true,
    displayMarker: '[합성]',
    case_id: household.id,
    revision: record.revision,
    lane: proposal.lane,
    due_reasons: proposal.due_reasons,
    earliest_due_date: proposal.earliest_due_date,
    reference_date: referenceDate,
    급성도_등급: triage?.급성도_등급 ?? null,
    급성도_점수: triage?.급성도_점수 ?? null,
    취약도_점수: triage?.취약도_점수 ?? null,
    grade_source: triage === null ? '미기록' : '세션 기록',
    virtual_phone: deriveVirtualPhone(household.id),
    location: {
      dong_code: household.location.current_admin_dong_code_20260701,
      dong_name: household.location.current_admin_dong_name_20260701,
      district: household.location.current_district_name_20260701,
      latitude: household.location.latitude,
      longitude: household.location.longitude,
      address_note: '합성 데이터에는 주소가 없습니다 · 동 단위 위치만 표시',
    },
    last_contact: {
      date: household.contact.last_contact_date,
      result_label: contactResultLabel(household.contact.last_contact_result),
      consecutive_no_answer_count: household.contact.consecutive_no_answer_count,
    },
    visit_approval_status: household.workflow.visit_approval_status,
  };
  if (proposal.lane === 'visit') {
    item.visit_context = {
      preferred_visit_time_window: structuredClone(household.visit_context.preferred_visit_time_window),
      requires_two_person_team: household.visit_context.requires_two_person_team,
      requires_public_official_companion: household.visit_context.requires_public_official_companion,
      stairs_present: household.visit_context.stairs_present,
      service_duration_minutes: household.visit_context.service_duration_minutes,
    };
  }
  return item;
}

function applyConfirmation(batch, memory) {
  const confirmation = memory.assignmentConfirmations.get(batch.batch_id) ?? null;
  const decorate = (proposal) => {
    const confirmed = confirmation !== null
      && (confirmation.case_ids === null || confirmation.case_ids.has(proposal.case_id));
    return confirmed
      ? {
        ...proposal,
        status: 'confirmed',
        confirmed_by: confirmation.confirmed_by,
        confirmed_at: confirmation.confirmed_at,
      }
      : proposal;
  };
  const lanes = { phone: batch.lanes.phone.map(decorate), visit: batch.lanes.visit.map(decorate) };
  const proposals = [...lanes.phone, ...lanes.visit];
  const confirmedCount = proposals.filter((proposal) => proposal.status === 'confirmed').length;
  return {
    ...batch,
    lanes,
    proposed_count: proposals.length - confirmedCount,
    confirmed_count: confirmedCount,
    status: confirmedCount === 0 ? 'proposed' : confirmedCount === proposals.length ? 'confirmed' : 'partially_confirmed',
    confirmation_rule: '확정은 동 행정복지센터 담당자의 명시적 확인 액션만 가능',
  };
}

export function createThreeTierService({
  state,
  store,
  structuralContext = null,
  workers,
  aiSummaryAdapter = null,
  now = () => new Date().toISOString(),
}) {
  if (!state || typeof state.list !== 'function' || typeof state.get !== 'function') {
    throw new TypeError('state must provide list and get');
  }
  if (!store || !store.zones) throw new TypeError('store with zones is required');
  if (!Array.isArray(workers) || workers.length === 0) {
    throw new TypeError('workers fixture is required');
  }
  const summaryAdapter = aiSummaryAdapter ?? createDistrictAiSummaryAdapter({ mode: 'mock' });
  const memoryStore = createSessionMemory();
  const facilityDistribution = store.summary?.distributions?.facilityDistrict ?? {};
  const structuralZones = structuralContext?.zones ?? [];

  async function districtAggregates({ sessionId, referenceDate }) {
    assertIsoDate(referenceDate, 'referenceDate');
    const records = await state.list({ sessionId });
    return buildDistrictAggregates({
      storeZones: store.zones,
      facilityDistribution,
      structuralZones,
      records,
      workers,
      referenceDate,
    });
  }

  return Object.freeze({
    async getTodayLanes({ sessionId, referenceDate, workerId }) {
      assertIsoDate(referenceDate, 'referenceDate');
      if (typeof workerId !== 'string' || !WORKER_ID_PATTERN.test(workerId)) {
        throw new TypeError('workerId must be a synthetic worker ID');
      }
      const worker = workers.find((candidate) => candidate.id === workerId);
      if (!worker) throw new TypeError('workerId is not a synthetic worker');
      const dongCode = worker.location.current_admin_dong_code_20260701;
      const records = await state.list({ sessionId });
      const recordById = new Map(records.map((record) => [record.household.id, record]));
      const batches = buildAssignmentProposals({ records, workers, referenceDate, dongCode });
      const batch = batches[0] ?? null;
      const toItems = (lane) => (batch?.lanes[lane] ?? [])
        .map((proposal) => laneItem(recordById.get(proposal.case_id), proposal, referenceDate));
      return {
        synthetic: true,
        displayMarker: '[합성]',
        reference_date: referenceDate,
        worker_id: workerId,
        worker_display_name: worker.display_name,
        dong_code: dongCode,
        dong_name: worker.location.current_admin_dong_name_20260701,
        lane_rule: '방문 레인에는 승인된 방문 또는 방문 선호 예정 업무만 포함',
        lanes: { phone: toItems('phone'), visit: toItems('visit') },
      };
    },

    async getReportCard({ sessionId, caseId }) {
      const record = await state.get({ sessionId, caseId });
      const card = buildReportCard(record);
      if (card === null) {
        throw new TypeError('report card requires a recorded contact result for this session');
      }
      const memory = memoryStore.forSession(sessionId);
      const acknowledgement = memory.reportAcknowledgements.get(caseId) ?? null;
      return {
        synthetic: true,
        displayMarker: '[합성]',
        report_card: {
          ...card,
          acknowledgement: acknowledgement ?? { status: '미확인' },
        },
        destination: '동 행정복지센터 인박스',
      };
    },

    async getCenterInbox({ sessionId, dongCode, referenceDate }) {
      assertIsoDate(referenceDate, 'referenceDate');
      if (typeof dongCode !== 'string' || !DONG_CODE_PATTERN.test(dongCode)) {
        throw new TypeError('dongCode must be a 10-digit current admin dong code');
      }
      const records = await state.list({ sessionId });
      const dongRecords = records.filter(
        ({ household }) => household.location.current_admin_dong_code_20260701 === dongCode,
      );
      if (dongRecords.length === 0) throw new TypeError('dongCode is not a synthetic dong');
      const memory = memoryStore.forSession(sessionId);
      const cards = dongRecords
        .map((record) => buildReportCard(record))
        .filter((card) => card !== null)
        .sort((left, right) => right.급성도_점수 - left.급성도_점수
          || left.case_id.localeCompare(right.case_id))
        .map((card) => ({
          ...card,
          acknowledgement: memory.reportAcknowledgements.get(card.case_id) ?? { status: '미확인' },
        }));
      const acknowledgedCount = cards.filter((card) => card.acknowledgement.status === '확인').length;
      const batches = buildAssignmentProposals({ records: dongRecords, workers, referenceDate, dongCode });
      const assignment = batches[0] ? applyConfirmation(batches[0], memory) : null;
      const pendingVisit = dongRecords.filter(
        ({ household }) => household.workflow.visit_approval_status === 'recommended',
      ).length;
      const sample = dongRecords[0].household.location;
      return {
        synthetic: true,
        displayMarker: '[합성]',
        audience: '동 행정복지센터용',
        reference_date: referenceDate,
        dong_code: dongCode,
        dong_name: sample.current_admin_dong_name_20260701,
        district: sample.current_district_name_20260701,
        summary: {
          보고_카드_수: cards.length,
          보고_확인_수: acknowledgedCount,
          보고_대기_수: cards.length - acknowledgedCount,
          처리_완료율_pct: cards.length > 0
            ? Math.round((acknowledgedCount / cards.length) * 100) : null,
          방문승인_대기_수: pendingVisit,
          배치_상태: assignment?.status ?? 'no_due_tasks',
        },
        report_cards: cards,
        assignment_proposal: assignment,
      };
    },

    async acknowledgeReport({ sessionId, caseId, expectedRevision, acknowledgedBy }) {
      assertActor(acknowledgedBy, 'acknowledged_by');
      const record = await state.get({ sessionId, caseId });
      if (buildReportCard(record) === null) {
        throw new TypeError('acknowledgement requires an existing report card');
      }
      if (record.revision !== expectedRevision) {
        const conflict = new Error('Synthetic case revision is stale');
        conflict.code = 'STATE_CONFLICT';
        throw conflict;
      }
      const memory = memoryStore.forSession(sessionId);
      const acknowledgement = {
        status: '확인',
        acknowledged_by: acknowledgedBy,
        acknowledged_at: now(),
        revision: record.revision,
      };
      memory.reportAcknowledgements.set(caseId, acknowledgement);
      return {
        synthetic: true,
        displayMarker: '[합성]',
        case_id: caseId,
        acknowledgement,
      };
    },

    async confirmAssignment({ sessionId, dongCode, referenceDate, confirmedBy, caseIds }) {
      assertIsoDate(referenceDate, 'referenceDate');
      assertActor(confirmedBy, 'confirmed_by');
      if (typeof dongCode !== 'string' || !DONG_CODE_PATTERN.test(dongCode)) {
        throw new TypeError('dongCode must be a 10-digit current admin dong code');
      }
      if (caseIds !== null && (!Array.isArray(caseIds) || caseIds.length === 0
          || caseIds.some((caseId) => typeof caseId !== 'string'))) {
        throw new TypeError('case_ids must be null (전체 확인) or a non-empty case ID array');
      }
      const records = await state.list({ sessionId });
      const batches = buildAssignmentProposals({ records, workers, referenceDate, dongCode });
      const batch = batches[0] ?? null;
      if (!batch) throw new TypeError('no assignment proposal exists for this dong and date');
      const proposalIds = new Set(
        [...batch.lanes.phone, ...batch.lanes.visit].map((proposal) => proposal.case_id),
      );
      if (caseIds !== null) {
        for (const caseId of caseIds) {
          if (!proposalIds.has(caseId)) {
            throw new TypeError(`case ${caseId} is not part of the proposal batch`);
          }
        }
      }
      const memory = memoryStore.forSession(sessionId);
      const existing = memory.assignmentConfirmations.get(batch.batch_id) ?? null;
      const merged = caseIds === null
        ? null
        : new Set([...(existing?.case_ids ?? []), ...caseIds]);
      memory.assignmentConfirmations.set(batch.batch_id, {
        confirmed_by: confirmedBy,
        confirmed_at: now(),
        case_ids: existing?.case_ids === null ? null : merged,
      });
      return {
        synthetic: true,
        displayMarker: '[합성]',
        assignment_proposal: applyConfirmation(batch, memory),
      };
    },

    async getDistrictAggregates({ sessionId, referenceDate }) {
      const districts = await districtAggregates({ sessionId, referenceDate });
      return {
        synthetic: true,
        displayMarker: '[합성]',
        reference_date: referenceDate,
        case_detail_access: 'none_district_rollup_only',
        privacy_note: '시·구 화면은 동 단위 롤업까지만 제공하며 개별 케이스 정보는 포함하지 않습니다.',
        districts,
        staffing_review: buildStaffingReview(districts),
      };
    },

    async getDistrictAiSummary({ sessionId, district, referenceDate }) {
      const districts = await districtAggregates({ sessionId, referenceDate });
      const aggregate = districts.find((item) => item.district === district);
      if (!aggregate) throw new TypeError('district is not a synthetic district');
      return summaryAdapter.summarize({ aggregate, referenceDate });
    },
  });
}

export { buildDistrictAiSummaryInput };
