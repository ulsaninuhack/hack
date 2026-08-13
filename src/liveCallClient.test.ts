import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildGuestInviteUrl,
  createLiveCall,
  exchangeRealtimeSdp,
  parseGuestJoinFragment,
} from './liveCallClient'
import type { LiveCallCredentials } from './liveCallClient'

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ apiVersion: 'v1', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const credentials = {
  provider: 'livekit' as const,
  call_id: 'fixed',
  room_name: 'care-call-fixed',
  server_url: 'wss://care-test.livekit.cloud',
  expires_at: '2026-08-13T01:30:00.000Z',
  transcription: { provider: 'openai' as const, model: 'gpt-live-transcribe', language: 'ko' as const },
  host: { role: 'surveyor' as const, participant_token: 'host-token' },
  guest: { role: 'resident' as const, participant_token: 'guest-token' },
} satisfies LiveCallCredentials

describe('live call HTTP client', () => {
  it('creates an unconfirmed call room for the selected case revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(credentials))

    const result = await createLiveCall({
      caseId: 'SYN-HH-2812551000-0001',
      revision: 7,
    })

    expect(result).toEqual(credentials)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/live-calls')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Demo-Session-ID': 'incheon-care-shared-demo-floor',
    })
    expect(JSON.parse(String(init?.body))).toEqual({ expected_revision: 7 })
    expect(String(init?.body)).not.toContain('confirm')
  })

  it('keeps the short-lived guest token in a URL fragment and round-trips it locally', () => {
    const url = buildGuestInviteUrl(credentials, 'https://care.example/m')
    const parsed = new URL(url)

    expect(parsed.origin).toBe('https://care.example')
    expect(parsed.pathname).toBe('/call')
    expect(parsed.search).toBe('')
    expect(parsed.hash).not.toBe('')
    expect(url).not.toContain('?')
    expect(parseGuestJoinFragment(parsed.hash, new Date('2026-08-13T01:00:00.000Z'))).toEqual({
      callId: 'fixed',
      serverUrl: 'wss://care-test.livekit.cloud',
      participantToken: 'guest-token',
      expiresAt: '2026-08-13T01:30:00.000Z',
      role: 'resident',
    })
  })

  it('posts SDP with only the short-lived participant bearer token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('v=0\r\na=answer\r\n', {
      status: 201,
      headers: { 'Content-Type': 'application/sdp' },
    }))

    const answer = await exchangeRealtimeSdp({
      participantToken: 'short-lived-token',
      sdp: 'v=0\r\na=offer\r\n',
    })

    expect(answer).toBe('v=0\r\na=answer\r\n')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/sdp',
        Authorization: 'Bearer short-lived-token',
        'Content-Type': 'application/sdp',
      },
      body: 'v=0\r\na=offer\r\n',
    })
  })

  it('rejects malformed or expired guest fragments without network access', () => {
    expect(parseGuestJoinFragment('')).toBeNull()
    expect(parseGuestJoinFragment('#join=not-base64')).toBeNull()
    const expired = buildGuestInviteUrl({
      ...credentials,
      expires_at: '2020-01-01T00:00:00.000Z',
    }, 'https://care.example')
    expect(parseGuestJoinFragment(new URL(expired).hash, new Date('2026-08-13T00:00:00.000Z'))).toBeNull()
  })
})
