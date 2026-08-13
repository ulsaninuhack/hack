import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveCaption } from './liveCallTranscript'

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
    expect(await screen.findByRole('img', { name: '연락 대상 참여 QR 코드' })).toHaveAttribute('src', 'data:image/png;base64,qr')
    await user.click(screen.getByRole('button', { name: '통화 연결' }))
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ expectedRole: 'surveyor' }))
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
    const user = userEvent.setup()
    render(<LiveCallPanel join={hostJoin} inviteUrl="https://demo.example/call?invite=shortcode012345678901234567" onFinish={onFinish} />)
    await user.click(screen.getByRole('button', { name: '통화 연결' }))

    act(() => {
      onCaption?.(caption({ itemId: 'surveyor-1', role: 'surveyor', text: '오늘 식사는 하셨어요?' }))
      onCaption?.(caption({ itemId: 'resident-1', role: 'resident', text: '밥은 안 먹고 누워만 있었어요.', final: false }))
      onCaption?.(caption({ itemId: 'resident-1', role: 'resident', text: '밥은 안 먹고 누워만 있었고 사람도 안 만났어요.', final: true }))
    })

    expect(screen.getByText('연결단원')).toBeInTheDocument()
    expect(screen.getByText('연락 대상')).toBeInTheDocument()
    expect(screen.getByText('밥은 안 먹고 누워만 있었고 사람도 안 만났어요.')).toBeInTheDocument()
    expect(onFinish).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '통화 종료하고 체크리스트 만들기' }))
    await waitFor(() => expect(mocks.finish).toHaveBeenCalled())
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalled())
    expect(onFinish).toHaveBeenCalledWith('밥은 안 먹고 누워만 있었고 사람도 안 만났어요.')
    expect(onFinish.mock.calls[0][0]).not.toContain('오늘 식사는 하셨어요?')
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
