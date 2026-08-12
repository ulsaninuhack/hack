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
      free_text: '약 복용 확인이 필요함',
      risk_signals: ['식사 심각'],
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
        };
      },
    },
  );

  assert.equal(received.critic, undefined);
  assert.ok(result.critic.contradictions.includes('연락 결과와 메모 확인 필요'));
  assert.equal(result.confirmed, false);
});

test('validated WAV/MP3 input uses the injected transcriber and the same Planner adapter', async () => {
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
    /WAV or MP3/,
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
