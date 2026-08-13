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
  escalateCase: vi.fn(),
  loadCaseHistory: vi.fn(),
  loadCaseHistorySummary: vi.fn(),
  loadCenterCalendar: vi.fn(),
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
    escalateCase: mocks.escalateCase,
    loadCaseHistory: mocks.loadCaseHistory,
    loadCaseHistorySummary: mocks.loadCaseHistorySummary,
    loadCenterCalendar: mocks.loadCenterCalendar,
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
vi.mock('./MapView', () => ({ default: () => <div role="region" aria-label="우리 동 대상 위치 참고 지도" /> }))

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
  display_name: '김영자',
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
  report_lane: 'phone',
  escalation: null,
}

const managementEntry = {
  synthetic: true as const,
  status: 'active_contact_management' as const,
  intake_channel: 'family_request' as const,
  intake_recorded_date: '2026-07-21',
  ongoing_contact_permission: { status: 'recorded' as const, recorded_date: '2026-07-22', basis: 'synthetic_demo_scenario' as const },
  duplicate_service_check: {
    status: 'completed_no_overlapping_schedule' as const, checked_date: '2026-07-23',
    scope: 'regular_wellbeing_contact_or_home_visit' as const,
    interpretation: 'workflow_duplicate_check_not_welfare_eligibility' as const,
  },
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
      status: 'proposed', assignment_status: 'proposed', case_id: 'SYN-HH-2812551000-0001', display_name: '김영자',
      road_address: '인천광역시 제물포구 답동로 7-2',
      last_contact: { date: '2026-08-11', result_label: '연락 안 됨' }, lane: 'phone',
      dong_code: '2812551000', dong_name: '신포동', district: '제물포구',
      worker_id: 'SYN-W-2812551000-01', worker_display_name: '연결단원 001',
      급성도_등급: '방문권고', 급성도_점수: 62, grade_source: '세션 기록',
      급성도_기여내역: [{ 코드: '연속_미응답', 근거: '연속 미응답 2회', 가산점: 25 }],
      due_reasons: ['scheduled_contact'], earliest_due_date: '2026-08-12',
      selection_reason_labels: ['오늘 정기 연락'], management_entry: managementEntry,
      preferred_contact_method: 'phone', approved_visit: false,
      adjustment_flags: [], 제안_근거: ['담당 동 일치 (신포동)'],
    }],
    visit: [{
      status: 'proposed', assignment_status: 'proposed', case_id: 'SYN-HH-2812551000-0002', display_name: '이순자',
      road_address: '인천광역시 제물포구 답동로 9',
      last_contact: { date: '2026-08-10', result_label: '안부 확인 완료' }, lane: 'visit',
      dong_code: '2812551000', dong_name: '신포동', district: '제물포구',
      worker_id: 'SYN-W-2812551000-01', worker_display_name: '연결단원 001',
      급성도_등급: '방문권고', 급성도_점수: 62, grade_source: '데모 사전 기록',
      기록_출처: 'demo_precontact_record', 프로필_버전: 'demo-precontact-v1',
      급성도_기여내역: [{ 코드: '연속_미응답', 근거: '연속 미응답 2회', 가산점: 25 }],
      due_reasons: ['scheduled_contact'], earliest_due_date: '2026-08-12',
      selection_reason_labels: ['오늘 정기 연락'], management_entry: managementEntry,
      preferred_contact_method: 'visit', approved_visit: true,
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
  mocks.escalateCase.mockResolvedValue({ case_id: 'SYN-HH-2812551000-0002', escalation: { status: '신고됨', agency: '구 희망복지지원단', reported_by: '동센터 담당자', reported_at: '2026-08-12T09:00:00.000Z' } })
  mocks.submitDecision.mockResolvedValue(structuredClone(recommendation))
  mocks.loadData.mockResolvedValue({ dongs: { features: [] }, summary: {} })
  mocks.loadCaseHistory.mockResolvedValue({
    synthetic: true, displayMarker: '[합성]',
    case_id: 'SYN-HH-2812551000-0001', display_name: '김영자', trend_label: '악화',
    source_note: '과거 기록은 시연용 합성 기록이며 세션에서 제출한 기록이 맨 위에 병합됩니다.',
    entries: [
      { 일자: '2026-08-11', 결과_라벨: '연락 안 됨', 식사상태: '심각', 위생상태: '불량', 특이_징후_수: 2, 출처: '합성 과거 기록' },
      { 일자: '2026-08-04', 결과_라벨: '안부 확인 완료', 식사상태: '양호', 위생상태: '양호', 특이_징후_수: 0, 출처: '합성 과거 기록' },
    ],
  })
  mocks.loadCaseHistorySummary.mockResolvedValue({
    case_id: 'SYN-HH-2812551000-0001',
    summary_text: "최근 기록 2회 중 '연락 안 됨' 1회, 마지막 기록은 2026-08-11 '연락 안 됨'입니다. 기록상 식사 상태가 '양호'에서 '심각'(으)로 바뀌었습니다. 합성 시연 기록의 요약이며 개인 상태에 대한 판단이 아닙니다.",
    generator: 'deterministic_v1',
    label: '[AI 생성 · 기록 요약 · 개인 예측 아님]',
  })
  mocks.loadCenterCalendar.mockResolvedValue({
    synthetic: true, displayMarker: '[합성]', month: '2026-08',
    source_note: '과거 기록은 시연용 합성 기록이며 세션에서 제출한 기록이 반영됩니다.',
    days: [{
      일자: '2026-08-11', 기록_수: 2, 미응답_수: 1,
      사례: [
        { case_id: 'SYN-HH-2812551000-0001', display_name: '김영자', 결과_라벨: '연락 안 됨', 출처: '합성 과거 기록' },
        { case_id: 'SYN-HH-2812551000-0002', display_name: '이순자', 결과_라벨: '안부 확인 완료', 출처: '합성 과거 기록' },
      ],
    }],
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('CenterPage (동 행정복지센터)', () => {
  it('renders the center audience header, summary actions, and report card with grade vocabulary', async () => {
    arrange()
    render(<CenterPage />)
    expect(await screen.findByRole('heading', { name: /신포동 행정복지센터/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/SYN-HH-|\[합성\]/)
    const summary = screen.getByLabelText('오늘 처리 요약과 다음 행동')
    expect(within(summary).getByText('전화 확인 대기')).toBeInTheDocument()
    expect(within(summary).getByText('방문 확인 대기')).toBeInTheDocument()
    expect(within(summary).getByText('방문 승격 대기')).toBeInTheDocument()
    const card = await screen.findByLabelText('김영자 어르신 보고 카드')
    expect(within(card).getByText('인천광역시 제물포구 답동로 7-2')).toBeInTheDocument()
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
    expect(within(phoneLane).getByText('김영자 어르신')).toBeInTheDocument()
    expect(within(phoneLane).getByText(/인천광역시 제물포구 답동로 7-2/)).toBeInTheDocument()
    expect(within(phoneLane).getByText('마지막 연락')).toBeInTheDocument()
    expect(within(phoneLane).getByText('2026-08-11')).toBeInTheDocument()
    expect(within(phoneLane).getByText('연락 안 됨')).toBeInTheDocument()
    expect(within(phoneLane).getByText('오늘 정기 연락')).toBeInTheDocument()
    expect(within(phoneLane).getByText('연락 기한')).toBeInTheDocument()
    expect(within(phoneLane).getByText('2026-08-12')).toBeInTheDocument()
    expect(within(phoneLane).getByText('등록 근거')).toBeInTheDocument()
    expect(within(phoneLane).getByText('가족 신청')).toBeInTheDocument()
    expect(within(phoneLane).getByText('연락 동의 기록 · 기존 정기 안부확인 중복 없음')).toBeInTheDocument()
    expect(within(phoneLane).queryByText('이순자 어르신')).toBeNull()
    await user.click(screen.getByRole('tab', { name: /방문 \d/ }))
    const visitLane = await screen.findByLabelText('방문 레인 할당 제안')
    expect(within(visitLane).getByText('이순자 어르신')).toBeInTheDocument()
    expect(within(visitLane).getByText('급성도 62점 · 방문권고')).toBeInTheDocument()
    expect(within(visitLane).getByText('연속 미응답 2회 · +25점')).toBeInTheDocument()
    expect(within(visitLane).queryByText('김영자 어르신')).toBeNull()
    expect(within(visitLane).getAllByText(/시간창 불일치/).length).toBeGreaterThan(0)
  })

  it('confirms visits only through explicit actions while phone work is auto-assigned (INV14)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    const phoneLane = await screen.findByLabelText('전화 레인 할당 제안')
    expect(within(phoneLane).getByText(/자동 배정됨/)).toBeInTheDocument()
    expect(within(phoneLane).queryByRole('button', { name: '확인' })).toBeNull()
    expect(mocks.confirmAssignment).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: /방문 \d/ }))
    await user.click(screen.getByRole('button', { name: '오늘 방문 일괄 확인' }))
    await waitFor(() => expect(mocks.confirmAssignment).toHaveBeenCalledWith({
      dongCode: '2812551000', referenceDate: '2026-08-12',
      confirmedBy: '동센터 담당자', caseIds: ['SYN-HH-2812551000-0002'],
    }))
    await user.click((await screen.findAllByRole('button', { name: '확인' }))[0])
    await waitFor(() => expect(mocks.confirmAssignment).toHaveBeenCalledWith({
      dongCode: '2812551000', referenceDate: '2026-08-12',
      confirmedBy: '동센터 담당자', caseIds: ['SYN-HH-2812551000-0002'],
    }))
  })

  it('routes visit-lane reports to 방문 확인 with a 기관 연락 action', async () => {
    arrange()
    const user = userEvent.setup()
    const withVisitReport = structuredClone(inbox)
    withVisitReport.report_cards.push({
      ...structuredClone(reportCard),
      card_id: 'RPT-SYN-HH-2812551000-0002-r1',
      case_id: 'SYN-HH-2812551000-0002',
      display_name: '이순자',
      report_lane: 'visit',
      등급: '정상',
    })
    mocks.loadCenterInbox.mockResolvedValue(withVisitReport)
    render(<CenterPage />)
    const visitSection = (await screen.findByRole('heading', { name: '방문 확인' })).closest('section') as HTMLElement
    const visitCard = within(visitSection).getByLabelText('이순자 어르신 보고 카드')
    const phoneSection = screen.getByRole('heading', { name: '전화 확인' }).closest('section') as HTMLElement
    expect(within(phoneSection).getByLabelText('김영자 어르신 보고 카드')).toBeInTheDocument()
    expect(within(phoneSection).queryByLabelText('이순자 어르신 보고 카드')).toBeNull()
    await user.click(within(visitCard).getByRole('button', { name: '기관 연락' }))
    await waitFor(() => expect(mocks.escalateCase).toHaveBeenCalledWith({
      caseId: 'SYN-HH-2812551000-0002', reportedBy: '동센터 담당자',
    }))
  })

  it('escalates a visit case to the higher agency and shows the reported state', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    await screen.findByLabelText('전화 레인 할당 제안')
    await user.click(screen.getByRole('tab', { name: /방문 \d/ }))
    const escalated = structuredClone(inbox)
    escalated.assignment_proposal!.lanes.visit[0].escalation = {
      status: '신고됨', agency: '구 희망복지지원단', reported_by: '동센터 담당자', reported_at: '2026-08-12T09:00:00.000Z',
    }
    mocks.loadCenterInbox.mockResolvedValue(escalated)
    await user.click(screen.getByRole('button', { name: '신고' }))
    await waitFor(() => expect(mocks.escalateCase).toHaveBeenCalledWith({
      caseId: 'SYN-HH-2812551000-0002', reportedBy: '동센터 담당자',
    }))
    const visitLane = await screen.findByLabelText('방문 레인 할당 제안')
    expect(within(visitLane).getByText(/상급기관 신고됨 · 구 희망복지지원단/)).toBeInTheDocument()
    expect(within(visitLane).queryByRole('button', { name: '신고' })).toBeNull()
  })


  it('acknowledges report cards with an explicit actor', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    const card = await screen.findByLabelText('김영자 어르신 보고 카드')
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
    await user.click(within(review).getByRole('button', { name: /김영자 어르신/ }))
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
    const card = await screen.findByLabelText('김영자 어르신 보고 카드')
    await user.click(within(card).getByRole('button', { name: '이관 안내' }))
    expect(within(card).getByText(/안부확인 트랙에서 사례관리·전문기관 트랙으로 전환/)).toBeInTheDocument()
  })

  it('opens the case history accordion with an AI-labeled summary and lazy loading', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    const phoneLane = await screen.findByLabelText('전화 레인 할당 제안')
    expect(mocks.loadCaseHistory).not.toHaveBeenCalled()
    await user.click(within(phoneLane).getByText('지난 기록'))
    expect(await within(phoneLane).findByText('[AI 생성 · 기록 요약 · 개인 예측 아님]')).toBeInTheDocument()
    expect(within(phoneLane).getByText(/식사 상태가 '양호'에서 '심각'/)).toBeInTheDocument()
    const entries = within(phoneLane).getByLabelText('지난 기록 목록')
    expect(within(entries).getByText('2026-08-04')).toBeInTheDocument()
    expect(within(entries).getByText('식사 심각')).toBeInTheDocument()
    expect(within(entries).getAllByText('합성 과거 기록').length).toBeGreaterThan(0)
  })

  it('renders the month calendar and reveals a day of records on click', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CenterPage />)
    const calendar = await screen.findByLabelText('우리 동 기록 캘린더')
    expect(within(calendar).getByText(/2026년 8월/)).toBeInTheDocument()
    await user.click(await within(calendar).findByRole('button', { name: '2026-08-11 기록 2건' }))
    const dayList = await within(calendar).findByLabelText('2026-08-11 기록 목록')
    expect(within(dayList).getByText('김영자 어르신')).toBeInTheDocument()
    expect(within(dayList).getByText('이순자 어르신')).toBeInTheDocument()
  })
})
