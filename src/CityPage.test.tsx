import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DistrictAggregates, DistrictAiSummary } from './threeTierClient'

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  loadCityOperationsMap: vi.fn(),
  loadStructuralContext: vi.fn(),
  loadDistrictAggregates: vi.fn(),
  loadDistrictAiSummary: vi.fn(),
}))

vi.mock('./data', () => ({ loadData: mocks.loadData }))

vi.mock('./structuralContext', () => ({ loadStructuralContext: mocks.loadStructuralContext }))
vi.mock('./threeTierClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./threeTierClient')>()
  return {
    ...actual,
    loadCityOperationsMap: mocks.loadCityOperationsMap,
    loadDistrictAggregates: mocks.loadDistrictAggregates,
    loadDistrictAiSummary: mocks.loadDistrictAiSummary,
  }
})
vi.mock('./MapView', () => ({
  default: ({ onSelectDong }: { onSelectDong: (dong: { geometry_zone_id: string; current_district_name_20260701: string; current_admin_dong_names_20260701: string[] }) => void }) => (
    <button type="button" onClick={() => onSelectDong({
      geometry_zone_id: 'vworld_sgis_20250630:23010530',
      current_district_name_20260701: '제물포구',
      current_admin_dong_names_20260701: ['신포동'],
    })}>지도 동 선택</button>
  ),
}))

import { CityPage } from './CityPage'
import { BANNED_GROUP_WORD } from './threeTierTestFixtures'

const aggregates: DistrictAggregates = {
  synthetic: true,
  displayMarker: '[합성]',
  reference_date: '2026-08-12',
  case_detail_access: 'none_district_rollup_only',
  privacy_note: '시·구 화면은 동 단위 롤업까지만 제공하며 개별 케이스 정보는 포함하지 않습니다.',
  districts: [
    {
      synthetic_operations: true,
      district: '제물포구',
      case_detail_access: 'none_district_rollup_only',
      structure: {
        total_population: 10000, population_age_65_plus: 2000, elderly_share_pct: 20,
        total_households: 5000, one_person_households: 1500, one_person_household_share_pct: 30,
        one_person_households_age_65_plus: 648,
        mixed_snapshot_warning: '분자 2026-07-31 · 분모 2026-06-30 · 서로 다른 기준월의 참고 비율이며 동시점 비율이 아닙니다.',
        welfare_facility_count: 171,
        basic_livelihood: {
          recipient_count_living_age_65_plus: 100, population_age_65_plus_denominator: 2000,
          density_pct: 5, missing_zone_count: 0,
          mixed_snapshot_warning: '기초수급 분자 2024-12-31 · 인구 분모 2026-06-30 · 서로 다른 기준일의 참고 밀도이며 동시점 비율이 아닙니다.',
        },
        structural_context: {
          model_output_label: '[MODEL OUTPUT — UNVALIDATED]', zone_count: 1,
          mean_score_0_50: 20, max_score_0_50: 20,
          indicator_mean_contributions: { 고령비율: 5, '1인가구비율': 5, 노후주택: 5, 기초수급_밀도: 5 },
        },
      },
      operations: {
        synthetic: true, displayMarker: '[합성]', worker_count: 1, case_count: 3,
        due_count: 2, overdue_count: 0, pending_visit_approval_count: 1,
        approved_visit_count: 0, transfer_recommended_count: 0,
        per_worker: { due: 2, overdue: 0, pending_visit_approval: 1 },
      },
    },
    {
      synthetic_operations: true,
      district: '부평구',
      case_detail_access: 'none_district_rollup_only',
      structure: {
        total_population: 20000, population_age_65_plus: 3000, elderly_share_pct: 15,
        total_households: 8000, one_person_households: 2000, one_person_household_share_pct: 25,
        one_person_households_age_65_plus: 700,
        mixed_snapshot_warning: '분자 2026-07-31 · 분모 2026-06-30 · 서로 다른 기준월의 참고 비율이며 동시점 비율이 아닙니다.',
        welfare_facility_count: 390,
        basic_livelihood: {
          recipient_count_living_age_65_plus: 0, population_age_65_plus_denominator: 0,
          density_pct: null, missing_zone_count: 1,
          mixed_snapshot_warning: '기초수급 분자 2024-12-31 · 인구 분모 2026-06-30 · 서로 다른 기준일의 참고 밀도이며 동시점 비율이 아닙니다.',
        },
        structural_context: {
          model_output_label: '[MODEL OUTPUT — UNVALIDATED]', zone_count: 1,
          mean_score_0_50: 30, max_score_0_50: 30,
          indicator_mean_contributions: { 고령비율: 10, '1인가구비율': 10, 노후주택: 10, 기초수급_밀도: null },
        },
      },
      operations: {
        synthetic: true, displayMarker: '[합성]', worker_count: 1, case_count: 1,
        due_count: 1, overdue_count: 1, pending_visit_approval_count: 0,
        approved_visit_count: 1, transfer_recommended_count: 1,
        per_worker: { due: 1, overdue: 1, pending_visit_approval: 0 },
      },
    },
  ],
  staffing_review: {
    title: '증원 검토 후보',
    method_note: '구조 맥락(0~50 기여내역)과 운영 부하(연결단원당 건수)를 나란히 표기하며 합산하지 않습니다. 배치 최적화가 아닙니다.',
    composite_score: null,
    ordering: '운영 부하(연결단원당 due) 내림차순 표시 순서이며 별도의 구조 맥락 순위를 함께 제공',
    candidates: [
      { district: '제물포구', load_rank: 1, structure_rank: 2, per_worker_due: 2, per_worker_pending_visit_approval: 1, worker_count: 1, structural_mean_score_0_50: 20, structural_model_output_label: '[MODEL OUTPUT — UNVALIDATED]' },
      { district: '부평구', load_rank: 2, structure_rank: 1, per_worker_due: 1, per_worker_pending_visit_approval: 0, worker_count: 1, structural_mean_score_0_50: 30, structural_model_output_label: '[MODEL OUTPUT — UNVALIDATED]' },
    ],
  },
}

const summary: DistrictAiSummary = {
  synthetic: true,
  displayMarker: '[합성]',
  label: '[AI 생성 · 관측 집계 해석 · 개인 예측 아님]',
  generator: 'mock_deterministic',
  district: '제물포구',
  reference_date: '2026-08-12',
  input_metrics: { 구: '제물포구', 기준일: '2026-08-12', 노인인구_비율_퍼센트: '20' },
  summary_text: '제물포구는 기준일 2026-08-12 관측 집계에서 노인 인구 비율 20%로 나타납니다.',
  mixed_snapshot_warnings: ['분자 2026-07-31 · 분모 2026-06-30 · 서로 다른 기준월의 참고 비율이며 동시점 비율이 아닙니다.'],
}

// 서버의 city-operations-map은 케이스 ID를 제거해 주지만, 방어선 겹침을
// 위해 이 픽스처는 일부러 케이스 ID를 실어 렌더 계층도 검증한다(INV17).
const operationsMap = {
  synthetic: true, displayMarker: '[합성]',
  geometry_zone_count: 156, current_admin_dong_count: 162,
  public_context_label: '[MODEL OUTPUT — UNVALIDATED]',
  scenario_label: '[합성 시나리오]', scenario_reference_date: '2026-08-12',
  scenario_method: 'one_deterministic_example_per_current_admin_dong',
  zones: [{
    geometry_zone_id: 'vworld_sgis_20250630:23010530',
    public_structural_context: {
      model_output_label: '[MODEL OUTPUT — UNVALIDATED]', score_0_50: 20,
      available_score_denominator: 50, completeness: { ratio: 1 }, indicators: {},
    },
    operations: {
      synthetic: true, displayMarker: '[합성]', aggregation: 'zone_max_priority_context',
      tie_rule: 'highest axis score then synthetic case ID ascending',
      scenario_label: '[합성 시나리오]', scenario_reference_date: '2026-08-12',
      scenario_method: 'one_deterministic_example_per_current_admin_dong',
      acute_color_metric: 62, vulnerability_size_metric: 25,
      acute_max_case_id: 'SYN-HH-2812551000-0001',
      vulnerability_max_case_id: 'SYN-HH-2812551000-0001',
      acute_metric_source: 'session_recorded', vulnerability_metric_source: 'session_recorded',
      scored_case_count: 1, unscored_case_count: 2,
      session_scored_case_count: 1, scenario_scored_case_count: 0,
      contribution_summaries: { acute: [], vulnerability: [] },
    },
  }],
}

function arrange() {
  mocks.loadData.mockResolvedValue({ dongs: { features: [] }, summary: {} })
  mocks.loadCityOperationsMap.mockResolvedValue(structuredClone(operationsMap))
  mocks.loadStructuralContext.mockResolvedValue({ zones: [{ geometry_zone_id: 'vworld_sgis_20250630:23010530', score_0_50: 20 }] })
  mocks.loadDistrictAggregates.mockResolvedValue(structuredClone(aggregates))
  mocks.loadDistrictAiSummary.mockResolvedValue(structuredClone(summary))
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('CityPage (시·구 /city)', () => {
  it('renders district briefing with structure and load side by side, never case IDs (INV17)', async () => {
    arrange()
    render(<CityPage />)
    expect(await screen.findByRole('heading', { name: /시·구 배치 브리핑/ })).toBeInTheDocument()
    await screen.findByLabelText('제물포구 구 단위 브리핑')
    expect(screen.getByLabelText('구조 맥락')).toBeInTheDocument()
    expect(screen.getByLabelText('운영 부하')).toBeInTheDocument()
    expect(document.documentElement.outerHTML).not.toMatch(/SYN-HH-/)
    expect(document.documentElement.outerHTML).not.toContain(BANNED_GROUP_WORD)
  })

  it('keeps the dong rollup case-free even after selecting a zone with a max-case ID (INV17)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CityPage />)
    await screen.findByLabelText('제물포구 구 단위 브리핑')
    await user.click(screen.getByRole('button', { name: '지도 동 선택' }))
    const rollup = await screen.findByLabelText('선택한 동 단위 롤업')
    expect(within(rollup).getByText(/급성도 최대\(구역\)/)).toBeInTheDocument()
    expect(within(rollup).getByText(/세션 기록 1건/)).toBeInTheDocument()
    expect(within(rollup).getByText(/동 단위 집계까지만 표시/)).toBeInTheDocument()
    expect(document.documentElement.outerHTML).not.toMatch(/SYN-HH-/)
  })

  it('serves the district AI summary with the required label and injected metrics (INV19)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<CityPage />)
    await screen.findByLabelText('제물포구 구 단위 브리핑')
    await user.click(screen.getByRole('button', { name: '구 단위 요약 읽기' }))
    await waitFor(() => expect(mocks.loadDistrictAiSummary).toHaveBeenCalledWith('제물포구'))
    const card = await screen.findByLabelText('제물포구 AI 요약')
    expect(within(card).getByText('[AI 생성 · 관측 집계 해석 · 개인 예측 아님]')).toBeInTheDocument()
    expect(within(card).getByText(/노인 인구 비율 20%로 나타납니다/)).toBeInTheDocument()
    await user.click(within(card).getByText('요약에 주입된 집계 수치 보기'))
    expect(within(card).getByText(/노인인구 비율 퍼센트: 20/)).toBeInTheDocument()
    expect(within(card).getByText(/서로 다른 기준월의 참고 비율/)).toBeInTheDocument()
  })

  it('renders the staffing review as side-by-side non-summed ranks (증원 검토)', async () => {
    arrange()
    render(<CityPage />)
    await screen.findByLabelText('제물포구 구 단위 브리핑')
    const table = screen.getByRole('table')
    expect(screen.getAllByText(/합산하지 않습니다/).length).toBeGreaterThan(0)
    expect(screen.getByText(/배치 최적화가 아닙니다/)).toBeInTheDocument()
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toContain('부하 순위')
    expect(headers).toContain('구조 순위')
    expect(headers.join(' ')).not.toMatch(/종합|합산/)
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('제물포구')).toBeInTheDocument()
    expect(within(rows[1]).getByText('부평구')).toBeInTheDocument()
  })
})
