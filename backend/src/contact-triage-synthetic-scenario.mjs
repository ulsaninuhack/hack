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

const STRUCTURAL_CODES = ['고령비율', '1인가구비율', '노후주택', '기초수급_밀도'];

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

export function buildSyntheticScenarioInput(household, referenceDate) {
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
    동단위_구조취약도: {
      지도구역_id: household.location.geometry_zone_id,
      현행_행정동_코드_20260701: household.location.current_admin_dong_code_20260701,
      점수: 0,
      기준일_메모: '합성 시나리오에는 검증 전 공개 구조 맥락 점수를 주입하지 않음',
      기여내역: STRUCTURAL_CODES.map((코드) => ({
        코드,
        가산점: 0,
        출처: '공개_동단위_집계',
      })),
    },
  };
}

export function buildSyntheticScenarioTriage(household, referenceDate) {
  return buildTriageQueue([buildSyntheticScenarioInput(household, referenceDate)])[0];
}

export function prepareSyntheticScenarioOverlayRecords(records, referenceDate) {
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
      triage: buildSyntheticScenarioTriage(record.household, referenceDate),
      score_source: 'synthetic_scenario',
    };
  });
}
