import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ContactOpsAdapterError,
  assertContactOpsObservationCandidate,
  planContactOpsObservation,
} from '../src/contact-ops-adapter.mjs';

const ROUTE_CASE_ID = 'SYN-HH-2812551000-0001';
const SURVEYOR_ID = '연결단원 001';

function plannerOutput({
  transcript = `${ROUTE_CASE_ID} 전화는 연결됐고 식사는 심각하고 위생도 심각합니다.`,
  caseId = ROUTE_CASE_ID,
  reached = true,
  observation = {},
  riskScore = 82,
  visitRecommended = true,
  riskSignals = ['식사 심각'],
  freeText = '약 복용 확인이 필요함',
} = {}) {
  return {
    intent: 'contact_result',
    surveyor_id: SURVEYOR_ID,
    case_id: caseId,
    transcript,
    condition: null,
    contact_result: {
      reached,
      observation: {
        mail_piled: null,
        odor_bugs: null,
        trash_bottles: null,
        tv_light_on: null,
        no_outing: null,
        no_contact: null,
        meal_status: '심각',
        hygiene: '심각',
        ...observation,
      },
      free_text: freeText,
      risk_signals: riskSignals,
      risk_score: riskScore,
      visit_recommended: visitRecommended,
      evidence: [transcript],
    },
  };
}

function mockPlanner(output, calls = []) {
  return {
    responses: {
      async create(request) {
        calls.push(request);
        return { status: 'completed', output_text: JSON.stringify(output) };
      },
    },
  };
}

test('text Planner output becomes an exact ContactOps candidate with canonical Korean observations', async () => {
  const transcript = `${ROUTE_CASE_ID} 전화는 연결됐고 우편물이 쌓였고 식사는 심각하고 위생도 심각합니다.`;
  const calls = [];
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        observation: { mail_piled: true },
      }), calls),
    },
  );

  assert.deepEqual(Object.keys(result), [
    'schema_version',
    'synthetic',
    'marker',
    'case_id',
    'surveyor_id',
    'source_kind',
    'transcript',
    'contact_result',
    'observations',
    'free_text',
    'critic',
    'stripped_server_owned_fields',
    'requires_user_confirmation',
    'confirmed',
  ]);
  assert.equal(result.case_id, ROUTE_CASE_ID);
  assert.equal(result.schema_version, 'contact-ops-observation-candidate/v2');
  assert.equal(result.contact_result, 'connected_concern');
  assert.deepEqual(result.observations, {
    '관찰_6징후': {
      '우편물_고지서_적체': true,
      '악취_벌레': false,
      '쓰레기_술병': false,
      '인기척_없이_TV_불': false,
      '외출_없음': false,
      '연락_두절': false,
    },
    '식사상태': '심각',
    '위생상태': '불량',
    '공과금_2개월_이상_체납': null,
    '최근_건강_정신_괴로움': null,
    '관계망_유무': null,
    '연락_빈도': null,
  });
  assert.deepEqual(result.stripped_server_owned_fields, [
    'contact_result.risk_score',
    'contact_result.visit_recommended',
  ]);
  assert.deepEqual(result.critic.contradictions, []);
  assert.ok(result.critic.low_confidence_fields.includes('위생상태'));
  assert.ok(result.critic.warnings.includes('위생상태 심각은 서버의 기존 가중치를 바꾸지 않고 정규화된 불량으로 매핑됨'));
  assert.equal(result.requires_user_confirmation, true);
  assert.equal(result.confirmed, false);
  assert.equal(JSON.stringify(result).includes('risk_score'), true);
  assert.equal(Object.hasOwn(result, 'risk_score'), false);
  assert.equal(Object.hasOwn(result, 'visit_recommended'), false);
  assert.equal(calls.length, 1);
});

test('Critic exposes missing and low-confidence fields instead of silently converting unknowns', async () => {
  const result = await planContactOpsObservation(
    { kind: 'text', text: `${ROUTE_CASE_ID} 연락이 안 됐어요.`, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript: `${ROUTE_CASE_ID} 연락이 안 됐어요.`,
        reached: false,
        observation: { meal_status: null, hygiene: null },
      })),
    },
  );

  assert.equal(result.contact_result, 'no_answer');
  for (const field of [
    '관찰_6징후.우편물_고지서_적체',
    '식사상태',
    '위생상태',
    '공과금_2개월_이상_체납',
    '최근_건강_정신_괴로움',
    '관계망_유무',
    '연락_빈도',
  ]) {
    assert.ok(result.critic.missing_fields.includes(field), field);
  }
  assert.ok(result.critic.low_confidence_fields.includes('관찰_6징후.우편물_고지서_적체'));
  assert.equal(result.critic.next_question, null);
});

test('reduced-meal speech becomes a poor-meal candidate and keeps one severity question', async () => {
  const transcript = '요즘 밥을 잘 못 먹어요.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: '심각', hygiene: null },
        riskSignals: [],
        freeText: '식사량이 평소보다 줄었다고 말함',
      })),
    },
  );

  assert.equal(result.observations.식사상태, '불량');
  assert.ok(!result.critic.missing_fields.includes('식사상태'));
  assert.ok(result.critic.warnings.includes('직접적인 결식 발화는 불량 후보로 두고 지속 정도를 추가 확인함'));
  assert.equal(
    result.critic.next_question,
    '오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?',
  );
  assert.equal(result.requires_user_confirmation, true);
  assert.equal(result.confirmed, false);
});

test('explicit repeated no-meal speech becomes at least a poor-meal candidate even when Planner misses it', async () => {
  const transcript = [
    '어, 나 밥도 못 먹고 친구도 없어. 나가지도 않고 씻지도 않았고.',
    '어, 나 밥 안 먹고 요새 안 먹고 있어.',
    '요새 나 밥 안 먹는다고.',
  ].join(' ');
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: null, hygiene: '불량', no_outing: true },
        riskSignals: ['관계망 없음'],
        freeText: '',
      })),
    },
  );

  assert.equal(result.observations.식사상태, '불량');
  assert.ok(!result.critic.missing_fields.includes('식사상태'));
  assert.equal(
    result.critic.next_question,
    '오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?',
  );
  assert.equal(result.requires_user_confirmation, true);
  assert.equal(result.confirmed, false);
});

test('unpaid utility speech becomes a generic arrears candidate even when Planner omits the signal', async () => {
  const transcript = '밥도 안 먹고 있고 씻지도 않고 있고 공과금도 안 내고 있고 돈도 없고.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: null, hygiene: '불량' },
        riskSignals: [],
        freeText: '공과금을 내지 못하고 돈이 없다고 말함',
      })),
    },
  );

  assert.equal(result.observations.식사상태, '불량');
  assert.equal(result.observations.위생상태, '불량');
  assert.equal(result.observations.공과금_2개월_이상_체납, true);
  assert.ok(!result.critic.missing_fields.includes('공과금_2개월_이상_체납'));
  assert.equal(result.requires_user_confirmation, true);
  assert.equal(result.confirmed, false);
});

test('paid or immediately corrected utility speech does not become an arrears candidate', async () => {
  for (const transcript of [
    '공과금을 안 낸 건 아니고 이번 달 것도 제때 냈어요.',
    '전기세가 밀린 건 아니고 모두 납부했어요.',
  ]) {
    const result = await planContactOpsObservation(
      { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
      {
        plannerClient: mockPlanner(plannerOutput({
          transcript,
          caseId: null,
          observation: { meal_status: null, hygiene: null },
          riskSignals: [],
          freeText: '',
        })),
      },
    );

    assert.equal(result.observations.공과금_2개월_이상_체납, false, transcript);
  }
});

test('utility arrears analyzer keeps one unpaid bill and ignores unrelated or exempt statements', async () => {
  const fixtures = [
    ['전기세는 밀렸지만 수도세는 제때 냈어요.', true],
    ['공과금을 못 냈어요.', true],
    ['공과금을 안 냈어요.', true],
    ['전기세 밀린 건 아니고 수도세는 못 냈어요.', true],
    ['수도세는 면제인데 전기세를 못 냈어요.', true],
    ['공과금이 비싸서 걱정이에요.', null],
    ['공과금은 지원 대상이라 안 내도 된대요.', null],
    ['공과금을 안 내면 안 돼요.', null],
  ];
  for (const [transcript, expected] of fixtures) {
    const result = await planContactOpsObservation(
      { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
      {
        plannerClient: mockPlanner(plannerOutput({
          transcript,
          caseId: null,
          observation: { meal_status: null, hygiene: null },
          riskSignals: [],
          freeText: '',
        })),
      },
    );

    assert.equal(result.observations.공과금_2개월_이상_체납, expected, transcript);
    if (expected === true) assert.equal(result.contact_result, 'connected_concern');
  }
});

test('explicit all-day or multi-day no-meal speech becomes serious even when Planner misses it', async () => {
  for (const transcript of ['오늘 한 끼도 못 먹었어요.', '이틀째 밥을 안 먹었어요.']) {
    const result = await planContactOpsObservation(
      { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
      {
        plannerClient: mockPlanner(plannerOutput({
          transcript,
          caseId: null,
          observation: { meal_status: null, hygiene: null },
          riskSignals: [],
          freeText: '',
        })),
      },
    );

    assert.equal(result.observations.식사상태, '심각', transcript);
    assert.ok(!result.critic.missing_fields.includes('식사상태'), transcript);
    assert.equal(result.critic.next_question, null, transcript);
  }
});

test('cooking-only speech does not become a meal-status candidate', async () => {
  const transcript = '요새 돈까스 같은 것도 안 해요.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: null, hygiene: null },
        riskSignals: [],
        freeText: '',
      })),
    },
  );

  assert.equal(result.observations.식사상태, null);
});

test('a direct no-meal phrase immediately corrected by the speaker is not deterministically overridden', async () => {
  const transcript = '밥을 안 먹은 건 아니고 아침에는 죽을 조금 먹었어요.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: '양호', hygiene: null },
        riskSignals: [],
        freeText: '',
      })),
    },
  );

  assert.equal(result.observations.식사상태, '양호');
  assert.equal(result.critic.next_question, null);
});

test('a negated starving phrase is not deterministically upgraded to serious', async () => {
  const transcript = '굶는 건 아니고 아침에는 죽을 먹었어요.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: '양호', hygiene: null },
        riskSignals: [],
        freeText: '',
      })),
    },
  );

  assert.equal(result.observations.식사상태, '양호');
  assert.equal(result.critic.next_question, null);
});

test('Critic does not ask a redundant question when the meal severity is explicit', async () => {
  const transcript = '이틀째 한 끼도 먹지 못했어요.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: '심각', hygiene: null },
        riskSignals: ['식사 심각'],
      })),
    },
  );

  assert.equal(result.observations.식사상태, '심각');
  assert.equal(result.critic.next_question, null);
});

test('Critic preserves conflicting meal statements and asks one time-scope clarification', async () => {
  const transcript = '오늘 아무것도 못 먹었어요. 아침에는 죽을 조금 먹었죠.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: '심각', hygiene: null },
        riskSignals: ['식사 심각'],
      })),
    },
  );

  assert.equal(result.observations.식사상태, null);
  assert.ok(result.critic.contradictions.includes('식사 발화가 서로 달라 추가 확인이 필요함'));
  assert.ok(result.critic.low_confidence_fields.includes('식사상태'));
  assert.equal(
    result.critic.next_question,
    '오늘은 조금 드셨지만 그 전에는 식사를 거의 못 하셨다는 뜻인가요?',
  );
  assert.equal(result.requires_user_confirmation, true);
  assert.equal(result.confirmed, false);
});

test('Critic does not mark different explicit dates as a meal contradiction', async () => {
  const transcript = '어제는 아무것도 못 먹었지만 오늘 아침에는 죽을 조금 먹었어요.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: '불량', hygiene: null },
        riskSignals: ['식사 불량'],
      })),
    },
  );

  assert.equal(result.observations.식사상태, '불량');
  assert.ok(!result.critic.contradictions.includes('식사 발화가 서로 달라 추가 확인이 필요함'));
  assert.equal(result.critic.next_question, null);
});

test('Critic treats an immediately negated no-meal phrase as a correction, not a contradiction', async () => {
  const transcript = '오늘 아무것도 못 먹은 건 아니고 아침에는 죽을 조금 먹었어요.';
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { meal_status: '양호', hygiene: null },
        riskSignals: [],
        freeText: '',
      })),
    },
  );

  assert.equal(result.observations.식사상태, '양호');
  assert.ok(!result.critic.contradictions.includes('식사 발화가 서로 달라 추가 확인이 필요함'));
  assert.equal(result.critic.next_question, null);
});

test('the explicit route case ID is authoritative and mismatch becomes a Critic contradiction', async () => {
  const spokenCaseId = 'SYN-HH-2812551000-0002';
  const transcript = `${spokenCaseId} 연락 결과입니다.`;
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    { plannerClient: mockPlanner(plannerOutput({ transcript, caseId: spokenCaseId })) },
  );

  assert.equal(result.case_id, ROUTE_CASE_ID);
  assert.deepEqual(result.critic.contradictions, [
    `case_id 불일치: 발화 ${spokenCaseId}, 라우트 ${ROUTE_CASE_ID}`,
  ]);
});

test('selected-case memo context maps AI social-isolation signals into the canonical checklist', async () => {
  const transcript = '아 씨발 나 밥 안 먹고 누워만 있어. 사람 안 만나.';
  const calls = [];
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({
        transcript,
        caseId: null,
        observation: { no_outing: true, meal_status: '심각', hygiene: null },
        riskSignals: [
          '식사 심각',
          '공과금 2개월 이상 체납 있음',
          '최근 건강·정신 괴로움 있음',
          '관계망 없음',
          '연락 빈도 없음',
        ],
        freeText: '사람을 만나지 않고 누워만 지냄',
      }), calls),
    },
  );

  assert.equal(result.case_id, ROUTE_CASE_ID);
  assert.equal(result.contact_result, 'connected_concern');
  assert.equal(result.observations.관찰_6징후.외출_없음, true);
  assert.equal(result.observations.식사상태, '불량');
  assert.equal(result.critic.next_question, '오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?');
  assert.equal(result.observations.공과금_2개월_이상_체납, true);
  assert.equal(result.observations.최근_건강_정신_괴로움, true);
  assert.equal(result.observations.관계망_유무, '없음');
  assert.equal(result.observations.연락_빈도, '없음');
  assert.equal(result.free_text, '사람을 만나지 않고 누워만 지냄');
  for (const field of [
    '공과금_2개월_이상_체납',
    '최근_건강_정신_괴로움',
    '관계망_유무',
    '연락_빈도',
  ]) assert.ok(!result.critic.missing_fields.includes(field), field);
  assert.deepEqual(result.critic.contradictions, []);

  const sent = JSON.parse(calls[0].input[1].content);
  assert.deepEqual(sent.contact_context, {
    expected_intent: 'contact_result',
    selected_case_id: ROUTE_CASE_ID,
    source: 'selected_case_voice_memo',
  });
});

for (const serverOwnedField of [
  'no_answer_streak',
  'recontact_deadline',
  'acute_score',
  'visit_approval_status',
  'transfer_completed',
  'route_constraints',
]) {
  test(`Planner cannot add server-owned field: ${serverOwnedField}`, async () => {
    const transcript = `${ROUTE_CASE_ID} 연락 결과입니다.`;
    const output = plannerOutput({ transcript });
    output.contact_result[serverOwnedField] = serverOwnedField === 'acute_score' ? 99 : true;
    await assert.rejects(
      planContactOpsObservation(
        { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
        { plannerClient: mockPlanner(output) },
      ),
      /JSON contract/,
    );
  });
}

test('an injected Critic may add flags but cannot mutate the candidate', async () => {
  const transcript = `${ROUTE_CASE_ID} 연락은 됐지만 상태가 잘 기억나지 않아요.`;
  let received;
  const result = await planContactOpsObservation(
    { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      plannerClient: mockPlanner(plannerOutput({ transcript })),
      critic: async (candidate) => {
        received = candidate;
        return {
          missing_fields: ['식사상태'],
          contradictions: ['연락 결과와 메모 확인 필요'],
          low_confidence_fields: ['위생상태'],
          warnings: ['사용자 확인 필수'],
          next_question: '오늘 식사는 평소와 같았나요, 아니면 양이 줄었나요?',
        };
      },
    },
  );

  assert.equal(received.critic, undefined);
  assert.ok(result.critic.contradictions.includes('연락 결과와 메모 확인 필요'));
  assert.equal(result.confirmed, false);
});

for (const nextQuestion of [
  '위험도 점수를 올릴까요?',
  '내일 방문할까요?',
  '동 행정복지센터에 이관할까요?',
  '식사는 했나요? 위생은 괜찮나요?',
  '식사를 했나요?\n다시 답해 주세요.',
]) {
  test(`Critic rejects unsafe or multi-part next question: ${JSON.stringify(nextQuestion)}`, async () => {
    const transcript = `${ROUTE_CASE_ID} 상태를 잘 모르겠어요.`;
    await assert.rejects(
      planContactOpsObservation(
        { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
        {
          plannerClient: mockPlanner(plannerOutput({ transcript })),
          critic: async () => ({
            missing_fields: [],
            contradictions: [],
            low_confidence_fields: [],
            warnings: [],
            next_question: nextQuestion,
          }),
        },
      ),
      ContactOpsAdapterError,
    );
  });
}

test('validated WAV/MP3/M4A input uses the injected transcriber and the same Planner adapter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'contact-ops-adapter-audio-'));
  const audioPath = join(directory, 'memo.wav');
  await writeFile(audioPath, Buffer.from('RIFF0000WAVEdata'));
  const transcript = `${ROUTE_CASE_ID} 연락이 안 됐어요.`;
  const transcriberCalls = [];

  const result = await planContactOpsObservation(
    { kind: 'audio', audioPath, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      transcriber: async (path) => {
        transcriberCalls.push(path);
        return transcript;
      },
      plannerClient: mockPlanner(plannerOutput({ transcript, reached: false })),
    },
  );

  assert.equal(result.source_kind, 'audio');
  assert.deepEqual(transcriberCalls, [audioPath]);

  const mobileAudioPath = join(directory, 'mobile.m4a');
  await writeFile(mobileAudioPath, Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x4d, 0x34, 0x41, 0x20,
  ]));
  const mobileResult = await planContactOpsObservation(
    { kind: 'audio', audioPath: mobileAudioPath, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
    {
      transcriber: async () => transcript,
      plannerClient: mockPlanner(plannerOutput({ transcript, reached: false })),
    },
  );
  assert.equal(mobileResult.source_kind, 'audio');

  const invalidPath = join(directory, 'memo.txt');
  await writeFile(invalidPath, 'not audio');
  await assert.rejects(
    planContactOpsObservation(
      { kind: 'audio', audioPath: invalidPath, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
      {
        transcriber: async () => assert.fail('invalid audio must not be transcribed'),
        plannerClient: mockPlanner(plannerOutput()),
      },
    ),
    /WAV, MP3, or M4A/,
  );
});

test('live providers are inaccessible without the explicit ContactOps environment gate', async () => {
  const previous = process.env.ENABLE_LIVE_CONTACT_OPS_AI;
  delete process.env.ENABLE_LIVE_CONTACT_OPS_AI;
  try {
    await assert.rejects(
      planContactOpsObservation({
        kind: 'text',
        text: `${ROUTE_CASE_ID} 연락했습니다.`,
        surveyorId: SURVEYOR_ID,
        caseId: ROUTE_CASE_ID,
      }),
      (error) => error instanceof ContactOpsAdapterError
        && /ENABLE_LIVE_CONTACT_OPS_AI=1/.test(error.message),
    );
  } finally {
    if (previous !== undefined) process.env.ENABLE_LIVE_CONTACT_OPS_AI = previous;
  }
});

test('the live gate adds a second Structured Outputs Critic node without exposing server-owned fields', async () => {
  const previous = process.env.ENABLE_LIVE_CONTACT_OPS_AI;
  process.env.ENABLE_LIVE_CONTACT_OPS_AI = '1';
  const transcript = `${ROUTE_CASE_ID} 연락은 됐지만 상태는 잘 모르겠어요.`;
  const calls = [];
  const client = {
    responses: {
      async create(request) {
        calls.push(request);
        const output = calls.length === 1
          ? plannerOutput({ transcript })
          : {
            missing_fields: ['최근_건강_정신_괴로움'],
            contradictions: [],
            low_confidence_fields: ['식사상태'],
            warnings: ['발화 근거를 사용자가 확인해야 함'],
            next_question: '오늘 식사는 평소와 같았나요, 아니면 양이 줄었나요?',
          };
        return { status: 'completed', output_text: JSON.stringify(output) };
      },
    },
  };

  try {
    const result = await planContactOpsObservation(
      { kind: 'text', text: transcript, surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
      { plannerClient: client },
    );

    assert.equal(calls.length, 2);
    assert.equal(calls[1].text.format.type, 'json_schema');
    assert.equal(calls[1].text.format.strict, true);
    const criticInput = JSON.parse(calls[1].input[1].content);
    assert.equal(criticInput.case_id, ROUTE_CASE_ID);
    assert.equal(JSON.stringify(criticInput).includes('risk_score'), false);
    assert.equal(JSON.stringify(criticInput).includes('visit_recommended'), false);
    assert.ok(result.critic.warnings.includes('발화 근거를 사용자가 확인해야 함'));
    assert.equal(result.critic.next_question, '오늘 식사는 평소와 같았나요, 아니면 양이 줄었나요?');
  } finally {
    if (previous === undefined) delete process.env.ENABLE_LIVE_CONTACT_OPS_AI;
    else process.env.ENABLE_LIVE_CONTACT_OPS_AI = previous;
  }
});

test('confirmation validator returns a detached clone and rejects client mutation or forbidden fields', async () => {
  const transcript = `${ROUTE_CASE_ID} 연락했습니다.`;
  const candidate = await planContactOpsObservation(
    {
      kind: 'text',
      text: transcript,
      surveyorId: SURVEYOR_ID,
      caseId: ROUTE_CASE_ID,
    },
    { plannerClient: mockPlanner(plannerOutput({ transcript })) },
  );
  const validated = assertContactOpsObservationCandidate(candidate);
  assert.deepEqual(validated, candidate);
  assert.notEqual(validated, candidate);
  assert.notEqual(validated.observations, candidate.observations);

  for (const mutate of [
    (value) => { value.approval = 'approved'; },
    (value) => { value.confirmed = true; },
    (value) => { value.observations.risk_score = 99; },
    (value) => { value.case_id = 'CASE-0001'; },
    (value) => { value.stripped_server_owned_fields.push('재연락_기한'); },
  ]) {
    const tampered = structuredClone(candidate);
    mutate(tampered);
    assert.throws(() => assertContactOpsObservationCandidate(tampered), ContactOpsAdapterError);
  }
});

test('condition/other Planner intents and non-synthetic route IDs cannot become ContactOps candidates', async () => {
  const condition = plannerOutput();
  condition.intent = 'condition';
  condition.case_id = null;
  condition.condition = {
    status: '피곤함',
    derived_constraints: {
      avoid_stairs: false,
      reduce_workload: true,
      phone_only: false,
      early_finish: true,
    },
  };
  condition.contact_result = null;

  await assert.rejects(
    planContactOpsObservation(
      { kind: 'text', text: '오늘 피곤해요.', surveyorId: SURVEYOR_ID, caseId: ROUTE_CASE_ID },
      { plannerClient: mockPlanner(condition) },
    ),
    /contact_result intent/,
  );
  await assert.rejects(
    planContactOpsObservation(
      { kind: 'text', text: 'CASE-0001 연락', surveyorId: SURVEYOR_ID, caseId: 'CASE-0001' },
      { plannerClient: mockPlanner(plannerOutput()) },
    ),
    /synthetic ContactOps ID/,
  );
});
