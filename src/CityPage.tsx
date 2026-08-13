import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, RefreshCw, Sparkles, UsersRound } from 'lucide-react'
import MapView from './MapView'
import { loadData } from './data'
import type { DataBundle, DongProperties } from './types'
import { loadCityOperationsMap } from './threeTierClient'
import type { CityOperationsMap, CityOperationsMapZone } from './threeTierClient'
import { loadStructuralContext } from './structuralContext'
import type { StructuralContext } from './structuralContext'
import { loadDistrictAggregates, loadDistrictAiSummary } from './threeTierClient'
import type { DistrictAggregate, DistrictAggregates, DistrictAiSummary } from './threeTierClient'

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
      <p className="city-privacy-note">동 단위 집계까지만 표시합니다. 개별 케이스 정보는 동 행정복지센터 화면에서만 다룹니다.</p>
      <dl className="city-zone-metrics">
        <div><dt>급성도 최대(구역)</dt><dd>{operations.acute_color_metric ?? '점수 없음'}</dd></div>
        <div><dt>취약도 최대(구역)</dt><dd>{operations.vulnerability_size_metric ?? '점수 없음'}</dd></div>
        <div><dt>점수 출처</dt><dd>세션 기록 {operations.session_scored_case_count}건 · 고정 예시 {operations.scenario_scored_case_count}건 · 미기록 {operations.unscored_case_count}건</dd></div>
      </dl>
      <p className="zone-scenario-note"><strong>고정 운영 예시</strong> 기준일 {operations.scenario_reference_date} · 실제 주민 상태가 아닙니다.</p>
      <div className="city-zone-structure">
        <span className="structural-model-label">{zone.public_structural_context.model_output_label}</span>
        <p>공개 구조 맥락 {zone.public_structural_context.score_0_50.toFixed(1)} / 50</p>
      </div>
    </section>
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
      <div className="city-brief-grid">
        <article aria-label="구조 맥락">
          <h4><UsersRound aria-hidden="true" size={17} /> 구조 맥락 (공개 집계)</h4>
          <ul>
            <li>노인 인구 비율 <strong>{formatPct(structure.elderly_share_pct)}</strong></li>
            <li>일인가구 비율 <strong>{formatPct(structure.one_person_household_share_pct)}</strong></li>
            <li>65세 이상 일인세대 <strong>{structure.one_person_households_age_65_plus.toLocaleString()}세대</strong></li>
            <li>기초수급 밀도(참고) <strong>{formatPct(structure.basic_livelihood.density_pct)}</strong></li>
            <li>복지시설 <strong>{structure.welfare_facility_count.toLocaleString()}곳</strong></li>
          </ul>
          <p className="mixed-snapshot-note">{structure.mixed_snapshot_warning}</p>
          <p className="mixed-snapshot-note">{structure.basic_livelihood.mixed_snapshot_warning}</p>
        </article>
        <article aria-label="운영 부하">
          <h4><Building2 aria-hidden="true" size={17} /> 운영 부하</h4>
          <ul>
            <li>연결단원 <strong>{operations.worker_count}명</strong></li>
            <li>오늘 예정 <strong>{operations.due_count}건</strong> · 연결단원당 {operations.per_worker.due ?? '자료 없음'}건</li>
            <li>기한 경과 <strong>{operations.overdue_count}건</strong></li>
            <li>방문승인 대기 <strong>{operations.pending_visit_approval_count}건</strong></li>
            <li>이관 권고 <strong>{operations.transfer_recommended_count}건</strong></li>
          </ul>
          <p className="city-privacy-note">케이스 단위 정보 없이 구·동 집계만 사용합니다.</p>
        </article>
      </div>
      <div className="city-ai-summary">
        <button disabled={summaryBusy} onClick={onRequestSummary}>
          <Sparkles aria-hidden="true" size={17} /> {summaryBusy ? '요약 생성 중' : '구 단위 요약 읽기'}
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
            {summary.mixed_snapshot_warnings.map((warning) => (
              <p key={warning} className="mixed-snapshot-note">{warning}</p>
            ))}
          </article>
        )}
      </div>
    </section>
  )
}

export function CityPage() {
  const [mapData, setMapData] = useState<DataBundle | null>(null)
  const [operationsMap, setOperationsMap] = useState<CityOperationsMap | null>(null)
  const [structuralContext, setStructuralContext] = useState<StructuralContext | null>(null)
  const [aggregates, setAggregates] = useState<DistrictAggregates | null>(null)
  const [selectedDong, setSelectedDong] = useState<DongProperties | null>(null)
  const [selectedDistrict, setSelectedDistrict] = useState<string>('')
  const [summary, setSummary] = useState<DistrictAiSummary | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([loadData(), loadCityOperationsMap(), loadStructuralContext(), loadDistrictAggregates()])
      .then(([bundle, operations, structural, districtAggregates]) => {
        if (!active) return
        setMapData(bundle)
        setOperationsMap(operations)
        setStructuralContext(structural)
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
          <p className="tier-audience">시·구 담당자용 · 동 단위 롤업까지만 표시(개인정보 최소수집·목적제한)</p>
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
            <h2 id="city-district-heading">구 단위 분석 확인</h2>
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
                <p className="center-section-note">{aggregates.staffing_review.method_note}</p>
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
                          <td>{candidate.structural_mean_score_0_50 ?? '자료 없음'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="city-privacy-note">구조 맥락 평균은 {aggregates.districts[0]?.structure.structural_context.model_output_label ?? '[MODEL OUTPUT — UNVALIDATED]'} 라벨의 공개 집계 참고값입니다. 두 축은 합산하지 않습니다.</p>
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
              showBubbles={false}
              facilityCategory="전체"
              selectedZoneId={selectedDong?.geometry_zone_id ?? null}
              mapMode="operations"
              structuralScores={structuralContext ? Object.fromEntries(structuralContext.zones.map((zone) => [zone.geometry_zone_id, zone.score_0_50])) : undefined}
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
