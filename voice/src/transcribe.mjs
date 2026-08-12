import { createReadStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { extname } from 'node:path';

import OpenAI from 'openai';

const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_LANGUAGE = 'ko';
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav']);

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export class TranscriptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

function createClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TranscriptionError(
      'OPENAI_API_KEY is required in voice/.env unless a test client is injected.',
    );
  }
  return new OpenAI({ apiKey });
}

function hasWavSignature(header) {
  return header.length >= 12
    && header.subarray(0, 4).toString('ascii') === 'RIFF'
    && header.subarray(8, 12).toString('ascii') === 'WAVE';
}

function hasMp3Signature(header) {
  const hasId3Tag = header.length >= 3
    && header.subarray(0, 3).toString('ascii') === 'ID3';
  const hasFrameSync = header.length >= 2
    && header[0] === 0xff
    && (header[1] & 0xe0) === 0xe0;
  return hasId3Tag || hasFrameSync;
}

async function assertSupportedAudioFile(audioPath) {
  if (typeof audioPath !== 'string' || audioPath.trim() === '') {
    throw new TranscriptionError('Audio file is unavailable.');
  }

  const extension = extname(audioPath).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new TranscriptionError('Audio file type must be WAV or MP3.');
  }

  let metadata;
  try {
    metadata = await lstat(audioPath);
  } catch {
    throw new TranscriptionError('Audio file is unavailable.');
  }

  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TranscriptionError('Audio file must be a regular file.');
  }
  if (metadata.size === 0) {
    throw new TranscriptionError('Audio file must not be empty.');
  }
  if (metadata.size > MAX_AUDIO_BYTES) {
    throw new TranscriptionError('Audio file must not exceed 25 MB.');
  }

  let handle;
  try {
    handle = await open(audioPath, 'r');
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const receivedHeader = header.subarray(0, bytesRead);
    const validSignature = extension === '.wav'
      ? hasWavSignature(receivedHeader)
      : hasMp3Signature(receivedHeader);
    if (!validSignature) {
      throw new TranscriptionError('Audio file content does not match its extension.');
    }
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError('Audio file is unavailable.');
  } finally {
    await handle?.close();
  }
}

/**
 * File-transcription boundary. The returned raw transcript must remain in
 * memory and be masked immediately by the caller.
 */
export async function transcribe(audioPath, options = {}) {
  await assertSupportedAudioFile(audioPath);

  const client = options.client || createClient();
  const model = options.model
    || process.env.OPENAI_VOICE_TRANSCRIPTION_MODEL
    || DEFAULT_TRANSCRIPTION_MODEL;
  const language = options.language
    || process.env.OPENAI_VOICE_TRANSCRIPTION_LANGUAGE
    || DEFAULT_LANGUAGE;
  const file = createReadStream(audioPath);

  try {
    const response = await client.audio.transcriptions.create({
      file,
      model,
      language,
      response_format: 'json',
    });

    if (typeof response?.text !== 'string' || response.text.trim() === '') {
      throw new TranscriptionError('Audio transcription returned no text.');
    }
    return response.text;
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError('Audio transcription failed.');
  } finally {
    file.destroy();
  }
}
