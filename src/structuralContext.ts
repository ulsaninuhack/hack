export interface StructuralIndicator {
  label_ko: string
  raw_value: number | null
  raw_numerator: number | null
  raw_denominator: number | null
  percentile_rank: number | null
  comparable_geography_count: number
  contribution: number
  maximum_contribution: number
  missing: boolean
  missing_reason?: string | null
  reference_dates: { numerator: string | null; denominator: string | null }
  mixed_snapshot: boolean
}

export interface StructuralZone {
  geometry_zone_id: string
  geometry_base_date?: string
  current_admin_reference_date?: string
  score_0_50: number
  available_score_denominator: number
  completeness: { available_indicator_count: number; total_indicator_count: number; ratio: number }
  indicators: Record<string, StructuralIndicator>
}

export interface StructuralContext {
  model_output_label: '[MODEL OUTPUT — UNVALIDATED]'
  score_range: { minimum: 0; maximum: 50 }
  zone_count: number
  zones: StructuralZone[]
}

let cached: Promise<StructuralContext> | null = null

export function loadStructuralContext(): Promise<StructuralContext> {
  cached ??= fetch('/data/structural-context.json').then(async (response) => {
    if (!response.ok) throw new Error('공개 인구 맥락 데이터를 불러오지 못했습니다.')
    return response.json() as Promise<StructuralContext>
  })
  return cached
}
