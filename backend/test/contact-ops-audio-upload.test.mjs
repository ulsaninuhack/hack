import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, test } from 'node:test';

import { createApiServer } from '../src/app.mjs';
import { createDataStore } from '../src/data-store.mjs';
import { createVoiceAudioUploader } from '../src/voice-audio-upload.mjs';

const CASE_ID = 'SYN-HH-2812551000-0001';
const SESSION_ID = 'mobile-voice-session-0001';
const store = createDataStore({
  summary: { schemaVersion: 1, project: 'test', metricGuardrail: 'test', counts: {} },
  zones: { type: 'FeatureCollection', features: [] },
  facilities: { type: 'FeatureCollection', features: [] },
  transit: { type: 'FeatureCollection', features: [] },
  validation: { status: 'pass' },
});

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function listen(options) {
  const server = createApiServer({ store, rateLimitPerMinute: 0, ...options });
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function mobileM4a() {
  return new Blob([Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x4d, 0x34, 0x41, 0x20,
  ])], { type: 'audio/mp4' });
}

function uploadForm(overrides = {}) {
  const form = new FormData();
  form.set('expected_revision', overrides.expected_revision ?? '0');
  form.set('contact_date', overrides.contact_date ?? '2026-08-13');
  form.set('surveyor_id', overrides.surveyor_id ?? '연결단원 001');
  form.set('consent_basis', overrides.consent_basis ?? 'verbal_in_recording');
  form.set('audio', overrides.audio ?? mobileM4a(), overrides.filename ?? 'memo.m4a');
  return form;
}

describe('mobile voice audio upload API', () => {
  test('rejects an interrupted multipart stream without leaving a file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voice-upload-aborted-'));
    const uploader = createVoiceAudioUploader({ audioDirectory: directory });
    const request = new PassThrough();
    request.headers = { 'content-type': 'multipart/form-data; boundary=voice-test-boundary' };
    const pending = uploader(request);
    while (request.listenerCount('aborted') === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    request.emit('aborted');

    await assert.rejects(pending, /interrupted/);
    request.end();
    assert.deepEqual(await readdir(directory), []);
  });

  test('stages a random M4A file, reuses the candidate service, and deletes audio afterward', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voice-upload-api-'));
    const calls = [];
    const origin = await listen({
      voiceAudioUploader: createVoiceAudioUploader({ audioDirectory: directory }),
      contactOpsService: {
        async createAiObservation(input) {
          calls.push(input);
          assert.match(input.source.fileReference, /^[0-9a-f-]+\.m4a$/);
          assert.deepEqual(await readdir(directory), [input.source.fileReference]);
          return { synthetic: true, displayMarker: '[합성]', revision: 0, candidate: { confirmed: false } };
        },
      },
    });

    const response = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/ai-observations/audio`, {
      method: 'POST',
      headers: { 'X-Demo-Session-ID': SESSION_ID },
      body: uploadForm(),
    });

    const responseBody = await response.json();
    assert.equal(response.status, 200, JSON.stringify(responseBody));
    assert.equal(responseBody.data.candidate.confirmed, false);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      mode: 'candidate',
      sessionId: SESSION_ID,
      caseId: CASE_ID,
      expectedRevision: 0,
      contactDate: '2026-08-13',
      surveyorId: '연결단원 001',
      source: { kind: 'audio', fileReference: calls[0].source.fileReference },
    });
    assert.deepEqual(await readdir(directory), []);
  });

  test('requires the fixed verbal-in-recording basis without adding a consent UI workflow', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voice-upload-consent-'));
    let called = false;
    const origin = await listen({
      voiceAudioUploader: createVoiceAudioUploader({ audioDirectory: directory }),
      contactOpsService: { async createAiObservation() { called = true; } },
    });

    const response = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/ai-observations/audio`, {
      method: 'POST',
      headers: { 'X-Demo-Session-ID': SESSION_ID },
      body: uploadForm({ consent_basis: 'checkbox' }),
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_VOICE_UPLOAD');
    assert.equal(called, false);
    assert.deepEqual(await readdir(directory), []);
  });

  test('deletes staged audio when candidate generation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voice-upload-failure-'));
    const origin = await listen({
      voiceAudioUploader: createVoiceAudioUploader({ audioDirectory: directory }),
      contactOpsService: {
        async createAiObservation(input) {
          assert.deepEqual(await readdir(directory), [input.source.fileReference]);
          throw new Error('provider details must not leave the service boundary');
        },
      },
    });

    const response = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/ai-observations/audio`, {
      method: 'POST',
      headers: { 'X-Demo-Session-ID': SESSION_ID },
      body: uploadForm(),
    });

    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'CONTACT_OPS_UNAVAILABLE');
    assert.deepEqual(await readdir(directory), []);
  });

  test('stops oversized uploads before the candidate service', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voice-upload-size-'));
    const origin = await listen({
      voiceAudioUploader: createVoiceAudioUploader({ audioDirectory: directory, maxBytes: 8 }),
      contactOpsService: { async createAiObservation() { assert.fail('oversized upload reached service'); } },
    });

    const response = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/ai-observations/audio`, {
      method: 'POST',
      headers: { 'X-Demo-Session-ID': SESSION_ID },
      body: uploadForm(),
    });

    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'INVALID_VOICE_UPLOAD');
    assert.deepEqual(await readdir(directory), []);
  });

  test('rejects spoofed audio, unsupported media, and extra multipart fields', async () => {
    for (const scenario of [
      { audio: new Blob(['not m4a'], { type: 'audio/mp4' }), filename: 'memo.m4a', expectedStatus: 415 },
      { audio: new Blob(['text'], { type: 'text/plain' }), filename: 'memo.txt', expectedStatus: 415 },
      { extra: true, expectedStatus: 400 },
      { duplicateFile: true, expectedStatus: 400 },
    ]) {
      const directory = await mkdtemp(join(tmpdir(), 'voice-upload-invalid-'));
      const origin = await listen({
        voiceAudioUploader: createVoiceAudioUploader({ audioDirectory: directory }),
        contactOpsService: { async createAiObservation() { assert.fail('invalid upload reached service'); } },
      });
      const form = uploadForm(scenario);
      if (scenario.extra) form.set('unexpected', 'value');
      if (scenario.duplicateFile) form.append('audio', mobileM4a(), 'second.m4a');

      const response = await fetch(`${origin}/api/v1/contact-ops/cases/${CASE_ID}/ai-observations/audio`, {
        method: 'POST',
        headers: { 'X-Demo-Session-ID': SESSION_ID },
        body: form,
      });

      assert.equal(response.status, scenario.expectedStatus);
      assert.equal((await response.json()).error.code, 'INVALID_VOICE_UPLOAD');
      assert.deepEqual(await readdir(directory), []);
    }
  });
});
