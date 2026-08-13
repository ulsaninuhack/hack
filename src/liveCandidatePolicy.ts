import type { VoiceCandidate } from './threeTierClient'

/**
 * A phone conversation can establish recent outing behavior, but it cannot by
 * itself establish the five environmental signs that require a visit or a
 * separate report from someone nearby.
 */
export function restrictLiveCandidateToPhoneEvidence(candidate: VoiceCandidate): VoiceCandidate {
  return {
    ...candidate,
    observations: {
      ...candidate.observations,
      관찰_6징후: {
        우편물_고지서_적체: false,
        악취_벌레: false,
        쓰레기_술병: false,
        인기척_없이_TV_불: false,
        외출_없음: candidate.observations.관찰_6징후.외출_없음,
        연락_두절: false,
      },
    },
  }
}
