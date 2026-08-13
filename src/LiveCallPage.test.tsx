import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./LiveCallPanel', () => ({
  LiveCallPanel: ({ join }: { join: { role: string; callId: string } }) => (
    <div data-testid="live-call-panel">{join.role}:{join.callId}</div>
  ),
}))

import { buildGuestInviteUrl, type LiveCallCredentials } from './liveCallClient'
import { LiveCallPage } from './LiveCallPage'

const credentials: LiveCallCredentials = {
  provider: 'livekit',
  call_id: 'call123',
  room_name: 'care-call-call123',
  server_url: 'wss://example.livekit.cloud',
  expires_at: '2030-08-13T12:00:00.000Z',
  transcription: { provider: 'openai', model: 'gpt-live-transcribe', language: 'ko' },
  host: { role: 'surveyor', participant_token: 'host.token.signature' },
  guest: { role: 'resident', participant_token: 'guest.token.signature' },
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('LiveCallPage', () => {
  it('captures the guest token from the URL fragment then removes it from the address bar', async () => {
    const invite = buildGuestInviteUrl(credentials, 'https://demo.example/m')
    window.history.replaceState(null, '', new URL(invite).pathname + new URL(invite).hash)
    render(<LiveCallPage />)

    expect(screen.getByRole('heading', { name: '안부 통화 참여' })).toBeInTheDocument()
    expect(screen.getByTestId('live-call-panel')).toHaveTextContent('resident:call123')
    await waitFor(() => expect(window.location.pathname).toBe('/call'))
    expect(window.location.hash).toBe('')
    expect(document.body.textContent).not.toContain('guest.token.signature')
  })

  it('shows an actionable message for invalid or expired links', () => {
    window.history.replaceState(null, '', '/call#join=broken')
    render(<LiveCallPage />)
    expect(screen.getByRole('heading', { name: '참여 링크를 다시 받아 주세요' })).toBeInTheDocument()
    expect(screen.getByText(/연결단원에게 새 참여 링크/)).toBeInTheDocument()
  })
})
