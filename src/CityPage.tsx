import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, RefreshCw, Sparkles, UsersRound } from 'lucide-react'
import MapView from './MapView'
import { loadData } from './data'
import type { DataBundle, DongProperties } from './types'
import { loadCityOperationsMap } from './threeTierClient'
import type { CityOperationsMap, CityOperationsMapZone } from './threeTierClient'
import { loadDistrictAggregates, loadDistrictAiSummary } from './threeTierClient'
import type { DistrictAggregate, DistrictAggregates, DistrictAiSummary } from './threeTierClient'
import { formatScore } from './scoreFormat'

function formatPct(value: number | null) {
  return value === null ? '자료 없음' : `${value}%`
}

// INV17: 시·구 화면은 동 단위 롤업까지만 보여준다. 케이스 ID·개별 상세는
// 이 컴포넌트에 절대 렌더하지 않는다(케이스 ID 필드는 의도적으로 미사용).
function CityZoneRollup({ zone, dong }: { zone: CityOperationsMapZone | null; dong: DongProperties | null }) {
  if (!zone || !dong) {
    return <p className="ops-empty">지도에서 동을 선택하면 동 단위 롤업이 나옵니다.</p>
  }
  const operations = zone.operations
  return (
    <section className="city-zone-rollup" aria-label="선택한 동 단위 롤업">
      <h3>{dong.current_district_name_20260701} {dong.current_admin_dong_names_20260701.join(' · ')}</h3>
      <dl className="city-zone-metrics">
        <div><dt>급성도 최대(구역)</dt><dd>{formatScore(operations.acute_color_metric, '점수 없음')}</dd></div>
        <div><dt>취약도 최대(구역)</dt><dd>{formatScore(operations.vulnerability_size_metric, '점수 없음')}</dd></div>
        <div><dt>점수 출처</dt><dd>세션 기록 {operations.session_scored_case_count}건 · 고정 예시 {operations.scenario_scored_case_count}건 · 미기록 {operations.unscored_case_count}건</dd></div>
      </dl>
      <div className="city-zone-structure">
        <span className="structural-model-label">{zone.public_structural_context.model_output_label}</span>
        <p>공개 구조 맥락 {zone.public_structural_context.score_0_50.toFixed(1)} / 50</p>
      </div>
    </section>
  )
}

function StatBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="city-stat-bar">
      <div className="city-stat-bar-head"><span>{label}</span><strong>{formatPct(value)}</strong></div>
      <div className="city-stat-bar-track"><div className="city-stat-bar-fill" style={{ width: `${value === null ? 0 : Math.min(value, 100)}%` }} /></div>
    </div>
  )
}

function PriorityActions({ operations }: { operations: DistrictAggregate['operations'] }) {
  const items = [
    { label: '기한 경과 확인', detail: `${operations.overdue_count}건` },
    { label: '방문승인 대기 검토', detail: `${operations.pending_visit_approval_count}건` },
    { label: '이관 권고 검토', detail: `${operations.transfer_recommended_count}건` },
  ]
  return (
    <div className="city-priority-actions" aria-label="우선 조치 권고">
      <h4>우선 조치 권고</h4>
      <ol>
        {items.map((item, index) => (
          <li key={item.label}>
            <span className="city-priority-index">{index + 1}</span>
            <span className="city-priority-body"><strong>{item.label}</strong><small>{item.detail}</small></span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function DistrictBrief({
  aggregate,
  summary,
  summaryBusy,
  onRequestSummary,
}: {
  aggregate: DistrictAggregate
  summary: DistrictAiSummary | null
  summaryBusy: boolean
  onRequestSummary: () => void
}) {
  const structure = aggregate.structure
  const operations = aggregate.operations
  return (
    <section className="city-district-brief" aria-label={`${aggregate.district} 구 단위 브리핑`}>
      <h3>{aggregate.district} 구 단위 브리핑</h3>

      <div className="city-stat-bars" aria-label="구조 맥락 비율 지표">
        <StatBar label="노인 인구 비율" value={structure.elderly_share_pct} />
        <StatBar label="일인가구 비율" value={structure.one_person_household_share_pct} />
        <StatBar label="기초수급 밀도(참고)" value={structure.basic_livelihood.density_pct} />
      </div>

      <div className="city-fact-chips" aria-label="구 단위 관측 수치">
        <span><UsersRound aria-hidden="true" size={15} /> 65세 이상 일인세대 <strong>{structure.one_person_households_age_65_plus.toLocaleString()}</strong>세대</span>
        <span><Building2 aria-hidden="true" size={15} /> 복지시설 <strong>{structure.welfare_facility_count.toLocaleString()}</strong>곳</span>
        <span>연결단원 <strong>{operations.worker_count}</strong>명</span>
        <span>오늘 예정 <strong>{operations.due_count}</strong>건 · 인당 {operations.per_worker.due ?? '자료 없음'}건</span>
      </div>

      <div className="city-ai-summary">
        <h4><Sparkles aria-hidden="true" size={16} /> AI 인사이트</h4>
        <button disabled={summaryBusy} onClick={onRequestSummary}>
          {summaryBusy ? '요약 생성 중' : '구 단위 요약 읽기'}
        </button>
        {summary && summary.district === aggregate.district && (
          <article className="city-ai-summary-card" aria-label={`${aggregate.district} AI 요약`}>
            <p className="city-ai-label">{summary.label}</p>
            <p className="city-ai-text">{summary.summary_text}</p>
            <details>
              <summary>요약에 주입된 집계 수치 보기</summary>
              <ul>
                {Object.entries(summary.input_metrics).map(([key, value]) => (
                  <li key={key}>{key.replaceAll('_', ' ')}: {value}</li>
                ))}
              </ul>
            </details>
          </article>
        )}
      </div>

      <PriorityActions operations={operations} />
    </section>
  )
}

export function CityPage() {
  const [mapData, setMapData] = useState<DataBundle | null>(null)
  const [operationsMap, setOperationsMap] = useState<CityOperationsMap | null>(null)
  const [aggregates, setAggregates] = useState<DistrictAggregates | null>(null)
  const [selectedDong, setSelectedDong] = useState<DongProperties | null>(null)
  const [selectedDistrict, setSelectedDistrict] = useState<string>('')
  const [summary, setSummary] = useState<DistrictAiSummary | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([loadData(), loadCityOperationsMap(), loadDistrictAggregates()])
      .then(([bundle, operations, districtAggregates]) => {
        if (!active) return
        setMapData(bundle)
        setOperationsMap(operations)
        setAggregates(districtAggregates)
        setSelectedDistrict((current) => current || districtAggregates.districts[0]?.district || '')
      })
      .catch(() => {
        if (active) setError('시·구 브리핑 데이터를 불러오지 못했습니다.')
      })
    return () => { active = false }
  }, [])

  const selectedZone = useMemo(() => operationsMap?.zones.find(
    (zone) => zone.geometry_zone_id === selectedDong?.geometry_zone_id,
  ) ?? null, [operationsMap, selectedDong])
  const selectedAggregate = aggregates?.districts.find((item) => item.district === selectedDistrict) ?? null

  const requestSummary = async () => {
    if (!selectedDistrict) return
    try {
      setSummaryBusy(true)
      setError(null)
      setSummary(await loadDistrictAiSummary(selectedDistrict))
    } catch {
      setError('구 단위 요약을 불러오지 못했습니다.')
    } finally {
      setSummaryBusy(false)
    }
  }

  return (
    <main className="tier-page city-page">
      <header className="tier-header">
        <div>
          <h1>시·구 배치 브리핑 · 인천</h1>
        </div>
        <nav aria-label="3계층 화면 이동">
          <a href="/center">동 센터</a>
          <a href="/m">조사원 모바일</a>
          <a href="/">공개 지도</a>
        </nav>
      </header>

      {error && (
        <div className="ops-state" role="alert">
          <AlertTriangle aria-hidden="true" />
          <p>{error}</p>
          <button onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" /> 다시 시도</button>
        </div>
      )}

      <div className="city-columns">
        <aside className="city-panel">
          <section className="city-section" aria-labelledby="city-district-heading">
            <h2 id="city-district-heading">구 단위 AI 브리핑</h2>
            <label className="city-district-select">브리핑할 구 선택
              <select value={selectedDistrict} onChange={(event) => { setSelectedDistrict(event.target.value); setSummary(null) }}>
                {aggregates?.districts.map((item) => <option key={item.district}>{item.district}</option>)}
              </select>
            </label>
            {selectedAggregate
              ? <DistrictBrief aggregate={selectedAggregate} summary={summary} summaryBusy={summaryBusy} onRequestSummary={() => void requestSummary()} />
              : <p className="ops-state" role="status">구 단위 집계를 불러오는 중입니다.</p>}
          </section>

          <section className="city-section" aria-labelledby="city-staffing-heading">
            <h2 id="city-staffing-heading">증원 검토</h2>
            {aggregates ? (
              <>
                <div className="city-table-scroll">
                  <table className="city-staffing-table">
                    <caption>증원 검토 후보 · 운영 부하 순 정렬(구조 맥락 순위는 별도 열)</caption>
                    <thead>
                      <tr>
                        <th scope="col">구</th>
                        <th scope="col">부하 순위</th>
                        <th scope="col">연결단원당 오늘 예정</th>
                        <th scope="col">연결단원</th>
                        <th scope="col">구조 순위</th>
                        <th scope="col">구조 맥락 평균(0~50)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregates.staffing_review.candidates.map((candidate) => (
                        <tr key={candidate.district} data-selected={candidate.district === selectedDistrict}>
                          <th scope="row">{candidate.district}</th>
                          <td>{candidate.load_rank}</td>
                          <td>{candidate.per_worker_due ?? '자료 없음'}</td>
                          <td>{candidate.worker_count}명</td>
                          <td>{candidate.structure_rank}</td>
                          <td>{formatScore(candidate.structural_mean_score_0_50, '자료 없음')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <p className="ops-state" role="status">증원 검토 집계를 불러오는 중입니다.</p>}
          </section>

          <CityZoneRollup zone={selectedZone} dong={selectedDong} />
        </aside>

        <section className="city-map" aria-label="인천 전체 지도">
          {mapData ? (
            <MapView
              data={mapData}
              metric="age_65_plus_one_person_share_of_age_65_plus_population"
              showFacilities={false}
              showTransit={false}
              facilityCategory="전체"
              selectedZoneId={selectedDong?.geometry_zone_id ?? null}
              mapMode="operations"
              operationsByZone={operationsMap ? Object.fromEntries(operationsMap.zones.map((zone) => [zone.geometry_zone_id, zone.operations])) : undefined}
              ariaLabel="인천 전체 운영 오버레이 지도 · 동 단위 롤업 전용"
              onSelectDong={(dong) => {
                setSelectedDong(dong)
                setSelectedDistrict(dong.current_district_name_20260701)
                setSummary(null)
              }}
            />
          ) : <p className="ops-state" role="status">인천 전체 지도를 불러오는 중입니다.</p>}
        </section>
      </div>
    </main>
  )
}
