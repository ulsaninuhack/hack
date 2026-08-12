#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { buildTriageQueue } from '../backend/src/contact-triage-scoring.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function loadSchema(name) {
  const payload = await readFile(
    resolve(repositoryRoot, 'data', 'schemas', name),
    'utf8',
  );
  return JSON.parse(payload);
}

function compile(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function scoringInput() {
  return {
    계약_버전: 'contact-triage-scoring-input-v0.1.0',
    합성_운영데이터: true,
    케이스_id: 'SYN-HH-2812551000-0001',
    기준일: '2026-08-12',
    관찰_6징후: {
      우편물_고지서_적체: false,
      악취_벌레: null,
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
      점수: 24,
      기준일_메모: '공개 집계자료의 서로 다른 기준일을 보존한 합성 운영 입력',
      기여내역: [
        { 코드: '고령비율', 가산점: 7, 출처: '공개_동단위_집계' },
        { 코드: '1인가구비율', 가산점: 7, 출처: '공개_동단위_집계' },
        { 코드: '노후주택', 가산점: 6, 출처: '공개_동단위_집계' },
        { 코드: '기초수급_밀도', 가산점: 4, 출처: '공개_동단위_집계' },
      ],
    },
  };
}

function queueItem() {
  return {
    계약_버전: 'contact-triage-queue-item-v0.1.0',
    합성_운영데이터: true,
    케이스_id: 'SYN-HH-2812551000-0001',
    급성도_점수: 62,
    급성도_원합계: 62,
    급성도_클램프_적용: false,
    급성도_등급: '방문권고',
    취약도_점수: 49,
    점수_기여내역: [
      {
        축: '급성도',
        코드: '연속_미응답',
        근거: '연속 미응답 2회',
        가산점: 25,
        상한_적용: false,
        출처: '연락_이력',
        근거_문서: ['운영_배점표_v0.1.0'],
      },
      {
        축: '취약도',
        코드: '관계망_없음',
        근거: '도움을 요청할 관계망 없음',
        가산점: 25,
        상한_적용: false,
        출처: '현장_관찰',
        근거_문서: ['매뉴얼_p49'],
      },
    ],
    권고_액션: '방문권고',
    방문_승인_상태: '권고',
    마지막_연결_후_경과일: 5,
    재연락_기한: '2026-08-13',
  };
}

function workerInput() {
  return {
    계약_버전: 'contact-triage-worker-input-v0.1.0',
    합성_운영데이터: true,
    연결단원_id: 'SYN-W-2812551000-01',
    제약: {
      계단_가능: true,
      가능_시간대: { 시작: '09:00', 종료: '15:00' },
      담당구역: ['2812551000'],
    },
    안전: {
      '2인1조_필요': false,
      정신건강_동행: false,
    },
    컨디션: {
      상태: '정상',
      갱신시각: '2026-08-12T09:00:00+09:00',
      출처: '시스템_기본값',
    },
  };
}

describe('contact triage scoring-input schema', () => {
  test('accepts the Korean adapter DTO and all six manual-backed signs', async () => {
    const schema = await loadSchema('contact-triage-scoring-input.schema.json');
    const validate = compile(schema);
    const payload = scoringInput();

    assert.equal(validate(payload), true, JSON.stringify(validate.errors));
    assert.deepEqual(Object.keys(payload.관찰_6징후), [
      '우편물_고지서_적체',
      '악취_벌레',
      '쓰레기_술병',
      '인기척_없이_TV_불',
      '외출_없음',
      '연락_두절',
    ]);
  });

  test('requires every sign and accepts only boolean or null observations', async () => {
    const schema = await loadSchema('contact-triage-scoring-input.schema.json');
    const validate = compile(schema);
    const missingSign = scoringInput();
    delete missingSign.관찰_6징후.연락_두절;
    const malformedSign = scoringInput();
    malformedSign.관찰_6징후.악취_벌레 = '의심';

    assert.equal(validate(missingSign), false);
    assert.equal(validate(malformedSign), false);
  });

  test('keeps hygiene to the scored 양호/불량/null contract', async () => {
    const schema = await loadSchema('contact-triage-scoring-input.schema.json');
    const validate = compile(schema);

    assert.equal(validate({ ...scoringInput(), 위생상태: '심각' }), false);
  });

  test('rejects undeclared personal utility-crisis fields', async () => {
    const schema = await loadSchema('contact-triage-scoring-input.schema.json');
    const validate = compile(schema);
    const payload = { ...scoringInput(), 단전_개인정보: true };

    assert.equal(validate(payload), false);
  });

  test('documents manual pages 11, 14, 48, and 49 in the contract', async () => {
    const schema = await loadSchema('contact-triage-scoring-input.schema.json');
    const serialized = JSON.stringify(schema);

    for (const page of ['p11', 'p14', 'p48', 'p49']) {
      assert.match(serialized, new RegExp(page));
    }
  });
});

describe('contact triage queue-item schema', () => {
  test('accepts the actual two-axis queue builder output', async () => {
    const schema = await loadSchema('contact-triage-queue-item.schema.json');
    const validate = compile(schema);
    const [payload] = buildTriageQueue([scoringInput()]);

    assert.equal(validate(payload), true, JSON.stringify(validate.errors));
  });

  test('keeps acute and vulnerability axes separate and forbids a composite score', async () => {
    const schema = await loadSchema('contact-triage-queue-item.schema.json');
    const validate = compile(schema);
    const payload = queueItem();

    assert.equal(validate(payload), true, JSON.stringify(validate.errors));
    assert.equal(Object.hasOwn(payload, '종합_점수'), false);
    assert.equal(
      validate({ ...payload, 종합_점수: payload.급성도_점수 + payload.취약도_점수 }),
      false,
    );
  });

  test('enforces the acute score-to-grade and recommendation thresholds', async () => {
    const schema = await loadSchema('contact-triage-queue-item.schema.json');
    const validate = compile(schema);
    const validCases = [
      [29, '정상', '재연락_예약'],
      [30, '주시', '재연락_기한_단축'],
      [54, '주시', '재연락_기한_단축'],
      [55, '방문권고', '방문권고'],
      [74, '방문권고', '방문권고'],
      [75, '방문권고-우선', '방문권고_우선'],
      [100, '방문권고-우선', '방문권고_우선'],
    ];

    for (const [score, grade, action] of validCases) {
      const payload = {
        ...queueItem(),
        급성도_점수: score,
        급성도_원합계: score,
        급성도_등급: grade,
        권고_액션: action,
      };
      assert.equal(validate(payload), true, `${score}: ${JSON.stringify(validate.errors)}`);
    }

    assert.equal(
      validate({ ...queueItem(), 급성도_점수: 37, 급성도_원합계: 37, 급성도_등급: '정상' }),
      false,
    );
  });

  test('allows recommendations but never represents automatic approval', async () => {
    const schema = await loadSchema('contact-triage-queue-item.schema.json');
    const validate = compile(schema);

    for (const status of [null, '권고', '승인', '반려']) {
      assert.equal(
        validate({ ...queueItem(), 방문_승인_상태: status }),
        true,
        `${status}: ${JSON.stringify(validate.errors)}`,
      );
    }
    assert.equal(validate({ ...queueItem(), 방문_승인_상태: '자동승인' }), false);
  });
});

describe('contact triage worker-input schema', () => {
  test('accepts constraints, safety, and dynamic condition without a global distance field', async () => {
    const schema = await loadSchema('contact-triage-worker-input.schema.json');
    const validate = compile(schema);
    const payload = workerInput();

    assert.equal(validate(payload), true, JSON.stringify(validate.errors));
    assert.equal(Object.hasOwn(payload.제약, '최대거리_km'), false);
  });

  test('rejects max distance before a visit has explicit approval', async () => {
    const schema = await loadSchema('contact-triage-worker-input.schema.json');
    const validate = compile(schema);
    const payload = workerInput();
    payload.제약.최대거리_km = 4;

    assert.equal(validate(payload), false);
  });
});
