import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  auditMildSignalEscalations,
  buildTriageQueue,
  summarizeTriageDistribution,
} from '../src/contact-triage-scoring.mjs';

const fixturePath = new URL('../../public/data/synthetic-households.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

const SIGN_KEYS = [
  '우편물_고지서_적체',
  '악취_벌레',
  '쓰레기_술병',
  '인기척_없이_TV_불',
  '외출_없음',
  '연락_두절',
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

function digest(id) {
  return createHash('sha256').update(id).digest();
}

function scoringInput(household) {
  const bytes = digest(household.id);
  const profile = PROFILES[bytes[0] % PROFILES.length];
  const signs = Object.fromEntries(SIGN_KEYS.map((key, index) => [
    key,
    index < (profile.signs ?? 0),
  ]));
  const adminDongCode = household.location.current_admin_dong_code_20260701;

  return {
    계약_버전: 'contact-triage-scoring-input-v0.1.0',
    합성_운영데이터: true,
    케이스_id: household.id,
    기준일: fixture.scenario_reference_date,
    관찰_6징후: signs,
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
      현행_행정동_코드_20260701: adminDongCode,
      점수: 0,
      기준일_메모: '분포 점검에서 미정인 동단위 정규화 가중치는 주입하지 않음',
      기여내역: [
        { 코드: '고령비율', 가산점: 0, 출처: '공개_동단위_집계' },
        { 코드: '1인가구비율', 가산점: 0, 출처: '공개_동단위_집계' },
        { 코드: '노후주택', 가산점: 0, 출처: '공개_동단위_집계' },
        { 코드: '기초수급_밀도', 가산점: 0, 출처: '공개_동단위_집계' },
      ],
    },
  };
}

const inputs = fixture.households.map(scoringInput);
const queue = buildTriageQueue(inputs);
const inputById = new Map(inputs.map((input) => [input.케이스_id, input]));
const scoredCases = queue.map((item) => {
  const input = inputById.get(item.케이스_id);
  return {
    ...item,
    연속_미응답_횟수: input.연속_미응답_횟수,
    식사상태: input.식사상태,
    평소_응답률_대비_급락: input.평소_응답률_대비_급락,
  };
});
const distribution = summarizeTriageDistribution(scoredCases);
const mildEscalations = auditMildSignalEscalations(scoredCases);

const report = {
  계약_버전: 'contact-triage-distribution-report-v0.1.0',
  자료_성격: 'synthetic_scenario_simulation',
  실제_개인_판정: false,
  기준일: fixture.scenario_reference_date,
  전체_건수: distribution.전체_건수,
  현행_행정동_수: new Set(fixture.households.map(
    ({ location }) => location.current_admin_dong_code_20260701,
  )).size,
  지도구역_수: new Set(fixture.households.map(
    ({ location }) => location.geometry_zone_id,
  )).size,
  동단위_구조취약도_정규화_주입: false,
  급성도_등급별_건수: distribution.급성도_등급별_건수,
  경증_누적_우선권고_건수: mildEscalations.length,
  경증_누적_우선권고_표본: mildEscalations.slice(0, 20),
  해석_주의: [
    '케이스 ID 해시로 고정 시나리오를 배정한 배점 역전 감시용 합성 분포다.',
    '실제 개인 상태, 연락 결과, 복지 적격성 또는 방문 필요성을 나타내지 않는다.',
    '동단위 0~50 정규화 방식은 별도 검증 전이므로 이 리포트에는 주입하지 않았다.',
  ],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
