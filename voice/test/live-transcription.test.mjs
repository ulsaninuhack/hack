import assert from 'node:assert/strict';
import test from 'node:test';

import { assertVoiceOutputContract } from '../src/index.mjs';
import { processAudioFile } from '../src/audio-input.mjs';

const runLive = process.env.RUN_LIVE_WHISPER === '1';

test('live opt-in: synthetic audio reaches transcription and 3a without crashing', {
  skip: !runLive,
}, async () => {
  const audioPath = process.env.LIVE_WHISPER_AUDIO_PATH;
  if (!audioPath) {
    throw new Error('LIVE_WHISPER_AUDIO_PATH is required for the opt-in live test.');
  }

  const result = await processAudioFile({
    audioPath,
    surveyorId: process.env.LIVE_WHISPER_SURVEYOR_ID || '연결단원 001',
  });

  assert.equal(typeof result.transcript, 'string');
  assert.ok(result.transcript.trim().length > 0);
  assert.deepEqual(assertVoiceOutputContract(result), result);
});
