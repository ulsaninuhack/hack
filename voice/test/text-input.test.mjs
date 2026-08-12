import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  VOICE_OUTPUT_JSON_SCHEMA,
  VoiceInputError,
  assertVoiceOutputContract,
  maskPii,
  processVoiceInput,
} from '../src/index.mjs';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/text-golden.json', import.meta.url), 'utf8'),
);

function mockClient(output, capture = []) {
  return {
    responses: {
      async create(request) {
        capture.push(request);
        return {
          status: 'completed',
          output_text: JSON.stringify(output),
        };
      },
    },
  };
}

test('the committed contract keeps the exact top-level field names', () => {
  assert.deepEqual(Object.keys(VOICE_OUTPUT_JSON_SCHEMA.properties), [
    'intent',
    'surveyor_id',
    'case_id',
    'transcript',
    'condition',
    'contact_result',
  ]);
  assert.deepEqual(VOICE_OUTPUT_JSON_SCHEMA.required, [
    'intent',
    'surveyor_id',
    'case_id',
    'transcript',
    'condition',
    'contact_result',
  ]);
});

for (const fixture of fixtures) {
  test(`golden: ${fixture.name}`, async () => {
    const calls = [];
    const result = await processVoiceInput(fixture.input, {
      client: mockClient(fixture.expected, calls),
      model: 'mock-structured-output-model',
    });

    assert.deepEqual(result, fixture.expected);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'mock-structured-output-model');
    assert.equal(calls[0].store, false);
    assert.equal(calls[0].text.format.type, 'json_schema');
    assert.equal(calls[0].text.format.strict, true);
    assert.deepEqual(calls[0].text.format.schema, VOICE_OUTPUT_JSON_SCHEMA);

    const sent = JSON.parse(calls[0].input[1].content);
    assert.equal(sent.surveyor_id, fixture.input.surveyorId);
    assert.equal(sent.transcript, fixture.expected.transcript);
  });
}

test('masks common PII shapes without changing synthetic IDs', () => {
  const input = 'CASE-0412 연결단원 001 이름: 김민수, +82 10-9876-5432, user@example.com, 900101-1234567, 영종대로 123';
  assert.equal(
    maskPii(input),
    'CASE-0412 연결단원 001 이름: [이름 마스킹], [연락처 마스킹], [이메일 마스킹], [주민번호 마스킹], [주소 마스킹]',
  );
  assert.equal(maskPii('김민수님이 응답했어요'), '[이름 마스킹]님이 응답했어요');
});

test('overrides model-generated triage fields with transcript-only extraction', async () => {
  const input = fixtures[2].input;
  const hallucinated = structuredClone(fixtures[2].expected);
  hallucinated.contact_result.risk_score = 99;
  hallucinated.contact_result.visit_recommended = true;

  const result = await processVoiceInput(input, { client: mockClient(hallucinated) });
  assert.equal(result.contact_result.risk_score, 0);
  assert.equal(result.contact_result.visit_recommended, false);
});

test('accepts explicit surveyor risk score and visit recommendation without confirming a visit', async () => {
  const transcript = 'CASE-0200 연락됐고 위험 점수는 12점으로 기록해요. 방문이 필요합니다.';
  const modelOutput = structuredClone(fixtures[4].expected);
  modelOutput.case_id = 'CASE-0200';
  modelOutput.transcript = transcript;
  modelOutput.contact_result.evidence = [transcript];

  const result = await processVoiceInput(
    { kind: 'text', text: transcript, surveyorId: '연결단원 004' },
    { client: mockClient(modelOutput) },
  );
  assert.equal(result.contact_result.risk_score, 12);
  assert.equal(result.contact_result.visit_recommended, true);
});

test('rejects real-looking or malformed surveyor identifiers before an API call', async () => {
  await assert.rejects(
    processVoiceInput(
      { kind: 'text', text: '오늘 괜찮아요', surveyorId: '홍길동' },
      { client: mockClient({}) },
    ),
    (error) => error instanceof VoiceInputError,
  );
});

test('rejects multiple case IDs to prevent routing the memo to the wrong case', async () => {
  await assert.rejects(
    processVoiceInput(
      {
        kind: 'text',
        text: 'CASE-0001과 CASE-0002를 같이 확인했어요',
        surveyorId: '연결단원 001',
      },
      { client: mockClient({}) },
    ),
    /multiple case IDs/,
  );
});

test('rejects a payload that populates both intent branches', () => {
  const value = structuredClone(fixtures[0].expected);
  value.contact_result = structuredClone(fixtures[2].expected.contact_result);
  assert.throws(() => assertVoiceOutputContract(value), /populate only its matching payload/);
});

test('rejects paraphrased evidence that is not an exact transcript excerpt', () => {
  const value = structuredClone(fixtures[2].expected);
  value.contact_result.evidence = ['대상자가 이틀 동안 식사하지 않음'];
  assert.throws(() => assertVoiceOutputContract(value), /exact excerpt/);
});

test('rejects incomplete or non-JSON model output without exposing transcript data', async () => {
  const input = { kind: 'text', text: '오늘 괜찮아요', surveyorId: '연결단원 001' };
  const incompleteClient = {
    responses: { create: async () => ({ status: 'incomplete', output_text: '' }) },
  };
  const invalidJsonClient = {
    responses: { create: async () => ({ status: 'completed', output_text: 'not-json' }) },
  };

  await assert.rejects(processVoiceInput(input, { client: incompleteClient }), /did not complete/);
  await assert.rejects(processVoiceInput(input, { client: invalidJsonClient }), /not valid JSON/);
});

test('rejects a non-object JSON model response cleanly', async () => {
  const input = { kind: 'text', text: '오늘 괜찮아요', surveyorId: '연결단원 001' };
  const client = {
    responses: { create: async () => ({ status: 'completed', output_text: 'null' }) },
  };
  await assert.rejects(processVoiceInput(input, { client }), /root must be a JSON object/);
});
