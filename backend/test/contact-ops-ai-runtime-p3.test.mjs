import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createContactOpsAiRuntime } from '../src/contact-ops-ai-runtime.mjs';

describe('P3 production AI adapter wiring', () => {
  test('passes text through and resolves only a bounded audio basename under the configured directory', async () => {
    const calls = [];
    const voiceAdapter = {
      async planContactOpsObservation(input) { calls.push(input); return { case_id: input.caseId }; },
      assertContactOpsObservationCandidate(value) { return value; },
    };
    const runtime = createContactOpsAiRuntime({ voiceAdapter, audioDirectory: '/srv/contact-ops-audio' });

    await runtime.planContactOpsObservation({
      kind: 'text', text: 'masked', surveyorId: '연결단원 001', caseId: 'SYN-HH-2812551000-0001',
    });
    await runtime.planContactOpsObservation({
      kind: 'audio', fileReference: 'case-0001.wav', surveyorId: '연결단원 001', caseId: 'SYN-HH-2812551000-0001',
    });

    assert.equal(calls[0].text, 'masked');
    assert.equal(calls[1].audioPath, '/srv/contact-ops-audio/case-0001.wav');
    assert.equal(Object.hasOwn(calls[1], 'fileReference'), false);
    assert.deepEqual(runtime.assertContactOpsObservationCandidate({ confirmed: false }), { confirmed: false });
  });

  test('rejects traversal, unsupported sources, and malformed injected voice ports', async () => {
    const voiceAdapter = {
      async planContactOpsObservation(value) { return value; },
      assertContactOpsObservationCandidate(value) { return value; },
    };
    const runtime = createContactOpsAiRuntime({ voiceAdapter, audioDirectory: '/srv/contact-ops-audio' });
    await assert.rejects(() => runtime.planContactOpsObservation({ kind: 'audio', fileReference: '../secret.wav' }), /reference/i);
    await assert.rejects(() => runtime.planContactOpsObservation({ kind: 'url', url: 'https://example.test/a.wav' }), /source/i);
    assert.throws(() => createContactOpsAiRuntime({ voiceAdapter: {}, audioDirectory: '/tmp' }), /voice adapter/i);
    assert.throws(() => createContactOpsAiRuntime({ voiceAdapter, audioDirectory: '' }), /audio directory/i);
  });
});
