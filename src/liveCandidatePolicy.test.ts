import { describe, expect, it } from 'vitest'

import { restrictLiveCandidateToPhoneEvidence } from './liveCandidatePolicy'
import type { VoiceCandidate } from './threeTierClient'

const candidate = {
  case_id: 'SYN-HH-2812551000-0001',
  contact_result: 'connected_concern',
  transcript: '며칠째 밖에 안 나갔고 우편물도 쌓였어요.',
  observations: {
    관찰_6징후: {
      우편물_고지서_적체: true,
      악취_벌레: true,
      쓰레기_술병: true,
      인기척_없이_TV_불: true,
      외출_없음: true,
      연락_두절: true,
    },
    식사상태: '불량',
    위생상태: null,
    공과금_2개월_이상_체납: null,
    최근_건강_정신_괴로움: true,
    관계망_유무: '없음',
    연락_빈도: null,
  },
  free_text: '',
  critic: {
    missing_fields: [],
    contradictions: [],
    low_confidence_fields: [],
    warnings: [],
    next_question: null,
  },
  requires_user_confirmation: true,
} as VoiceCandidate

describe('live phone evidence policy', () => {
  it('keeps recent outing as the only six-sign field that live speech may prefill', () => {
    const restricted = restrictLiveCandidateToPhoneEvidence(candidate)

    expect(restricted.observations.관찰_6징후).toEqual({
      우편물_고지서_적체: false,
      악취_벌레: false,
      쓰레기_술병: false,
      인기척_없이_TV_불: false,
      외출_없음: true,
      연락_두절: false,
    })
    expect(restricted.observations.식사상태).toBe('불량')
    expect(restricted.observations.최근_건강_정신_괴로움).toBe(true)
    expect(candidate.observations.관찰_6징후.우편물_고지서_적체).toBe(true)
  })
})
