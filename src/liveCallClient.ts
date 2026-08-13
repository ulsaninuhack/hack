import { ContactOpsClientError } from './contactOpsClient'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const SESSION_KEY = 'care-ops-demo-session-id'
const SHARED_DEMO_SESSION_ID = 'incheon-care-shared-demo-floor'
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,4096}$/
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{24,80}$/

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
  guest: { role: 'resident'; invite_code: string }
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
  url.searchParams.set('invite', credentials.guest.invite_code)
  return url.toString()
}

export function parseGuestInviteCode(search: string): string | null {
  if (typeof search !== 'string' || search.length === 0 || search.length > 256) return null
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  const inviteCode = params.get('invite')
  if ([...params.keys()].some((key) => key !== 'invite') || params.getAll('invite').length !== 1) return null
  return INVITE_CODE_PATTERN.test(inviteCode || '') ? inviteCode : null
}

export async function redeemGuestInvite(inviteCode: string): Promise<LiveCallJoin> {
  if (!INVITE_CODE_PATTERN.test(inviteCode)) {
    throw new ContactOpsClientError('INVALID_INVITE', '통화 참여 링크가 올바르지 않습니다.')
  }
  const response = await fetch(`${API_BASE_URL}/api/v1/contact-ops/live-calls/invites/${encodeURIComponent(inviteCode)}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  const envelope = await response.json().catch(() => ({})) as {
    data?: {
      provider?: string
      call_id?: string
      server_url?: string
      expires_at?: string
      participant?: { role?: string; participant_token?: string }
    }
    error?: { code?: string }
  }
  const data = envelope.data
  if (!response.ok || !data
      || data.provider !== 'livekit'
      || typeof data.call_id !== 'string'
      || !CALL_ID_PATTERN.test(data.call_id)
      || !validServerUrl(data.server_url)
      || typeof data.expires_at !== 'string'
      || !Number.isFinite(Date.parse(data.expires_at))
      || data.participant?.role !== 'resident'
      || typeof data.participant.participant_token !== 'string'
      || !TOKEN_PATTERN.test(data.participant.participant_token)) {
    throw new ContactOpsClientError(
      envelope.error?.code ?? 'INVALID_INVITE',
      '통화 참여 링크가 만료되었거나 올바르지 않습니다.',
    )
  }
  return {
    callId: data.call_id,
    serverUrl: data.server_url,
    participantToken: data.participant.participant_token,
    expiresAt: data.expires_at,
    role: 'resident',
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
