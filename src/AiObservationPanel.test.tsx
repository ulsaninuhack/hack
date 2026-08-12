import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaseDetail } from './contactOpsClient'
import type { AiObservationCandidate } from './AiObservationClient'

const mocks = vi.hoisted(() => ({
  createAiObservationCandidate: vi.fn(),
  confirmAiObservation: vi.fn(),
}))

vi.mock('./AiObservationClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./AiObservationClient')>()
  return {
    ...actual,
    createAiObservationCandidate: mocks.createAiObservationCandidate,
    confirmAiObservation: mocks.confirmAiObservation,
  }
})

import { AiObservationPanel } from './AiObservationPanel'

const candidate = {
  schema_version: 'contact-ops-observation-candidate/v1' as const,
  synthetic: true as const,
  marker: '[합성]' as const,
  case_id: 'SYN-HH-2812551000-0001',
  surveyor_id: '연결단원 001',
  source_kind: 'text' as const,
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
  free_text: '식사 상태 재확인',
  critic: {
    missing_fields: ['식사상태'],
    contradictions: ['미응답과 연락 두절 아님을 함께 확인해야 함'],
    low_confidence_fields: ['위생상태'],
    warnings: [],
  },
  stripped_server_owned_fields: [
    'contact_result.risk_score',
    'contact_result.visit_recommended',
  ],
  requires_user_confirmation: true as const,
  confirmed: false as const,
}

const updated = {
  synthetic: true as const,
  displayMarker: '[합성]' as const,
  revision: 4,
  household: {
    id: candidate.case_id,
    synthetic: true as const,
    location: {
      longitude: 126.6,
      latitude: 37.4,
      geometry_zone_id: 'zone:1',
      current_admin_dong_code_20260701: '2812551000',
      current_admin_dong_name_20260701: '신포동',
      current_district_name_20260701: '제물포구',
    },
    contact: {},
    workflow: { visit_approval_status: 'recommended' as const },
    approved_visit_constraints: null,
  },
  observations: candidate.observations,
  triage: null,
} satisfies CaseDetail

afterEach(() => vi.clearAllMocks())

describe('P3 Planner-Critic surveyor review', () => {
  it('requires consent, shows all five graph steps, and renders no automatic-decision fields', async () => {
    render(<AiObservationPanel caseId={candidate.case_id} revision={3} onApplied={vi.fn()} />)

    expect(screen.getByText(/AI 후보 · 자동 승인 아님/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 관찰 후보 만들기' })).toBeDisabled()
    for (const step of [
      '1. 발화·메모 후보 구조화',
      '2. 형식 검사',
      '3. 모순·누락 확인',
      '4. 규칙·2축 점수 재계산',
      '5. 담당자 결정',
    ]) expect(screen.getByText(step)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('risk_score')
    expect(document.body.textContent).not.toContain('visit_recommended')
    expect(document.body.textContent).not.toContain('approved')
  })

  it('creates a reviewable candidate, allows canonical edits, then explicitly confirms it', async () => {
    const user = userEvent.setup()
    const onApplied = vi.fn()
    mocks.createAiObservationCandidate.mockResolvedValue({
      synthetic: true,
      displayMarker: '[합성]',
      revision: 3,
      candidate,
    })
    mocks.confirmAiObservation.mockResolvedValue(updated)
    render(<AiObservationPanel caseId={candidate.case_id} revision={3} onApplied={onApplied} />)

    await user.click(screen.getByLabelText('동의를 받은 비식별·마스킹 입력입니다.'))
    await user.type(screen.getByLabelText('동의받은 비식별·마스킹 텍스트'), candidate.transcript)
    await user.click(screen.getByRole('button', { name: 'AI 관찰 후보 만들기' }))

    expect(await screen.findByText('누락 필드')).toBeInTheDocument()
    expect(screen.getByText('식사상태')).toBeInTheDocument()
    expect(screen.getByText('모순 확인')).toBeInTheDocument()
    expect(screen.getByText('낮은 확신 필드')).toBeInTheDocument()
    expect(screen.getByLabelText('AI 후보 연락 결과')).toHaveValue('미응답')
    await user.selectOptions(screen.getByLabelText('AI 후보 식사 상태'), '심각')
    await user.click(screen.getByLabelText('AI 후보 악취·벌레'))
    await user.click(screen.getByLabelText('검토한 후보를 결정론적 규칙 입력으로 사용합니다.'))
    await user.click(screen.getByRole('button', { name: '검토한 AI 후보 명시 확인' }))

    await waitFor(() => expect(mocks.confirmAiObservation).toHaveBeenCalledWith(expect.objectContaining({
      caseId: candidate.case_id,
      revision: 3,
      candidate: expect.objectContaining({
        confirmed: false,
        contact_result: ['no', 'answer'].join('_'),
        observations: expect.objectContaining({
          식사상태: '심각',
          관찰_6징후: expect.objectContaining({ 악취_벌레: true }),
        }),
      }),
    })))
    expect(onApplied).toHaveBeenCalledWith(updated)
    expect(screen.getByText(/후보를 기록하고 연락업무 순서를 다시 계산했습니다/)).toBeInTheDocument()
  })

  it('uses a staged validated reference instead of a browser file upload', async () => {
    const user = userEvent.setup()
    mocks.createAiObservationCandidate.mockResolvedValue({
      synthetic: true,
      displayMarker: '[합성]',
      revision: 3,
      candidate: { ...candidate, source_kind: 'audio' },
    })
    render(<AiObservationPanel caseId={candidate.case_id} revision={3} onApplied={vi.fn()} />)

    await user.click(screen.getByLabelText('동의를 받은 비식별·마스킹 입력입니다.'))
    await user.click(screen.getByLabelText('검증된 음성 참조'))
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument()
    expect(screen.getByText(/서버 준비 디렉터리에 사전 검증되어 놓인 참조 이름만 입력/)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/검증된 WAV 또는 MP3 참조 이름/), 'staged-0001.wav')
    await user.click(screen.getByRole('button', { name: 'AI 관찰 후보 만들기' }))
    await waitFor(() => expect(mocks.createAiObservationCandidate).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: 'audio', fileReference: 'staged-0001.wav' },
    })))
  })

  it('preserves entered text after timeout/failure and keeps the manual form outside the panel usable', async () => {
    const user = userEvent.setup()
    mocks.createAiObservationCandidate.mockRejectedValue(new Error('AI 후보 생성 시간이 초과되었습니다.'))
    render(<>
      <AiObservationPanel caseId={candidate.case_id} revision={3} onApplied={vi.fn()} />
      <button type="button">수동 통화 결과 저장</button>
    </>)

    await user.click(screen.getByLabelText('동의를 받은 비식별·마스킹 입력입니다.'))
    await user.type(screen.getByLabelText('동의받은 비식별·마스킹 텍스트'), candidate.transcript)
    await user.click(screen.getByRole('button', { name: 'AI 관찰 후보 만들기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AI 후보 생성 시간이 초과되었습니다.')
    expect(screen.getByLabelText('동의받은 비식별·마스킹 텍스트')).toHaveValue(candidate.transcript)
    expect(screen.getByRole('button', { name: '수동 통화 결과 저장' })).toBeEnabled()
  })
})
