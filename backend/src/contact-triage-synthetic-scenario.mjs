import { createHash } from 'node:crypto';

import { buildTriageQueue } from './contact-triage-scoring.mjs';

const SIGN_KEYS = [
  '우편물_고지서_적체',
  '악취_벌레',
  '쓰레기_술병',
  '인기척_없이_TV_불',
  '외출_없음',
  '연락_두절',
];

const STRUCTURAL_CODE_MAP = [
  ['고령비율', 'older_population_share'],
  ['1인가구비율', 'one_person_household_share'],
  ['노후주택', 'residential_building_30_plus_share'],
  ['기초수급_밀도', 'basic_livelihood_context_density'],
];

const PROFILES = [
  {},
  { misses: 2, signs: 1 },
  { misses: 2, signs: 1, meal: '심각' },
  { misses: 3 },
  { misses: 3, signs: 1 },
  { meal: '심각', hygiene: '불량' },
  { misses: 3, signs: 2, meal: '심각' },
  {
    signs: 4,
    meal: '불량',
    hygiene: '불량',
    utilityArrears: true,
    recentDistress: true,
  },
  {
    misses: 3,
    signs: 4,
    meal: '심각',
    hygiene: '불량',
    utilityArrears: true,
    recentDistress: true,
  },
];

const DEMO_PRECONTACT_SOURCE = 'demo_precontact_record';
const DEMO_PRECONTACT_PROFILE_VERSION = 'demo-precontact-v1';

function digest(id) {
  return createHash('sha256').update(id).digest();
}

function assertReferenceDate(referenceDate) {
  if (typeof referenceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)
      || Number.isNaN(Date.parse(`${referenceDate}T00:00:00Z`))) {
    throw new TypeError('scenario reference date must be an ISO date');
  }
}

function assertSyntheticHousehold(household) {
  if (!household || household.synthetic !== true
      || !/^SYN-HH-\d{10}-\d{4}$/.test(household.id || '')
      || !/^\d{10}$/.test(household.location?.current_admin_dong_code_20260701 || '')
      || typeof household.location?.geometry_zone_id !== 'string') {
    throw new TypeError('synthetic scenario requires a valid synthetic household');
  }
}

export function buildPublicStructuralContext(household, structuralContext = null) {
  assertSyntheticHousehold(household);
  const zeroContext = {
    지도구역_id: household.location.geometry_zone_id,
    현행_행정동_코드_20260701: household.location.current_admin_dong_code_20260701,
    점수: 0,
    기준일_메모: '공개 구조 맥락 데이터가 주입되지 않은 테스트 기본값',
    기여내역: STRUCTURAL_CODE_MAP.map(([코드]) => ({
      코드,
      가산점: 0,
      출처: '공개_동단위_집계',
    })),
  };
  if (structuralContext === null) return zeroContext;
  if (!structuralContext || structuralContext.schema_version !== 'structural-context-p7-v1'
      || structuralContext.model_output_label !== '[MODEL OUTPUT — UNVALIDATED]'
      || !Array.isArray(structuralContext.zones)) {
    throw new TypeError('structural context dataset is invalid');
  }
  const zone = structuralContext.zones.find(
    (item) => item.geometry_zone_id === household.location.geometry_zone_id,
  );
  if (!zone || !zone.indicators || typeof zone.score_0_50 !== 'number') {
    throw new TypeError('household geometry zone is missing structural context');
  }
  const contributions = STRUCTURAL_CODE_MAP.map(([코드, sourceCode]) => {
    const indicator = zone.indicators[sourceCode];
    if (!indicator || typeof indicator.contribution !== 'number') {
      throw new TypeError(`structural context indicator is invalid: ${sourceCode}`);
    }
    return { 코드, 가산점: indicator.contribution, 출처: '공개_동단위_집계' };
  });
  const dates = [...new Set(Object.values(zone.indicators).flatMap(
    (indicator) => Object.values(indicator.reference_dates || {}).filter(Boolean),
  ))].sort();
  return {
    지도구역_id: household.location.geometry_zone_id,
    현행_행정동_코드_20260701: household.location.current_admin_dong_code_20260701,
    점수: zone.score_0_50,
    기준일_메모: `${structuralContext.model_output_label}; 공개 집계 기준일 ${dates.join(', ')}; 혼합 스냅샷`,
    기여내역: contributions,
  };
}

export function buildSyntheticScenarioInput(household, referenceDate, structuralContext = null) {
  assertSyntheticHousehold(household);
  assertReferenceDate(referenceDate);
  const bytes = digest(household.id);
  const profile = PROFILES[bytes[0] % PROFILES.length];
  return {
    계약_버전: 'contact-triage-scoring-input-v0.1.0',
    합성_운영데이터: true,
    케이스_id: household.id,
    기준일: referenceDate,
    관찰_6징후: Object.fromEntries(SIGN_KEYS.map((key, index) => [
      key,
      index < (profile.signs ?? 0),
    ])),
    식사상태: profile.meal ?? '양호',
    위생상태: profile.hygiene ?? '양호',
    공과금_2개월_이상_체납: profile.utilityArrears ?? false,
    최근_건강_정신_괴로움: profile.recentDistress ?? false,
    관계망_유무: bytes[1] % 5 === 0 ? '없음' : '있음',
    연락_빈도: bytes[2] % 7 === 0 ? '없음' : '주_1회_이상',
    연속_미응답_횟수: profile.misses ?? 0,
    개인_평소_응답률: null,
    평소_응답률_대비_급락: false,
    마지막_연결_후_경과일: bytes[3] % 61,
    재연락_기한: household.workflow.follow_up_deadline,
    방문_승인_상태: null,
    동단위_구조취약도: buildPublicStructuralContext(household, structuralContext),
  };
}

export function buildSyntheticScenarioTriage(household, referenceDate, structuralContext = null) {
  return buildTriageQueue([
    buildSyntheticScenarioInput(household, referenceDate, structuralContext),
  ])[0];
}

function observationsFromScenarioInput(input) {
  return {
    관찰_6징후: structuredClone(input.관찰_6징후),
    식사상태: input.식사상태,
    위생상태: input.위생상태,
    공과금_2개월_이상_체납: input.공과금_2개월_이상_체납,
    최근_건강_정신_괴로움: input.최근_건강_정신_괴로움,
    관계망_유무: input.관계망_유무,
    연락_빈도: input.연락_빈도,
  };
}

// A fresh demo session starts with one clearly-labelled, deterministic prior
// contact record per current dong. Prefer a non-0001 case so the established
// golden phone journey remains untouched; within that pool choose the lowest
// recommendation score, then case ID, to avoid a seeded high score masking a
// score created live during the demo.
export function buildDemoPrecontactSeedRecords(
  households,
  referenceDate,
  structuralContext = null,
) {
  if (!Array.isArray(households)) throw new TypeError('households must be an array');
  assertReferenceDate(referenceDate);

  const candidatesByDong = new Map();
  for (const household of households) {
    assertSyntheticHousehold(household);
    const input = buildSyntheticScenarioInput(household, referenceDate, structuralContext);
    const triage = buildTriageQueue([input])[0];
    if (triage.급성도_점수 < 55) continue;
    const code = household.location.current_admin_dong_code_20260701;
    const candidates = candidatesByDong.get(code) ?? [];
    candidates.push({ household, input, triage });
    candidatesByDong.set(code, candidates);
  }

  const records = [];
  for (const candidates of candidatesByDong.values()) {
    const preferred = candidates.filter(({ household }) => !household.id.endsWith('-0001'));
    const pool = preferred.length > 0 ? preferred : candidates;
    const selected = pool.toSorted((left, right) => (
      left.triage.급성도_점수 - right.triage.급성도_점수
      || left.household.id.localeCompare(right.household.id)
    ))[0];
    const contactHistory = {
      ...selected.household.contact,
      consecutive_no_answer_count: selected.input.연속_미응답_횟수,
    };
    const household = {
      ...structuredClone(selected.household),
      contact: contactHistory,
      workflow: {
        ...structuredClone(selected.household.workflow),
        visit_approval_status: 'recommended',
        visit_decision: null,
      },
      approved_visit_constraints: null,
    };
    records.push({
      revision: 1,
      household,
      observations: observationsFromScenarioInput(selected.input),
      triage: {
        ...selected.triage,
        기록_출처: DEMO_PRECONTACT_SOURCE,
        프로필_버전: DEMO_PRECONTACT_PROFILE_VERSION,
      },
      updated_at: `${referenceDate}T00:00:00.000Z`,
    });
  }

  const dongCount = new Set(households.map(
    (household) => household.location.current_admin_dong_code_20260701,
  )).size;
  if (records.length !== dongCount) {
    throw new Error('every current admin dong must have a recommendation-eligible demo seed');
  }
  return records.toSorted((left, right) => left.household.id.localeCompare(right.household.id));
}

export function prepareSyntheticScenarioOverlayRecords(
  records,
  referenceDate,
  structuralContext = null,
) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  assertReferenceDate(referenceDate);

  const exemplarByDong = new Map();
  for (const record of records) {
    assertSyntheticHousehold(record?.household);
    const code = record.household.location.current_admin_dong_code_20260701;
    const current = exemplarByDong.get(code);
    if (!current || record.household.id.localeCompare(current) < 0) {
      exemplarByDong.set(code, record.household.id);
    }
  }

  return records.map((record) => {
    if (record.triage !== null) return { ...record, score_source: 'session_recorded' };
    const code = record.household.location.current_admin_dong_code_20260701;
    if (exemplarByDong.get(code) !== record.household.id) {
      return { ...record, score_source: null };
    }
    return {
      ...record,
      triage: buildSyntheticScenarioTriage(
        record.household,
        referenceDate,
        structuralContext,
      ),
      score_source: 'synthetic_scenario',
    };
  });
}
