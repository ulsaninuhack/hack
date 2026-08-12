import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  Home,
  Info,
  Layers3,
  MapPinned,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { loadData } from './data'
import MapView from './MapView'
import type { DataBundle, DongProperties, MetricKey } from './types'

const METRICS: Array<{ key: MetricKey; short: string; label: string; description: string }> = [
  {
    key: 'age_65_plus_one_person_share_of_age_65_plus_population',
    short: '고령 1인세대 비율',
    label: '65세 이상 인구 대비 65세 이상 1인세대 비율',
    description: '인천 내 상대적인 관측 비율을 색으로 비교합니다.',
  },
  {
    key: 'one_person_households_age_65_plus',
    short: '고령 1인세대 규모',
    label: '65세 이상 1인세대 관측 규모',
    description: '주민등록상 65세 이상 1인세대 수를 색으로 비교합니다.',
  },
  {
    key: 'housing_age_30_plus_share_valid_pct',
    short: '30년+ 건축물',
    label: '연령 유효 건축물대장 중 30년 이상 레코드 비율',
    description: '건물·호수·가구 수가 아닌 대장 레코드 기반 참고 지표입니다.',
  },
]

const FACILITY_GROUPS = ['전체', '노인복지', '장애인복지', '아동·돌봄', '지역복지', '정신건강복지', '가족·여성복지']

export default function App() {
  const [data, setData] = useState<DataBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState<MetricKey>('age_65_plus_one_person_share_of_age_65_plus_population')
  const [showFacilities, setShowFacilities] = useState(true)
  const [showTransit, setShowTransit] = useState(false)
  const [showBubbles, setShowBubbles] = useState(true)
  const [facilityCategory, setFacilityCategory] = useState('전체')
  const [selectedDong, setSelectedDong] = useState<DongProperties | null>(null)
  const [search, setSearch] = useState('')
  const [mobilePanel, setMobilePanel] = useState(false)
  const [showMethodology, setShowMethodology] = useState(false)
  const methodologyButtonRef = useRef<HTMLButtonElement>(null)
  const methodologyCloseRef = useRef<HTMLButtonElement>(null)
  const methodologyDialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    loadData().then(setData).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.')
    })
  }, [])

  useEffect(() => {
    if (!showMethodology) return
    methodologyCloseRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMethodology(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      methodologyButtonRef.current?.focus()
    }
  }, [showMethodology])

  const dongRows = useMemo(() => {
    if (!data) return []
    return data.dongs.features.map((feature) => feature.properties)
  }, [data])

  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    if (!query) return []
    return dongRows.filter((dong) => {
      const label = `${dong.current_district_name_20260701} ${dong.current_admin_dong_names_20260701.join(' ')}`
      return label.toLocaleLowerCase('ko-KR').includes(query)
    }).slice(0, 7)
  }, [dongRows, search])

  const activeMetric = METRICS.find((item) => item.key === metric)!

  const trapMethodologyFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = methodologyDialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (error) {
    return <main className="fatal-state"><Database /><h1>데이터를 열지 못했습니다</h1><p>{error}</p><button onClick={() => location.reload()}>다시 시도</button></main>
  }

  if (!data) {
    return <main className="loading-state"><div className="loading-mark"><MapPinned /></div><strong>인천 지도와 공개 데이터를 준비하고 있습니다</strong><span>156개 지도 구역을 불러오는 중</span></main>
  }

  const selectSearchResult = (dong: DongProperties) => {
    setSelectedDong(dong)
    setSearch('')
    setMobilePanel(true)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Home size={19} /></span>
          <div><strong>돌봄나침반</strong><span>INCHEON CARE CONTEXT MAP</span></div>
        </div>
        <div className="topbar-title">
          <span className="eyebrow">I5 · 도시 돌봄</span>
          <h1>인천 돌봄 수요 맥락 지도</h1>
        </div>
        <div className="header-actions">
          <button ref={methodologyButtonRef} className="method-button" onClick={() => setShowMethodology(true)}><Info size={15} /> 방법론</button>
          <a className="data-link" href="/data/manifest.json" target="_blank" rel="noreferrer"><Database size={15} /> 데이터 명세</a>
        </div>
      </header>

      <section className="guardrail" role="note">
        <ShieldCheck size={17} />
        <p><strong>지역 검토를 돕는 공개 집계 지도입니다.</strong> 개인·가구의 위험이나 복지 미수혜를 판정하지 않습니다.</p>
        <span>비율은 1인세대 2026.07.31 분자 + 인구 2026.06.30 분모의 혼합 스냅샷 · 동시점 비율 아님</span>
      </section>

      <main className="workspace">
        <aside className="sidebar">
          <section className="sidebar-section intro-copy">
            <span className="section-kicker">WHERE TO LOOK FIRST</span>
            <h2>동네의 돌봄 맥락을<br />한 화면에서 봅니다</h2>
            <p>관측 수요, 복지시설, 교통과 노후주택을 겹쳐 지자체의 추가 검토 지점을 좁힙니다.</p>
          </section>

          <section className="kpi-grid" aria-label="인천 주요 지표">
            <Kpi icon={<UsersRound />} value={formatCompact(data.summary.cityTotals.one_person_households_age_65_plus)} label="65세+ 1인세대" meta="주민등록 관측" />
            <Kpi icon={<MapPinned />} value={`${data.summary.counts.adminGeometryZones}`} label="지도 구역" meta="현행 162개 동 반영" />
            <Kpi icon={<Building2 />} value={formatCompact(data.summary.counts.facilityPoints)} label="시설 좌표" meta={`${data.summary.coverage.facilityCoordinateCoveragePct.toFixed(1)}% 확보`} />
          </section>

          <section className="sidebar-section">
            <div className="section-heading"><div><span>STEP 1</span><h3>비교할 지표</h3></div><ChevronDown size={16} /></div>
            <div className="metric-options">
              {METRICS.map((item) => (
                <button key={item.key} className={metric === item.key ? 'metric-option active' : 'metric-option'} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>
                  <span className="radio-dot" />
                  <span><strong>{item.short}</strong><small>{item.description}</small></span>
                </button>
              ))}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-heading"><div><span>STEP 2</span><h3>겹쳐 볼 레이어</h3></div><Layers3 size={16} /></div>
            <label className="layer-row"><span><i className="legend-dot facility" />복지시설 <small>{data.summary.counts.facilityPoints.toLocaleString()}곳</small></span><input type="checkbox" checked={showFacilities} onChange={(event) => setShowFacilities(event.target.checked)} /></label>
            {showFacilities && (
              <select className="category-select" value={facilityCategory} onChange={(event) => setFacilityCategory(event.target.value)} aria-label="복지시설 유형">
                {FACILITY_GROUPS.map((category) => <option key={category}>{category}</option>)}
              </select>
            )}
            <label className="layer-row"><span><i className="legend-dot bubble" />65세+ 1인세대 규모</span><input type="checkbox" checked={showBubbles} onChange={(event) => setShowBubbles(event.target.checked)} /></label>
            <label className="layer-row"><span><i className="legend-dot transit" />버스 승하차 <small>참고</small></span><input type="checkbox" checked={showTransit} onChange={(event) => setShowTransit(event.target.checked)} /></label>
          </section>

          <div className="sidebar-footer"><Info size={14} /><span>지도 경계는 2025.06 기준 156개 구역이며, 2026.07 현행 162개 동 통계를 합산 정합했습니다.</span></div>
        </aside>

        <section className="map-stage">
          <div className="search-box">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="구·동 이름으로 찾기" aria-label="구 또는 동 검색" />
            {search && <button aria-label="검색어 지우기" onClick={() => setSearch('')}><X size={16} /></button>}
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((dong) => <button key={dong.geometry_zone_id} onClick={() => selectSearchResult(dong)}><MapPinned size={14} /><span><strong>{dong.current_admin_dong_names_20260701.join(' · ')}</strong><small>{dong.current_district_name_20260701}</small></span></button>)}
              </div>
            )}
          </div>

          <div className="mobile-controls-shell">
            <div className="mobile-controls" role="toolbar" aria-label="지도 지표와 레이어">
              {METRICS.map((item) => <button key={item.key} className={metric === item.key ? 'active' : ''} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.short}</button>)}
              <button className={showFacilities ? 'active layer-chip' : 'layer-chip'} aria-pressed={showFacilities} onClick={() => setShowFacilities((value) => !value)}>시설</button>
              <button className={showBubbles ? 'active layer-chip' : 'layer-chip'} aria-pressed={showBubbles} onClick={() => setShowBubbles((value) => !value)}>규모 원</button>
              <button className={showTransit ? 'active layer-chip' : 'layer-chip'} aria-pressed={showTransit} onClick={() => setShowTransit((value) => !value)}>교통</button>
            </div>
            <span className="mobile-scroll-cue" aria-hidden="true"><ChevronRight size={17} /></span>
          </div>

          <div className="map-title-card">
            <span>현재 채색 기준</span>
            <strong>{activeMetric.label}</strong>
            <p>{activeMetric.description}</p>
            {metric === 'age_65_plus_one_person_share_of_age_65_plus_population' && <em>2026.07.31 분자 + 2026.06.30 분모 · 동시점 비율 아님</em>}
          </div>

          <MapView
            data={data}
            metric={metric}
            showFacilities={showFacilities}
            showTransit={showTransit}
            showBubbles={showBubbles}
            facilityCategory={facilityCategory}
            selectedZoneId={selectedDong?.geometry_zone_id ?? null}
            onSelectDong={(dong) => { setSelectedDong(dong); setMobilePanel(true) }}
          />

          <Legend metric={metric} showFacilities={showFacilities} showBubbles={showBubbles} showTransit={showTransit} />

          {selectedDong && (
            <DetailPanel dong={selectedDong} openMobile={mobilePanel} onClose={() => { setSelectedDong(null); setMobilePanel(false) }} />
          )}
        </section>
      </main>
      {showMethodology && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowMethodology(false)}>
          <section ref={methodologyDialogRef} className="method-dialog" role="dialog" aria-modal="true" aria-labelledby="method-title" onKeyDown={trapMethodologyFocus} onMouseDown={(event) => event.stopPropagation()}>
            <button ref={methodologyCloseRef} className="panel-close" onClick={() => setShowMethodology(false)} aria-label="방법론 닫기"><X size={18} /></button>
            <span className="section-kicker">HOW TO READ</span>
            <h2 id="method-title">이 지도는 ‘판정’이 아니라<br />추가 검토의 출발점입니다</h2>
            <ol>
              <li><strong>채색</strong><span>65세 이상 인구 대비 주민등록상 65세 이상 1인세대의 관측 비율을 구역끼리 비교합니다.</span></li>
              <li><strong>노란 원</strong><span>65세 이상 1인세대 수를 면적 비례로 보여 줍니다. 대표점이며 실제 가구 위치가 아닙니다.</span></li>
              <li><strong>참고 레이어</strong><span>공식 시설, 버스 승하차 이벤트, 건축물대장 연령을 별도로 겹쳐 봅니다. 합산 점수는 만들지 않습니다.</span></li>
            </ol>
            <div className="method-warning"><ShieldCheck size={16} /><p>비율은 2026.07.31 세대 분자와 2026.06.30 인구 분모를 결합한 혼합 스냅샷으로, 동시점 비율이 아닙니다. 개인·가구의 위험이나 복지 미수혜를 판정하지 않습니다.</p></div>
            <a href="/data/manifest.json" target="_blank" rel="noreferrer">전체 데이터 명세 열기</a>
          </section>
        </div>
      )}
    </div>
  )
}

function Kpi({ icon, value, label, meta }: { icon: React.ReactNode; value: string; label: string; meta: string }) {
  return <article className="kpi-card"><span className="kpi-icon">{icon}</span><strong>{value}</strong><p>{label}</p><small>{meta}</small></article>
}

function DetailPanel({ dong, onClose, openMobile }: { dong: DongProperties; onClose: () => void; openMobile: boolean }) {
  const statusLabel = dong.map_unit_status === 'exact' ? '단일 경계' : dong.map_unit_status === 'aggregated_split' ? '분할 동 합산' : '본소·출장소 합산'
  return (
    <article className={`detail-panel ${openMobile ? 'mobile-open' : ''}`}>
      <button className="panel-close" onClick={onClose} aria-label="상세 닫기"><X size={18} /></button>
      <div className="detail-location"><span>{dong.current_district_name_20260701}</span><h2>{dong.current_admin_dong_names_20260701.join(' · ')}</h2><small>{statusLabel}</small></div>
      <div className="detail-hero"><span>65세 이상 1인세대</span><strong>{dong.one_person_households_age_65_plus.toLocaleString()}<small>세대</small></strong><p>65세 이상 인구 대비 {(dong.age_65_plus_one_person_share_of_age_65_plus_population * 100).toFixed(1)}%</p></div>
      <p className="mixed-snapshot-note">비율은 2026.07.31 세대 분자와 2026.06.30 인구 분모를 결합한 참고값이며 동시점 비율이 아닙니다.</p>
      <div className="detail-stats">
        <div><span>총인구</span><strong>{dong.total_population.toLocaleString()}명</strong></div>
        <div><span>65세 이상 인구</span><strong>{dong.population_age_65_plus.toLocaleString()}명</strong></div>
        <div><span>전체 1인세대</span><strong>{dong.one_person_households.toLocaleString()}세대</strong></div>
        <div><span>30년+ 대장 비율</span><strong>{dong.housing_age_30_plus_share_valid_pct == null ? '자료 없음' : `${dong.housing_age_30_plus_share_valid_pct.toFixed(1)}%`}</strong></div>
      </div>
      <div className="detail-note"><Info size={15} /><p>이 수치는 연락·방문 대상자나 복지 미수혜자 수가 아닙니다. 현장 자료와 함께 추가 검토해야 합니다.</p></div>
      <footer><span>인구 {dong.population_reference_date}</span><span>세대 {dong.household_reference_date}</span><span>주택 유효연령 커버리지 {dong.housing_age_coverage_pct?.toFixed(1) ?? '–'}%</span></footer>
    </article>
  )
}

function Legend({ metric, showFacilities, showBubbles, showTransit }: { metric: MetricKey; showFacilities: boolean; showBubbles: boolean; showTransit: boolean }) {
  const labels = metric === 'one_person_households_age_65_plus'
    ? ['적은 편', '600', '1,000', '1,500', '많은 편']
    : metric === 'housing_age_30_plus_share_valid_pct'
      ? ['낮은 편', '35%', '55%', '75%', '높은 편']
      : ['낮은 편', '24%', '30%', '36%', '높은 편']
  return (
    <div className={`legend ${metric === 'housing_age_30_plus_share_valid_pct' ? 'housing-scale' : ''}`}>
      <span>인천 내 상대 비교</span>
      <div className="legend-gradient" />
      <div className="legend-labels">{labels.map((label) => <small key={label}>{label}</small>)}</div>
      {metric === 'housing_age_30_plus_share_valid_pct' && <p className="no-data-key"><i />회색 구역은 주택 연령 자료 없음</p>}
      {metric === 'age_65_plus_one_person_share_of_age_65_plus_population' && <p className="snapshot-key">혼합 스냅샷 · 동시점 비율 아님</p>}
      {(showFacilities || showBubbles || showTransit) && (
        <div className="point-legend" aria-label="활성 점 레이어 기호">
          {showFacilities && <><span><i className="facility-point-symbol" />시설</span><span><i className="facility-cluster-symbol">12</i>시설 묶음</span></>}
          {showBubbles && <span><i className="demand-bubble-symbol" />규모 원</span>}
          {showTransit && <span><i className="transit-point-symbol" />승하차</span>}
        </div>
      )}
    </div>
  )
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
