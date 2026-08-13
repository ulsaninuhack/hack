import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

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
  guest: { role: 'resident', invite_code: 'invitecode0123456789abcdef012345' },
}

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('LiveCallPage', () => {
  it('owns vertical scrolling because the global body is intentionally locked', () => {
    expect(styles).toMatch(/\.guest-call-page\s*\{(?=[^}]*height:\s*100dvh)(?=[^}]*overflow-y:\s*auto)[^}]*\}/)
  })

  it('redeems the short query code and keeps the shareable invite URL available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      apiVersion: 'v1',
      data: {
        provider: 'livekit', call_id: 'call123', server_url: 'wss://example.livekit.cloud',
        expires_at: '2030-08-13T12:00:00.000Z',
        participant: { role: 'resident', participant_token: 'guest.token.signature' },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const invite = buildGuestInviteUrl(credentials, 'https://demo.example/m')
    window.history.replaceState(null, '', new URL(invite).pathname + new URL(invite).search)
    render(<LiveCallPage />)

    expect(screen.getByRole('heading', { name: '안부 통화 참여' })).toBeInTheDocument()
    expect(await screen.findByTestId('live-call-panel')).toHaveTextContent('resident:call123')
    expect(screen.queryByText(/별도 앱 설치/)).toBeNull()
    await waitFor(() => expect(window.location.search).toContain('invite='))
    expect(window.location.hash).toBe('')
    expect(document.body.textContent).not.toContain('guest.token.signature')
  })

  it('shows an actionable message for invalid links without making a request', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    window.history.replaceState(null, '', '/call?invite=short')
    render(<LiveCallPage />)
    expect(screen.getByRole('heading', { name: '참여 링크를 다시 받아 주세요' })).toBeInTheDocument()
    expect(screen.getByText(/연결단원에게 새 참여 링크/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
