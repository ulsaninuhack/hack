import { describe, expect, it } from 'vitest'

import type { LiveCaption } from './liveCallTranscript'
import { buildLiveEvidenceGraph } from './liveEvidenceGraph'
import type { VoiceCandidate } from './threeTierClient'

function turn(input: Partial<LiveCaption> & Pick<LiveCaption, 'itemId' | 'role' | 'text'>): LiveCaption {
  return {
    final: true,
    receivedAt: 1,
    ...input,
  }
}

function candidate(input: Partial<VoiceCandidate> = {}): VoiceCandidate {
  return {
    case_id: 'SYN-HH-2812551000-0001',
    contact_result: 'connected_concern',
    transcript: '요즘 밥을 제대로 못 먹고 밖에도 안 나가요.',
    observations: {
      관찰_6징후: {
        우편물_고지서_적체: false,
        악취_벌레: false,
        쓰레기_술병: false,
        인기척_없이_TV_불: false,
        외출_없음: true,
        연락_두절: false,
      },
      식사상태: '불량',
      위생상태: null,
      공과금_2개월_이상_체납: null,
      최근_건강_정신_괴로움: null,
      관계망_유무: null,
      연락_빈도: null,
    },
    free_text: '',
    critic: {
      missing_fields: [],
      contradictions: [],
      low_confidence_fields: ['식사상태'],
      warnings: [],
      next_question: '오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?',
    },
    requires_user_confirmation: true,
    ...input,
  }
}

describe('live evidence graph projection', () => {
  it('links only finalized resident turns contained in the analyzed transcript', () => {
    const captions: LiveCaption[] = [
      turn({ itemId: 's-1', role: 'surveyor', text: '오늘 식사는 하셨어요?', receivedAt: 1 }),
      turn({ itemId: 'r-1', role: 'resident', text: '요즘 밥을 제대로 못 먹고 밖에도 안 나가요.', receivedAt: 2 }),
      turn({ itemId: 'r-2', role: 'resident', text: '아직 말하는 중', final: false, receivedAt: 3 }),
      turn({ itemId: 'r-3', role: 'resident', text: '방금 새로 한 말', receivedAt: 4 }),
    ]

    const graph = buildLiveEvidenceGraph(captions, candidate())

    expect(graph.graphRevision).toBe(1)
    expect(graph.turns.map((entry) => entry.itemId)).toEqual(['r-1'])
    expect(graph.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: '식사상태', label: '식사 상태', value: '불량', state: 'clarification_needed', evidenceItemIds: ['r-1'] }),
      expect.objectContaining({ field: '관찰_6징후.외출_없음', label: '최근 외출 없음', value: '후보', state: 'proposed', evidenceItemIds: ['r-1'] }),
    ]))
    expect(graph.facts.every((fact) => fact.evidenceItemIds.every((id) => id === 'r-1'))).toBe(true)
  })

  it('does not invent an evidence edge when no utterance contains a field cue', () => {
    const graph = buildLiveEvidenceGraph([
      turn({ itemId: 'r-1', role: 'resident', text: '오늘 날씨가 좋네요.' }),
    ], candidate({
      transcript: '오늘 날씨가 좋네요.',
      observations: {
        ...candidate().observations,
        식사상태: '심각',
      },
    }))

    expect(graph.facts.find((fact) => fact.field === '식사상태')).toBeUndefined()
  })

  it('preserves both meal statements and proposes clarification when they conflict', () => {
    const captions: LiveCaption[] = [
      turn({ itemId: 'r-1', role: 'resident', text: '오늘 아무것도 못 먹었어요.', receivedAt: 1 }),
      turn({ itemId: 'r-2', role: 'resident', text: '아침에는 죽을 조금 먹었죠.', receivedAt: 2 }),
    ]
    const transcript = captions.map((entry) => entry.text).join(' ')
    const graph = buildLiveEvidenceGraph(captions, candidate({
      transcript,
      critic: {
        missing_fields: [],
        contradictions: ['식사 발화가 서로 달라 추가 확인이 필요함'],
        low_confidence_fields: ['식사상태'],
        warnings: [],
        next_question: '오늘은 조금 드셨지만 그 전에는 식사를 거의 못 하셨다는 뜻인가요?',
      },
    }))

    expect(graph.contradictions).toEqual([
      expect.objectContaining({
        field: '식사상태',
        label: '식사 정보가 서로 다릅니다',
        evidenceItemIds: ['r-1', 'r-2'],
        nextQuestion: '오늘은 조금 드셨지만 그 전에는 식사를 거의 못 하셨다는 뜻인가요?',
      }),
    ])
    expect(graph.turns).toEqual([
      expect.objectContaining({ itemId: 'r-1', sequence: 1, text: '오늘 아무것도 못 먹었어요.' }),
      expect.objectContaining({ itemId: 'r-2', sequence: 2, text: '아침에는 죽을 조금 먹었죠.' }),
    ])
  })

  it('does not project a contradiction when the speaker immediately retracts the no-meal phrase', () => {
    const text = '오늘 아무것도 못 먹은 건 아니고 아침에는 죽을 조금 먹었어요.'
    const graph = buildLiveEvidenceGraph([
      turn({ itemId: 'r-1', role: 'resident', text }),
    ], candidate({
      transcript: text,
      observations: { ...candidate().observations, 식사상태: '양호' },
      critic: {
        missing_fields: [],
        contradictions: ['식사 발화가 서로 달라 추가 확인이 필요함'],
        low_confidence_fields: [],
        warnings: [],
        next_question: '오늘은 조금 드셨지만 그 전에는 식사를 거의 못 하셨다는 뜻인가요?',
      },
    }))

    expect(graph.contradictions).toEqual([])
  })

  it('keeps the live phone ledger limited to recent outing among environmental signs', () => {
    const text = '우편물이 쌓였고 냄새와 벌레, 쓰레기와 술병, TV 불도 켜졌지만 요즘 밖에는 안 나가요. 연락도 안 됐어요.'
    const observations = candidate().observations
    const graph = buildLiveEvidenceGraph([
      turn({ itemId: 'r-1', role: 'resident', text }),
    ], candidate({
      transcript: text,
      observations: {
        ...observations,
        관찰_6징후: {
          우편물_고지서_적체: true,
          악취_벌레: true,
          쓰레기_술병: true,
          인기척_없이_TV_불: true,
          외출_없음: true,
          연락_두절: true,
        },
      },
    }))

    expect(graph.facts.filter((fact) => fact.field.startsWith('관찰_6징후.'))).toEqual([
      expect.objectContaining({ field: '관찰_6징후.외출_없음', label: '최근 외출 없음' }),
    ])
  })

  it('uses action-oriented wording for utility and health candidates', () => {
    const text = '전기세를 체납했고 요즘 마음이 힘들어요.'
    const observations = candidate().observations
    const graph = buildLiveEvidenceGraph([
      turn({ itemId: 'r-1', role: 'resident', text }),
    ], candidate({
      transcript: text,
      observations: {
        ...observations,
        공과금_2개월_이상_체납: true,
        최근_건강_정신_괴로움: true,
      },
    }))

    expect(graph.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '공과금 체납', value: '체납 있음' }),
      expect.objectContaining({ label: '건강·마음 어려움', value: '어려움 있음' }),
    ]))
    expect(graph.facts.some((fact) => fact.value === '관찰됨')).toBe(false)
  })
})
