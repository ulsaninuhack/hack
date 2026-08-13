import { ContactOpsClientError, CONTACT_OPS_REFERENCE_DATE } from './contactOpsClient'
import type { CanonicalObservations, CaseDetail, ContactResultLabel } from './contactOpsClient'

// 원시 결과 코드는 렌더 파일(.tsx)에 쓰지 않는다. 이 매핑만 통해 한국어
// 라벨로 변환한다(UI copy 게이트 계약).
const LABEL_BY_RESULT_CODE: Record<string, ContactResultLabel> = {
  connected_ok: '안부 확인 완료',
  connected_concern: '우려 사항 있음',
  no_answer: '미응답',
  refused: '연락(또는 방문) 거부',
  invalid_contact: '연락처 확인 필요',
}

export function contactResultLabelFromCode(code: string): ContactResultLabel | '' {
  return LABEL_BY_RESULT_CODE[code] ?? ''
}

export type ManagementIntakeChannel = 'self_request' | 'family_request' | 'partner_agency_referral' | 'field_outreach'

const LABEL_BY_INTAKE_CHANNEL: Record<ManagementIntakeChannel, string> = {
  self_request: '본인 신청',
  family_request: '가족 신청',
  partner_agency_referral: '지역기관 의뢰',
  field_outreach: '현장 발굴',
}

export function managementIntakeLabel(channel: ManagementIntakeChannel): string {
  return LABEL_BY_INTAKE_CHANNEL[channel]
}

// 목록에서 강조가 필요한 연락 결과 라벨. 백엔드 3계층 어댑터는 no_answer를
// '연락 안 됨'으로, 프런트 제출 흐름은 '미응답'으로 표기하므로 둘 다 포함한다.
export const ATTENTION_CONTACT_LABELS: ReadonlySet<string> = new Set([
  '연락 안 됨', '미응답', '연락(또는 방문) 거부', '연락처 확인 필요', '우려 사항 있음',
])

// 3계층 어댑터 API 클라이언트. contactOpsClient와 같은 규약을 쓴다:
// VITE_API_BASE_URL 기반 경로, X-Demo-Session-ID 헤더, {data, error} 봉투.

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const SESSION_KEY = 'care-ops-demo-session-id'
const SHARED_DEMO_SESSION_ID = 'incheon-care-shared-demo-floor'

export const DEMO_CENTER_DONG_CODE = '2812551000'
export const DEMO_CENTER_DONG_NAME = '신포동'
export const DEMO_WORKER_ID = 'SYN-W-2812551000-01'

export function demoWorkerIdForDong(dongCode: string): string {
  if (!/^\d{10}$/.test(dongCode)) throw new TypeError('dongCode must be 10 digits')
  return `SYN-W-${dongCode}-01`
}

function demoSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing
  // 기본은 기기 간 공유 데모 세션. e2e·격리 시나리오는 sessionStorage 주입으로 덮어쓴다.
  sessionStorage.setItem(SESSION_KEY, SHARED_DEMO_SESSION_ID)
  return SHARED_DEMO_SESSION_ID
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'X-Demo-Session-ID': demoSessionId(),
      ...init?.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as {
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

export interface VirtualPhone {
  label: '[가상]'
  display_number: string
  dialable: false
  note: string
}

export interface LaneLocation {
  dong_code: string
  dong_name: string
  district: string
  latitude: number
  longitude: number
  geometry_zone_id: string
  road_address: string | null
  building_name: string | null
  apartment_reference: boolean | null
  address_note: string
}

export type AssignmentStatus = 'proposed' | 'confirmed'

export interface ManagementEntry {
  synthetic: true
  status: 'active_contact_management'
  intake_channel: ManagementIntakeChannel
  intake_recorded_date: string
  ongoing_contact_permission: {
    status: 'recorded'
    recorded_date: string
    basis: 'synthetic_demo_scenario'
  }
  duplicate_service_check: {
    status: 'completed_no_overlapping_schedule'
    checked_date: string
    scope: 'regular_wellbeing_contact_or_home_visit'
    interpretation: 'workflow_duplicate_check_not_welfare_eligibility'
  }
}

export interface AcuteContribution {
  코드: string
  근거: string
  가산점: number
}

export interface LaneItem {
  synthetic: true
  displayMarker: string
  case_id: string
  display_name: string
  revision: number
  lane: 'phone' | 'visit'
  assignment_status: AssignmentStatus
  worker_display_name: string | null
  confirmed_by?: string
  confirmed_at?: string
  selection_reason_labels: string[]
  management_entry: ManagementEntry
  due_reasons: string[]
  earliest_due_date: string | null
  reference_date: string
  급성도_등급: string | null
  급성도_점수: number | null
  취약도_점수: number | null
  grade_source: '세션 기록' | '데모 사전 기록' | '미기록'
  기록_출처?: 'demo_precontact_record' | null
  프로필_버전?: 'demo-precontact-v1' | null
  급성도_기여내역: AcuteContribution[]
  virtual_phone: VirtualPhone
  location: LaneLocation
  last_contact: {
    date: string | null
    result_label: string
    consecutive_no_answer_count: number
  }
  visit_approval_status: 'recommended' | 'approved' | 'rejected' | null
  visit_context?: {
    preferred_visit_time_window: { start: string; end: string }
    requires_two_person_team: boolean
    requires_public_official_companion: boolean
    stairs_present: boolean
    service_duration_minutes: number
  }
}

export interface CompletedContact {
  case_id: string
  display_name: string
  결과_라벨: string
  급성도_등급: string | null
  급성도_점수?: number | null
  취약도_점수?: number | null
  연속_미응답?: number | null
  완료_시각: string
}

export interface TodayLanes {
  synthetic: true
  displayMarker: string
  reference_date: string
  worker_id: string
  worker_display_name: string
  dong_code: string
  dong_name: string
  lane_rule: string
  assignment_rule: string
  pending_confirmation: { phone: number; visit: number }
  lanes: { phone: LaneItem[]; visit: LaneItem[] }
  completed: CompletedContact[]
}

// 표시용 심각도. 엔진의 급성도·취약도 점수는 분리 저장·서빙을 유지하고,
// 화면에서만 두 점수의 최댓값에 연락 실패 가산을 더해 하나의 심각도로
// 보여준다. 등급 임계값은 contact-triage-scoring.mjs gradeAcuity와 동일(75/55/30).
export interface DisplaySeverity {
  점수: number | null
  등급: string | null
  상승_근거: Array<{ 근거: string; 가산점: number }>
}

const SEVERITY_CONTACT_BUMPS: Array<{ labels: string[]; perCount: boolean; points: number; reason: string }> = [
  { labels: ['연락(또는 방문) 거부', '연락 거부'], perCount: false, points: 12, reason: '연락 거부' },
  { labels: ['연락처 확인 필요'], perCount: false, points: 8, reason: '연락처 확인 필요' },
  { labels: ['연락 안 됨', '미응답'], perCount: true, points: 6, reason: '미응답 지속' },
]

function severityGrade(score: number): string {
  if (score >= 75) return '방문권고-우선'
  if (score >= 55) return '방문권고'
  if (score >= 30) return '주시'
  return '정상'
}

export function caseDetailDisplaySeverity(item: CaseDetail): DisplaySeverity {
  return displaySeverity({
    급성도_점수: item.triage?.급성도_점수 ?? null,
    취약도_점수: item.triage?.취약도_점수 ?? null,
    결과_라벨: contactResultLabelFromCode(String(item.household.contact.last_contact_result ?? '')),
    연속_미응답: Number(item.household.contact.consecutive_no_answer_count ?? 0),
  })
}

export function completedContactDisplaySeverity(entry: CompletedContact): DisplaySeverity {
  return displaySeverity({
    급성도_점수: entry.급성도_점수 ?? null,
    취약도_점수: entry.취약도_점수 ?? null,
    결과_라벨: entry.결과_라벨,
    연속_미응답: entry.연속_미응답 ?? null,
  })
}

export function proposalItemDisplaySeverity(item: AssignmentProposalItem): DisplaySeverity {
  return displaySeverity({
    급성도_점수: item.급성도_점수,
    취약도_점수: item.취약도_점수 ?? null,
    결과_라벨: item.last_contact.result_label,
    연속_미응답: item.last_contact.consecutive_no_answer_count ?? null,
  })
}

export function laneItemDisplaySeverity(item: LaneItem): DisplaySeverity {
  return displaySeverity({
    급성도_점수: item.급성도_점수,
    취약도_점수: item.취약도_점수,
    결과_라벨: item.last_contact.result_label,
    연속_미응답: item.last_contact.consecutive_no_answer_count,
  })
}

export function displaySeverity(input: {
  급성도_점수: number | null
  취약도_점수?: number | null
  결과_라벨?: string | null
  연속_미응답?: number | null
}): DisplaySeverity {
  const acute = input.급성도_점수
  const vulnerability = input.취약도_점수 ?? null
  if (acute === null && vulnerability === null) return { 점수: null, 등급: null, 상승_근거: [] }
  const base = Math.max(acute ?? 0, vulnerability ?? 0)
  const 상승_근거: Array<{ 근거: string; 가산점: number }> = []
  if (vulnerability !== null && vulnerability > (acute ?? 0)) {
    상승_근거.push({ 근거: '생활 기반 취약', 가산점: Math.round((vulnerability - (acute ?? 0)) * 10) / 10 })
  }
  let bump = 0
  const label = input.결과_라벨 ?? null
  if (label !== null) {
    const matched = SEVERITY_CONTACT_BUMPS.find((rule) => rule.labels.includes(label))
    if (matched) {
      const count = matched.perCount ? Math.min(Math.max(input.연속_미응답 ?? 1, 1), 3) : 1
      bump = matched.points * count
      상승_근거.push({
        근거: matched.perCount && count > 1 ? `${matched.reason} ${count}회` : matched.reason,
        가산점: bump,
      })
    }
  }
  const score = Math.min(100, Math.round((base + bump) * 10) / 10)
  return { 점수: score, 등급: severityGrade(score), 상승_근거 }
}

export interface AgencyRecommendation {
  기관: string
  사유: string
  근거_문서: string[]
  성격: '권고'
  확정_권한: string
}

export interface ReportAcknowledgement {
  status: '확인' | '미확인'
  acknowledged_by?: string
  acknowledged_at?: string
  revision?: number
}

export interface ReportCard {
  synthetic: true
  displayMarker: string
  card_id: string
  case_id: string
  display_name: string
  road_address: string | null
  revision: number
  dong_code: string
  dong_name: string
  district: string
  등급: string
  급성도_점수: number
  취약도_점수: number
  권고_액션: string
  사유_요약: Array<{ 축: string; 근거: string; 가산점: number }>
  evidence: {
    관찰: CanonicalObservations
    마지막_연락_일자: string | null
    마지막_연락_결과_라벨: string
    연속_미응답_횟수: number
  }
  권고_기관: AgencyRecommendation[]
  workflow: {
    follow_up_status: string
    transfer_status: string
    transfer_label: string | null
    visit_approval_status: string | null
  }
  virtual_phone: VirtualPhone
  acknowledgement: ReportAcknowledgement
  기타사항?: string | null
  // center-inbox 응답에서만 채워진다: 전화/방문 확인 분리와 기관 연락 상태.
  report_lane?: 'phone' | 'visit'
  escalation?: CaseEscalation | null
}

export interface CaseEscalation {
  status: '신고됨'
  agency: string
  reported_by: string
  reported_at: string
}

export interface AssignmentProposalItem {
  status: 'proposed' | 'confirmed'
  assignment_status: AssignmentStatus
  case_id: string
  display_name: string
  escalation?: CaseEscalation | null
  road_address: string | null
  last_contact: {
    date: string | null
    result_label: string
    consecutive_no_answer_count?: number
  }
  lane: 'phone' | 'visit'
  dong_code: string
  dong_name: string
  district: string
  worker_id: string | null
  worker_display_name: string | null
  confirmed_by?: string
  confirmed_at?: string
  급성도_등급: string | null
  급성도_점수: number | null
  취약도_점수?: number | null
  grade_source: '세션 기록' | '데모 사전 기록' | '미기록'
  기록_출처?: 'demo_precontact_record' | null
  프로필_버전?: 'demo-precontact-v1' | null
  급성도_기여내역: AcuteContribution[]
  due_reasons: string[]
  earliest_due_date: string | null
  selection_reason_labels: string[]
  management_entry: ManagementEntry
  preferred_contact_method: 'phone' | 'visit'
  approved_visit: boolean
  adjustment_flags: string[]
  제안_근거: string[]
}

export interface AssignmentProposal {
  synthetic: true
  displayMarker: string
  batch_id: string
  reference_date: string
  dong_code: string
  dong_name: string
  district: string
  status: 'proposed' | 'partially_confirmed' | 'confirmed'
  worker_id: string | null
  worker_display_name: string | null
  max_daily_approved_visits: number | null
  lanes: { phone: AssignmentProposalItem[]; visit: AssignmentProposalItem[] }
  proposed_count: number
  confirmed_count: number
  confirmation_rule: string
}

export interface CenterInbox {
  synthetic: true
  displayMarker: string
  audience: string
  reference_date: string
  dong_code: string
  dong_name: string
  district: string
  summary: {
    보고_카드_수: number
    보고_확인_수: number
    보고_대기_수: number
    처리_완료율_pct: number | null
    방문승인_대기_수: number
    배치_상태: string
  }
  report_cards: ReportCard[]
  assignment_proposal: AssignmentProposal | null
}

export interface DistrictAggregate {
  synthetic_operations: true
  district: string
  case_detail_access: string
  structure: {
    total_population: number
    population_age_65_plus: number
    elderly_share_pct: number | null
    total_households: number
    one_person_households: number
    one_person_household_share_pct: number | null
    one_person_households_age_65_plus: number
    mixed_snapshot_warning: string
    welfare_facility_count: number
    basic_livelihood: {
      recipient_count_living_age_65_plus: number
      population_age_65_plus_denominator: number
      density_pct: number | null
      missing_zone_count: number
      mixed_snapshot_warning: string
    }
    structural_context: {
      model_output_label: string
      zone_count: number
      mean_score_0_50: number | null
      max_score_0_50: number | null
      indicator_mean_contributions: Record<string, number | null>
    }
  }
  operations: {
    synthetic: true
    displayMarker: string
    worker_count: number
    case_count: number
    due_count: number
    overdue_count: number
    pending_visit_approval_count: number
    approved_visit_count: number
    transfer_recommended_count: number
    per_worker: {
      due: number | null
      overdue: number | null
      pending_visit_approval: number | null
    }
  }
}

export interface StaffingReview {
  title: string
  method_note: string
  composite_score: null
  ordering: string
  candidates: Array<{
    district: string
    load_rank: number
    structure_rank: number
    per_worker_due: number | null
    per_worker_pending_visit_approval: number | null
    worker_count: number
    structural_mean_score_0_50: number | null
    structural_model_output_label: string
  }>
}

export interface DistrictAggregates {
  synthetic: true
  displayMarker: string
  reference_date: string
  case_detail_access: string
  privacy_note: string
  districts: DistrictAggregate[]
  staffing_review: StaffingReview
}

export interface DistrictAiSummary {
  synthetic: true
  displayMarker: string
  label: string
  generator: string
  district: string
  reference_date: string
  input_metrics: Record<string, string>
  summary_text: string
  mixed_snapshot_warnings: string[]
}

export async function loadTodayLanes(
  referenceDate: string = CONTACT_OPS_REFERENCE_DATE,
  workerId: string = DEMO_WORKER_ID,
): Promise<TodayLanes> {
  const query = new URLSearchParams({ referenceDate, workerId })
  return request<TodayLanes>(`/api/v1/contact-ops/three-tier/today-lanes?${query}`)
}

export async function loadCenterInbox(
  dongCode: string = DEMO_CENTER_DONG_CODE,
  referenceDate: string = CONTACT_OPS_REFERENCE_DATE,
): Promise<CenterInbox> {
  const query = new URLSearchParams({ dongCode, referenceDate })
  return request<CenterInbox>(`/api/v1/contact-ops/three-tier/center-inbox?${query}`)
}

export async function loadReportCard(caseId: string): Promise<{ report_card: ReportCard; destination: string }> {
  return request(`/api/v1/contact-ops/three-tier/report-cards/${encodeURIComponent(caseId)}`)
}

export interface CaseHistoryEntry {
  일자: string
  결과_라벨: string
  식사상태: string | null
  위생상태: string | null
  특이_징후_수: number
  출처: string
}

export interface CaseHistory {
  synthetic: true
  displayMarker: '[합성]'
  case_id: string
  display_name: string
  trend_label: string
  source_note: string
  entries: CaseHistoryEntry[]
}

export interface CaseHistorySummary {
  case_id: string
  summary_text: string
  generator: string
  label: string
}

export interface CenterCalendarDay {
  일자: string
  기록_수: number
  미응답_수: number
  사례: Array<{ case_id: string; display_name: string; 결과_라벨: string; 출처: string }>
}

export interface CenterCalendar {
  month: string
  source_note: string
  days: CenterCalendarDay[]
}

export async function loadCaseHistory(caseId: string): Promise<CaseHistory> {
  return request(`/api/v1/contact-ops/three-tier/case-histories/${encodeURIComponent(caseId)}`)
}

export async function loadCaseHistorySummary(caseId: string): Promise<CaseHistorySummary> {
  return request(`/api/v1/contact-ops/three-tier/case-history-summaries/${encodeURIComponent(caseId)}`)
}

export async function loadCenterCalendar(input: {
  dongCode?: string
  month: string
}): Promise<CenterCalendar> {
  const query = new URLSearchParams({ dongCode: input.dongCode ?? DEMO_CENTER_DONG_CODE, month: input.month })
  return request(`/api/v1/contact-ops/three-tier/center-calendar?${query}`)
}

export async function acknowledgeReport(input: {
  caseId: string
  revision: number
  acknowledgedBy: string
}): Promise<{ case_id: string; acknowledgement: ReportAcknowledgement }> {
  return request('/api/v1/contact-ops/three-tier/report-acknowledgements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      case_id: input.caseId,
      expected_revision: input.revision,
      acknowledged_by: input.acknowledgedBy,
    }),
  })
}

export async function confirmAssignment(input: {
  dongCode: string
  referenceDate: string
  confirmedBy: string
  caseIds: string[] | null
}): Promise<{ assignment_proposal: AssignmentProposal }> {
  return request('/api/v1/contact-ops/three-tier/assignment-confirmations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dong_code: input.dongCode,
      reference_date: input.referenceDate,
      confirmed_by: input.confirmedBy,
      case_ids: input.caseIds,
    }),
  })
}

export async function submitCaseNote(input: {
  caseId: string
  note: string
}): Promise<{ case_id: string; 기타사항: string }> {
  return request(`/api/v1/contact-ops/three-tier/case-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ case_id: input.caseId, note: input.note }),
  })
}

export async function escalateCase(input: {
  caseId: string
  reportedBy: string
}): Promise<{ case_id: string; escalation: CaseEscalation }> {
  return request('/api/v1/contact-ops/three-tier/escalations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ case_id: input.caseId, reported_by: input.reportedBy }),
  })
}

// 시·구 화면 전용 운영 지도: 서버가 구역 최대값의 케이스 ID를 제거한 응답
// (INV17을 API 계층에서 강제). 공개/센터 화면의 operations-map과 구분된다.
export interface CityOperationsMapZone {
  geometry_zone_id: string
  public_structural_context: {
    model_output_label: string
    score_0_50: number
    available_score_denominator: number
    completeness: { ratio: number }
    indicators: Record<string, unknown>
  }
  operations: {
    synthetic: true
    displayMarker: string
    scenario_label: string
    scenario_reference_date: string
    acute_color_metric: number | null
    vulnerability_size_metric: number | null
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

export interface CityOperationsMap {
  synthetic: true
  displayMarker: string
  geometry_zone_count: number
  current_admin_dong_count: number
  case_detail_access: string
  privacy_note: string
  zones: CityOperationsMapZone[]
  dong_rollups?: Array<{
    dong_code: string
    dong_name: string
    district: string
    geometry_zone_id: string
    worker_count: number
    contact_target_count: number
    approved_visit_target_count: number
    contact_targets_per_worker: number | null
  }>
}

export async function loadCityOperationsMap(): Promise<CityOperationsMap> {
  return request<CityOperationsMap>('/api/v1/contact-ops/three-tier/city-operations-map')
}

export async function loadDistrictAggregates(
  referenceDate: string = CONTACT_OPS_REFERENCE_DATE,
): Promise<DistrictAggregates> {
  const query = new URLSearchParams({ referenceDate })
  return request<DistrictAggregates>(`/api/v1/contact-ops/three-tier/district-aggregates?${query}`)
}

export async function loadDistrictAiSummary(
  district: string,
  referenceDate: string = CONTACT_OPS_REFERENCE_DATE,
): Promise<DistrictAiSummary> {
  const query = new URLSearchParams({ district, referenceDate })
  return request<DistrictAiSummary>(`/api/v1/contact-ops/three-tier/district-ai-summary?${query}`)
}

export interface VoiceCandidate {
  case_id: string
  contact_result: string
  observations: CanonicalObservations
  transcript: string
  free_text: string
  critic: {
    missing_fields: string[]
    contradictions: string[]
    low_confidence_fields: string[]
    warnings: string[]
    next_question: string | null
  }
  requires_user_confirmation: true
}

export interface VoiceCandidateResponse {
  synthetic: true
  displayMarker: string
  revision: number
  candidate: VoiceCandidate
}

export async function uploadVoiceObservationAudio(input: {
  caseId: string
  revision: number
  file: File
  surveyorId?: string
  contactDate?: string
}): Promise<VoiceCandidateResponse> {
  const form = new FormData()
  form.append('expected_revision', String(input.revision))
  form.append('contact_date', input.contactDate ?? CONTACT_OPS_REFERENCE_DATE)
  form.append('surveyor_id', input.surveyorId ?? '연결단원 001')
  form.append('consent_basis', 'verbal_in_recording')
  form.append('audio', input.file)
  return request<VoiceCandidateResponse>(`/api/v1/contact-ops/cases/${encodeURIComponent(input.caseId)}/ai-observations/audio`, {
    method: 'POST',
    body: form,
  })
}
