import { useEffect, useMemo, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import { loadData } from './data'
import MapView from './MapView'
import type { DataBundle, DongProperties, MetricKey } from './types'
import { ManagerPage, SurveyorPage, ZoneOperationsPanel } from './Operations'
import { loadStructuralContext } from './structuralContext'
import type { StructuralContext } from './structuralContext'
import { loadOperationsMap } from './contactOpsClient'
import type { OperationsMap } from './contactOpsClient'

const METRICS: Array<{ key: MetricKey; short: string; description: string }> = [
  {
    key: 'age_65_plus_one_person_share_of_age_65_plus_population',
    short: '고령 1인세대 비율',
    description: '65세 이상 인구 중 혼자 사는 세대의 비율',
  },
  {
    key: 'one_person_households_age_65_plus',
    short: '고령 1인세대 수',
    description: '주민등록 기준 65세 이상 1인세대 수',
  },
  {
    key: 'housing_age_30_plus_share_valid_pct',
    short: '노후 건축물 비율',
    description: '사용승인 30년 이상 건축물대장 비율',
  },
]

const FACILITY_GROUPS = ['전체', '노인복지', '장애인복지', '지역복지', '정신건강복지', '가족·여성복지']

export default function App() {
  if (window.location.pathname === '/ops/surveyor') return <SurveyorPage />
  if (window.location.pathname === '/ops/manager') return <ManagerPage />
  return <PublicMapApp />
}

function PublicMapApp() {
  const [data, setData] = useState<DataBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState<MetricKey>('age_65_plus_one_person_share_of_age_65_plus_population')
  const [showFacilities, setShowFacilities] = useState(true)
  const [showBubbles, setShowBubbles] = useState(true)
  const [facilityCategory, setFacilityCategory] = useState('전체')
  const [selectedDong, setSelectedDong] = useState<DongProperties | null>(null)
  const [search, setSearch] = useState('')
  const [mobilePanel, setMobilePanel] = useState(false)
  const [mapMode, setMapMode] = useState<'public' | 'operations'>('public')
  const [structuralContext, setStructuralContext] = useState<StructuralContext | null>(null)
  const [operationsMap, setOperationsMap] = useState<OperationsMap | null>(null)
  const [selectedOperationsZoneId, setSelectedOperationsZoneId] = useState<string | null>(null)

  useEffect(() => {
    loadData().then(setData).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.')
    })
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([loadStructuralContext(), loadOperationsMap()]).then(([context, operations]) => {
      if (!active) return
      setStructuralContext(context)
      setOperationsMap(operations)
    }).catch(() => {
      // The public map stays usable when the optional overlays are unavailable.
    })
    return () => { active = false }
  }, [])

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

  if (error) {
    return (
      <main className="state-screen">
        <h1>지도를 열지 못했습니다</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>다시 시도</button>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="state-screen">
        <span className="state-spinner" aria-hidden="true" />
        <h1>지도를 불러오는 중입니다</h1>
        <p>인천 156개 구역의 공개 통계를 준비하고 있습니다.</p>
      </main>
    )
  }

  const selectSearchResult = (dong: DongProperties) => {
    setSelectedDong(dong)
    setSelectedOperationsZoneId(dong.geometry_zone_id)
    setSearch('')
    setMobilePanel(true)
  }

  const searchField = (
    <div className="search">
      <Search size={16} aria-hidden="true" />
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="구·동 이름 검색"
        aria-label="구 또는 동 검색"
      />
      {search && <button aria-label="검색어 지우기" onClick={() => setSearch('')}><X size={15} /></button>}
      {searchResults.length > 0 && (
        <div className="search-results">
          {searchResults.map((dong) => (
            <button key={dong.geometry_zone_id} onClick={() => selectSearchResult(dong)}>
              <MapPin size={14} aria-hidden="true" />
              <span>
                <strong>{dong.current_admin_dong_names_20260701.join(' · ')}</strong>
                <small>{dong.current_district_name_20260701}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="map-app">
      <MapView
        data={data}
        metric={metric}
        showFacilities={showFacilities}
        showTransit={false}
        showBubbles={showBubbles}
        facilityCategory={facilityCategory}
        selectedZoneId={selectedDong?.geometry_zone_id ?? null}
        mapMode={mapMode}
        structuralScores={structuralContext ? Object.fromEntries(structuralContext.zones.map((zone) => [zone.geometry_zone_id, zone.score_0_50])) : undefined}
        operationsByZone={operationsMap ? Object.fromEntries(operationsMap.zones.map((zone) => [zone.geometry_zone_id, zone.operations])) : undefined}
        onSelectDong={(dong) => { setSelectedDong(dong); setSelectedOperationsZoneId(dong.geometry_zone_id); setMobilePanel(true) }}
      />

      <aside className="panel">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>돌봄나침반</strong>
          <em>인천</em>
        </div>

        {searchField}

        <section className="panel-section">
          <h3>지표</h3>
          <div className="metric-list" role="radiogroup" aria-label="채색 지표">
            {METRICS.map((item) => (
              <button
                key={item.key}
                role="radio"
                aria-checked={metric === item.key}
                className={metric === item.key ? 'metric-item active' : 'metric-item'}
                onClick={() => setMetric(item.key)}
              >
                <strong>{item.short}</strong>
                <small>{item.description}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <h3>겹쳐 보기</h3>
          <label className="layer-item">
            <span>복지시설<small>{data.summary.counts.facilityPoints.toLocaleString()}곳</small></span>
            <input type="checkbox" checked={showFacilities} onChange={(event) => setShowFacilities(event.target.checked)} />
          </label>
          {showFacilities && (
            <select className="select" value={facilityCategory} onChange={(event) => setFacilityCategory(event.target.value)} aria-label="복지시설 유형">
              {FACILITY_GROUPS.map((category) => <option key={category}>{category}</option>)}
            </select>
          )}
          <label className="layer-item">
            <span>세대 규모 원<small>1인세대 수 비례</small></span>
            <input type="checkbox" checked={showBubbles} onChange={(event) => setShowBubbles(event.target.checked)} />
          </label>
        </section>

        <section className="panel-section">
          <h3>보기 모드</h3>
          <div className="seg" role="group" aria-label="지도 표시 모드">
            <button type="button" aria-pressed={mapMode === 'public'} onClick={() => setMapMode('public')}>인구 맥락</button>
            <button type="button" aria-pressed={mapMode === 'operations'} onClick={() => setMapMode('operations')}>업무 현황<i className="demo-tag">데모</i></button>
          </div>
        </section>

        <Legend metric={metric} mapMode={mapMode} showFacilities={showFacilities} showBubbles={showBubbles} />

        <p className="panel-foot">
          공개 통계 기반 참고 지도이며 개인·가구를 판정하지 않습니다.
          {' '}
          <a href="/data/manifest.json" target="_blank" rel="noreferrer">데이터 출처</a>
        </p>
      </aside>

      <div className="m-top">
        {searchField}
        <div className="m-chips" role="toolbar" aria-label="지도 지표와 레이어">
          {METRICS.map((item) => (
            <button key={item.key} className={metric === item.key ? 'active' : ''} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.short}</button>
          ))}
          <button className={showFacilities ? 'active' : ''} aria-pressed={showFacilities} onClick={() => setShowFacilities((value) => !value)}>시설</button>
          <button className={showBubbles ? 'active' : ''} aria-pressed={showBubbles} onClick={() => setShowBubbles((value) => !value)}>규모 원</button>
          <button className={mapMode === 'operations' ? 'active' : ''} aria-pressed={mapMode === 'operations'} onClick={() => setMapMode((mode) => mode === 'operations' ? 'public' : 'operations')}>업무 현황</button>
        </div>
      </div>

      {selectedDong && (
        <DetailPanel dong={selectedDong} openMobile={mobilePanel} onClose={() => { setSelectedDong(null); setMobilePanel(false) }} />
      )}

      {mapMode === 'operations' && selectedOperationsZoneId && (
        <div className="public-zone-operations" tabIndex={0} role="region" aria-label="선택한 구역의 업무 요약">
          <ZoneOperationsPanel zone={operationsMap?.zones.find((zone) => zone.geometry_zone_id === selectedOperationsZoneId) ?? null} />
        </div>
      )}
    </div>
  )
}

function DetailPanel({ dong, onClose, openMobile }: { dong: DongProperties; onClose: () => void; openMobile: boolean }) {
  const statusLabel = dong.map_unit_status === 'exact' ? '단일 경계' : dong.map_unit_status === 'aggregated_split' ? '분할 동 합산' : '본소·출장소 합산'
  return (
    <article className={`detail-panel ${openMobile ? 'mobile-open' : ''}`}>
      <button className="panel-close" onClick={onClose} aria-label="상세 닫기"><X size={16} /></button>
      <header className="detail-head">
        <span>{dong.current_district_name_20260701}</span>
        <h2>{dong.current_admin_dong_names_20260701.join(' · ')}</h2>
        <small>{statusLabel}</small>
      </header>
      <div className="detail-hero">
        <span>65세 이상 1인세대</span>
        <strong>{dong.one_person_households_age_65_plus.toLocaleString()}<i>세대</i></strong>
        <em>65세 이상 인구의 {(dong.age_65_plus_one_person_share_of_age_65_plus_population * 100).toFixed(1)}%</em>
      </div>
      <dl className="detail-grid">
        <div><dt>총인구</dt><dd>{dong.total_population.toLocaleString()}명</dd></div>
        <div><dt>65세 이상</dt><dd>{dong.population_age_65_plus.toLocaleString()}명</dd></div>
        <div><dt>전체 1인세대</dt><dd>{dong.one_person_households.toLocaleString()}세대</dd></div>
        <div><dt>30년+ 건축물</dt><dd>{dong.housing_age_30_plus_share_valid_pct == null ? '자료 없음' : `${dong.housing_age_30_plus_share_valid_pct.toFixed(1)}%`}</dd></div>
      </dl>
      <p className="detail-foot">세대 2026.7 · 인구 2026.6 기준 참고 지표입니다. 개인·가구를 판정하지 않습니다.</p>
    </article>
  )
}

function Legend({ metric, mapMode, showFacilities, showBubbles }: { metric: MetricKey; mapMode: 'public' | 'operations'; showFacilities: boolean; showBubbles: boolean }) {
  if (mapMode === 'operations') {
    return (
      <div className="legend">
        <span>업무 현황 표시</span>
        <p className="legend-note">색은 급성도, 원 크기는 취약도 기준입니다.</p>
      </div>
    )
  }
  const labels = metric === 'one_person_households_age_65_plus'
    ? ['적음', '600', '1,000', '1,500', '많음']
    : metric === 'housing_age_30_plus_share_valid_pct'
      ? ['낮음', '35%', '55%', '75%', '높음']
      : ['낮음', '24%', '30%', '36%', '높음']
  return (
    <div className={`legend ${metric === 'housing_age_30_plus_share_valid_pct' ? 'housing-scale' : ''}`}>
      <span>인천 내 상대 비교</span>
      <div className="legend-gradient" />
      <div className="legend-labels">{labels.map((label) => <small key={label}>{label}</small>)}</div>
      {metric === 'housing_age_30_plus_share_valid_pct' && <p className="legend-note"><i className="no-data-swatch" />회색은 자료 없음</p>}
      {(showFacilities || showBubbles) && (
        <div className="point-legend">
          {showFacilities && <span><i className="facility-point-symbol" />시설</span>}
          {showBubbles && <span><i className="demand-bubble-symbol" />세대 규모</span>}
        </div>
      )}
    </div>
  )
}
