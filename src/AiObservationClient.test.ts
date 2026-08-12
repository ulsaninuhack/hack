import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confirmAiObservation,
  createAiObservationCandidate,
} from './AiObservationClient'
import type { AiObservationCandidate } from './AiObservationClient'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  sessionStorage.clear()
})

function response(data: unknown) {
  return new Response(JSON.stringify({ apiVersion: 'v1', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const candidate = {
  schema_version: 'contact-ops-observation-candidate/v1',
  synthetic: true,
  marker: '[합성]',
  case_id: 'SYN-HH-2812551000-0001',
  surveyor_id: '연결단원 001',
  source_kind: 'text',
  transcript: '미응답이고 우편물이 쌓였습니다.',
  contact_result: ['no', 'answer'].join('_') as AiObservationCandidate['contact_result'],
  observations: {
    관찰_6징후: {
      우편물_고지서_적체: true,
      악취_벌레: false,
      쓰레기_술병: false,
      인기척_없이_TV_불: false,
      외출_없음: false,
      연락_두절: false,
    },
    식사상태: null,
    위생상태: null,
    공과금_2개월_이상_체납: null,
    최근_건강_정신_괴로움: null,
    관계망_유무: null,
    연락_빈도: null,
  },
  free_text: '',
  critic: {
    missing_fields: ['식사상태'],
    contradictions: [],
    low_confidence_fields: ['위생상태'],
    warnings: [],
  },
  stripped_server_owned_fields: [
    'contact_result.risk_score',
    'contact_result.visit_recommended',
  ],
  requires_user_confirmation: true,
  confirmed: false,
} satisfies AiObservationCandidate

describe('P3 AI observation HTTP client', () => {
  it('requests a consented masked-text candidate without confirmation or server-owned fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      synthetic: true,
      displayMarker: '[합성]',
      revision: 3,
      candidate,
    }))

    const result = await createAiObservationCandidate({
      caseId: candidate.case_id,
      revision: 3,
      source: { kind: 'text', text: candidate.transcript },
    })

    expect(result.candidate).toEqual(candidate)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      mode: 'candidate',
      expected_revision: 3,
      contact_date: '2026-08-12',
      surveyor_id: '연결단원 001',
      consented_masked_text: candidate.transcript,
    })
    expect(String(init?.body)).not.toContain('confirmed')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses only a staged validated WAV/MP3 reference and rejects path-like values locally', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      synthetic: true,
      displayMarker: '[합성]',
      revision: 3,
      candidate: { ...candidate, source_kind: 'audio' },
    }))

    await createAiObservationCandidate({
      caseId: candidate.case_id,
      revision: 3,
      source: { kind: 'audio', fileReference: 'staged-memo-0001.WAV' },
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      mode: 'candidate',
      expected_revision: 3,
      contact_date: '2026-08-12',
      surveyor_id: '연결단원 001',
      validated_file_reference: 'staged-memo-0001.WAV',
    })

    await expect(createAiObservationCandidate({
      caseId: candidate.case_id,
      revision: 3,
      source: { kind: 'audio', fileReference: '../private/memo.wav' },
    })).rejects.toThrow('검증된 WAV 또는 MP3 참조 이름')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('posts explicit confirmation with the reviewed candidate and never adds approval fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      synthetic: true,
      displayMarker: '[합성]',
      revision: 4,
      household: {},
      observations: candidate.observations,
      triage: null,
    }))

    await confirmAiObservation({
      caseId: candidate.case_id,
      revision: 3,
      candidate,
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toEqual({
      mode: 'confirm',
      expected_revision: 3,
      contact_date: '2026-08-12',
      confirmed: true,
      candidate,
    })
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('approval')
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('route_constraints')
  })

  it('does not expose an English provider error to the surveyor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      apiVersion: 'v1',
      error: { code: 'CONTACT_OPS_UNAVAILABLE', message: 'AI adapter is unavailable' },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }))

    await expect(createAiObservationCandidate({
      caseId: candidate.case_id,
      revision: 3,
      source: { kind: 'text', text: candidate.transcript },
    })).rejects.toThrow('인공지능 관찰 후보 서비스를 잠시 사용할 수 없습니다.')
  })
})
