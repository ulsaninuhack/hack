import { ContactOpsClientError } from './contactOpsClient'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const SESSION_KEY = 'care-ops-demo-session-id'
const SHARED_DEMO_SESSION_ID = 'incheon-care-shared-demo-floor'
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,4096}$/

export interface LiveCallCredentials {
  provider: 'livekit'
  call_id: string
  room_name: string
  server_url: string
  expires_at: string
  transcription: {
    provider: 'openai'
    model: 'gpt-live-transcribe'
    language: 'ko'
  }
  host: { role: 'surveyor'; participant_token: string }
  guest: { role: 'resident'; participant_token: string }
}

export interface LiveCallJoin {
  callId: string
  serverUrl: string
  participantToken: string
  expiresAt: string
  role: 'surveyor' | 'resident'
}

function demoSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing
  sessionStorage.setItem(SESSION_KEY, SHARED_DEMO_SESSION_ID)
  return SHARED_DEMO_SESSION_ID
}

function base64UrlEncode(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): string {
  const standard = value.replaceAll('-', '+').replaceAll('_', '/')
  return atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='))
}

function validServerUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false
  try {
    const url = new URL(value)
    return ['wss:', 'ws:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export async function createLiveCall(input: {
  caseId: string
  revision: number
}): Promise<LiveCallCredentials> {
  const response = await fetch(`${API_BASE_URL}/api/v1/contact-ops/cases/${encodeURIComponent(input.caseId)}/live-calls`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Demo-Session-ID': demoSessionId(),
    },
    body: JSON.stringify({ expected_revision: input.revision }),
  })
  const envelope = await response.json().catch(() => ({})) as {
    data?: LiveCallCredentials
    error?: { code?: string; message?: string }
  }
  if (!response.ok || !envelope.data) {
    throw new ContactOpsClientError(
      envelope.error?.code ?? 'LIVE_CALL_UNAVAILABLE',
      '실시간 통화를 시작하지 못했습니다. 음성 파일이나 직접 입력을 사용할 수 있습니다.',
    )
  }
  return envelope.data
}

export function buildGuestInviteUrl(credentials: LiveCallCredentials, currentUrl: string = window.location.href): string {
  const url = new URL('/call', currentUrl)
  const join: LiveCallJoin = {
    callId: credentials.call_id,
    serverUrl: credentials.server_url,
    participantToken: credentials.guest.participant_token,
    expiresAt: credentials.expires_at,
    role: 'resident',
  }
  url.hash = `join=${base64UrlEncode(JSON.stringify(join))}`
  return url.toString()
}

export function parseGuestJoinFragment(fragment: string, now: Date = new Date()): LiveCallJoin | null {
  if (typeof fragment !== 'string' || fragment.length === 0 || fragment.length > 8_192) return null
  try {
    const params = new URLSearchParams(fragment.replace(/^#/, ''))
    const encoded = params.get('join')
    if (!encoded) return null
    const value = JSON.parse(base64UrlDecode(encoded)) as Partial<LiveCallJoin>
    const expires = Date.parse(value.expiresAt || '')
    if (!CALL_ID_PATTERN.test(value.callId || '')
        || !validServerUrl(value.serverUrl)
        || !TOKEN_PATTERN.test(value.participantToken || '')
        || value.role !== 'resident'
        || !Number.isFinite(expires)
        || expires <= now.getTime()) return null
    return value as LiveCallJoin
  } catch {
    return null
  }
}

export async function exchangeRealtimeSdp(input: {
  participantToken: string
  sdp: string
}): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/v1/contact-ops/live-calls/realtime-sdp`, {
    method: 'POST',
    headers: {
      Accept: 'application/sdp',
      Authorization: `Bearer ${input.participantToken}`,
      'Content-Type': 'application/sdp',
    },
    body: input.sdp,
  })
  const answer = await response.text()
  if (!response.ok || !/^v=0(?:\r?\n|$)/.test(answer)) {
    throw new ContactOpsClientError(
      'REALTIME_TRANSCRIPTION_UNAVAILABLE',
      '실시간 자막을 시작하지 못했습니다. 통화는 종료하고 음성 파일을 사용할 수 있습니다.',
    )
  }
  return answer
}
