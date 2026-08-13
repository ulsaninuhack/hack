type UnknownRecord = Record<string, unknown>

export const CONTACT_OPS_REFERENCE_DATE = '2026-08-12'
export const DEFAULT_SYNTHETIC_WORKER_ID = 'SYN-W-2812551000-01'

export interface ScoreContribution {
  축: '급성도' | '취약도'
  코드?: string
  근거: string
  가산점: number
}

export interface Triage {
  급성도_점수: number
  취약도_점수: number
  급성도_등급?: string
  권고_액션?: string
  방문_승인_상태?: '권고' | '승인' | '반려' | null
  점수_기여내역: ScoreContribution[]
}

export interface QueueItem {
  household_id: string
  revision: number
  preferred_contact_method: 'phone' | 'visit'
  due_reasons: string[]
  triage: Triage
}

export interface CanonicalObservations {
  관찰_6징후: {
    우편물_고지서_적체: boolean
    악취_벌레: boolean
    쓰레기_술병: boolean
    인기척_없이_TV_불: boolean
    외출_없음: boolean
    연락_두절: boolean
  }
  식사상태: '양호' | '불량' | '심각' | null
  위생상태: '양호' | '불량' | null
  공과금_2개월_이상_체납: boolean | null
  최근_건강_정신_괴로움: boolean | null
  관계망_유무: '있음' | '없음' | null
  연락_빈도: '주_1회_이상' | '주_1회_미만' | '없음' | null
}

export interface SyntheticHousehold {
  id: string
  synthetic: true
  location: {
    longitude: number
    latitude: number
    geometry_zone_id: string
    current_admin_dong_code_20260701: string
    current_admin_dong_name_20260701: string
    current_district_name_20260701: string
    road_address: string
    building_name: string
    apartment_reference: boolean
    reference_pnu: string
    residential_building_reference: true
    not_real_resident: true
  }
  contact: UnknownRecord
  workflow: {
    visit_approval_status: 'recommended' | 'approved' | 'rejected' | null
    [key: string]: unknown
  }
  approved_visit_constraints: UnknownRecord | null
  [key: string]: unknown
}

export interface CaseDetail {
  synthetic: true
  displayMarker: '[합성]'
  revision: number
  household: SyntheticHousehold
  observations: CanonicalObservations
  triage: Triage | null
  findings?: Array<{ code?: string }>
}

export interface ManagerBreadth {
  synthetic: true
  displayMarker: '[합성]'
  transfer_recommendations: Array<{ case_id: string; status_label: string; acute: { score: number }; vulnerability: { score: number } }>
  grade_distribution: {
    scored_case_count: number
    not_yet_scored_case_count: number
    acute: { axis_label: string; grades: Record<string, number> }
    vulnerability: { axis_label: string; score_bands: Record<string, number> }
  }
  tuning_warning: { title: string; current_mild_signal_count: number; source_case_count: number; interpretation: string }
  approved_visit_hint: {
    approved_visit_count: number
    label: string
    items: Array<{ case_id: string; district: string; admin_dong: string; assigned_worker_ids: string[]; approved_max_route_distance_km: number; distance_from_previous_km?: number }>
  }
}

export interface OperationsMapZone {
  geometry_zone_id: string
  public_structural_context: {
    model_output_label: '[MODEL OUTPUT — UNVALIDATED]'
    score_0_50: number
    available_score_denominator: number
    completeness: { available_indicator_count?: number; total_indicator_count?: number; ratio: number }
    indicators: Record<string, unknown>
  }
  operations: {
    synthetic: true
    displayMarker: '[합성]'
    aggregation: 'zone_max_priority_context'
    tie_rule: string
    scenario_label: '[합성 시나리오]'
    scenario_reference_date: string
    scenario_method: 'one_deterministic_example_per_current_admin_dong'
    acute_color_metric: number | null
    vulnerability_size_metric: number | null
    acute_max_case_id: string | null
    vulnerability_max_case_id: string | null
    acute_metric_source: 'session_recorded' | 'synthetic_scenario' | null
    vulnerability_metric_source: 'session_recorded' | 'synthetic_scenario' | null
    scored_case_count: number
    unscored_case_count: number
    session_scored_case_count: number
    scenario_scored_case_count: number
    contribution_summaries: {
      acute: Array<{ code: string; total_points: number; case_count: number }>
      vulnerability: Array<{ code: string; total_points: number; case_count: number }>
    }
  }
}

export interface OperationsMap {
  synthetic: true
  displayMarker: '[합성]'
  geometry_zone_count: 156
  current_admin_dong_count: 162
  public_context_label: '[MODEL OUTPUT — UNVALIDATED]'
  scenario_label: '[합성 시나리오]'
  scenario_reference_date: string
  scenario_method: 'one_deterministic_example_per_current_admin_dong'
  visit_review_points: VisitReviewPoint[]
  zones: OperationsMapZone[]
}

export interface VisitReviewPoint {
  synthetic: true
  displayMarker: '[합성]'
  case_id: string
  score_source: 'session_recorded' | 'synthetic_scenario'
  visit_approval_status: '권고'
  권고_액션: string
  급성도_점수: number
  급성도_등급: '방문권고' | '방문권고-우선'
  취약도_점수: number
  점수_기여내역: ScoreContribution[]
  current_admin_dong_code_20260701: string
  current_admin_dong_name_20260701: string
  current_district_name_20260701: string
  geometry_zone_id: string
  longitude: number
  latitude: number
  road_address: string
  building_name: string
  apartment_reference: boolean
  reference_pnu: string
  spatial_basis: 'official_residential_building_address_reference'
  address_source: 'MOIS_JUSO_BUILDING_DB_202607'
  coordinate_source: string
  not_real_resident: true
}

export class ContactOpsClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const SESSION_KEY = 'care-ops-demo-session-id'

function demoSessionId() {
  const existing = sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const randomPart = crypto.randomUUID().replaceAll('-', '')
  const value = `ui-demo-${randomPart}`
  sessionStorage.setItem(SESSION_KEY, value)
  return value
}

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      'X-Demo-Session-ID': demoSessionId(),
      ...init?.headers,
    },
  })
  const body = await response.json() as {
    data?: T
    error?: { code?: string; message?: string }
  }
  if (!response.ok || !body.data) {
    throw new ContactOpsClientError(
      body.error?.code ?? 'CONTACT_OPS_REQUEST_FAILED',
      body.error?.message ?? '운영 데이터를 불러오지 못했습니다.',
    )
  }
  return body.data
}

export async function loadTodayQueue(
  referenceDate = CONTACT_OPS_REFERENCE_DATE,
  workerId = DEFAULT_SYNTHETIC_WORKER_ID,
) {
  const query = new URLSearchParams({ referenceDate, workerId })
  return request<{ synthetic: true; displayMarker: '[합성]'; items: QueueItem[] }>(
    `/api/v1/contact-ops/today?${query}`,
  )
}

export async function loadCase(caseId: string) {
  return request<CaseDetail>(`/api/v1/contact-ops/cases/${encodeURIComponent(caseId)}`)
}

export async function loadRecommendations() {
  return request<{ synthetic: true; displayMarker: '[합성]'; items: CaseDetail[] }>(
    '/api/v1/contact-ops/visit-recommendations',
  )
}

export async function loadManagerBreadth() {
  return request<ManagerBreadth>('/api/v1/contact-ops/manager-breadth')
}

export async function loadOperationsMap() {
  return request<OperationsMap>('/api/v1/contact-ops/operations-map')
}

export function emptyObservations(): CanonicalObservations {
  return {
    관찰_6징후: {
      우편물_고지서_적체: false,
      악취_벌레: false,
      쓰레기_술병: false,
      인기척_없이_TV_불: false,
      외출_없음: false,
      연락_두절: false,
    },
    식사상태: null,
    위생상태: null,
    공과금_2개월_이상_체납: null,
    최근_건강_정신_괴로움: null,
    관계망_유무: null,
    연락_빈도: null,
  }
}

const RESULT_CODE_BY_LABEL = {
  '안부 확인 완료': 'connected_ok',
  '우려 사항 있음': 'connected_concern',
  '미응답': 'no_answer',
  '연락 거부': 'refused',
  '연락처 확인 필요': 'invalid_contact',
} as const

export type ContactResultLabel = keyof typeof RESULT_CODE_BY_LABEL

export async function submitContact(input: {
  caseId: string
  revision: number
  resultLabel: ContactResultLabel
  observations: CanonicalObservations
}) {
  return request<CaseDetail>(
    `/api/v1/contact-ops/cases/${encodeURIComponent(input.caseId)}/contact-results`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_revision: input.revision,
        contact_date: CONTACT_OPS_REFERENCE_DATE,
        contact_result: RESULT_CODE_BY_LABEL[input.resultLabel],
        observations: input.observations,
      }),
    },
  )
}

export async function submitDecision(input: {
  caseId: string
  revision: number
  decision: 'approved' | 'rejected'
  note: string
  workerIds?: string[]
  distance?: number
}) {
  const common = {
    expected_revision: input.revision,
    decision: input.decision,
    decided_by: 'synthetic-manager',
    decided_at: `${CONTACT_OPS_REFERENCE_DATE}T09:00:00Z`,
    note: input.note,
  }
  const body = input.decision === 'approved'
    ? {
        ...common,
        assigned_worker_ids: input.workerIds,
        max_route_distance_km: input.distance,
      }
    : common
  return request<CaseDetail>(
    `/api/v1/contact-ops/cases/${encodeURIComponent(input.caseId)}/visit-decisions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}
