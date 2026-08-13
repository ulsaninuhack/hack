import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Send } from 'lucide-react'
import MapView from './MapView'
import {
  ContactOpsClientError,
  emptyObservations,
  loadCase,
  loadManagerBreadth,
  loadOperationsMap,
  loadRecommendations,
  loadTodayQueue,
  submitContact,
  submitDecision,
} from './contactOpsClient'
import type {
  CanonicalObservations,
  CaseDetail,
  ContactResultLabel,
  QueueItem,
  ManagerBreadth,
  OperationsMap,
  OperationsMapZone,
} from './contactOpsClient'
import { SurveyorBreadth } from './SurveyorBreadth'
import { demoWorkerIdForDong } from './threeTierClient'
import { AiObservationPanel } from './AiObservationPanel'
import { loadData } from './data'
import type { DataBundle } from './types'
import { loadStructuralContext } from './structuralContext'
import type { StructuralContext, StructuralIndicator, StructuralZone } from './structuralContext'
import { caseDisplayName } from './caseDisplayName'
import { formatScore } from './scoreFormat'

const CONTACT_LABELS: ContactResultLabel[] = [
  '안부 확인 완료',
  '우려 사항 있음',
  '미응답',
  '연락(또는 방문) 거부',
  '연락처 확인 필요',
]

const SIGN_FIELDS: Array<{
  key: keyof CanonicalObservations['관찰_6징후']
  label: string
}> = [
  { key: '우편물_고지서_적체', label: '우편물·고지서 적체' },
  { key: '악취_벌레', label: '악취·벌레' },
  { key: '쓰레기_술병', label: '쓰레기·술병' },
  { key: '인기척_없이_TV_불', label: '인기척 없이 TV·불 켜짐' },
  { key: '외출_없음', label: '최근 외출 없음' },
  { key: '연락_두절', label: '주변에서 확인한 연락 두절' },
]

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof ContactOpsClientError) {
    if (cause.code === 'STATE_CONFLICT') {
      return '다른 화면에서 먼저 변경했습니다. 최신 내용을 다시 불러온 뒤 입력해 주세요.'
    }
    if (cause.code === 'CONTACT_OPS_UNAVAILABLE') {
      return '연락업무 서비스를 잠시 사용할 수 없습니다.'
    }
  }
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function AxisCards({ detail }: { detail: CaseDetail | null }) {
  const contributions = detail?.triage?.점수_기여내역 ?? []
  return (
    <section className="ops-axis-grid" aria-label="분리된 점수 축">
      <article className="ops-axis ops-axis-primary">
        <span>급성도</span>
        <strong>{formatScore(detail?.triage?.급성도_점수)}</strong>
        <small>오늘의 재연락·방문 검토 순서</small>
        <details>
          <summary>급성도 근거 보기</summary>
          {contributions.some((item) => item.축 === '급성도') ? (
            <ul>
              {contributions.filter((item) => item.축 === '급성도').map((item) => (
                <li key={`${item.코드 ?? item.근거}-${item.가산점}`}>{item.근거} · {formatScore(item.가산점)}점</li>
              ))}
            </ul>
          ) : <p>아직 기록된 급성도 가산 근거가 없습니다.</p>}
        </details>
      </article>
      <article className="ops-axis">
        <span>취약도</span>
        <strong>{formatScore(detail?.triage?.취약도_점수)}</strong>
        <small>공개 동단위 맥락과 관계망 관찰</small>
        <details>
          <summary>취약도 근거 보기</summary>
          {contributions.some((item) => item.축 === '취약도') ? (
            <ul>
              {contributions.filter((item) => item.축 === '취약도').map((item) => (
                <li key={`${item.코드 ?? item.근거}-${item.가산점}`}>{item.근거} · {formatScore(item.가산점)}점</li>
              ))}
            </ul>
          ) : <p>아직 기록된 취약도 가산 근거가 없습니다.</p>}
        </details>
      </article>
    </section>
  )
}

function OperationsHeader({ title }: { title: string }) {
  return (
    <header className="ops-header">
      <div>
        <h1>{title}</h1>
      </div>
      <nav aria-label="연락업무 화면 이동">
        <a href="/ops/surveyor">연결단원 화면</a>
        <a href="/ops/manager">담당자 화면</a>
        <a href="/">공개 지도</a>
      </nav>
    </header>
  )
}

function LoadingOrError({ error, retry }: { error: string | null; retry: () => void }) {
  if (!error) return <p className="ops-state" role="status">운영 데이터를 불러오는 중입니다.</p>
  return (
    <div className="ops-state" role="alert">
      <AlertTriangle aria-hidden="true" />
      <p>{error}</p>
      <button onClick={retry}><RefreshCw aria-hidden="true" /> 다시 시도</button>
    </div>
  )
}

function ObservationForm({
  value,
  onChange,
}: {
  value: CanonicalObservations
  onChange: (value: CanonicalObservations) => void
}) {
  const update = <K extends keyof CanonicalObservations>(key: K, next: CanonicalObservations[K]) => {
    onChange({ ...value, [key]: next })
  }
  const updateSign = (key: keyof CanonicalObservations['관찰_6징후'], checked: boolean) => {
    update('관찰_6징후', { ...value.관찰_6징후, [key]: checked })
  }
  return (
    <fieldset className="ops-observations">
      <legend>우려 관찰</legend>
      <div className="ops-sign-grid">
        {SIGN_FIELDS.map((field) => (
          <label className="ops-choice" key={field.key}>
            <input
              type="checkbox"
              checked={value.관찰_6징후[field.key]}
              onChange={(event) => updateSign(field.key, event.target.checked)}
            />
            <span>{field.label}</span>
          </label>
        ))}
      </div>
      <label>식사 상태
        <select value={value.식사상태 ?? ''} onChange={(event) => update('식사상태', (event.target.value || null) as CanonicalObservations['식사상태'])}>
          <option value="">확인하지 못함</option><option>양호</option><option>불량</option><option>심각</option>
        </select>
      </label>
      <label>위생 상태
        <select value={value.위생상태 ?? ''} onChange={(event) => update('위생상태', (event.target.value || null) as CanonicalObservations['위생상태'])}>
          <option value="">확인하지 못함</option><option>양호</option><option>불량</option>
        </select>
      </label>
      <NullableBooleanSelect label="공과금 2개월 이상 체납 관찰·보고" value={value.공과금_2개월_이상_체납} onChange={(next) => update('공과금_2개월_이상_체납', next)} />
      <NullableBooleanSelect label="최근 건강·정신적 괴로움 관찰" value={value.최근_건강_정신_괴로움} onChange={(next) => update('최근_건강_정신_괴로움', next)} />
      <label>도움을 요청할 관계망
        <select value={value.관계망_유무 ?? ''} onChange={(event) => update('관계망_유무', (event.target.value || null) as CanonicalObservations['관계망_유무'])}>
          <option value="">확인하지 못함</option><option>있음</option><option>없음</option>
        </select>
      </label>
      <label>평소 타인 연락 빈도
        <select value={value.연락_빈도 ?? ''} onChange={(event) => update('연락_빈도', (event.target.value || null) as CanonicalObservations['연락_빈도'])}>
          <option value="">확인하지 못함</option>
          <option value="주_1회_이상">주 1회 이상</option>
          <option value="주_1회_미만">주 1회 미만</option>
          <option value="없음">연락 없음</option>
        </select>
      </label>
    </fieldset>
  )
}

function NullableBooleanSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean | null
  onChange: (value: boolean | null) => void
}) {
  return (
    <label>{label}
      <select
        value={value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}
      >
        <option value="">확인하지 못함</option>
        <option value="false">해당 없음</option>
        <option value="true">관찰 또는 보고됨</option>
      </select>
    </label>
  )
}

export function SurveyorPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [details, setDetails] = useState<CaseDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [resultLabel, setResultLabel] = useState<ContactResultLabel | ''>('')
  const [observations, setObservations] = useState<CanonicalObservations>(emptyObservations)
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await loadTodayQueue()
      setItems(response.items)
      setSelectedId((current) => response.items.some((item) => item.household_id === current)
        ? current
        : response.items[0]?.household_id ?? null)
    } catch (cause) {
      setError(errorMessage(cause, '운영 데이터를 불러오지 못했습니다.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let active = true
    void loadCase(selectedId).then((next) => {
      if (active) {
        setDetail(next)
        setDetails((current) => [...current.filter((item) => item.household.id !== next.household.id), next])
      }
    }).catch((cause: unknown) => {
      if (active) setError(errorMessage(cause, '상세 정보를 불러오지 못했습니다.'))
    })
    return () => { active = false }
  }, [selectedId])

  const displayedDetail = useMemo(() => {
    if (!detail || detail.triage) return detail
    const queueTriage = items.find((item) => item.household_id === detail.household.id)?.triage
    return queueTriage ? { ...detail, triage: queueTriage } : detail
  }, [detail, items])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!detail || !resultLabel) return
    try {
      setSaving(true)
      setError(null)
      const updated = await submitContact({
        caseId: detail.household.id,
        revision: detail.revision,
        resultLabel,
        observations,
      })
      setDetail(updated)
      setResultLabel('')
      setObservations(emptyObservations())
      setMemo('')
      setFeedback('통화(또는 방문) 결과를 저장하고 연락업무 순서를 다시 계산했습니다.')
      await refresh()
    } catch (cause) {
      setError(errorMessage(cause, '통화(또는 방문) 결과를 저장하지 못했습니다.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="ops-page surveyor-page">
      <OperationsHeader title="오늘 연락할 대상" />
      {error && <LoadingOrError error={error} retry={() => void refresh()} />}
      {loading && items.length === 0 ? <LoadingOrError error={null} retry={() => {}} /> : (
        <div className="ops-mobile-flow">
          <section className="ops-queue" aria-labelledby="today-queue-heading">
            <h2 id="today-queue-heading">오늘 연락업무</h2>
            <SurveyorBreadth items={items} details={details} loading={loading} error={null} selectedId={selectedId} onSelect={setSelectedId} onRetry={() => void refresh()} />
          </section>
          <section className="ops-detail" aria-label="선택한 연락업무">
            <h2>선택한 연락업무</h2>
            {displayedDetail ? <>
              <p className="case-id">{caseDisplayName(displayedDetail.household.id)} 어르신</p>
              <AxisCards detail={displayedDetail} />
              <p className="recommendation">
                {displayedDetail.household.workflow.visit_approval_status === 'recommended'
                  ? '방문 권고 · 담당자 승인 대기'
                  : '전화 안부 확인 후 결정론적 규칙을 다시 계산합니다.'}
              </p>
            </> : <p className="ops-empty">목록에서 연락업무를 선택해 주세요.</p>}
          </section>
          <form className="ops-form" onSubmit={submit}>
            <fieldset>
              <legend>통화(또는 방문) 결과 입력</legend>
              <label>통화(또는 방문) 결과
                <select value={resultLabel} onChange={(event) => setResultLabel(event.target.value as ContactResultLabel | '')} required>
                  <option value="">선택해 주세요</option>
                  {CONTACT_LABELS.map((label) => <option key={label}>{label}</option>)}
                </select>
              </label>
              <ObservationForm value={observations} onChange={setObservations} />
              <label>통화 메모
                <textarea value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="수동 입력의 참고 메모이며 현재 화면에만 유지됩니다." />
                <small>점수나 서버 기록에 넣지 않습니다. 아래 인공지능 후보 입력과 별개로 사용할 수 있습니다.</small>
              </label>
              <button disabled={saving || !detail || !resultLabel} type="submit">
                <Send aria-hidden="true" /> {saving ? '저장 중' : '통화(또는 방문) 결과 저장'}
              </button>
            </fieldset>
            <p className="ops-live" role="status" aria-live="polite">{saving ? '결정론적 규칙과 분리된 점수 축을 계산하는 중입니다.' : feedback}</p>
          </form>
          {displayedDetail && <AiObservationPanel
            key={displayedDetail.household.id}
            caseId={displayedDetail.household.id}
            revision={displayedDetail.revision}
            onApplied={async (updated) => {
              setDetail(updated)
              setFeedback('인공지능 후보 확인 결과를 저장하고 연락업무 순서를 다시 계산했습니다.')
              await refresh()
            }}
          />}
        </div>
      )}
    </main>
  )
}

export function ManagerPage() {
  const [items, setItems] = useState<CaseDetail[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapData, setMapData] = useState<DataBundle | null>(null)
  const [structuralContext, setStructuralContext] = useState<StructuralContext | null>(null)
  const [operationsMap, setOperationsMap] = useState<OperationsMap | null>(null)
  const [selectedOperationsZoneId, setSelectedOperationsZoneId] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<'public' | 'operations'>('public')
  const [breadth, setBreadth] = useState<ManagerBreadth | null>(null)
  const [breadthError, setBreadthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapError, setMapError] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = items.find((item) => item.household.id === selectedId) ?? null
  const workerId = selected
    ? demoWorkerIdForDong(selected.household.location.current_admin_dong_code_20260701)
    : ''
  const syntheticPoint = useMemo(() => selected ? {
    caseId: selected.household.id,
    longitude: selected.household.location.longitude,
    latitude: selected.household.location.latitude,
  } : null, [selected])
  const activeOperationsZoneId = selectedOperationsZoneId ?? selected?.household.location.geometry_zone_id ?? null
  const activeOperationsZone = operationsMap?.zones.find((zone) => zone.geometry_zone_id === activeOperationsZoneId) ?? null

  const refresh = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await loadRecommendations()
      setItems(response.items)
      setSelectedId((current) => response.items.some((item) => item.household.id === current)
        ? current
        : response.items[0]?.household.id ?? null)
    } catch (cause) {
      setError(errorMessage(cause, '방문 권고 목록을 불러오지 못했습니다.'))
    } finally {
      setLoading(false)
    }
  }

  const refreshBreadth = useCallback(async () => {
    try {
      const next = await loadManagerBreadth()
      setBreadth(next)
      setBreadthError(null)
    } catch (cause) {
      setBreadthError(errorMessage(cause, '관리자 운영 요약을 불러오지 못했습니다.'))
    }
  }, [])

  useEffect(() => { void refresh() }, [])
  useEffect(() => { void refreshBreadth() }, [refreshBreadth])
  useEffect(() => {
    let active = true
    void Promise.all([loadStructuralContext(), loadOperationsMap()]).then(([context, operations]) => {
      if (!active) return
      setStructuralContext(context)
      setOperationsMap(operations)
    }).catch(() => {
      if (active) setMapError(true)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    void loadData().then((data) => {
      if (active) setMapData(data)
    }).catch(() => {
      if (active) setMapError(true)
    })
    return () => { active = false }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !decision || !note.trim()) return
    try {
      setSaving(true)
      setError(null)
      await submitDecision({
        caseId: selected.household.id,
        revision: selected.revision,
        decision,
        note: note.trim(),
        ...(decision === 'approved' ? { workerIds: [workerId] } : {}),
      })
      setFeedback(decision === 'approved' ? '담당자 승인을 기록했습니다.' : '담당자 반려를 기록했습니다.')
      setDecision(null)
      setNote('')
      await Promise.all([refresh(), refreshBreadth()])
    } catch (cause) {
      setError(errorMessage(cause, '담당자 결정을 저장하지 못했습니다.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="ops-page manager-page">
      <OperationsHeader title="방문 권고 승인" />
      {error && <LoadingOrError error={error} retry={() => void refresh()} />}
      {feedback && <p className="ops-feedback" role="status" aria-live="polite">{feedback}</p>}
      {loading && items.length === 0 ? <LoadingOrError error={null} retry={() => {}} /> : (
        <div className="ops-workbench">
          <section className="ops-queue" aria-labelledby="recommendations-heading">
            <h2 id="recommendations-heading">담당자 승인 대기</h2>
            {items.length === 0 ? <p className="ops-empty">현재 검토할 방문 권고가 없습니다.</p> : (
              <div className="ops-queue-list" role="listbox" aria-label="방문 권고 목록">
                {items.map((item) => (
                  <button
                    role="option"
                    aria-selected={item.household.id === selectedId}
                    className={item.household.id === selectedId ? 'ops-queue-item selected' : 'ops-queue-item'}
                    key={item.household.id}
                    onClick={() => { setSelectedId(item.household.id); setDecision(null) }}
                  >
                    <span>{caseDisplayName(item.household.id)} 어르신</span>
                    <strong>
                      <b data-score-axis="acute">급성도 {formatScore(item.triage?.급성도_점수)}</b>
                      <b data-score-axis="vulnerability">취약도 {formatScore(item.triage?.취약도_점수)}</b>
                    </strong>
                    <small>방문 권고 · 담당자 승인 대기</small>
                  </button>
                ))}
              </div>
            )}
          </section>
          <ManagerBreadthPanel breadth={breadth} error={breadthError} />
          <section className="ops-decision">
            <h2>선택한 권고 검토</h2>
            {selected ? <>
              <p className="case-id">{caseDisplayName(selected.household.id)} 어르신</p>
              <AxisCards detail={selected} />
              <section className="ops-map-context" aria-label="선택한 대상 위치와 목록 대안">
                <strong>선택한 대상 위치</strong>
                <span>{selected.household.location.current_district_name_20260701} {selected.household.location.current_admin_dong_name_20260701}</span>
                <small>지도는 맥락 확인용입니다. 왼쪽의 키보드 접근 가능 목록으로 같은 업무를 선택할 수 있습니다.</small>
                <MapModeToggle mode={mapMode} onChange={setMapMode} />
                <div className="ops-map-frame">
                  {mapData ? <MapView
                    data={mapData}
                    metric="age_65_plus_one_person_share_of_age_65_plus_population"
                    showFacilities={false}
                    showTransit={false}
                    facilityCategory="전체"
                    selectedZoneId={activeOperationsZoneId}
                    syntheticPoint={syntheticPoint}
                    mapMode={mapMode}
                    operationsByZone={operationsMap ? Object.fromEntries(operationsMap.zones.map((zone) => [zone.geometry_zone_id, zone.operations])) : undefined}
                    ariaLabel="연락업무 위치와 공개 동단위 맥락 지도"
                    onSelectDong={(dong) => setSelectedOperationsZoneId(dong.geometry_zone_id)}
                  /> : <p role="status">공개 동단위 맥락 지도를 불러오는 중입니다.</p>}
                </div>
                {mapError && <p>지도를 불러오지 못했습니다. 목록 검토와 담당자 결정은 계속 사용할 수 있습니다.</p>}
                {mapMode === 'operations' && <ZoneOperationsPanel zone={activeOperationsZone} />}
                <StructuralContextPanel zone={structuralContext?.zones.find((item) => item.geometry_zone_id === activeOperationsZoneId) ?? null} />
              </section>
              <form className="ops-form" onSubmit={submit}>
                <fieldset>
                  <legend>담당자 결정</legend>
                  <label className="ops-choice"><input checked={decision === 'approved'} onChange={() => setDecision('approved')} type="radio" name="decision" /><span>방문 권고 승인</span></label>
                  <label className="ops-choice"><input checked={decision === 'rejected'} onChange={() => setDecision('rejected')} type="radio" name="decision" /><span>방문 권고 반려</span></label>
                  {decision === 'approved' && <>
                    <label>연결단원 배정
                      <select value={workerId} onChange={() => {}}><option value={workerId}>연결단원 001</option></select>
                    </label>
                  </>}
                  <label>결정 사유
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} required />
                  </label>
                  <button className={decision === 'rejected' ? 'reject' : 'approve'} disabled={saving || !decision || !note.trim()} type="submit">
                    <CheckCircle2 aria-hidden="true" /> {saving ? '저장 중' : decision === 'rejected' ? '방문 권고 반려 기록' : '방문 권고 승인 기록'}
                  </button>
                </fieldset>
                <p className="ops-live" role="status" aria-live="polite">{saving ? '명시적 담당자 결정을 저장하는 중입니다.' : ''}</p>
              </form>
            </> : <p className="ops-empty">목록에서 연락업무를 선택해 주세요.</p>}
          </section>
        </div>
      )}
    </main>
  )
}

function ManagerBreadthPanel({ breadth, error }: { breadth: ManagerBreadth | null; error: string | null }) {
  if (error) return <section className="ops-breadth" aria-label="관리자 운영 요약"><p role="alert">{error}</p></section>
  if (!breadth) return <section className="ops-breadth" aria-label="관리자 운영 요약"><p role="status">관리자 운영 요약을 불러오는 중입니다.</p></section>
  return <aside className="ops-breadth" aria-label="관리자 운영 요약">
    <section><h2>행정복지센터 이관</h2>{breadth.transfer_recommendations.length === 0 ? <p>현재 이관 권고가 없습니다.</p> : <ul>{breadth.transfer_recommendations.map((item) => <li key={item.case_id}><strong>{item.status_label}</strong><span>{caseDisplayName(item.case_id)} 어르신</span><small>급성도 {formatScore(item.acute.score)} · 취약도 {formatScore(item.vulnerability.score)}</small></li>)}</ul>}</section>
    <section><h2>분리된 2축 분포</h2><h3>급성도 분포</h3><Distribution values={breadth.grade_distribution.acute.grades} /><h3>취약도 분포</h3><Distribution values={breadth.grade_distribution.vulnerability.score_bands} /></section>
    <section className="ops-tuning"><h2>배점 점검</h2><strong>{breadth.tuning_warning.current_mild_signal_count.toLocaleString()}건</strong><p>점수 규칙 점검값입니다.</p></section>
    <section><h2>승인된 방문 {breadth.approved_visit_hint.approved_visit_count}건</h2><p>{breadth.approved_visit_hint.label}</p>{breadth.approved_visit_hint.items.length > 0 && <ol>{breadth.approved_visit_hint.items.map((item) => <li key={item.case_id}>{caseDisplayName(item.case_id)} 어르신 · {item.admin_dong}{item.distance_from_previous_km != null ? ` · 이전 지점에서 ${item.distance_from_previous_km}km` : ''}</li>)}</ol>}</section>
  </aside>
}

function Distribution({ values }: { values: Record<string, number> }) {
  const displayLabel = (label: string) => /^\d+_\d+$/.test(label)
    ? `${label.replace('_', '–')}점`
    : label
  return <dl className="ops-distribution">{Object.entries(values).map(([label, count]) => <div key={label}><dt>{displayLabel(label)}</dt><dd>{count}건</dd></div>)}</dl>
}

function MapModeToggle({ mode, onChange }: { mode: 'public' | 'operations'; onChange: (mode: 'public' | 'operations') => void }) {
  return <div className="map-mode-toggle" role="group" aria-label="지도 표시 모드">
    <button type="button" aria-pressed={mode === 'public'} onClick={() => onChange('public')}>공개 인구 맥락</button>
    <button type="button" aria-pressed={mode === 'operations'} onClick={() => onChange('operations')}>연락업무</button>
  </div>
}

export function ZoneOperationsPanel({ zone }: { zone: OperationsMapZone | null }) {
  if (!zone) return <section className="zone-operations-panel" aria-label="선택한 구역의 연락업무"><p role="status">선택한 구역의 연락업무를 불러오는 중입니다.</p></section>
  const operations = zone.operations
  const sourceLabel = (source: typeof operations.acute_metric_source) => source === 'session_recorded'
    ? '세션 기록'
    : source === 'synthetic_scenario' ? '고정 예시' : '자료 없음'
  return <section className="zone-operations-panel" aria-label="선택한 구역의 연락업무">
    <h3>선택한 구역의 연락업무</h3>
    <p>채색은 구역 내 급성도 최댓값, 원 크기는 취약도 최댓값입니다. 두 축은 각각 표시하며 자동 승인은 사용하지 않습니다.</p>
    <p className="zone-scenario-note"><strong>고정 운영 예시</strong><br />현행 행정동마다 한 건의 고정 예시로 로직을 보여줍니다. 같은 업무에 현재 세션의 입력 기록이 생기면 그 기록을 사용합니다. 기준일 {operations.scenario_reference_date}</p>
    <dl className="zone-operation-metrics">
      <div><dt>급성도 채색값</dt><dd>{formatScore(operations.acute_color_metric, '점수 없음')} · {sourceLabel(operations.acute_metric_source)}{operations.acute_max_case_id ? ` · ${caseDisplayName(operations.acute_max_case_id)} 어르신` : ''}</dd></div>
      <div><dt>취약도 원 크기값</dt><dd>{formatScore(operations.vulnerability_size_metric, '점수 없음')} · {sourceLabel(operations.vulnerability_metric_source)}{operations.vulnerability_max_case_id ? ` · ${caseDisplayName(operations.vulnerability_max_case_id)} 어르신` : ''}</dd></div>
      <div><dt>점수 출처</dt><dd>세션 기록 {operations.session_scored_case_count}건 · 고정 예시 {operations.scenario_scored_case_count}건 · 미기록 {operations.unscored_case_count}건</dd></div>
    </dl>
    <p className="zone-aggregation">구역 집계: 최댓값 우선 맥락. 동점이면 높은 축 점수 후 내부 업무 식별자 오름차순으로 선택합니다.</p>
    <ContributionSummary title="급성도 기여" entries={operations.contribution_summaries.acute} />
    <ContributionSummary title="취약도 기여" entries={operations.contribution_summaries.vulnerability} />
  </section>
}

function ContributionSummary({ title, entries }: { title: string; entries: Array<{ code: string; total_points: number; case_count: number }> }) {
  const displayCode = (code: string) => ({
    연속_미응답: '연속 미응답',
    관찰_6징후: '우려 관찰 6징후',
    관계망_없음: '관계망 없음',
    사회적_고립: '사회적 연락 부족',
    동단위_고령비율: '동단위 고령비율',
    동단위_1인가구비율: '동단위 1인가구비율',
    동단위_노후주택: '동단위 노후주택',
    동단위_기초수급_밀도: '동단위 기초수급 밀도',
  }[code] ?? code.replaceAll('_', ' '))
  return <section className="zone-contributions"><h4>{title}</h4>{entries.length === 0 ? <p>점수 기록이 없습니다.</p> : <>
    <ul>{entries.map((entry) => <li key={entry.code}><span>{displayCode(entry.code)}</span><strong>{formatScore(entry.total_points)}점 · {entry.case_count}건</strong></li>)}</ul>
    {entries.some(({ total_points: points }) => points === 0) && <p className="zero-contribution-note">0점 항목은 평가되었으나 가산되지 않은 지표입니다.</p>}
  </>}</section>
}

function StructuralContextPanel({ zone }: { zone: StructuralZone | null }) {
  if (!zone) return <section className="structural-panel" aria-label="공개 인구 맥락"><p role="status">공개 인구 맥락을 불러오는 중입니다.</p></section>
  return <section className="structural-panel" aria-label="공개 인구 맥락">
    <span className="structural-model-label">[MODEL OUTPUT — UNVALIDATED]</span>
    <h3>공개 인구 맥락 · 156개 지도 구역</h3>
    <p>개별 연락업무의 점수가 아닌, 공개 집계 기반 구조 맥락입니다.</p>
    <dl className="structural-summary">
      <div><dt>구조 맥락 점수</dt><dd>{zone.score_0_50.toFixed(1)} / 50</dd></div>
      <div><dt>사용 가능 분모</dt><dd>{zone.available_score_denominator.toFixed(1)} / 50</dd></div>
      <div><dt>완결성</dt><dd>{zone.completeness.available_indicator_count} / {zone.completeness.total_indicator_count} ({Math.round(zone.completeness.ratio * 100)}%)</dd></div>
    </dl>
    <div className="structural-indicators">
      {Object.entries(zone.indicators).map(([key, indicator]) => <IndicatorRow key={key} indicator={indicator} />)}
    </div>
  </section>
}

function IndicatorRow({ indicator }: { indicator: StructuralIndicator }) {
  const raw = indicator.raw_value == null ? '결측' : `${(indicator.raw_value * 100).toFixed(1)}%`
  return <article className="structural-indicator">
    <h4>{indicator.label_ko}</h4>
    {indicator.missing ? <p>결측 · 가산점 없음{indicator.missing_reason ? ` (${indicator.missing_reason})` : ''}</p> : <>
      <dl>
        <div><dt>원자료</dt><dd>{raw} ({indicator.raw_numerator?.toLocaleString() ?? '–'} / {indicator.raw_denominator?.toLocaleString() ?? '–'})</dd></div>
        <div><dt>중간순위</dt><dd>{(indicator.percentile_rank! * 100).toFixed(1)}% · 비교 {indicator.comparable_geography_count}구역</dd></div>
        <div><dt>기여</dt><dd>{indicator.contribution.toFixed(1)} / {indicator.maximum_contribution.toFixed(1)}</dd></div>
        <div><dt>기준일</dt><dd>분자 {indicator.reference_dates.numerator ?? '–'} · 분모 {indicator.reference_dates.denominator ?? '–'}</dd></div>
      </dl>
      {indicator.mixed_snapshot && <p className="mixed-snapshot-note"><strong>혼합 시점 참고값</strong><br />분자 {indicator.reference_dates.numerator ?? '–'} · 분모 {indicator.reference_dates.denominator ?? '–'} · 서로 다른 기준일의 참고 비율이며 동시점 비율이 아닙니다.</p>}
    </>}
  </article>
}
