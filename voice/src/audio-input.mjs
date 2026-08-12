import { maskPii, processVoiceInput } from './index.mjs';
import { transcribe } from './transcribe.mjs';

export class AudioInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AudioInputError';
  }
}

/**
 * Stage 3b entry point: audio file -> transcription -> masking -> unchanged 3a.
 */
export async function processAudioFile(input, options = {}) {
  if (!input || typeof input.audioPath !== 'string' || input.audioPath.trim() === '') {
    throw new AudioInputError('audioPath must be a non-empty string.');
  }

  const transcriber = options.transcriber || transcribe;
  let rawTranscript;
  try {
    rawTranscript = await transcriber(input.audioPath, options.transcriptionOptions);
  } catch {
    throw new AudioInputError('Audio transcription failed.');
  }

  if (typeof rawTranscript !== 'string' || rawTranscript.trim() === '') {
    throw new AudioInputError('Audio transcription returned no text.');
  }

  const maskedTranscript = maskPii(rawTranscript);
  return processVoiceInput(
    {
      kind: 'text',
      text: maskedTranscript,
      surveyorId: input.surveyorId,
    },
    options.textOptions,
  );
}
