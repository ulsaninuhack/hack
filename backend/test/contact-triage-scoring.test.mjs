import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const subjectUrl = new URL('../src/contact-triage-scoring.mjs', import.meta.url);

async function calculateAcuityScore(input) {
  const subject = await import(subjectUrl);
  return subject.calculateAcuityScore(input);
}

function scoringInput(overrides = {}) {
  const base = {
    계약_버전: 'contact-triage-scoring-input-v0.1.0',
    합성_운영데이터: true,
    케이스_id: 'SYN-HH-2812551000-0001',
    기준일: '2026-08-12',
    관찰_6징후: {
      우편물_고지서_적체: false,
      악취_벌레: false,
      쓰레기_술병: false,
      인기척_없이_TV_불: false,
      외출_없음: false,
      연락_두절: false,
    },
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
      점수: 0,
      기준일_메모: '골든셋의 급성도 계산과 무관한 공개 집계 입력',
      기여내역: [
        { 코드: '고령비율', 가산점: 0, 출처: '공개_동단위_집계' },
        { 코드: '1인가구비율', 가산점: 0, 출처: '공개_동단위_집계' },
        { 코드: '노후주택', 가산점: 0, 출처: '공개_동단위_집계' },
        { 코드: '기초수급_밀도', 가산점: 0, 출처: '공개_동단위_집계' },
      ],
    },
  };

  return {
    ...base,
    ...overrides,
    관찰_6징후: {
      ...base.관찰_6징후,
      ...overrides.관찰_6징후,
    },
  };
}

function conciseContributions(result) {
  return result.점수_기여내역.map(({ 축, 코드, 가산점, 상한_적용 }) => ({
    축,
    코드,
    가산점,
    상한_적용,
  }));
}

function assertAcuity(result, expected) {
  assert.equal(result.급성도_점수, expected.score);
  assert.equal(result.급성도_원합계, expected.rawScore ?? expected.score);
  assert.equal(result.급성도_클램프_적용, expected.clamped ?? false);
  assert.equal(result.급성도_등급, expected.grade);
  assert.equal(Object.hasOwn(result, '종합_점수'), false);
  assert.deepEqual(conciseContributions(result), expected.contributions);
}

const acute = (code, points, capped = false) => ({
  축: '급성도',
  코드: code,
  가산점: points,
  상한_적용: capped,
});

describe('contact triage acuity golden set', () => {
  test('미응답 2회 + 관찰징후 1개 = 37 → 주시', async () => {
    const result = await calculateAcuityScore(scoringInput({
      연속_미응답_횟수: 2,
      관찰_6징후: { 우편물_고지서_적체: true },
    }));

    assertAcuity(result, {
      score: 37,
      grade: '주시',
      contributions: [acute('연속_미응답', 25), acute('관찰_6징후', 12)],
    });
  });

  test('미응답 2회 + 관찰징후 1개 + 식사심각 = 62 → 방문권고', async () => {
    const result = await calculateAcuityScore(scoringInput({
      연속_미응답_횟수: 2,
      관찰_6징후: { 우편물_고지서_적체: true },
      식사상태: '심각',
    }));

    assertAcuity(result, {
      score: 62,
      grade: '방문권고',
      contributions: [
        acute('연속_미응답', 25),
        acute('관찰_6징후', 12),
        acute('식사상태', 25),
      ],
    });
  });

  test('미응답 3회 단독 = 45 → 주시', async () => {
    const result = await calculateAcuityScore(scoringInput({ 연속_미응답_횟수: 3 }));

    assertAcuity(result, {
      score: 45,
      grade: '주시',
      contributions: [acute('연속_미응답', 45)],
    });
  });

  test('미응답 3회 + 관찰징후 1개 = 57 → 방문권고', async () => {
    const result = await calculateAcuityScore(scoringInput({
      연속_미응답_횟수: 3,
      관찰_6징후: { 악취_벌레: true },
    }));

    assertAcuity(result, {
      score: 57,
      grade: '방문권고',
      contributions: [acute('연속_미응답', 45), acute('관찰_6징후', 12)],
    });
  });

  test('응답 정상 + 식사심각 + 위생불량 = 35 → 주시', async () => {
    const result = await calculateAcuityScore(scoringInput({
      식사상태: '심각',
      위생상태: '불량',
    }));

    assertAcuity(result, {
      score: 35,
      grade: '주시',
      contributions: [acute('식사상태', 25), acute('위생상태', 10)],
    });
  });

  test('미응답 3회 + 관찰징후 2개 + 식사심각 = 94 → 방문권고-우선', async () => {
    const result = await calculateAcuityScore(scoringInput({
      연속_미응답_횟수: 3,
      관찰_6징후: {
        쓰레기_술병: true,
        외출_없음: true,
      },
      식사상태: '심각',
    }));

    assertAcuity(result, {
      score: 94,
      grade: '방문권고-우선',
      contributions: [
        acute('연속_미응답', 45),
        acute('관찰_6징후', 24),
        acute('식사상태', 25),
      ],
    });
  });
});

describe('contact triage acuity rule boundaries', () => {
  test('fails visibly for missing or malformed required acute inputs', async () => {
    await assert.rejects(() => calculateAcuityScore({}), /관찰_6징후|연속_미응답/);
    await assert.rejects(
      () => calculateAcuityScore(scoringInput({ 연속_미응답_횟수: '3' })),
      /연속_미응답_횟수/,
    );
    await assert.rejects(
      () => calculateAcuityScore(scoringInput({ 연속_미응답_횟수: -1 })),
      /연속_미응답_횟수/,
    );
    await assert.rejects(
      () => calculateAcuityScore(scoringInput({ 식사상태: '모름' })),
      /식사상태/,
    );
  });

  test('미응답은 1회 0점, 2회 25점, 3회 이상 45점으로 계단 적용한다', async () => {
    for (const [count, points] of [[1, 0], [2, 25], [3, 45], [9, 45]]) {
      const result = await calculateAcuityScore(scoringInput({ 연속_미응답_횟수: count }));
      assert.equal(result.급성도_점수, points);
    }
  });

  test('개인 평소 응답률 자체가 아니라 급락 판정에만 20점을 준다', async () => {
    const stable = await calculateAcuityScore(scoringInput({
      개인_평소_응답률: 0.95,
      평소_응답률_대비_급락: false,
    }));
    const dropped = await calculateAcuityScore(scoringInput({
      개인_평소_응답률: 0.95,
      평소_응답률_대비_급락: true,
    }));

    assert.equal(stable.급성도_점수, 0);
    assertAcuity(dropped, {
      score: 20,
      grade: '정상',
      contributions: [acute('평소_응답률_대비_급락', 20)],
    });
  });

  test('관찰징후는 개당 12점이지만 네 개 이상은 40점으로 상한 처리한다', async () => {
    const result = await calculateAcuityScore(scoringInput({
      관찰_6징후: {
        우편물_고지서_적체: true,
        악취_벌레: true,
        쓰레기_술병: true,
        인기척_없이_TV_불: true,
      },
    }));

    assertAcuity(result, {
      score: 40,
      grade: '주시',
      contributions: [acute('관찰_6징후', 40, true)],
    });
  });

  test('식사불량 12, 공과금 체납 10, 최근 괴로움 12를 각각 기여내역에 남긴다', async () => {
    const result = await calculateAcuityScore(scoringInput({
      식사상태: '불량',
      공과금_2개월_이상_체납: true,
      최근_건강_정신_괴로움: true,
    }));

    assertAcuity(result, {
      score: 34,
      grade: '주시',
      contributions: [
        acute('식사상태', 12),
        acute('공과금_2개월_이상_체납', 10),
        acute('최근_건강_정신_괴로움', 12),
      ],
    });
    assert.equal(
      result.점수_기여내역.find(({ 코드 }) => 코드 === '공과금_2개월_이상_체납').근거,
      '공과금 체납 관찰 또는 보고',
    );
  });

  test('원합계가 100을 넘으면 기여내역을 보존하고 최종점수만 100으로 클램프한다', async () => {
    const result = await calculateAcuityScore(scoringInput({
      연속_미응답_횟수: 3,
      관찰_6징후: {
        우편물_고지서_적체: true,
        악취_벌레: true,
        쓰레기_술병: true,
        인기척_없이_TV_불: true,
      },
      식사상태: '심각',
      위생상태: '불량',
      공과금_2개월_이상_체납: true,
      최근_건강_정신_괴로움: true,
    }));

    assertAcuity(result, {
      score: 100,
      rawScore: 142,
      clamped: true,
      grade: '방문권고-우선',
      contributions: [
        acute('연속_미응답', 45),
        acute('관찰_6징후', 40, true),
        acute('식사상태', 25),
        acute('위생상태', 10),
        acute('공과금_2개월_이상_체납', 10),
        acute('최근_건강_정신_괴로움', 12),
      ],
    });
  });
});
