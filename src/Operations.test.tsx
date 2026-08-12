import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanonicalObservations } from './contactOpsClient'

const empty = (): CanonicalObservations => ({
  관찰_6징후: { 우편물_고지서_적체: false, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
  식사상태: null,
  위생상태: null,
  공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null,
  관계망_유무: null,
  연락_빈도: null,
})

const mocks = vi.hoisted(() => ({
  loadTodayQueue: vi.fn(),
  loadCase: vi.fn(),
  loadRecommendations: vi.fn(),
  loadManagerBreadth: vi.fn(),
  loadOperationsMap: vi.fn(),
  loadStructuralContext: vi.fn(),
  submitContact: vi.fn(),
  submitDecision: vi.fn(),
  loadData: vi.fn(),
}))

vi.mock('./contactOpsClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./contactOpsClient')>()
  return {
    ...actual,
    loadTodayQueue: mocks.loadTodayQueue,
    loadCase: mocks.loadCase,
    loadRecommendations: mocks.loadRecommendations,
    loadManagerBreadth: mocks.loadManagerBreadth,
    loadOperationsMap: mocks.loadOperationsMap,
    submitContact: mocks.submitContact,
    submitDecision: mocks.submitDecision,
  }
})
vi.mock('./data', () => ({ loadData: mocks.loadData }))
vi.mock('./structuralContext', () => ({ loadStructuralContext: mocks.loadStructuralContext }))
vi.mock('./MapView', () => ({ default: ({ onSelectDong }: { onSelectDong: (dong: { geometry_zone_id: string }) => void }) => <><div role="region" aria-label="[합성] 연락업무 위치와 공개 동단위 맥락 지도" data-map-ready="true" /><button type="button" onClick={() => onSelectDong({ geometry_zone_id: 'zone:other' })}>지도 구역 선택</button></> }))

import { ManagerPage, SurveyorPage } from './Operations'

const detail = {
  synthetic: true as const,
  displayMarker: '[합성]' as const,
  revision: 3,
  household: {
    id: 'SYN-HH-2812551000-0001',
    synthetic: true as const,
    workflow: { visit_approval_status: 'recommended' as const },
    location: {
      latitude: 37.47,
      longitude: 126.62,
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
    급성도_점수: 55,
    취약도_점수: 25,
    점수_기여내역: [
      { 축: '급성도' as const, 근거: '연속 미응답 2회', 가산점: 25 },
      { 축: '취약도' as const, 근거: '관계망 관찰', 가산점: 25 },
    ],
  },
}

const queue = {
  synthetic: true as const,
  displayMarker: '[합성]' as const,
  items: [{ household_id: detail.household.id, revision: 3, preferred_contact_method: 'phone' as const, due_reasons: [], triage: detail.triage }],
}

afterEach(() => vi.clearAllMocks())

describe('P2 surveyor flow', () => {
  it('loads a worker-filtered synthetic queue and exposes separated axes and contributions', async () => {
    mocks.loadTodayQueue.mockResolvedValue(queue)
    mocks.loadCase.mockResolvedValue(detail)
    render(<SurveyorPage />)
    expect(await screen.findByRole('option', { name: /SYN-HH-2812551000-0001/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('방문 권고 · 담당자 승인 대기')).toBeInTheDocument()
    expect(screen.getByText('급성도 근거 보기')).toBeInTheDocument()
    expect(screen.getByText('취약도 근거 보기')).toBeInTheDocument()
    expect(mocks.loadTodayQueue).toHaveBeenCalledOnce()
  })

  it('uses the queue triage projection when the immutable case seed has no stored triage', async () => {
    mocks.loadTodayQueue.mockResolvedValue(queue)
    mocks.loadCase.mockResolvedValue({ ...detail, triage: null })
    render(<SurveyorPage />)
    expect(await screen.findByRole('option', { name: /SYN-HH-2812551000-0001/ })).toBeInTheDocument()
    expect(await screen.findByText('55')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('급성도 근거 보기')).toBeInTheDocument()
    expect(screen.getByText('취약도 근거 보기')).toBeInTheDocument()
  })

  it('submits all canonical observation fields and refreshes the reordered queue', async () => {
    const user = userEvent.setup()
    mocks.loadTodayQueue.mockResolvedValue(queue)
    mocks.loadCase.mockResolvedValue(detail)
    mocks.submitContact.mockResolvedValue({ ...detail, revision: 4 })
    render(<SurveyorPage />)
    expect(await screen.findByRole('group', { name: '통화 결과 입력' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('통화 결과'), '미응답')
    await user.click(screen.getByLabelText('우편물·고지서 적체'))
    await user.selectOptions(screen.getByLabelText('식사 상태'), '심각')
    await user.selectOptions(screen.getByLabelText('도움을 요청할 관계망'), '없음')
    await user.click(screen.getByRole('button', { name: '통화 결과 저장' }))
    await waitFor(() => expect(mocks.submitContact).toHaveBeenCalledWith(expect.objectContaining({
      resultLabel: '미응답',
      revision: 3,
      observations: expect.objectContaining({
        관찰_6징후: expect.objectContaining({ 우편물_고지서_적체: true }),
        식사상태: '심각',
        관계망_유무: '없음',
      }),
    })))
    await waitFor(() => expect(mocks.loadTodayQueue).toHaveBeenCalledTimes(2))
    expect(document.body.textContent).not.toContain(['no', 'answer'].join('_'))
  })

  it('shows a recovery action when the queue API fails', async () => {
    mocks.loadTodayQueue.mockRejectedValue(new Error('연결할 수 없습니다.'))
    render(<SurveyorPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('연결할 수 없습니다.')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('integrates the daily breadth summary and repeated-follow-up badges into the live queue', async () => {
    mocks.loadTodayQueue.mockResolvedValue(queue)
    mocks.loadCase.mockResolvedValue({
      ...detail,
      household: { ...detail.household, contact: { [['consecutive', 'no', 'answer', 'count'].join('_')]: 3 }, workflow: { ...detail.household.workflow, follow_up_status: 'overdue', transfer_status: 'recommended' } },
    })
    render(<SurveyorPage />)
    expect(await screen.findByText('오늘 연락업무 1건')).toBeInTheDocument()
    expect(await screen.findByText('연속 미응답 3회')).toBeInTheDocument()
    expect(screen.getByText('후속조치 기한 지남')).toBeInTheDocument()
    expect(screen.getByText('행정복지센터 이관 권고')).toBeInTheDocument()
  })
})

describe('P2 manager flow', () => {
  const breadth = {
    synthetic: true as const,
    displayMarker: '[합성]' as const,
    transfer_recommendations: [{ case_id: detail.household.id, status_label: '행정복지센터 이관 권고', acute: { score: 55 }, vulnerability: { score: 25 } }],
    grade_distribution: { scored_case_count: 13, not_yet_scored_case_count: 0, acute: { axis_label: '급성도', grades: { 정상: 1, 주시: 2, 방문권고: 3, '방문권고-우선': 7 } }, vulnerability: { axis_label: '취약도', score_bands: { '0_24': 2, '25_49': 4, '50_74': 5, '75_100': 2 } } },
    tuning_warning: { title: '합성 배점 튜닝 경고', current_mild_signal_count: 664, source_case_count: 5869, interpretation: '결정적 합성 시나리오의 배점 점검값이며 실제 개인 판정이 아닙니다.' },
    approved_visit_hint: { approved_visit_count: 13, label: '단순 근접 순서 · VRP 아님(차량 경로 최적화 미사용)', items: [{ case_id: detail.household.id, district: '제물포구', admin_dong: '신포동', assigned_worker_ids: ['SYN-W-2812551000-01'], approved_max_route_distance_km: 2 }] },
  }
  it('loads recommendation records and provides the existing map plus list alternative', async () => {
    mocks.loadRecommendations.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', items: [detail] })
    mocks.loadManagerBreadth.mockResolvedValue(breadth)
    mocks.loadData.mockResolvedValue({})
    render(<ManagerPage />)
    expect(await screen.findByText('담당자 승인 대기')).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: '방문 권고 목록' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '[합성] 연락업무 위치와 공개 동단위 맥락 지도' })).toBeInTheDocument()
    expect(screen.getByText(/키보드 접근 가능 목록/)).toBeInTheDocument()
  })

  it('shows the manager breadth API transfer queue, separated distributions, tuning warning, and 13 approved-visit hint', async () => {
    mocks.loadRecommendations.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', items: [detail] })
    mocks.loadManagerBreadth.mockResolvedValue(breadth)
    mocks.loadData.mockResolvedValue({})
    render(<ManagerPage />)
    expect(await screen.findByText('행정복지센터 이관 권고')).toBeInTheDocument()
    expect(screen.getByText('합성 배점 튜닝 경고')).toBeInTheDocument()
    expect(screen.getByText('664건')).toBeInTheDocument()
    expect(screen.getByText('승인된 방문 13건')).toBeInTheDocument()
    expect(screen.getByText('단순 근접 순서 · VRP 아님(차량 경로 최적화 미사용)')).toBeInTheDocument()
    expect(screen.getByText('급성도 분포')).toBeInTheDocument()
    expect(screen.getByText('취약도 분포')).toBeInTheDocument()
  })

  it('keeps the 156-zone public context separate from synthetic contact work and shows all four unvalidated indicators', async () => {
    mocks.loadRecommendations.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', items: [detail] })
    mocks.loadData.mockResolvedValue({})
    mocks.loadStructuralContext.mockResolvedValue({
      model_output_label: '[MODEL OUTPUT — UNVALIDATED]',
      score_range: { minimum: 0, maximum: 50 },
      zone_count: 156,
      zones: [{
        geometry_zone_id: detail.household.location.geometry_zone_id,
        score_0_50: 39.3,
        available_score_denominator: 50,
        completeness: { available_indicator_count: 4, total_indicator_count: 4, ratio: 1 },
        indicators: {
          older_population_share: { label_ko: '65세 이상 인구 비율', raw_value: 0.36, raw_numerator: 1795, raw_denominator: 4945, percentile_rank: 0.85, comparable_geography_count: 156, contribution: 10.6, maximum_contribution: 12.5, missing: false, reference_dates: { numerator: '2026-06-30', denominator: '2026-06-30' }, mixed_snapshot: false },
          one_person_household_share: { label_ko: '1인세대 비율', raw_value: 0.55, raw_numerator: 1565, raw_denominator: 2828, percentile_rank: 0.83, comparable_geography_count: 156, contribution: 10.4, maximum_contribution: 12.5, missing: false, reference_dates: { numerator: '2026-07-31', denominator: '2026-07-31' }, mixed_snapshot: false },
          residential_building_30_plus_share: { label_ko: '30년 이상 주거용 건축물대장 레코드 비율', raw_value: 0.95, raw_numerator: 40, raw_denominator: 42, percentile_rank: 0.92, comparable_geography_count: 153, contribution: 11.5, maximum_contribution: 12.5, missing: false, reference_dates: { numerator: '2026-08-05', denominator: '2026-08-05' }, mixed_snapshot: false },
          basic_livelihood_context_density: { label_ko: '65세 이상 인구 대비 생계급여 자격 65세 이상 건수 맥락 밀도', raw_value: 0.08, raw_numerator: 146, raw_denominator: 1795, percentile_rank: 0.54, comparable_geography_count: 154, contribution: 6.8, maximum_contribution: 12.5, missing: false, reference_dates: { numerator: '2024-12-31', denominator: '2026-06-30' }, mixed_snapshot: true },
        },
      }],
    })
    mocks.loadOperationsMap.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', geometry_zone_count: 156, current_admin_dong_count: 162, public_context_label: '[MODEL OUTPUT — UNVALIDATED]', zones: [] })
    render(<ManagerPage />)
    expect(await screen.findByText('[MODEL OUTPUT — UNVALIDATED]')).toBeInTheDocument()
    expect(screen.getByText('공개 인구 맥락')).toBeInTheDocument()
    expect(screen.getByText('[합성] 연락업무')).toBeInTheDocument()
    expect(screen.getByText('39.3 / 50')).toBeInTheDocument()
    expect(screen.getByText(/4\s*\/\s*4\s*\(100%\)/)).toBeInTheDocument()
    expect(screen.getByText('65세 이상 인구 비율')).toBeInTheDocument()
    expect(screen.getByText('1인세대 비율')).toBeInTheDocument()
    expect(screen.getByText('30년 이상 주거용 건축물대장 레코드 비율')).toBeInTheDocument()
    expect(screen.getByText('혼합 시점 참고값')).toBeInTheDocument()
    expect(screen.getByText('분자 2024-12-31 · 분모 2026-06-30 · 서로 다른 기준일의 참고 비율이며 동시점 비율이 아닙니다.')).toBeInTheDocument()
    expect(mocks.loadOperationsMap).toHaveBeenCalledOnce()
  })

  it('opens a separately selected operations zone contribution panel from the manager map', async () => {
    const user = userEvent.setup()
    mocks.loadRecommendations.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', items: [detail] })
    mocks.loadData.mockResolvedValue({})
    mocks.loadStructuralContext.mockResolvedValue({ model_output_label: '[MODEL OUTPUT — UNVALIDATED]', score_range: { minimum: 0, maximum: 50 }, zone_count: 156, zones: [] })
    mocks.loadOperationsMap.mockResolvedValue({
      synthetic: true, displayMarker: '[합성]', geometry_zone_count: 156, current_admin_dong_count: 162, public_context_label: '[MODEL OUTPUT — UNVALIDATED]',
      zones: [{ geometry_zone_id: 'zone:other', public_structural_context: {}, operations: {
        synthetic: true, displayMarker: '[합성]', aggregation: 'zone_max_priority_context', tie_rule: 'highest axis score then synthetic case ID ascending',
        acute_color_metric: 75, acute_max_case_id: 'SYN-HH-A', vulnerability_size_metric: 80, vulnerability_max_case_id: 'SYN-HH-B', scored_case_count: 2, unscored_case_count: 1,
        contribution_summaries: { acute: [{ code: '연속_미응답', total_points: 50, case_count: 2 }], vulnerability: [{ code: '관계망_없음', total_points: 80, case_count: 2 }] },
      } }],
    })
    render(<ManagerPage />)
    await screen.findByText('선택한 권고 검토')
    await user.click(screen.getByRole('button', { name: '[합성] 연락업무' }))
    await user.click(screen.getByRole('button', { name: '지도 구역 선택' }))
    expect(await screen.findByRole('heading', { name: '선택한 구역의 [합성] 연락업무' })).toBeInTheDocument()
    expect(screen.getByText('급성도 기여')).toBeInTheDocument()
    expect(screen.getByText('취약도 기여')).toBeInTheDocument()
    expect(screen.getByText(/SYN-HH-A/)).toBeInTheDocument()
    expect(screen.getByText(/채색은 구역 내 급성도 최댓값/)).toBeInTheDocument()
  })

  it('requires a decision and reason, and exposes distance only for approval', async () => {
    const user = userEvent.setup()
    mocks.loadRecommendations.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', items: [detail] })
    mocks.loadData.mockResolvedValue({})
    mocks.submitDecision.mockResolvedValue({ ...detail, revision: 4 })
    render(<ManagerPage />)
    await screen.findByText('선택한 권고 검토')
    expect(screen.queryByLabelText('승인된 방문 거리 제한 (km)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '방문 권고 승인 기록' })).toBeDisabled()
    await user.click(screen.getByLabelText('방문 권고 승인'))
    expect(screen.getByLabelText('승인된 방문 거리 제한 (km)')).toBeInTheDocument()
    await user.type(screen.getByLabelText('결정 사유'), '합성 데모 승인 사유')
    await user.click(screen.getByRole('button', { name: '방문 권고 승인 기록' }))
    await waitFor(() => expect(mocks.submitDecision).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'approved',
      note: '합성 데모 승인 사유',
      workerIds: ['SYN-W-2812551000-01'],
      distance: 2,
    })))
  })

  it('rejects without distance or worker constraints', async () => {
    const user = userEvent.setup()
    mocks.loadRecommendations.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', items: [detail] })
    mocks.loadData.mockResolvedValue({})
    mocks.submitDecision.mockResolvedValue({ ...detail, revision: 4 })
    render(<ManagerPage />)
    await screen.findByText('선택한 권고 검토')
    await user.click(screen.getByLabelText('방문 권고 반려'))
    await user.type(screen.getByLabelText('결정 사유'), '합성 데모 반려 사유')
    expect(screen.queryByLabelText('승인된 방문 거리 제한 (km)')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '방문 권고 반려 기록' }))
    await waitFor(() => expect(mocks.submitDecision).toHaveBeenCalledWith({
      caseId: detail.household.id,
      revision: 3,
      decision: 'rejected',
      note: '합성 데모 반려 사유',
    }))
  })

  it('keeps the success confirmation visible after an approved item leaves the queue', async () => {
    const user = userEvent.setup()
    mocks.loadRecommendations
      .mockResolvedValueOnce({ synthetic: true, displayMarker: '[합성]', items: [detail] })
      .mockResolvedValueOnce({ synthetic: true, displayMarker: '[합성]', items: [] })
    mocks.loadData.mockResolvedValue({})
    mocks.submitDecision.mockResolvedValue({ ...detail, revision: 4 })
    render(<ManagerPage />)
    await screen.findByText('선택한 권고 검토')
    await user.click(screen.getByLabelText('방문 권고 승인'))
    await user.type(screen.getByLabelText('결정 사유'), '합성 승인 후 확인 문구')
    await user.click(screen.getByRole('button', { name: '방문 권고 승인 기록' }))
    expect(await screen.findByText('담당자 승인을 기록했습니다.')).toBeInTheDocument()
    expect(screen.getByText('현재 검토할 방문 권고가 없습니다.')).toBeInTheDocument()
  })

  it('does not render an approval form when there is no recommended case', async () => {
    mocks.loadRecommendations.mockResolvedValue({ synthetic: true, displayMarker: '[합성]', items: [] })
    mocks.loadData.mockResolvedValue({})
    render(<ManagerPage />)
    expect(await screen.findByText('현재 검토할 방문 권고가 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '방문 권고 승인 기록' })).not.toBeInTheDocument()
  })
})
