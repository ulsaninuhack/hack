import { createHash } from 'node:crypto';

import { buildTodayContactQueue } from './contact-ops.mjs';

// Three-tier adapter layer (P1). The frozen engines (contact-ops.mjs,
// contact-triage-scoring.mjs) stay untouched; every function here derives
// '제안/후보' views from already-recorded state and never confirms anything
// (INV14). Confirmation is a separate explicit human action in the service.

const CASE_ID_PATTERN = /^SYN-HH-\d{10}-\d{4}$/;
const DONG_CODE_PATTERN = /^\d{10}$/;
const VIRTUAL_PHONE_LABEL = '[가상]';
const AI_SUMMARY_LABEL = '[AI 생성 · 관측 집계 해석 · 개인 예측 아님]';
const MIXED_SNAPSHOT_WARNING = '분자 2026-07-31 · 분모 2026-06-30 · 서로 다른 기준월의 참고 비율이며 동시점 비율이 아닙니다.';
const WELFARE_MIXED_SNAPSHOT_WARNING = '기초수급 분자 2024-12-31 · 인구 분모 2026-06-30 · 서로 다른 기준일의 참고 밀도이며 동시점 비율이 아닙니다.';
const ACUTE_GRADES = ['정상', '주시', '방문권고', '방문권고-우선'];

const CONTACT_RESULT_LABELS = new Map([
  ['not_attempted', '시도 전'],
  ['connected_ok', '안부 확인 완료'],
  ['connected_concern', '우려 사항 있음'],
  ['no_answer', '연락 안 됨'],
  ['refused', '연락 거부'],
  ['invalid_contact', '연락처 확인 필요'],
]);

const FAMILY_NAMES = Object.freeze([
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍',
]);

// 현재 fixture는 동별 20~50건이다. 마지막 일련번호를 서로 다른 이름에
// 대응시켜 한 동 안에서는 이름이 겹치지 않도록 한다. 내부 식별자는 그대로
// 유지하지만 사용자 화면에는 이 표시명만 전달한다.
const GIVEN_NAMES = Object.freeze([
  '영자', '순자', '정자', '미자', '춘자', '옥자', '명자', '경자', '복자', '금자',
  '영숙', '정숙', '현숙', '선희', '영희', '순희', '명희', '성자', '은자', '화자',
  '점순', '말순', '재순', '봉순', '영순', '순덕', '정순', '미순', '경순', '명순',
  '영옥', '정옥', '미옥', '명옥', '길자', '귀자', '영수', '성수', '동수', '종수',
  '정호', '영호', '성호', '태수', '창수', '만수', '덕수', '병철', '상철', '영철',
]);

const DISTRICT_AUTHORED_GUIDANCE = Object.freeze({
  강화군: '고령 인구와 일인가구 비율을 함께 보고, 읍·면별 접근 여건은 담당자가 별도로 확인하는 편이 좋습니다.',
  검단구: '구조 맥락만으로 업무량을 판단하지 말고 연결단원당 예정 건수와 기한 경과 업무를 함께 확인해야 합니다.',
  계양구: '운영 부하와 생활 여건 참고값이 동시에 나타나므로, 기한 경과 업무를 먼저 정리한 뒤 증원 필요를 검토할 수 있습니다.',
  남동구: '연결단원당 예정 건수와 전체 예정 건수를 함께 보면 단기 업무 조정 필요성을 검토하기에 적합합니다.',
  미추홀구: '일인가구 비율과 구조 맥락, 운영 부하를 나란히 보고 어느 한 지표만으로 우선순위를 확정하지 않아야 합니다.',
  부평구: '예정 업무와 기한 경과 업무가 함께 쌓이는지 확인하고, 기존 인력 안에서 조정 가능한 범위를 먼저 살펴볼 수 있습니다.',
  서해구: '구조 맥락과 연결단원당 업무량의 방향이 다를 수 있으므로 두 축을 분리해 검토하는 것이 중요합니다.',
  연수구: '현재 집계의 상대적 규모뿐 아니라 동별 편차와 기한 경과 업무가 특정 동에 몰리는지 추가로 확인해야 합니다.',
  영종구: '일인가구 비율과 복지시설 수를 함께 참고하되, 시설 수만으로 실제 접근 가능성을 판단하지 않아야 합니다.',
  옹진군: '고령 인구와 일인가구 비율이 높게 관찰되지만, 섬 지역의 이동 여건은 이 집계에 포함되지 않아 별도 현장 검토가 필요합니다.',
  제물포구: '구조 맥락 참고값이 높게 나타나는 만큼 단순 건수 확대보다 보고 근거와 후속 확인의 품질을 함께 살펴보는 편이 좋습니다.',
});

function assertIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
      || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${label} must be a valid ISO date`);
  }
}

function assertCaseId(caseId) {
  if (typeof caseId !== 'string' || !CASE_ID_PATTERN.test(caseId)) {
    throw new TypeError('caseId must be a synthetic SYN-HH identifier');
  }
}

export function contactResultLabel(result) {
  return CONTACT_RESULT_LABELS.get(result) ?? '기록 없음';
}

export function deriveCaseDisplayName(caseId) {
  assertCaseId(caseId);
  const match = CASE_ID_PATTERN.exec(caseId);
  const dongCode = caseId.slice(7, 17);
  const ordinal = Number(caseId.slice(-4));
  const index = Math.max(ordinal - 1, 0);
  const family = FAMILY_NAMES[(Number(dongCode.slice(-2)) + index) % FAMILY_NAMES.length];
  const given = GIVEN_NAMES[index % GIVEN_NAMES.length];
  if (!match || !family || !given) throw new TypeError('caseId cannot be mapped to a display name');
  return `${family}${given}`;
}

// INV15: the only phone shape this system ever emits is a clearly-virtual
// 010-0000-XXXX display string with the [가상] label. Derived at serve time so
// fixtures never carry a phone-like value (INV4 stays intact).
export function deriveVirtualPhone(caseId) {
  assertCaseId(caseId);
  const digest = createHash('sha256').update(`virtual-phone:${caseId}`).digest();
  const suffix = String(digest.readUInt32BE(0) % 10_000).padStart(4, '0');
  return {
    label: VIRTUAL_PHONE_LABEL,
    display_number: `010-0000-${suffix}`,
    dialable: false,
    note: '가상 번호 · 실제 발신이 이루어지지 않습니다',
  };
}

function observedSigns(observations) {
  const signs = observations?.관찰_6징후 || {};
  return Object.entries(signs).filter(([, value]) => value === true).map(([key]) => key);
}

// 결정론 기관 권고 룰 테이블: 신호 조합 -> '권고 + 사유'까지만 (INV14).
export function buildAgencyRecommendations({ observations, household, triage }) {
  if (!observations || typeof observations !== 'object') {
    throw new TypeError('observations must be an object');
  }
  const recommendations = [];
  const push = (agency, reason, basisDocuments) => {
    recommendations.push({
      기관: agency,
      사유: reason,
      근거_문서: basisDocuments,
      성격: '권고',
      확정_권한: '동 행정복지센터',
    });
  };

  if (observations.최근_건강_정신_괴로움 === true) {
    push('정신건강복지센터', '최근 건강·정신적 괴로움 관찰 보고', ['매뉴얼_p49']);
  }
  const mealConcern = observations.식사상태 === '심각' || observations.식사상태 === '불량';
  const hygieneConcern = observations.위생상태 === '불량';
  if (mealConcern || hygieneConcern) {
    const parts = [];
    if (mealConcern) parts.push(`식사상태 ${observations.식사상태}`);
    if (hygieneConcern) parts.push('위생상태 불량');
    push('보건소·의료 연계', `${parts.join(' · ')} 관찰`, ['매뉴얼_p49']);
  }
  const isolated = observations.관계망_유무 === '없음';
  if (observations.공과금_2개월_이상_체납 === true || (isolated && (mealConcern || hygieneConcern))) {
    const reason = observations.공과금_2개월_이상_체납 === true
      ? '공과금 2개월 이상 체납 관찰·보고'
      : '관계망 부재와 생활 상태 어려움이 함께 관찰됨';
    push('구 희망복지지원단', reason, ['매뉴얼_p11', '매뉴얼_p49']);
  }
  const signs = observedSigns(observations);
  const noAnswerStreak = household?.contact?.consecutive_no_answer_count ?? 0;
  const transferRecommended = household?.workflow?.transfer_status === 'recommended';
  const visitGrade = ['방문권고', '방문권고-우선'].includes(triage?.급성도_등급);
  if (signs.length > 0 || noAnswerStreak >= 2 || transferRecommended || visitGrade) {
    const reasons = [];
    if (signs.length > 0) reasons.push(`관찰 6징후 중 ${signs.length}개 확인`);
    if (noAnswerStreak >= 2) reasons.push(`연속 미응답 ${noAnswerStreak}회`);
    if (transferRecommended) reasons.push('행정복지센터 이관 권고 상태');
    if (visitGrade) reasons.push(`급성도 등급 ${triage.급성도_등급}`);
    push('현장 확인', reasons.join(' · '), ['매뉴얼_p14', '매뉴얼_p48']);
  }
  return recommendations;
}

function reasonSummary(triage) {
  return [...(triage?.점수_기여내역 ?? [])]
    .sort((left, right) => right.가산점 - left.가산점
      || String(left.코드 ?? '').localeCompare(String(right.코드 ?? '')))
    .slice(0, 3)
    .map((item) => ({ 축: item.축, 근거: item.근거, 가산점: item.가산점 }));
}

// 조사원 제출(기존 contact-results 경로) 결과를 동 센터 인박스용 구조화 보고
// 카드로 파생한다. 세션에 기록된 결과가 있는 케이스만 카드가 된다.
export function buildReportCard(record) {
  if (!record || typeof record !== 'object' || !record.household) {
    throw new TypeError('record must be a stored contact-ops record');
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 1 || record.triage === null) {
    return null;
  }
  const { household, observations, triage } = record;
  if (!ACUTE_GRADES.includes(triage.급성도_등급)) {
    throw new TypeError('report card requires an engine acute grade');
  }
  return {
    synthetic: true,
    displayMarker: '[합성]',
    card_id: `RPT-${household.id}-r${record.revision}`,
    case_id: household.id,
    display_name: deriveCaseDisplayName(household.id),
    road_address: household.location.road_address ?? null,
    revision: record.revision,
    dong_code: household.location.current_admin_dong_code_20260701,
    dong_name: household.location.current_admin_dong_name_20260701,
    district: household.location.current_district_name_20260701,
    등급: triage.급성도_등급,
    급성도_점수: triage.급성도_점수,
    취약도_점수: triage.취약도_점수,
    권고_액션: triage.권고_액션,
    사유_요약: reasonSummary(triage),
    evidence: {
      관찰: structuredClone(observations),
      마지막_연락_일자: household.contact.last_contact_date,
      마지막_연락_결과_라벨: contactResultLabel(household.contact.last_contact_result),
      연속_미응답_횟수: household.contact.consecutive_no_answer_count,
    },
    권고_기관: buildAgencyRecommendations({ observations, household, triage }),
    workflow: {
      follow_up_status: household.workflow.follow_up_status,
      transfer_status: household.workflow.transfer_status,
      transfer_label: household.workflow.transfer_status === 'recommended'
        ? '행정복지센터 이관 권고' : null,
      visit_approval_status: household.workflow.visit_approval_status,
    },
    virtual_phone: deriveVirtualPhone(household.id),
  };
}

function parseMinutes(value, label) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) throw new TypeError(`${label} must be HH:MM`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function timeWindowsOverlap(left, right) {
  const leftStart = parseMinutes(left.start, 'time window start');
  const leftEnd = parseMinutes(left.end, 'time window end');
  const rightStart = parseMinutes(right.start, 'time window start');
  const rightEnd = parseMinutes(right.end, 'time window end');
  return leftStart < rightEnd && rightStart < leftEnd;
}

function laneFor(household, dueIds) {
  if (household.workflow.visit_approval_status === 'approved') return 'visit';
  if (!dueIds.has(household.id)) return null;
  return household.contact.preferred_contact_method === 'visit' ? 'visit' : 'phone';
}

// 자동 할당 제안 엔진(결정론): due일·급성도 등급·동 매칭·연결단원 용량.
// 산출물은 전부 status='proposed' — 확정은 서비스 계층의 명시적 확인 API만
// 수행한다(INV14). 방문 레인은 승인된 방문 또는 방문선호 due만(INV16).
export function buildAssignmentProposals({ records, workers, referenceDate, dongCode = null }) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!Array.isArray(workers)) throw new TypeError('workers must be an array');
  assertIsoDate(referenceDate, 'referenceDate');
  if (dongCode !== null && !DONG_CODE_PATTERN.test(dongCode)) {
    throw new TypeError('dongCode must be a 10-digit current admin dong code');
  }

  const scoped = dongCode === null
    ? records
    : records.filter(({ household }) => household.location.current_admin_dong_code_20260701 === dongCode);
  const queue = buildTodayContactQueue(scoped.map(({ household }) => household), referenceDate);
  const queueOrder = new Map(queue.map((item, index) => [item.household_id, { index, item }]));
  const dueIds = new Set(queue.map((item) => item.household_id));

  const workerByDong = new Map();
  for (const worker of workers) {
    for (const code of worker.constraints.assigned_admin_dong_codes_20260701) {
      workerByDong.set(code, worker);
    }
  }

  const batches = new Map();
  for (const record of scoped) {
    const { household, triage } = record;
    const lane = laneFor(household, dueIds);
    if (lane === null) continue;
    const code = household.location.current_admin_dong_code_20260701;
    const worker = workerByDong.get(code) ?? null;
    const queueEntry = queueOrder.get(household.id) ?? null;
    const proposal = {
      status: 'proposed',
      case_id: household.id,
      display_name: deriveCaseDisplayName(household.id),
      road_address: household.location.road_address ?? null,
      last_contact: {
        date: household.contact.last_contact_date,
        result_label: contactResultLabel(household.contact.last_contact_result),
      },
      lane,
      dong_code: code,
      dong_name: household.location.current_admin_dong_name_20260701,
      district: household.location.current_district_name_20260701,
      worker_id: worker?.id ?? null,
      worker_display_name: worker?.display_name ?? null,
      급성도_등급: triage?.급성도_등급 ?? null,
      급성도_점수: triage?.급성도_점수 ?? null,
      grade_source: triage === null ? '미기록' : '세션 기록',
      due_reasons: queueEntry?.item.due_reasons ?? [],
      earliest_due_date: queueEntry?.item.earliest_due_date ?? null,
      preferred_contact_method: household.contact.preferred_contact_method,
      approved_visit: household.workflow.visit_approval_status === 'approved',
      adjustment_flags: [],
      제안_근거: worker
        ? [`담당 동 일치 (${household.location.current_admin_dong_name_20260701})`]
        : ['담당 연결단원 미배정 — 조정 필요'],
    };
    if (!worker) proposal.adjustment_flags.push('no_worker_for_dong');
    if (lane === 'visit' && worker
        && !timeWindowsOverlap(household.visit_context.preferred_visit_time_window, worker.constraints.available_time_window)) {
      proposal.adjustment_flags.push('time_window_mismatch');
      proposal.제안_근거.push('선호 시간창과 연결단원 가용 시간창 불일치 — 조정 필요');
    }
    if (!batches.has(code)) {
      batches.set(code, {
        synthetic: true,
        displayMarker: '[합성]',
        batch_id: `ASSIGN-${referenceDate}-${code}`,
        reference_date: referenceDate,
        dong_code: code,
        dong_name: household.location.current_admin_dong_name_20260701,
        district: household.location.current_district_name_20260701,
        status: 'proposed',
        worker_id: worker?.id ?? null,
        worker_display_name: worker?.display_name ?? null,
        max_daily_approved_visits: worker?.constraints.max_daily_approved_visits ?? null,
        lanes: { phone: [], visit: [] },
      });
    }
    batches.get(code).lanes[lane].push(proposal);
  }

  const sortKey = (proposal) => {
    const entry = queueOrder.get(proposal.case_id);
    return entry ? entry.index : Number.MAX_SAFE_INTEGER;
  };
  for (const batch of batches.values()) {
    batch.lanes.phone.sort((left, right) => sortKey(left) - sortKey(right)
      || left.case_id.localeCompare(right.case_id));
    // 방문 레인은 승인된 방문 → 급성도 점수 내림차순 → due 순서. 급성도
    // 등급이 실제 배치 순서와 용량 판단에 참여한다.
    batch.lanes.visit.sort((left, right) => Number(right.approved_visit) - Number(left.approved_visit)
      || (right.급성도_점수 ?? -1) - (left.급성도_점수 ?? -1)
      || sortKey(left) - sortKey(right)
      || left.case_id.localeCompare(right.case_id));
    const capacity = batch.max_daily_approved_visits;
    if (Number.isInteger(capacity)) {
      batch.lanes.visit.forEach((proposal, index) => {
        if (index >= capacity) {
          proposal.adjustment_flags.push('capacity_exceeded');
          proposal.제안_근거.push(`연결단원 일일 승인 방문 용량(${capacity}건) 초과 — 조정 필요`);
        }
      });
    }
  }

  return [...batches.values()].sort((left, right) => left.dong_code.localeCompare(right.dong_code));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function share(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round((numerator / denominator) * 100, 1);
}

function sumFinite(values) {
  return values.filter((value) => Number.isFinite(value)).reduce((sum, value) => sum + value, 0);
}

// 구 단위 롤업(INV17): 케이스 ID·개인 단위 정보 없이 동/구 집계만 반환한다.
export function buildDistrictAggregates({
  storeZones,
  facilityDistribution = {},
  structuralZones = [],
  records,
  workers,
  referenceDate,
}) {
  if (!storeZones || !Array.isArray(storeZones.features)) {
    throw new TypeError('storeZones must be a FeatureCollection');
  }
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!Array.isArray(workers)) throw new TypeError('workers must be an array');
  assertIsoDate(referenceDate, 'referenceDate');

  const districtOfZone = new Map();
  const zonesByDistrict = new Map();
  for (const feature of storeZones.features) {
    const district = feature.properties?.current_district_name_20260701;
    if (typeof district !== 'string' || district.length === 0) continue;
    districtOfZone.set(feature.properties.geometry_zone_id, district);
    if (!zonesByDistrict.has(district)) zonesByDistrict.set(district, []);
    zonesByDistrict.get(district).push(feature.properties);
  }

  const structuralByDistrict = new Map();
  for (const zone of structuralZones) {
    const district = districtOfZone.get(zone.geometry_zone_id);
    if (!district) continue;
    if (!structuralByDistrict.has(district)) structuralByDistrict.set(district, []);
    structuralByDistrict.get(district).push(zone);
  }

  const queue = buildTodayContactQueue(records.map(({ household }) => household), referenceDate);
  const dueIds = new Set(queue.map((item) => item.household_id));
  const operationsByDistrict = new Map();
  const operationsFor = (district) => {
    if (!operationsByDistrict.has(district)) {
      operationsByDistrict.set(district, {
        case_count: 0, due_count: 0, overdue_count: 0,
        pending_visit_approval_count: 0, approved_visit_count: 0, transfer_recommended_count: 0,
      });
    }
    return operationsByDistrict.get(district);
  };
  for (const { household } of records) {
    const bucket = operationsFor(household.location.current_district_name_20260701);
    bucket.case_count += 1;
    if (dueIds.has(household.id)) bucket.due_count += 1;
    const { workflow } = household;
    if (workflow.follow_up_status === 'overdue'
        || (['required'].includes(workflow.follow_up_status)
          && typeof workflow.follow_up_deadline === 'string'
          && workflow.follow_up_deadline < referenceDate)) {
      bucket.overdue_count += 1;
    }
    if (workflow.visit_approval_status === 'recommended') bucket.pending_visit_approval_count += 1;
    if (workflow.visit_approval_status === 'approved') bucket.approved_visit_count += 1;
    if (workflow.transfer_status === 'recommended') bucket.transfer_recommended_count += 1;
  }

  const workerCountByDistrict = new Map();
  for (const worker of workers) {
    const district = worker.location.current_district_name_20260701;
    workerCountByDistrict.set(district, (workerCountByDistrict.get(district) ?? 0) + 1);
  }

  const perWorker = (count, workerCount) => (workerCount > 0 ? round(count / workerCount, 2) : null);

  const districts = [...zonesByDistrict.keys()].sort((left, right) => left.localeCompare(right, 'ko'));
  return districts.map((district) => {
    const zoneRows = zonesByDistrict.get(district);
    const population = sumFinite(zoneRows.map((row) => row.total_population));
    const elderly = sumFinite(zoneRows.map((row) => row.population_age_65_plus));
    const households = sumFinite(zoneRows.map((row) => row.total_households));
    const onePerson = sumFinite(zoneRows.map((row) => row.one_person_households));
    const elderlyOnePerson = sumFinite(zoneRows.map((row) => row.one_person_households_age_65_plus));

    const structural = structuralByDistrict.get(district) ?? [];
    const welfareNumerator = sumFinite(structural.map((zone) => zone.indicators?.basic_livelihood_context_density?.raw_numerator));
    const welfareDenominator = sumFinite(structural.map((zone) => zone.indicators?.basic_livelihood_context_density?.raw_denominator));
    const welfareMissing = structural.filter((zone) => zone.indicators?.basic_livelihood_context_density?.missing !== false).length;
    const scores = structural.map((zone) => zone.score_0_50).filter((value) => Number.isFinite(value));
    const indicatorMeans = {};
    for (const [key, code] of [
      ['older_population_share', '고령비율'],
      ['one_person_household_share', '1인가구비율'],
      ['residential_building_30_plus_share', '노후주택'],
      ['basic_livelihood_context_density', '기초수급_밀도'],
    ]) {
      const contributions = structural
        .map((zone) => zone.indicators?.[key]?.contribution)
        .filter((value) => Number.isFinite(value));
      indicatorMeans[code] = contributions.length > 0
        ? round(contributions.reduce((sum, value) => sum + value, 0) / contributions.length, 2)
        : null;
    }

    const operations = operationsFor(district);
    const workerCount = workerCountByDistrict.get(district) ?? 0;
    return {
      synthetic_operations: true,
      district,
      case_detail_access: 'none_district_rollup_only',
      structure: {
        total_population: population,
        population_age_65_plus: elderly,
        elderly_share_pct: share(elderly, population),
        total_households: households,
        one_person_households: onePerson,
        one_person_household_share_pct: share(onePerson, households),
        one_person_households_age_65_plus: elderlyOnePerson,
        mixed_snapshot_warning: MIXED_SNAPSHOT_WARNING,
        welfare_facility_count: Number.isFinite(facilityDistribution[district]) ? facilityDistribution[district] : 0,
        basic_livelihood: {
          recipient_count_living_age_65_plus: welfareNumerator,
          population_age_65_plus_denominator: welfareDenominator,
          density_pct: share(welfareNumerator, welfareDenominator),
          missing_zone_count: welfareMissing,
          mixed_snapshot_warning: WELFARE_MIXED_SNAPSHOT_WARNING,
        },
        structural_context: {
          model_output_label: '[MODEL OUTPUT — UNVALIDATED]',
          zone_count: structural.length,
          mean_score_0_50: scores.length > 0 ? round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 1) : null,
          max_score_0_50: scores.length > 0 ? round(Math.max(...scores), 1) : null,
          indicator_mean_contributions: indicatorMeans,
        },
      },
      operations: {
        synthetic: true,
        displayMarker: '[합성]',
        worker_count: workerCount,
        ...operations,
        per_worker: {
          due: perWorker(operations.due_count, workerCount),
          overdue: perWorker(operations.overdue_count, workerCount),
          pending_visit_approval: perWorker(operations.pending_visit_approval_count, workerCount),
        },
      },
    };
  });
}

// 증원 검토: 구조 맥락과 운영 부하를 나란히, 비합산으로만 정렬 근거를 남긴다.
export function buildStaffingReview(aggregates) {
  if (!Array.isArray(aggregates)) throw new TypeError('aggregates must be an array');
  const byLoad = [...aggregates].sort((left, right) => (right.operations.per_worker.due ?? -1) - (left.operations.per_worker.due ?? -1)
    || left.district.localeCompare(right.district, 'ko'));
  const byStructure = [...aggregates].sort((left, right) => (right.structure.structural_context.mean_score_0_50 ?? -1) - (left.structure.structural_context.mean_score_0_50 ?? -1)
    || left.district.localeCompare(right.district, 'ko'));
  const loadRank = new Map(byLoad.map((item, index) => [item.district, index + 1]));
  const structureRank = new Map(byStructure.map((item, index) => [item.district, index + 1]));
  return {
    title: '증원 검토 후보',
    method_note: '구조 맥락(0~50 기여내역)과 운영 부하(연결단원당 건수)를 나란히 표기하며 합산하지 않습니다. 배치 최적화가 아닙니다.',
    composite_score: null,
    ordering: '운영 부하(연결단원당 due) 내림차순 표시 순서이며 별도의 구조 맥락 순위를 함께 제공',
    candidates: byLoad.map((item) => ({
      district: item.district,
      load_rank: loadRank.get(item.district),
      structure_rank: structureRank.get(item.district),
      per_worker_due: item.operations.per_worker.due,
      per_worker_pending_visit_approval: item.operations.per_worker.pending_visit_approval,
      worker_count: item.operations.worker_count,
      structural_mean_score_0_50: item.structure.structural_context.mean_score_0_50,
      structural_model_output_label: '[MODEL OUTPUT — UNVALIDATED]',
    })),
  };
}

// INV19: 서버가 집계 수치를 주입하고, 생성기는 해석 문장만 만든다. 아래 목
// 생성기는 결정론이며 주입된 수치 문자열만 인용한다.
export function buildDistrictAiSummaryInput(aggregate, referenceDate) {
  if (!aggregate || typeof aggregate !== 'object') {
    throw new TypeError('aggregate must be a district aggregate');
  }
  assertIsoDate(referenceDate, 'referenceDate');
  const metric = (value) => (value === null || value === undefined ? '자료 없음' : String(value));
  return {
    구: aggregate.district,
    기준일: referenceDate,
    노인인구_비율_퍼센트: metric(aggregate.structure.elderly_share_pct),
    일인가구_비율_퍼센트: metric(aggregate.structure.one_person_household_share_pct),
    고령_일인세대_수: metric(aggregate.structure.one_person_households_age_65_plus),
    기초수급_밀도_퍼센트: metric(aggregate.structure.basic_livelihood.density_pct),
    복지시설_수: metric(aggregate.structure.welfare_facility_count),
    연결단원_수: metric(aggregate.operations.worker_count),
    오늘_예정_건수: metric(aggregate.operations.due_count),
    기한_경과_건수: metric(aggregate.operations.overdue_count),
    방문승인_대기_건수: metric(aggregate.operations.pending_visit_approval_count),
    연결단원당_오늘_예정: metric(aggregate.operations.per_worker.due),
  };
}

export function renderAuthoredDistrictAiSummary(input) {
  if (!input || typeof input !== 'object' || typeof input.구 !== 'string') {
    throw new TypeError('input must be a district AI summary input');
  }
  const guidance = DISTRICT_AUTHORED_GUIDANCE[input.구];
  if (!guidance) throw new TypeError('district AI summary has no authored guidance');
  const sentences = [
    `${input.구}는 기준일 ${input.기준일} 관측 집계에서 노인 인구 비율 ${input.노인인구_비율_퍼센트}%, 일인가구 비율 ${input.일인가구_비율_퍼센트}%로 나타납니다.`,
    `고령 일인세대는 ${input.고령_일인세대_수}세대이고, 기초수급 밀도는 ${input.기초수급_밀도_퍼센트}%입니다.`,
    `복지시설은 ${input.복지시설_수}곳, 연결단원은 ${input.연결단원_수}명이 배치되어 있습니다.`,
    `연락업무는 오늘 예정 ${input.오늘_예정_건수}건, 기한 경과 ${input.기한_경과_건수}건, 방문승인 대기 ${input.방문승인_대기_건수}건이며 연결단원 한 명당 오늘 예정은 ${input.연결단원당_오늘_예정}건입니다.`,
    guidance,
    '이 문단은 주입된 집계 수치를 그대로 인용한 해석이며, 개인 단위 예측이나 판정이 아닙니다.',
  ];
  return sentences.join(' ');
}

export function createDistrictAiSummaryAdapter() {
  return Object.freeze({
    async summarize({ aggregate, referenceDate }) {
      const input = buildDistrictAiSummaryInput(aggregate, referenceDate);
      return {
        synthetic: true,
        displayMarker: '[합성]',
        label: AI_SUMMARY_LABEL,
        generator: 'codex_authored_v1',
        district: input.구,
        reference_date: input.기준일,
        input_metrics: input,
        summary_text: renderAuthoredDistrictAiSummary(input),
        mixed_snapshot_warnings: [MIXED_SNAPSHOT_WARNING, WELFARE_MIXED_SNAPSHOT_WARNING],
      };
    },
  });
}

export {
  AI_SUMMARY_LABEL,
  MIXED_SNAPSHOT_WARNING,
  WELFARE_MIXED_SNAPSHOT_WARNING,
  VIRTUAL_PHONE_LABEL,
  timeWindowsOverlap,
};
