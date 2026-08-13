import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, RefreshCw, Sparkles, UsersRound, X } from 'lucide-react'
import MapView from './MapView'
import { loadData } from './data'
import type { DataBundle, DongProperties } from './types'
import { loadCityOperationsMap } from './threeTierClient'
import type { CityOperationsMap } from './threeTierClient'
import { loadDistrictAggregates, loadDistrictAiSummary } from './threeTierClient'
import type { DistrictAggregate, DistrictAggregates, DistrictAiSummary } from './threeTierClient'

function formatPct(value: number | null) {
  return value === null ? '자료 없음' : `${value}%`
}

function splitSummarySentences(text: string) {
  return text
    .split(/(?<=[가-힣]\.)(?:\s+)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function buildDistrictReviewMessages(aggregates: DistrictAggregates | null, district: string) {
  if (!aggregates || !district) return []
  const messages: string[] = []
  const staffing = aggregates.staffing_review.candidates.find((candidate) => candidate.district === district)
  if (staffing?.per_worker_due !== null && staffing?.per_worker_due !== undefined) {
    if (staffing.load_rank === 1) {
      messages.push(`${district}는 연결단원 1명당 오늘 예정 연락업무가 ${staffing.per_worker_due}건으로 인천에서 가장 많아 증원 검토가 필요합니다.`)
    } else if (staffing.load_rank <= Math.max(2, Math.ceil(aggregates.staffing_review.candidates.length * 0.4))) {
      messages.push(`${district}는 연결단원 1명당 오늘 예정 연락업무가 ${staffing.per_worker_due}건으로 운영 부하 상위 ${staffing.load_rank}위입니다. 가용 인력이 있다면 증원을 검토할 수 있습니다.`)
    } else {
      messages.push(`${district}는 연결단원 1명당 오늘 예정 연락업무가 ${staffing.per_worker_due}건으로 운영 부하 ${staffing.load_rank}위이며, 현재 연결단원이 적절하게 배치되어 있습니다.`)
    }
  }

  const highestPendingVisit = [...aggregates.districts].sort(
    (left, right) => right.operations.pending_visit_approval_count - left.operations.pending_visit_approval_count,
  )[0]
  if (highestPendingVisit?.district === district && highestPendingVisit.operations.pending_visit_approval_count > 0) {
    messages.push(`${district}는 방문 권고 ${highestPendingVisit.operations.pending_visit_approval_count}건이 인천에서 가장 많이 담당자 승인 대기 중이어서 우선 검토가 필요합니다.`)
  }
  return messages
}

type CityDongRollup = NonNullable<CityOperationsMap['dong_rollups']>[number]

function CityDongOverlay({
  rollups,
  selectedCode,
  onSelectCode,
  onClose,
}: {
  rollups: CityDongRollup[]
  selectedCode: string
  onSelectCode: (code: string) => void
  onClose: () => void
}) {
  const rollup = rollups.find((item) => item.dong_code === selectedCode) ?? rollups[0]
  if (!rollup) return null
  return (
    <aside className="city-dong-overlay" aria-label={`${rollup.dong_name} 운영 현황`}>
      <div className="city-dong-overlay-head">
        <div><small>{rollup.district}</small><h2>{rollup.dong_name}</h2></div>
        <button type="button" aria-label="동 운영 현황 닫기" onClick={onClose}><X aria-hidden="true" size={18} /></button>
      </div>
      {rollups.length > 1 && (
        <label className="city-dong-picker">같은 지도 구역의 동
          <select value={rollup.dong_code} onChange={(event) => onSelectCode(event.target.value)}>
            {rollups.map((item) => <option key={item.dong_code} value={item.dong_code}>{item.dong_name}</option>)}
          </select>
        </label>
      )}
      <dl className="city-dong-overlay-metrics">
        <div><dt>연결단원</dt><dd>{rollup.worker_count.toLocaleString()}명</dd></div>
        <div><dt>연락 대상</dt><dd>{rollup.contact_target_count.toLocaleString()}명</dd></div>
        <div><dt>방문 대상</dt><dd>{rollup.approved_visit_target_count.toLocaleString()}명</dd></div>
        <div className="city-dong-load"><dt>연결단원 1명당 담당 대상</dt><dd>{rollup.contact_targets_per_worker?.toLocaleString() ?? '자료 없음'}명</dd></div>
      </dl>
      <p className="city-dong-overlay-note">방문 대상은 담당자 승인이 완료된 방문 업무만 집계합니다.</p>
    </aside>
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
  cityReviewMessages,
  onRequestSummary,
}: {
  aggregate: DistrictAggregate
  summary: DistrictAiSummary | null
  summaryBusy: boolean
  cityReviewMessages: string[]
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
            <details className="city-ai-toggle" open>
              <summary>핵심 요약</summary>
              <ul className="city-ai-points" aria-label="핵심 요약 문장">
                {splitSummarySentences(summary.summary_text).map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
                {cityReviewMessages.map((message) => (
                  <li className="city-ai-review-point" key={message}>{message}</li>
                ))}
              </ul>
            </details>
            <details className="city-ai-metrics">
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
  const [selectedDongCode, setSelectedDongCode] = useState('')
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

  const selectedDongRollups = useMemo(() => operationsMap?.dong_rollups?.filter(
    (rollup) => rollup.geometry_zone_id === selectedDong?.geometry_zone_id,
  ) ?? [], [operationsMap, selectedDong])

  useEffect(() => {
    if (selectedDongRollups.length === 0) return
    setSelectedDongCode((current) => (
      selectedDongRollups.some((rollup) => rollup.dong_code === current)
        ? current : selectedDongRollups[0].dong_code
    ))
  }, [selectedDongRollups])
  const selectedAggregate = aggregates?.districts.find((item) => item.district === selectedDistrict) ?? null
  const cityReviewMessages = useMemo(
    () => buildDistrictReviewMessages(aggregates, selectedDistrict),
    [aggregates, selectedDistrict],
  )

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
              ? <DistrictBrief aggregate={selectedAggregate} summary={summary} summaryBusy={summaryBusy} cityReviewMessages={cityReviewMessages} onRequestSummary={() => void requestSummary()} />
              : <p className="ops-state" role="status">구 단위 집계를 불러오는 중입니다.</p>}
          </section>
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
              mapMode="public"
              ariaLabel="인천 전체 지도 · 관측 65세 이상 1인가구 비율 채색 · 동 단위 롤업 전용"
              onSelectDong={(dong) => {
                setSelectedDong(dong)
                setSelectedDongCode('')
                setSelectedDistrict(dong.current_district_name_20260701)
                setSummary(null)
              }}
            />
          ) : <p className="ops-state" role="status">인천 전체 지도를 불러오는 중입니다.</p>}
          {selectedDong && selectedDongRollups.length > 0 && (
            <CityDongOverlay
              rollups={selectedDongRollups}
              selectedCode={selectedDongCode}
              onSelectCode={setSelectedDongCode}
              onClose={() => { setSelectedDong(null); setSelectedDongCode('') }}
            />
          )}
        </section>
      </div>
    </main>
  )
}
