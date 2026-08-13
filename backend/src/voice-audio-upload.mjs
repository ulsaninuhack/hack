import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';

import Busboy from 'busboy';

export const MAX_VOICE_AUDIO_BYTES = 25 * 1024 * 1024;

const FIELD_NAMES = Object.freeze([
  'expected_revision',
  'contact_date',
  'surveyor_id',
  'consent_basis',
]);
const FIELD_NAME_SET = new Set(FIELD_NAMES);
const SURVEYOR_ID_PATTERN = /^연결단원 [0-9]{3}$/;
const AUDIO_TYPES = Object.freeze({
  '.m4a': new Set(['audio/m4a', 'audio/mp4', 'audio/x-m4a']),
  '.mp3': new Set(['audio/mpeg', 'audio/mp3']),
  '.wav': new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
});

export class VoiceAudioUploadError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'VoiceAudioUploadError';
    this.status = status;
    this.code = 'INVALID_VOICE_UPLOAD';
  }
}

function hasAudioSignature(extension, header) {
  if (extension === '.m4a') {
    return header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  if (extension === '.wav') {
    return header.length >= 12
      && header.subarray(0, 4).toString('ascii') === 'RIFF'
      && header.subarray(8, 12).toString('ascii') === 'WAVE';
  }
  return (header.length >= 3 && header.subarray(0, 3).toString('ascii') === 'ID3')
    || (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
}

function parseFields(fields) {
  if (Object.keys(fields).length !== FIELD_NAMES.length
      || FIELD_NAMES.some((name) => !Object.hasOwn(fields, name))) {
    throw new VoiceAudioUploadError(400, 'Voice upload fields do not match the required contract.');
  }
  if (!/^(0|[1-9][0-9]*)$/.test(fields.expected_revision)) {
    throw new VoiceAudioUploadError(400, 'expected_revision must be a non-negative integer.');
  }
  const expectedRevision = Number(fields.expected_revision);
  if (!Number.isSafeInteger(expectedRevision)) {
    throw new VoiceAudioUploadError(400, 'expected_revision is outside the supported range.');
  }
  const contactDate = fields.contact_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contactDate)
      || Number.isNaN(Date.parse(`${contactDate}T00:00:00.000Z`))
      || new Date(`${contactDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== contactDate) {
    throw new VoiceAudioUploadError(400, 'contact_date must be a valid ISO date.');
  }
  if (!SURVEYOR_ID_PATTERN.test(fields.surveyor_id)) {
    throw new VoiceAudioUploadError(400, 'surveyor_id must be a synthetic display ID.');
  }
  if (fields.consent_basis !== 'verbal_in_recording') {
    throw new VoiceAudioUploadError(400, 'The recording must carry the verbal consent basis.');
  }
  return {
    expectedRevision,
    contactDate,
    surveyorId: fields.surveyor_id,
  };
}

async function removeStagedFile(path) {
  if (!path) return;
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function createVoiceAudioUploader({ audioDirectory, maxBytes = MAX_VOICE_AUDIO_BYTES }) {
  if (typeof audioDirectory !== 'string' || audioDirectory.trim() === '') {
    throw new TypeError('audioDirectory is required');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_VOICE_AUDIO_BYTES) {
    throw new TypeError('maxBytes must be within the voice upload limit');
  }
  const root = resolve(audioDirectory);

  return async function stageVoiceAudio(request) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    let parser;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          fieldNameSize: 64,
          fieldSize: 128,
          fields: FIELD_NAMES.length,
          fileSize: maxBytes,
          files: 1,
          parts: FIELD_NAMES.length + 2,
        },
      });
    } catch {
      throw new VoiceAudioUploadError(415, 'Content-Type must be multipart/form-data with a boundary.');
    }

    return new Promise((resolveUpload, rejectUpload) => {
      const fields = {};
      let stagedPath = null;
      let fileReference = null;
      let fileCompletion = null;
      let failure = null;
      let fileCount = 0;
      let settled = false;

      const rejectAfterCleanup = async (error) => {
        if (settled) return;
        settled = true;
        try {
          await removeStagedFile(stagedPath);
        } finally {
          rejectUpload(error instanceof VoiceAudioUploadError
            ? error
            : new VoiceAudioUploadError(400, 'Voice upload could not be received.'));
        }
      };

      parser.on('field', (name, value, info) => {
        if (!FIELD_NAME_SET.has(name) || Object.hasOwn(fields, name)
            || info.nameTruncated || info.valueTruncated) {
          failure ||= new VoiceAudioUploadError(400, 'Voice upload contains unsupported or duplicate fields.');
          return;
        }
        fields[name] = value;
      });

      parser.on('file', (name, stream, info) => {
        fileCount += 1;
        const extension = extname(info.filename || '').toLowerCase();
        if (name !== 'audio' || fileCount !== 1 || !Object.hasOwn(AUDIO_TYPES, extension)
            || !AUDIO_TYPES[extension].has(String(info.mimeType || '').toLowerCase())) {
          failure ||= new VoiceAudioUploadError(415, 'Voice audio type is unsupported.');
          stream.resume();
          return;
        }

        fileReference = `${randomUUID()}${extension}`;
        stagedPath = join(root, fileReference);
        if (basename(stagedPath) !== fileReference || !resolve(stagedPath).startsWith(`${root}/`)) {
          failure ||= new VoiceAudioUploadError(400, 'Voice upload path is invalid.');
          stream.resume();
          return;
        }

        let header = Buffer.alloc(0);
        let limited = false;
        stream.on('data', (chunk) => {
          if (header.length < 12) header = Buffer.concat([header, chunk]).subarray(0, 12);
        });
        stream.once('limit', () => { limited = true; });

        const writer = createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 });
        stream.pipe(writer);
        fileCompletion = finished(writer).then(() => {
          if (limited) throw new VoiceAudioUploadError(413, 'Voice audio must not exceed 25 MB.');
          if (!hasAudioSignature(extension, header)) {
            throw new VoiceAudioUploadError(415, 'Voice audio content does not match its type.');
          }
        });
      });

      parser.once('filesLimit', () => {
        failure ||= new VoiceAudioUploadError(400, 'Voice upload must contain exactly one audio file.');
      });
      parser.once('fieldsLimit', () => {
        failure ||= new VoiceAudioUploadError(400, 'Voice upload contains too many fields.');
      });
      parser.once('partsLimit', () => {
        failure ||= new VoiceAudioUploadError(400, 'Voice upload contains too many parts.');
      });
      parser.once('error', rejectAfterCleanup);
      request.once('aborted', () => rejectAfterCleanup(new VoiceAudioUploadError(400, 'Voice upload was interrupted.')));
      request.once('error', rejectAfterCleanup);

      parser.once('close', async () => {
        try {
          await fileCompletion;
          if (failure) throw failure;
          if (fileCount !== 1 || !fileReference || !stagedPath) {
            throw new VoiceAudioUploadError(400, 'Voice upload must contain exactly one audio file.');
          }
          const parsed = parseFields(fields);
          settled = true;
          let cleaned = false;
          resolveUpload({
            ...parsed,
            fileReference,
            async cleanup() {
              if (cleaned) return;
              cleaned = true;
              await removeStagedFile(stagedPath);
            },
          });
        } catch (error) {
          await rejectAfterCleanup(error);
        }
      });

      request.pipe(parser);
    });
  };
}
