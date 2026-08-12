import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildTriageQueue,
  calculateVulnerabilityScore,
} from '../src/contact-triage-scoring.mjs';

const SIGN_KEYS = [
  '우편물_고지서_적체',
  '악취_벌레',
  '쓰레기_술병',
  '인기척_없이_TV_불',
  '외출_없음',
  '연락_두절',
];

function scoringInput(overrides = {}) {
  const signs = Object.fromEntries(SIGN_KEYS.map((key) => [key, false]));
  const base = {
    계약_버전: 'contact-triage-scoring-input-v0.1.0',
    합성_운영데이터: true,
    케이스_id: 'SYN-HH-2812551000-0001',
    기준일: '2026-08-12',
    관찰_6징후: signs,
    식사상태: '양호',
    위생상태: '양호',
    공과금_2개월_이상_체납: false,
    최근_건강_정신_괴로움: false,
    관계망_유무: '있음',
    연락_빈도: '주_1회_이상',
    연속_미응답_횟수: 0,
    개인_평소_응답률: 0.85,
    평소_응답률_대비_급락: false,
    마지막_연결_후_경과일: 3,
    재연락_기한: '2026-08-13',
    방문_승인_상태: null,
    동단위_구조취약도: {
      지도구역_id: 'vworld_sgis_20250630:23010530',
      현행_행정동_코드_20260701: '2812551000',
      점수: 24,
      기준일_메모: '공개 집계 입력의 기준일을 보존한 테스트 데이터',
      기여내역: [
        { 코드: '고령비율', 가산점: 7, 출처: '공개_동단위_집계' },
        { 코드: '1인가구비율', 가산점: 7, 출처: '공개_동단위_집계' },
        { 코드: '노후주택', 가산점: 6, 출처: '공개_동단위_집계' },
        { 코드: '기초수급_밀도', 가산점: 4, 출처: '공개_동단위_집계' },
      ],
    },
  };

  return {
    ...base,
    ...overrides,
    관찰_6징후: { ...signs, ...overrides.관찰_6징후 },
    동단위_구조취약도: {
      ...base.동단위_구조취약도,
      ...overrides.동단위_구조취약도,
    },
  };
}

function conciseContributions(result, axis) {
  return result.점수_기여내역
    .filter(({ 축 }) => 축 === axis)
    .map(({ 코드, 가산점, 출처 }) => ({ 코드, 가산점, 출처 }));
}

describe('contact triage vulnerability scoring', () => {
  test('adds public dong context, absent network, and social isolation without a composite score', () => {
    const result = calculateVulnerabilityScore(scoringInput({
      관계망_유무: '없음',
      연락_빈도: '주_1회_미만',
    }));

    assert.equal(result.취약도_점수, 74);
    assert.equal(Object.hasOwn(result, '종합_점수'), false);
    assert.deepEqual(conciseContributions(result, '취약도'), [
      { 코드: '동단위_고령비율', 가산점: 7, 출처: '공개_동단위_집계' },
      { 코드: '동단위_1인가구비율', 가산점: 7, 출처: '공개_동단위_집계' },
      { 코드: '동단위_노후주택', 가산점: 6, 출처: '공개_동단위_집계' },
      { 코드: '동단위_기초수급_밀도', 가산점: 4, 출처: '공개_동단위_집계' },
      { 코드: '관계망_없음', 가산점: 25, 출처: '현장_관찰' },
      { 코드: '사회적_고립', 가산점: 25, 출처: '현장_관찰' },
    ]);
  });

  test('treats 주 1회 미만 and 없음 as isolation, while null and weekly contact add nothing', () => {
    for (const value of ['주_1회_미만', '없음']) {
      assert.equal(calculateVulnerabilityScore(scoringInput({ 연락_빈도: value })).취약도_점수, 49);
    }
    for (const value of ['주_1회_이상', null]) {
      assert.equal(calculateVulnerabilityScore(scoringInput({ 연락_빈도: value })).취약도_점수, 24);
    }
  });

  test('rejects a dong score whose four contribution points do not add up', () => {
    assert.throws(
      () => calculateVulnerabilityScore(scoringInput({
        동단위_구조취약도: { 점수: 25 },
      })),
      /동단위.*기여.*합계/,
    );
  });

  test('rejects unsupported relationship and social-contact values instead of under-scoring', () => {
    for (const overrides of [
      { 관계망_유무: '없음 ' },
      { 연락_빈도: '없음 ' },
    ]) {
      assert.throws(
        () => calculateVulnerabilityScore(scoringInput(overrides)),
        /unsupported value/,
      );
    }
  });
});

describe('two-axis triage queue', () => {
  test('sorts by acute score, vulnerability score, elapsed days, then case id', () => {
    const inputs = [
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0004',
        연속_미응답_횟수: 2,
        관찰_6징후: { 악취_벌레: true },
        관계망_유무: '없음',
        마지막_연결_후_경과일: 8,
      }),
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0003',
        연속_미응답_횟수: 2,
        관찰_6징후: { 악취_벌레: true },
        관계망_유무: '없음',
        마지막_연결_후_경과일: 8,
      }),
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0002',
        연속_미응답_횟수: 2,
        관찰_6징후: { 악취_벌레: true },
        관계망_유무: '없음',
        연락_빈도: '없음',
        마지막_연결_후_경과일: 1,
      }),
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0001',
        연속_미응답_횟수: 3,
        관찰_6징후: { 악취_벌레: true },
        마지막_연결_후_경과일: null,
      }),
    ];

    const queue = buildTriageQueue(inputs);

    assert.deepEqual(queue.map(({ 케이스_id }) => 케이스_id), [
      'SYN-HH-2812551000-0001',
      'SYN-HH-2812551000-0002',
      'SYN-HH-2812551000-0003',
      'SYN-HH-2812551000-0004',
    ]);
  });

  test('maps score thresholds to actions and recommends but never auto-approves a visit', () => {
    const [priority, visit, watch, normal] = buildTriageQueue([
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0001',
        연속_미응답_횟수: 3,
        관찰_6징후: { 악취_벌레: true, 외출_없음: true },
        식사상태: '심각',
      }),
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0002',
        연속_미응답_횟수: 2,
        관찰_6징후: { 악취_벌레: true },
        식사상태: '심각',
      }),
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0003',
        연속_미응답_횟수: 3,
      }),
      scoringInput({ 케이스_id: 'SYN-HH-2812551000-0004' }),
    ]);

    assert.deepEqual(
      [priority.권고_액션, visit.권고_액션, watch.권고_액션, normal.권고_액션],
      ['방문권고_우선', '방문권고', '재연락_기한_단축', '재연락_예약'],
    );
    assert.equal(priority.방문_승인_상태, '권고');
    assert.equal(visit.방문_승인_상태, '권고');
    assert.equal(watch.방문_승인_상태, null);
    assert.equal(normal.방문_승인_상태, null);
    assert.ok(![priority, visit, watch, normal].some(
      ({ 방문_승인_상태 }) => 방문_승인_상태 === '승인',
    ));
  });

  test('preserves an existing manager approval or rejection instead of overwriting it', () => {
    const queue = buildTriageQueue([
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0001',
        연속_미응답_횟수: 3,
        관찰_6징후: { 악취_벌레: true },
        방문_승인_상태: '승인',
      }),
      scoringInput({
        케이스_id: 'SYN-HH-2812551000-0002',
        연속_미응답_횟수: 3,
        관찰_6징후: { 악취_벌레: true },
        방문_승인_상태: '반려',
      }),
    ]);

    assert.deepEqual(queue.map(({ 방문_승인_상태 }) => 방문_승인_상태), ['승인', '반려']);
  });

  test('emits separate axes and contributions without mutating inputs or creating a total score', () => {
    const input = scoringInput({
      연속_미응답_횟수: 2,
      관계망_유무: '없음',
    });
    const before = structuredClone(input);

    const [item] = buildTriageQueue([input]);

    assert.deepEqual(input, before);
    assert.equal(item.급성도_점수, 25);
    assert.equal(item.취약도_점수, 49);
    assert.ok(item.점수_기여내역.some(({ 축 }) => 축 === '급성도'));
    assert.ok(item.점수_기여내역.some(({ 축 }) => 축 === '취약도'));
    assert.equal(Object.hasOwn(item, '종합_점수'), false);
  });

  test('rejects non-array queue input', () => {
    assert.throws(() => buildTriageQueue(null), /array/i);
  });

  test('rejects schema-invalid identity, schedule, and dong provenance fields', () => {
    const invalidOverrides = [
      { 케이스_id: undefined },
      { 케이스_id: 'CASE-0001' },
      { 기준일: '2026-02-31' },
      { 마지막_연결_후_경과일: -1 },
      { 마지막_연결_후_경과일: 1.5 },
      { 재연락_기한: 'tomorrow' },
      { 계약_버전: 'contact-triage-scoring-input-v9' },
      { 합성_운영데이터: false },
      { 동단위_구조취약도: { 지도구역_id: '' } },
      { 동단위_구조취약도: { 현행_행정동_코드_20260701: '28125' } },
      { 동단위_구조취약도: { 기준일_메모: '' } },
    ];

    for (const overrides of invalidOverrides) {
      assert.throws(() => buildTriageQueue([scoringInput(overrides)]));
    }
  });

  test('rejects unknown top-level fields and invalid dong contribution provenance', () => {
    const unknownFieldInput = scoringInput();
    unknownFieldInput.종합_점수 = 99;
    assert.throws(() => buildTriageQueue([unknownFieldInput]), /unknown key/);

    const invalidProvenance = scoringInput();
    invalidProvenance.동단위_구조취약도.기여내역[0].출처 = '개인_위기정보';
    assert.throws(() => buildTriageQueue([invalidProvenance]), /출처/);
  });
});
