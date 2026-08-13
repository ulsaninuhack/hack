import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDemoCallUrl,
  buildGuestInviteUrl,
  createLiveCall,
  exchangeRealtimeSdp,
  joinDemoCall,
  parseGuestInviteCode,
  redeemGuestInvite,
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
  guest: { role: 'resident' as const, invite_code: 'invitecode0123456789abcdef012345' },
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

  it('explicitly creates the surveyor side of the fixed demo room', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(credentials))

    await createLiveCall({
      caseId: 'SYN-HH-2812551000-0001',
      revision: 7,
      demoEntry: true,
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({ expected_revision: 7, demo_entry: true })
  })

  it('builds a short share-safe invite URL without participant credentials', () => {
    const url = buildGuestInviteUrl(
      credentials,
      'https://care.example/m?case=SYN-HH-2812551000-0001#live-call',
    )
    const parsed = new URL(url)

    expect(parsed.origin).toBe('https://care.example')
    expect(parsed.pathname).toBe('/call')
    expect(parsed.search).toBe('?invite=invitecode0123456789abcdef012345')
    expect(parsed.hash).toBe('')
    expect(url.length).toBeLessThan(100)
    expect(url).not.toContain('host-token')
    expect(url).not.toContain('participant')
    expect(parseGuestInviteCode(parsed.search)).toBe('invitecode0123456789abcdef012345')
  })

  it('builds a permanent demo entrance on the existing service origin', () => {
    const url = buildDemoCallUrl('https://care.example/m?case=one#live-call')
    expect(url).toBe('https://care.example/call/demo')
    expect(url).not.toContain('token')
    expect(url).not.toContain('invite')
  })

  it('accepts share-provider metadata without weakening invite validation', () => {
    expect(parseGuestInviteCode(
      '?invite=invitecode0123456789abcdef012345&utm_source=message&utm_medium=qr',
    )).toBe('invitecode0123456789abcdef012345')
    expect(parseGuestInviteCode(
      '?invite=invitecode0123456789abcdef012345&invite=invitecode999999999999999999999999',
    )).toBeNull()
  })

  it('exchanges the opaque invite code for resident-only join credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      provider: 'livekit', call_id: 'fixed', server_url: 'wss://care-test.livekit.cloud',
      expires_at: '2026-08-13T01:30:00.000Z',
      participant: { role: 'resident', participant_token: 'guest-token' },
    }))

    const join = await redeemGuestInvite('invitecode0123456789abcdef012345')

    expect(join).toEqual({
      callId: 'fixed', serverUrl: 'wss://care-test.livekit.cloud', participantToken: 'guest-token',
      expiresAt: '2026-08-13T01:30:00.000Z', role: 'resident',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/contact-ops/live-calls/invites/invitecode0123456789abcdef012345'),
      { method: 'POST', headers: { Accept: 'application/json' } },
    )
  })

  it('gets a short-lived resident token through the fixed bodyless demo entrance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      provider: 'livekit', call_id: 'demo-stage', server_url: 'wss://care-test.livekit.cloud',
      expires_at: '2026-08-13T01:30:00.000Z',
      participant: { role: 'resident', participant_token: 'guest-token' },
    }))

    const join = await joinDemoCall()

    expect(join).toMatchObject({ callId: 'demo-stage', role: 'resident', participantToken: 'guest-token' })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/contact-ops/live-calls/demo'),
      { method: 'POST', headers: { Accept: 'application/json' } },
    )
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('guest-token')
  })

  it('keeps a temporary gateway failure distinct from an invalid invite', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))

    await expect(redeemGuestInvite('invitecode0123456789abcdef012345')).rejects.toMatchObject({
      code: 'INVITE_REDEMPTION_FAILED',
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

  it('rejects malformed invite queries and invalid exchange responses', async () => {
    expect(parseGuestInviteCode('')).toBeNull()
    expect(parseGuestInviteCode('?invite=short')).toBeNull()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      provider: 'livekit', call_id: '../bad', server_url: 'https://wrong.example',
      expires_at: 'not-a-date', participant: { role: 'surveyor', participant_token: 'short' },
    }))
    await expect(redeemGuestInvite('invitecode0123456789abcdef012345')).rejects.toThrow(/참여 정보/)
  })
})
