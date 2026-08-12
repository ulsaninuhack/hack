import {
  CONTACT_OPS_REFERENCE_DATE,
  type CanonicalObservations,
  type CaseDetail,
  ContactOpsClientError,
} from './contactOpsClient'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const SESSION_KEY = 'care-ops-demo-session-id'
const REQUEST_TIMEOUT_MS = 20_000
const AUDIO_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:wav|mp3)$/i

export type AiContactResult = `connected_${'ok' | 'concern'}` | `no_${'answer'}`

export interface AiObservationCritic {
  missing_fields: string[]
  contradictions: string[]
  low_confidence_fields: string[]
  warnings: string[]
}

export interface AiObservationCandidate {
  schema_version: 'contact-ops-observation-candidate/v1'
  synthetic: true
  marker: '[합성]'
  case_id: string
  surveyor_id: string
  source_kind: 'text' | 'audio'
  transcript: string
  contact_result: AiContactResult
  observations: CanonicalObservations
  free_text: string
  critic: AiObservationCritic
  stripped_server_owned_fields: string[]
  requires_user_confirmation: true
  confirmed: false
}

export interface AiCandidateResponse extends CaseDetail {
  candidate: AiObservationCandidate
}

export type AiObservationSource =
  | { kind: 'text'; text: string }
  | { kind: 'audio'; fileReference: string }

function demoSessionId() {
  const existing = sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const value = `ui-demo-${crypto.randomUUID().replaceAll('-', '')}`
  sessionStorage.setItem(SESSION_KEY, value)
  return value
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Demo-Session-ID': demoSessionId(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const envelope = await response.json() as {
      data?: T
      error?: { code?: string; message?: string }
    }
    if (!response.ok || !envelope.data) {
      const unavailable = response.status >= 500
        || envelope.error?.code === 'CONTACT_OPS_UNAVAILABLE'
      throw new ContactOpsClientError(
        envelope.error?.code ?? 'AI_OBSERVATION_REQUEST_FAILED',
        unavailable
          ? '인공지능 관찰 후보 서비스를 잠시 사용할 수 없습니다.'
          : '인공지능 관찰 후보 요청을 처리하지 못했습니다. 입력을 확인해 주세요.',
      )
    }
    return envelope.data
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new ContactOpsClientError('AI_OBSERVATION_TIMEOUT', 'AI 후보 생성 시간이 초과되었습니다.')
    }
    throw cause
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function createAiObservationCandidate(input: {
  caseId: string
  revision: number
  source: AiObservationSource
}) {
  const common = {
    mode: 'candidate',
    expected_revision: input.revision,
    contact_date: CONTACT_OPS_REFERENCE_DATE,
    surveyor_id: '연결단원 001',
  }
  let body: Record<string, unknown>
  if (input.source.kind === 'text') {
    if (!input.source.text.trim()) throw new Error('비식별·마스킹 텍스트를 입력해 주세요.')
    body = { ...common, consented_masked_text: input.source.text }
  } else {
    if (!AUDIO_REFERENCE_PATTERN.test(input.source.fileReference)) {
      throw new Error('검증된 WAV 또는 MP3 참조 이름을 입력해 주세요.')
    }
    body = { ...common, validated_file_reference: input.source.fileReference }
  }
  return post<AiCandidateResponse>(
    `/api/v1/contact-ops/cases/${encodeURIComponent(input.caseId)}/ai-observations`,
    body,
  )
}

export async function confirmAiObservation(input: {
  caseId: string
  revision: number
  candidate: AiObservationCandidate
}) {
  return post<CaseDetail>(
    `/api/v1/contact-ops/cases/${encodeURIComponent(input.caseId)}/ai-observations`,
    {
      mode: 'confirm',
      expected_revision: input.revision,
      contact_date: CONTACT_OPS_REFERENCE_DATE,
      confirmed: true,
      candidate: input.candidate,
    },
  )
}
