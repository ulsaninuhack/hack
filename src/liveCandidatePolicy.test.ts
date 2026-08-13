import { describe, expect, it } from 'vitest'

import { isCandidateValuePending, restrictLiveCandidateToPhoneEvidence, selectLiveNextQuestion } from './liveCandidatePolicy'
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

  it('marks a populated low-confidence value pending without erasing it', () => {
    const pendingMeal = {
      ...candidate,
      critic: { ...candidate.critic, low_confidence_fields: ['식사상태'] },
    } as VoiceCandidate
    const missingMeal = {
      ...pendingMeal,
      observations: { ...pendingMeal.observations, 식사상태: null },
      critic: { ...pendingMeal.critic, missing_fields: ['식사상태'] },
    } as VoiceCandidate

    expect(isCandidateValuePending(pendingMeal, '식사상태')).toBe(true)
    expect(pendingMeal.observations.식사상태).toBe('불량')
    expect(isCandidateValuePending(missingMeal, '식사상태')).toBe(false)
  })

  it('asks about an unconfirmed item instead of repeating a checked meal question', () => {
    const partiallyChecked = {
      ...candidate,
      observations: {
        ...candidate.observations,
        위생상태: '불량',
        공과금_2개월_이상_체납: true,
        최근_건강_정신_괴로움: null,
        관계망_유무: null,
      },
      critic: {
        ...candidate.critic,
        next_question: '오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?',
      },
    } as VoiceCandidate

    expect(selectLiveNextQuestion(partiallyChecked)).toBe(
      '최근 몸이 아프거나 마음이 힘든 일은 없으세요?',
    )
  })

  it('uses the Critic question after every live checklist item has a value', () => {
    const fullyChecked = {
      ...candidate,
      observations: {
        ...candidate.observations,
        관찰_6징후: { ...candidate.observations.관찰_6징후, 외출_없음: true },
        위생상태: '양호',
        공과금_2개월_이상_체납: false,
        최근_건강_정신_괴로움: false,
        관계망_유무: '있음',
      },
      critic: { ...candidate.critic, next_question: '식사량이 줄어든 기간은 얼마나 되었나요?' },
    } as VoiceCandidate

    expect(selectLiveNextQuestion(fullyChecked)).toBe('식사량이 줄어든 기간은 얼마나 되었나요?')
  })

  it('does not re-ask about outing when the Planner explicitly observed recent outings', () => {
    const explicitOuting = {
      ...candidate,
      observations: {
        ...candidate.observations,
        관찰_6징후: { ...candidate.observations.관찰_6징후, 외출_없음: false },
        위생상태: '양호',
        공과금_2개월_이상_체납: false,
        최근_건강_정신_괴로움: false,
        관계망_유무: '있음',
      },
      critic: { ...candidate.critic, missing_fields: [], next_question: '필요한 도움을 더 말씀해 주시겠어요?' },
    } as VoiceCandidate

    expect(selectLiveNextQuestion(explicitOuting)).toBe('필요한 도움을 더 말씀해 주시겠어요?')
  })
})
