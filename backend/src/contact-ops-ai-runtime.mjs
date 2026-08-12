import { resolve } from 'node:path';

const AUDIO_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:wav|mp3)$/i;

export function createContactOpsAiRuntime({ voiceAdapter, audioDirectory }) {
  if (!voiceAdapter
      || typeof voiceAdapter.planContactOpsObservation !== 'function'
      || typeof voiceAdapter.assertContactOpsObservationCandidate !== 'function') {
    throw new TypeError('voice adapter must provide plan and candidate validation');
  }
  if (typeof audioDirectory !== 'string' || audioDirectory.trim() === '') {
    throw new TypeError('audio directory must be configured');
  }
  const root = resolve(audioDirectory);

  return Object.freeze({
    assertContactOpsObservationCandidate(value) {
      return voiceAdapter.assertContactOpsObservationCandidate(value);
    },
    async planContactOpsObservation(input) {
      if (input?.kind === 'text') return voiceAdapter.planContactOpsObservation(input);
      if (input?.kind !== 'audio') throw new TypeError('AI observation source is unsupported');
      if (!AUDIO_REFERENCE_PATTERN.test(input.fileReference || '')) {
        throw new TypeError('validated audio file reference is invalid');
      }
      const { fileReference, ...rest } = input;
      return voiceAdapter.planContactOpsObservation({
        ...rest,
        audioPath: resolve(root, fileReference),
      });
    },
  });
}
