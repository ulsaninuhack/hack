import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContactOpsClientError } from './contactOpsClient'

const mocks = vi.hoisted(() => ({ joinDemoCall: vi.fn() }))

vi.mock('./liveCallClient', () => ({ joinDemoCall: mocks.joinDemoCall }))
vi.mock('./LiveCallPanel', () => ({
  LiveCallPanel: ({ join }: { join: { role: string; callId: string } }) => (
    <div data-testid="live-call-panel">{join.role}:{join.callId}</div>
  ),
}))

import { DemoCallPage } from './DemoCallPage'

const join = {
  callId: 'demo-stage',
  serverUrl: 'wss://example.livekit.cloud',
  participantToken: 'guest.token.signature',
  expiresAt: '2030-08-13T12:00:00.000Z',
  role: 'resident' as const,
}

afterEach(() => vi.clearAllMocks())

describe('DemoCallPage', () => {
  it('prepares the fixed room and keeps participant credentials out of the URL and page text', async () => {
    mocks.joinDemoCall.mockResolvedValue(join)
    window.history.replaceState(null, '', '/call/demo')

    render(<DemoCallPage />)

    expect(screen.getByRole('heading', { name: '고정 시연 통화방' })).toBeInTheDocument()
    expect(await screen.findByTestId('live-call-panel')).toHaveTextContent('resident:demo-stage')
    expect(window.location.href).not.toContain('guest.token.signature')
    expect(document.body.textContent).not.toContain('guest.token.signature')
    expect(mocks.joinDemoCall).toHaveBeenCalledOnce()
  })

  it('lets the resident retry a temporary preparation failure', async () => {
    mocks.joinDemoCall
      .mockRejectedValueOnce(new ContactOpsClientError('LIVE_CALL_UNAVAILABLE', 'unavailable'))
      .mockResolvedValueOnce(join)
    const user = userEvent.setup()

    render(<DemoCallPage />)

    expect(await screen.findByRole('heading', { name: '시연 통화방을 준비하지 못했습니다' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('live-call-panel')).toHaveTextContent('resident:demo-stage')
    expect(mocks.joinDemoCall).toHaveBeenCalledTimes(2)
  })

})
