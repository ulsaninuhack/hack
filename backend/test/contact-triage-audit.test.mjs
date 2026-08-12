import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const subjectUrl = new URL('../src/contact-triage-scoring.mjs', import.meta.url);

async function auditMildSignalEscalations(inputs) {
  const subject = await import(subjectUrl);
  return subject.auditMildSignalEscalations(inputs);
}

async function summarizeTriageDistribution(inputs) {
  const subject = await import(subjectUrl);
  return subject.summarizeTriageDistribution(inputs);
}

function scoredCase(overrides = {}) {
  const base = {
    케이스_id: 'SYN-HH-2812551000-0001',
    급성도_점수: 0,
    급성도_등급: '정상',
    취약도_점수: 0,
    점수_기여내역: [],
    연속_미응답_횟수: 0,
    식사상태: '양호',
    평소_응답률_대비_급락: false,
  };

  return {
    ...base,
    ...overrides,
    점수_기여내역: overrides.점수_기여내역 ?? base.점수_기여내역,
  };
}

const contribution = (code, points) => ({
  축: '급성도',
  코드: code,
  가산점: points,
  상한_적용: false,
});

describe('contact triage mild-signal reversal audit', () => {
  test('fails visibly when audit anchors are missing from a scored queue item', async () => {
    await assert.rejects(
      () => auditMildSignalEscalations([{
        케이스_id: 'SYN-HH-2812551000-0001',
        급성도_점수: 84,
        급성도_등급: '방문권고-우선',
        점수_기여내역: [],
      }]),
      /audit anchor|연속_미응답/i,
    );
  });

  test('reports mild-only cases that escalate to priority visit recommendation', async () => {
    const result = await auditMildSignalEscalations([
      scoredCase({
        케이스_id: 'mild-priority',
        급성도_점수: 84,
        급성도_등급: '방문권고-우선',
        점수_기여내역: [
          contribution('관찰_6징후', 40),
          contribution('식사상태', 12),
          contribution('위생상태', 10),
          contribution('공과금_2개월_이상_체납', 10),
          contribution('최근_건강_정신_괴로움', 12),
        ],
      }),
    ]);

    assert.deepEqual(result, [
      {
        케이스_id: 'mild-priority',
        급성도_점수: 84,
        급성도_등급: '방문권고-우선',
        기여_코드: [
          '관찰_6징후',
          '식사상태',
          '위생상태',
          '공과금_2개월_이상_체납',
          '최근_건강_정신_괴로움',
        ],
      },
    ]);
  });

  test('does not report priority cases that have a high-salience anchor', async () => {
    const result = await auditMildSignalEscalations([
      scoredCase({
        케이스_id: 'three-misses',
        급성도_점수: 94,
        급성도_등급: '방문권고-우선',
        연속_미응답_횟수: 3,
        점수_기여내역: [
          contribution('연속_미응답', 45),
          contribution('관찰_6징후', 24),
          contribution('식사상태', 25),
        ],
      }),
      scoredCase({
        케이스_id: 'severe-meal',
        급성도_점수: 87,
        급성도_등급: '방문권고-우선',
        식사상태: '심각',
        점수_기여내역: [
          contribution('관찰_6징후', 40),
          contribution('식사상태', 25),
          contribution('위생상태', 10),
          contribution('공과금_2개월_이상_체납', 10),
        ],
      }),
      scoredCase({
        케이스_id: 'baseline-drop',
        급성도_점수: 82,
        급성도_등급: '방문권고-우선',
        평소_응답률_대비_급락: true,
        점수_기여내역: [
          contribution('관찰_6징후', 40),
          contribution('평소_응답률_대비_급락', 20),
          contribution('식사상태', 12),
          contribution('위생상태', 10),
        ],
      }),
    ]);

    assert.deepEqual(result, []);
  });

  test('orders reported mild-only escalations by score descending then case id', async () => {
    const result = await auditMildSignalEscalations([
      scoredCase({
        케이스_id: 'case-b',
        급성도_점수: 84,
        급성도_등급: '방문권고-우선',
        점수_기여내역: [
          contribution('관찰_6징후', 40),
          contribution('식사상태', 12),
          contribution('위생상태', 10),
          contribution('공과금_2개월_이상_체납', 10),
          contribution('최근_건강_정신_괴로움', 12),
        ],
      }),
      scoredCase({
        케이스_id: 'case-a',
        급성도_점수: 84,
        급성도_등급: '방문권고-우선',
        점수_기여내역: [
          contribution('관찰_6징후', 40),
          contribution('식사상태', 12),
          contribution('위생상태', 10),
          contribution('공과금_2개월_이상_체납', 10),
          contribution('최근_건강_정신_괴로움', 12),
        ],
      }),
      scoredCase({
        케이스_id: 'case-c',
        급성도_점수: 99,
        급성도_등급: '방문권고-우선',
        연속_미응답_횟수: 2,
        점수_기여내역: [
          contribution('연속_미응답', 25),
          contribution('관찰_6징후', 40),
          contribution('식사상태', 12),
          contribution('위생상태', 10),
          contribution('최근_건강_정신_괴로움', 12),
        ],
      }),
    ]);

    assert.deepEqual(result.map(({ 케이스_id }) => 케이스_id), ['case-c', 'case-a', 'case-b']);
  });
});

describe('contact triage distribution summary', () => {
  test('counts every acute grade and preserves total cases', async () => {
    const result = await summarizeTriageDistribution([
      scoredCase({ 급성도_등급: '정상' }),
      scoredCase({ 급성도_등급: '주시' }),
      scoredCase({ 급성도_등급: '주시' }),
      scoredCase({ 급성도_등급: '방문권고' }),
      scoredCase({ 급성도_등급: '방문권고-우선' }),
    ]);

    assert.deepEqual(result, {
      전체_건수: 5,
      급성도_등급별_건수: {
        정상: 1,
        주시: 2,
        방문권고: 1,
        '방문권고-우선': 1,
      },
    });
  });

  test('does not emit a composite score in distribution output', async () => {
    const result = await summarizeTriageDistribution([
      scoredCase({ 급성도_등급: '방문권고', 취약도_점수: 90 }),
    ]);

    assert.equal(Object.hasOwn(result, '종합_점수'), false);
    assert.equal(Object.hasOwn(result, '종합점수'), false);
  });
});
