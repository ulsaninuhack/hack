import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanonicalObservations } from './contactOpsClient'
import type { AssignmentProposal, CenterInbox, ReportCard } from './threeTierClient'

const empty = (): CanonicalObservations => ({
  관찰_6징후: { 우편물_고지서_적체: true, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
  식사상태: '심각',
  위생상태: null,
  공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null,
  관계망_유무: null,
  연락_빈도: null,
})

const mocks = vi.hoisted(() => ({
  loadCenterInbox: vi.fn(),
  acknowledgeReport: vi.fn(),
  confirmAssignment: vi.fn(),
  loadRecommendations: vi.fn(),
  submitDecision: vi.fn(),
  loadData: vi.fn(),
}))

vi.mock('./threeTierClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./threeTierClient')>()
  return {
    ...actual,
    loadCenterInbox: mocks.loadCenterInbox,
    acknowledgeReport: mocks.acknowledgeReport,
    confirmAssignment: mocks.confirmAssignment,
  }
})
vi.mock('./contactOpsClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./contactOpsClient')>()
  return {
    ...actual,
    loadRecommendations: mocks.loadRecommendations,
    submitDecision: mocks.submitDecision,
  }
})
vi.mock('./data', () => ({ loadData: mocks.loadData }))
vi.mock('./MapView', () => ({ default: () => <div role="region" aria-label="[합성] 우리 동 케이스 위치 참고 지도" /> }))

import { CenterPage } from './CenterPage'
import { BANNED_GROUP_WORD } from './threeTierTestFixtures'

const virtualPhone = {
  label: '[가상]' as const,
  display_number: '010-0000-1234',
  dialable: false as const,
  note: '가상 번호 · 실제 발신이 이루어지지 않습니다',
}

const reportCard: ReportCard = {
  synthetic: true,
  displayMarker: '[합성]',
  card_id: 'RPT-SYN-HH-2812551000-0001-r1',
  case_id: 'SYN-HH-2812551000-0001',
  가명: '김순○',
  road_address: '인천광역시 제물포구 답동로 7-2',
  revision: 1,
  dong_code: '2812551000',
  dong_name: '신포동',
  district: '제물포구',
  등급: '방문권고',
  급성도_점수: 62,
  취약도_점수: 25,
  권고_액션: '방문권고',
  사유_요약: [
    { 축: '급성도', 근거: '연속 미응답 2회', 가산점: 25 },
    { 축: '급성도', 근거: '식사상태 심각', 가산점: 25 },
  ],
  evidence: {
    관찰: empty(),
    마지막_연락_일자: '2026-08-12',
    마지막_연락_결과_라벨: '연락 안 됨',
    연속_미응답_횟수: 2,
  },
  권고_기관: [
    { 기관: '보건소·의료 연계', 사유: '식사상태 심각 관찰', 근거_문서: ['매뉴얼_p49'], 성격: '권고', 확정_권한: '동 행정복지센터' },
    { 기관: '현장 확인', 사유: '연속 미응답 2회', 근거_문서: ['매뉴얼_p14'], 성격: '권고', 확정_권한: '동 행정복지센터' },
  ],
  workflow: {
    follow_up_status: 'required',
    transfer_status: 'recommended',
    transfer_label: '행정복지센터 이관 권고',
    visit_approval_status: 'recommended',
  },
  virtual_phone: virtualPhone,
  acknowledgement: { status: '미확인' },
}

const proposal: AssignmentProposal = {
  synthetic: true,
  displayMarker: '[합성]',
  batch_id: 'ASSIGN-2026-08-12-2812551000',
  reference_date: '2026-08-12',
  dong_code: '2812551000',
  dong_name: '신포동',
  district: '제물포구',
  status: 'proposed',
  worker_id: 'SYN-W-2812551000-01',
  worker_display_name: '연결단원 001',
  max_daily_approved_visits: 2,
  lanes: {
    phone: [{
      status: 'proposed', case_id: 'SYN-HH-2812551000-0001', 가명: '김순○',
      road_address: '인천광역시 제물포구 답동로 7-2',
      last_contact: { date: '2026-08-11', result_label: '연락 안 됨' }, lane: 'phone',
      dong_code: '2812551000', dong_name: '신포동', district: '제물포구',
      worker_id: 'SYN-W-2812551000-01', worker_display_name: '연결단원 001',
      급성도_등급: '방문권고', 급성도_점수: 62, grade_source: '세션 기록',
      due_reasons: ['scheduled_contact'], earliest_due_date: '2026-08-12',
      preferred_contact_method: 'phone', approved_visit: false,
      adjustment_flags: [], 제안_근거: ['담당 동 일치 (신포동)'],
    }],
    visit: [{
      status: 'proposed', case_id: 'SYN-HH-2812551000-0002', 가명: '박영○',
      road_address: '인천광역시 제물포구 답동로 9',
      last_contact: { date: '2026-08-10', result_label: '안부 확인 완료' }, lane: 'visit',
      dong_code: '2812551000', dong_name: '신포동', district: '제물포구',
      worker_id: 'SYN-W-2812551000-01', worker_display_name: '연결단원 001',
      급성도_등급: null, 급성도_점수: null, grade_source: '미기록',
      due_reasons: ['scheduled_contact'], earliest_due_date: '2026-08-12',
      preferred_contact_method: 'visit', approved_visit: false,
      adjustment_flags: ['time_window_mismatch'], 제안_근거: ['담당 동 일치 (신포동)', '선호 시간창과 연결단원 가용 시간창 불일치 — 조정 필요'],
    }],
  },
  proposed_count: 2,
  confirmed_count: 0,
  confirmation_rule: '확정은 동 행정복지센터 담당자의 명시적 확인 액션만 가능',
}

const inbox: CenterInbox = {
  synthetic: true,
  displayMarker: '[합성]',
  audience: '동 행정복지센터용',
  reference_date: '2026-08-12',
  dong_code: '2812551000',
  dong_name: '신포동',
  district: '제물포구',
  summary: {
    보고_카드_수: 1, 보고_확인_수: 0, 보고_대기_수: 1,
    처리_완료율_pct: 0, 방문승인_대기_수: 1, 배치_상태: 'proposed',
  },
  report_cards: [reportCard],
  assignment_proposal: proposal,
}

const recommendation = {
  synthetic: true as const,
  displayMarker: '[합성]' as const,
  revision: 1,
  household: {
    id: 'SYN-HH-2812551000-0001',
    synthetic: true as const,
    workflow: { visit_approval_status: 'recommended' as const },
    location: {
      latitude: 37.47, longitude: 126.62,
      geometry_zone_id: 'vworld_sgis_20250630:23010530',
      current_admin_dong_code_20260701: '2812551000',
      current_admin_dong_name_20260701: '신포동',
      current_district_name_20260701: '제물포구',
    },
    contact: {},
    approved_visit_constraints: null,
  },
  observations: empty(),
  triage: {
    급성도_점수: 62, 취약도_점수: 25,
    점수_기여내역: [{ 축: '급성도' as const, 근거: '연속 미응답 2회', 가산점: 25 }],
  },
}

function arrange() {
  mocks.loadCenterInbox.mockResolvedValue(structuredClone(inbox))
  mocks.loadRecommendations.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', items: [structuredClone(recommendation)] })
  mocks.acknowledgeReport.mockResolvedValue({ case_id: reportCard.case_id, acknowledgement: { status: '확인' } })
  mocks.confirmAssignment.mockResolvedValue({ assignment_proposal: { ...structuredClone(proposal), status: 'confirmed' } })
  mocks.submitDecision.mockResolvedValue(structuredClone(recommendation))
  mocks.loadData.mockResolvedValue({ dongs: { features: [] }, summary: {} })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('CenterPage (동 행정복지센터)', () => {
  it('renders the center audience header, summary actions, and report card with grade vocabulary', async () => {
    arrange()
    render(<CenterPage />)
    expect(await screen.findByRole('heading', { name: /신포동 행정복지센터/ })).toBeInTheDocument()
    expect(screen.queryByText('[합성] 데모')).toBeNull()
    const summary = screen.getByLabelText('오늘 처리 요약과 다음 행동')
    expect(within(summary).getByText('보고 확인 대기')).toBeInTheDocument()
    expect(within(summary).getByText('방문 검토 대기')).toBeInTheDocument()
    const card = await screen.findByLabelText('SYN-HH-2812551000-0001 보고 카드')
    expect(within(card).getByText('김순○')).toBeInTheDocument()
    expect(within(card).getByText('인천광역시 제물포구 답동로 7-2')).toBeInTheDocument()
    expect(screen.queryByText(/SYN-HH-/)).toBeNull()
    expect(within(card).getByText('방문권고')).toBeInTheDocument()
    expect(within(card).getByText('보건소·의료 연계')).toBeInTheDocument()
    expect(within(card).getByText('행정복지센터 이관 권고')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(BANNED_GROUP_WORD)
  })

  it('separates phone and visit lanes without mixing (INV16)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    const phoneLane = await screen.findByLabelText('전화 레인 할당 제안')
    expect(within(phoneLane).getByText('김순○')).toBeInTheDocument()
    expect(phoneLane.querySelector('[data-case-id="SYN-HH-2812551000-0001"]')).not.toBeNull()
    expect(within(phoneLane).queryByText('박영○')).toBeNull()
    await user.click(screen.getByRole('tab', { name: /방문 \d/ }))
    const visitLane = await screen.findByLabelText('방문 레인 할당 제안')
    expect(within(visitLane).getByText('박영○')).toBeInTheDocument()
    expect(visitLane.querySelector('[data-case-id="SYN-HH-2812551000-0002"]')).not.toBeNull()
    expect(within(visitLane).queryByText('김순○')).toBeNull()
    expect(within(visitLane).getAllByText(/시간창 불일치/).length).toBeGreaterThan(0)
  })

  it('confirms assignments only through explicit actions (INV14)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    await screen.findByLabelText('전화 레인 할당 제안')
    expect(mocks.confirmAssignment).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '오늘 배치 일괄 확인' }))
    await waitFor(() => expect(mocks.confirmAssignment).toHaveBeenCalledWith({
      dongCode: '2812551000', referenceDate: '2026-08-12',
      confirmedBy: '동센터 담당자', caseIds: null,
    }))
    await user.click((await screen.findAllByRole('button', { name: '확인' }))[0])
    await waitFor(() => expect(mocks.confirmAssignment).toHaveBeenCalledWith({
      dongCode: '2812551000', referenceDate: '2026-08-12',
      confirmedBy: '동센터 담당자', caseIds: ['SYN-HH-2812551000-0001'],
    }))
  })

  it('acknowledges report cards with an explicit actor', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    const card = await screen.findByLabelText('SYN-HH-2812551000-0001 보고 카드')
    await user.click(within(card).getByRole('button', { name: '보고 확인' }))
    await waitFor(() => expect(mocks.acknowledgeReport).toHaveBeenCalledWith({
      caseId: 'SYN-HH-2812551000-0001', revision: 1, acknowledgedBy: '동센터 담당자',
    }))
  })

  it('reuses the manager visit-decision API for approval with worker and distance', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    const review = await screen.findByLabelText('방문 권고 대기 목록')
    await user.click(within(review).getByRole('button', { name: /SYN-HH-2812551000-0001/ }))
    await user.click(screen.getByRole('radio', { name: '방문 권고 승인' }))
    await user.type(screen.getByLabelText('결정 사유'), '합성 승인 사유')
    await user.click(screen.getByRole('button', { name: '방문 권고 승인 기록' }))
    await waitFor(() => expect(mocks.submitDecision).toHaveBeenCalledWith({
      caseId: 'SYN-HH-2812551000-0001', revision: 1, decision: 'approved',
      note: '합성 승인 사유', workerIds: ['SYN-W-2812551000-01'], distance: 2,
    }))
  })

  it('shows the transfer track wording only as guidance', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    const card = await screen.findByLabelText('SYN-HH-2812551000-0001 보고 카드')
    await user.click(within(card).getByRole('button', { name: '이관 안내' }))
    expect(within(card).getByText(/안부확인 트랙에서 사례관리·전문기관 트랙으로 전환/)).toBeInTheDocument()
  })
})
