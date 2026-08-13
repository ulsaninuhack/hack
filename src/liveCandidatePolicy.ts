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

type LiveQuestionCandidate = Pick<VoiceCandidate, 'observations' | 'critic'>

/**
 * Keep the call moving through facts that are still unknown. A concrete
 * contradiction remains more urgent than breadth, but an already populated
 * field must not monopolize the next-question card.
 */
export function selectLiveNextQuestion(candidate?: LiveQuestionCandidate | null): string | null {
  if (!candidate) return null
  if (candidate.critic.contradictions.length > 0 && candidate.critic.next_question) {
    return candidate.critic.next_question
  }

  const observations = candidate.observations
  if (observations.식사상태 === null) return '요즘 식사는 잘 드시고 계신가요?'
  if (observations.최근_건강_정신_괴로움 === null) {
    return '최근 몸이 아프거나 마음이 힘든 일은 없으세요?'
  }
  if (observations.위생상태 === null) return '요즘 씻거나 옷을 갈아입는 데 어려움은 없으세요?'
  if (observations.관계망_유무 === null) return '필요할 때 연락하거나 도움을 청할 분이 계세요?'
  if (observations.공과금_2개월_이상_체납 === null) {
    return '공과금이 밀리거나 내기 어려운 상황은 없으세요?'
  }
  if (candidate.critic.missing_fields.includes('관찰_6징후.외출_없음')) {
    return '최근 며칠 동안 외출하거나 사람을 만난 적이 있으세요?'
  }
  return candidate.critic.next_question
}
