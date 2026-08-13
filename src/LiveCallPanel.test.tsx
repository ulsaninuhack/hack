import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveCaption } from './liveCallTranscript'
import type { VoiceCandidate } from './threeTierClient'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  setMuted: vi.fn(),
  finish: vi.fn(),
  toDataUrl: vi.fn(),
}))

vi.mock('./liveCallSession', () => ({ connectLiveCallSession: mocks.connect }))
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.toDataUrl } }))

import { LiveCallPanel } from './LiveCallPanel'

const hostJoin = {
  callId: 'abc123',
  serverUrl: 'wss://example.livekit.cloud',
  participantToken: 'host.token.signature',
  expiresAt: '2030-08-13T12:00:00.000Z',
  role: 'surveyor' as const,
}

function caption(input: Partial<LiveCaption> & Pick<LiveCaption, 'itemId' | 'role' | 'text'>): LiveCaption {
  return {
    final: true,
    receivedAt: Date.now(),
    ...input,
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('LiveCallPanel', () => {
  it('shows an invite QR and starts media only after the user taps connect', async () => {
    mocks.toDataUrl.mockResolvedValue('data:image/png;base64,qr')
    mocks.connect.mockResolvedValue({
      roomName: 'care-call-abc123',
      localRole: 'surveyor',
      setMuted: mocks.setMuted,
      finish: mocks.finish,
      disconnect: mocks.disconnect,
    })
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} inviteUrl="https://demo.example/call?invite=shortcode012345678901234567" />)

    expect(mocks.connect).not.toHaveBeenCalled()
    const qrImage = await screen.findByRole('img', { name: '연락 대상 참여 QR 코드' })
    expect(qrImage).toHaveAttribute('src', 'data:image/png;base64,qr')
    expect(qrImage).toHaveAttribute('width', '280')
    expect(qrImage).toHaveAttribute('height', '280')
    expect(mocks.toDataUrl).toHaveBeenCalledWith(
      'https://demo.example/call?invite=shortcode012345678901234567',
      {
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'H',
        margin: 4,
        width: 280,
      },
    )
    await user.click(screen.getByRole('button', { name: '통화 연결' }))
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ expectedRole: 'surveyor' }))
  })

  it('keeps link sharing available when QR rendering fails', async () => {
    mocks.toDataUrl.mockRejectedValue(new Error('canvas unavailable'))
    render(<LiveCallPanel join={hostJoin} inviteUrl="https://demo.example/call?invite=shortcode012345678901234567" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('QR 코드를 만들지 못했습니다')
    expect(screen.getByRole('button', { name: /참여 링크 (보내기|복사)/ })).toBeInTheDocument()
  })

  it('labels both speakers but sends only final resident speech after explicit finish', async () => {
    let onCaption: ((value: LiveCaption) => void) | undefined
    mocks.toDataUrl.mockResolvedValue('data:image/png;base64,qr')
    mocks.connect.mockImplementation(async (input: { onCaption: (value: LiveCaption) => void }) => {
      onCaption = input.onCaption
      return {
        roomName: 'care-call-abc123',
        localRole: 'surveyor',
        setMuted: mocks.setMuted,
        finish: mocks.finish,
        disconnect: mocks.disconnect,
      }
    })
    const onFinish = vi.fn()
    const onTranscriptUpdate = vi.fn()
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} inviteUrl="https://demo.example/call?invite=shortcode012345678901234567" onFinish={onFinish} onTranscriptUpdate={onTranscriptUpdate} />)
    await user.click(screen.getByRole('button', { name: '통화 연결' }))

    act(() => {
      onCaption?.(caption({ itemId: 'surveyor-1', role: 'surveyor', text: '오늘 식사는 하셨어요?' }))
      onCaption?.(caption({ itemId: 'resident-1', role: 'resident', text: '밥은 안 먹고 누워만 있었어요.', final: false }))
      onCaption?.(caption({ itemId: 'resident-1', role: 'resident', text: '밥은 안 먹고 누워만 있었고 사람도 안 만났어요.', final: true }))
      onCaption?.(caption({ itemId: 'resident-1', role: 'resident', text: '밥은 안 먹고 누워만 있었고 사람도 안 만났어요.', final: true }))
    })

    expect(screen.getByText('연결단원')).toBeInTheDocument()
    expect(screen.getByText('연락 대상')).toBeInTheDocument()
    expect(screen.getByText('밥은 안 먹고 누워만 있었고 사람도 안 만났어요.')).toBeInTheDocument()
    expect(onFinish).not.toHaveBeenCalled()
    expect(onTranscriptUpdate).toHaveBeenCalledTimes(1)
    expect(onTranscriptUpdate).toHaveBeenCalledWith('밥은 안 먹고 누워만 있었고 사람도 안 만났어요.')

    await user.click(screen.getByRole('button', { name: '통화 종료하고 체크리스트 만들기' }))
    await waitFor(() => expect(mocks.finish).toHaveBeenCalled())
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalled())
    expect(onFinish).toHaveBeenCalledWith('밥은 안 먹고 누워만 있었고 사람도 안 만났어요.')
    expect(onFinish.mock.calls[0][0]).not.toContain('오늘 식사는 하셨어요?')
  })

  it('keeps the newest caption in view inside the transcript chat after muting', async () => {
    let onCaption: ((value: LiveCaption) => void) | undefined
    mocks.connect.mockImplementation(async (input: { onCaption: (value: LiveCaption) => void }) => {
      onCaption = input.onCaption
      return {
        roomName: 'care-call-abc123',
        localRole: 'surveyor',
        setMuted: mocks.setMuted,
        finish: mocks.finish,
        disconnect: mocks.disconnect,
      }
    })
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} />)
    await user.click(screen.getByRole('button', { name: '통화 연결' }))
    await user.click(screen.getByRole('button', { name: '마이크 끄기' }))
    expect(mocks.setMuted).toHaveBeenCalledWith(true)

    act(() => {
      onCaption?.(caption({ itemId: 'resident-1', role: 'resident', text: '며칠째 밖에 안 나갔어요.' }))
    })
    const transcript = within(screen.getByRole('region', { name: '실시간 자막' })).getByRole('list')
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 640 })
    transcript.scrollTop = 0

    act(() => {
      onCaption?.(caption({ itemId: 'resident-2', role: 'resident', text: '오늘도 집에만 있었어요.' }))
    })

    await waitFor(() => expect(transcript.scrollTop).toBe(640))
  })

  it('renders streamed Planner-Critic state as unconfirmed checklist candidates', async () => {
    mocks.toDataUrl.mockResolvedValue('data:image/png;base64,qr')
    mocks.connect.mockResolvedValue({
      roomName: 'care-call-abc123',
      localRole: 'surveyor',
      setMuted: mocks.setMuted,
      finish: mocks.finish,
      disconnect: mocks.disconnect,
    })
    const liveCandidate = {
      contact_result: ['connected', 'concern'].join('_') as VoiceCandidate['contact_result'],
      transcript: '밥을 잘 못 먹어요.',
      observations: {
        관찰_6징후: { 우편물_고지서_적체: false, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
        식사상태: '불량', 위생상태: null, 공과금_2개월_이상_체납: null,
        최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
      },
      critic: {
        missing_fields: ['식사상태'], contradictions: [], low_confidence_fields: ['식사상태'], warnings: [],
        next_question: '오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?',
      },
    } satisfies Pick<VoiceCandidate, 'contact_result' | 'transcript' | 'observations' | 'critic'>
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} liveCandidate={liveCandidate} candidatePending={false} />)
    await user.click(screen.getByRole('button', { name: '통화 연결' }))

    expect(screen.getByRole('region', { name: '통화 중 체크리스트 후보' })).toHaveTextContent('AI 후보 · 미확정')
    expect(screen.getByText('식사 상태')).toBeInTheDocument()
    expect(screen.getByText('불량 · 후보')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '다음 확인 질문' })).toBeInTheDocument()
    expect(screen.getByText(liveCandidate.critic.next_question)).toBeInTheDocument()
  })

  it('shows only recent outing from the six environmental signs during a live phone call', async () => {
    mocks.connect.mockResolvedValue({
      roomName: 'care-call-abc123',
      localRole: 'surveyor',
      setMuted: mocks.setMuted,
      finish: mocks.finish,
      disconnect: mocks.disconnect,
    })
    const liveCandidate = {
      contact_result: ['connected', 'concern'].join('_') as VoiceCandidate['contact_result'],
      transcript: '며칠째 밖에 안 나가고 우편물도 쌓였어요.',
      observations: {
        관찰_6징후: { 우편물_고지서_적체: true, 악취_벌레: true, 쓰레기_술병: true, 인기척_없이_TV_불: true, 외출_없음: true, 연락_두절: true },
        식사상태: null, 위생상태: null, 공과금_2개월_이상_체납: null,
        최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
      },
      critic: { missing_fields: [], contradictions: [], low_confidence_fields: [], warnings: [], next_question: null },
    } satisfies Pick<VoiceCandidate, 'contact_result' | 'transcript' | 'observations' | 'critic'>
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} liveCandidate={liveCandidate} />)
    await user.click(screen.getByRole('button', { name: '통화 연결' }))

    const preview = screen.getByRole('region', { name: '통화 중 체크리스트 후보' })
    expect(within(preview).getByText('최근 외출 없음')).toBeInTheDocument()
    for (const label of ['우편물·고지서 적체', '악취·벌레', '쓰레기·술병', '인기척 없이 TV·불', '연락 두절']) {
      expect(within(preview).queryByText(label)).toBeNull()
    }
  })

  it('shows turn-linked evidence and preserves conflicting meal statements for review', async () => {
    let onCaption: ((value: LiveCaption) => void) | undefined
    mocks.toDataUrl.mockResolvedValue('data:image/png;base64,qr')
    mocks.connect.mockImplementation(async (input: { onCaption: (value: LiveCaption) => void }) => {
      onCaption = input.onCaption
      return {
        roomName: 'care-call-abc123',
        localRole: 'surveyor',
        setMuted: mocks.setMuted,
        finish: mocks.finish,
        disconnect: mocks.disconnect,
      }
    })
    const liveCandidate = {
      contact_result: ['connected', 'concern'].join('_') as VoiceCandidate['contact_result'],
      transcript: '오늘 아무것도 못 먹었어요. 아침에는 죽을 조금 먹었죠.',
      observations: {
        관찰_6징후: { 우편물_고지서_적체: false, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
        식사상태: null, 위생상태: null, 공과금_2개월_이상_체납: null,
        최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
      },
      critic: {
        missing_fields: [],
        contradictions: ['식사 발화가 서로 달라 추가 확인이 필요함'],
        low_confidence_fields: ['식사상태'],
        warnings: [],
        next_question: '오늘은 조금 드셨지만 그 전에는 식사를 거의 못 하셨다는 뜻인가요?',
      },
    } satisfies Pick<VoiceCandidate, 'contact_result' | 'transcript' | 'observations' | 'critic'>
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} liveCandidate={liveCandidate} />)
    await user.click(screen.getByRole('button', { name: '통화 연결' }))

    act(() => {
      onCaption?.(caption({ itemId: 'resident-1', role: 'resident', text: '오늘 아무것도 못 먹었어요.', receivedAt: 1 }))
      onCaption?.(caption({ itemId: 'resident-2', role: 'resident', text: '아침에는 죽을 조금 먹었죠.', receivedAt: 2 }))
    })

    const contradiction = screen.getByRole('region', { name: '추가 확인이 필요한 상충 정보' })
    expect(contradiction).toHaveTextContent('식사 정보가 서로 다릅니다')
    expect(contradiction).toHaveTextContent('발화 1 · 오늘 아무것도 못 먹었어요.')
    expect(contradiction).toHaveTextContent('발화 2 · 아침에는 죽을 조금 먹었죠.')
    expect(contradiction).toHaveTextContent(liveCandidate.critic.next_question)
    expect(screen.getByRole('region', { name: '통화 근거 원장' })).toHaveTextContent('근거 발화')
  })

  it('keeps live-call copy terse for the demo surface', async () => {
    mocks.connect.mockResolvedValue({
      roomName: 'care-call-abc123',
      localRole: 'surveyor',
      setMuted: mocks.setMuted,
      finish: mocks.finish,
      disconnect: mocks.disconnect,
    })
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} />)
    await user.click(screen.getByRole('button', { name: '통화 연결' }))

    expect(screen.getByText('자막 대기 중')).toBeInTheDocument()
    expect(screen.getByText('대기 중')).toBeInTheDocument()
    for (const phrase of [
      '말을 시작하면 발화자별 자막이 표시됩니다.',
      '연락 대상의 확정 발화',
      '연락 대상의 확정 발화가 들어오면 후보 항목이 표시됩니다.',
      '체크 항목과 실제 발화를 함께 확인합니다.',
      '후보와 직접 연결할 수 있는 발화를 확인하는 중입니다.',
    ]) {
      expect(screen.queryByText(phrase)).toBeNull()
    }
  })

  it('offers a file/manual fallback when the live connection fails', async () => {
    mocks.toDataUrl.mockResolvedValue('data:image/png;base64,qr')
    mocks.connect.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} inviteUrl="https://demo.example/call?invite=shortcode012345678901234567" />)

    await user.click(screen.getByRole('button', { name: '통화 연결' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('실시간 통화를 연결하지 못했습니다')
    expect(screen.getByText(/음성 파일 또는 직접 입력/)).toBeInTheDocument()
  })
})
