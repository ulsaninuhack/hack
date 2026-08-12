import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Send } from 'lucide-react'
import MapView from './MapView'
import {
  ContactOpsClientError,
  emptyObservations,
  loadCase,
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
} from './contactOpsClient'
import { loadData } from './data'
import type { DataBundle } from './types'

const SYNTHETIC_MESSAGE = '합성 연락업무 데모 · 실제 주민, 실제 업무, 개인 판정이 아닙니다.'
const CONTACT_LABELS: ContactResultLabel[] = [
  '안부 확인 완료',
  '우려 사항 있음',
  '미응답',
  '연락 거부',
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
      return '합성 연락업무 서비스를 잠시 사용할 수 없습니다.'
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
        <strong>{detail?.triage?.급성도_점수 ?? '–'}</strong>
        <small>오늘의 재연락·방문 검토 순서</small>
        <details>
          <summary>급성도 근거 보기</summary>
          {contributions.some((item) => item.축 === '급성도') ? (
            <ul>
              {contributions.filter((item) => item.축 === '급성도').map((item) => (
                <li key={`${item.코드 ?? item.근거}-${item.가산점}`}>{item.근거} · {item.가산점}점</li>
              ))}
            </ul>
          ) : <p>아직 기록된 급성도 가산 근거가 없습니다.</p>}
        </details>
      </article>
      <article className="ops-axis">
        <span>취약도</span>
        <strong>{detail?.triage?.취약도_점수 ?? '–'}</strong>
        <small>공개 동단위 맥락과 관계망 관찰</small>
        <details>
          <summary>취약도 근거 보기</summary>
          {contributions.some((item) => item.축 === '취약도') ? (
            <ul>
              {contributions.filter((item) => item.축 === '취약도').map((item) => (
                <li key={`${item.코드 ?? item.근거}-${item.가산점}`}>{item.근거} · {item.가산점}점</li>
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
        <span className="synthetic-chip">[합성]</span>
        <h1>{title}</h1>
      </div>
      <p>{SYNTHETIC_MESSAGE}</p>
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

function QueueList({
  items,
  selectedId,
  onSelect,
}: {
  items: QueueItem[]
  selectedId: string | null
  onSelect: (caseId: string) => void
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? Math.min(index + 1, items.length - 1)
          : Math.max(index - 1, 0)
    const next = items[nextIndex]
    if (!next) return
    onSelect(next.household_id)
    document.getElementById(`queue-${next.household_id}`)?.focus()
  }

  return (
    <div className="ops-queue-list" role="listbox" aria-label="오늘 연락업무 목록">
      {items.map((item, index) => (
        <button
          id={`queue-${item.household_id}`}
          role="option"
          aria-selected={item.household_id === selectedId}
          className={item.household_id === selectedId ? 'ops-queue-item selected' : 'ops-queue-item'}
          key={item.household_id}
          onClick={() => onSelect(item.household_id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          <span>[합성] {item.household_id}</span>
          <strong>
            <b data-score-axis="acute">급성도 {item.triage.급성도_점수}</b>
            <b data-score-axis="vulnerability">취약도 {item.triage.취약도_점수}</b>
          </strong>
          <small>{item.preferred_contact_method === 'phone' ? '전화 안부 확인' : '방문 선호 기록'}</small>
        </button>
      ))}
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
      if (active) setDetail(next)
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
      setFeedback('통화 결과를 저장하고 연락업무 순서를 다시 계산했습니다.')
      await refresh()
    } catch (cause) {
      setError(errorMessage(cause, '통화 결과를 저장하지 못했습니다.'))
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
            {items.length > 0
              ? <QueueList items={items} selectedId={selectedId} onSelect={setSelectedId} />
              : <p className="ops-empty">오늘 예정된 합성 연락업무가 없습니다.</p>}
          </section>
          <section className="ops-detail" aria-label="선택한 합성 연락업무">
            <h2>선택한 연락업무</h2>
            {displayedDetail ? <>
              <p className="case-id">[합성] {displayedDetail.household.id}</p>
              <AxisCards detail={displayedDetail} />
              <p className="recommendation">
                {displayedDetail.household.workflow.visit_approval_status === 'recommended'
                  ? '방문 권고 · 담당자 승인 대기'
                  : '전화 안부 확인 후 결정론적 규칙을 다시 계산합니다.'}
              </p>
            </> : <p className="ops-empty">목록에서 합성 연락업무를 선택해 주세요.</p>}
          </section>
          <form className="ops-form" onSubmit={submit}>
            <fieldset>
              <legend>통화 결과 입력</legend>
              <label>통화 결과
                <select value={resultLabel} onChange={(event) => setResultLabel(event.target.value as ContactResultLabel | '')} required>
                  <option value="">선택해 주세요</option>
                  {CONTACT_LABELS.map((label) => <option key={label}>{label}</option>)}
                </select>
              </label>
              <ObservationForm value={observations} onChange={setObservations} />
              <label>개인정보 없는 합성 메모
                <textarea value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="이 메모는 P3 검토 입력 전까지 현재 화면에만 유지됩니다." />
                <small>현재 P2에서는 점수나 서버 기록에 넣지 않습니다.</small>
              </label>
              <button disabled={saving || !detail || !resultLabel} type="submit">
                <Send aria-hidden="true" /> {saving ? '저장 중' : '통화 결과 저장'}
              </button>
            </fieldset>
            <p className="ops-live" role="status" aria-live="polite">{saving ? '결정론적 규칙과 분리된 점수 축을 계산하는 중입니다.' : feedback}</p>
          </form>
        </div>
      )}
    </main>
  )
}

export function ManagerPage() {
  const [items, setItems] = useState<CaseDetail[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapData, setMapData] = useState<DataBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapError, setMapError] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [distance, setDistance] = useState('2')
  const [saving, setSaving] = useState(false)

  const selected = items.find((item) => item.household.id === selectedId) ?? null
  const workerId = selected
    ? `SYN-W-${selected.household.location.current_admin_dong_code_20260701}-01`
    : ''
  const syntheticPoint = useMemo(() => selected ? {
    caseId: selected.household.id,
    longitude: selected.household.location.longitude,
    latitude: selected.household.location.latitude,
  } : null, [selected])

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

  useEffect(() => { void refresh() }, [])
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
    const numericDistance = Number(distance)
    if (decision === 'approved' && (!Number.isFinite(numericDistance) || numericDistance <= 0)) return
    try {
      setSaving(true)
      setError(null)
      await submitDecision({
        caseId: selected.household.id,
        revision: selected.revision,
        decision,
        note: note.trim(),
        ...(decision === 'approved' ? { workerIds: [workerId], distance: numericDistance } : {}),
      })
      setFeedback(decision === 'approved' ? '담당자 승인을 기록했습니다.' : '담당자 반려를 기록했습니다.')
      setDecision(null)
      setNote('')
      await refresh()
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
                    <span>[합성] {item.household.id}</span>
                    <strong>
                      <b data-score-axis="acute">급성도 {item.triage?.급성도_점수 ?? '–'}</b>
                      <b data-score-axis="vulnerability">취약도 {item.triage?.취약도_점수 ?? '–'}</b>
                    </strong>
                    <small>방문 권고 · 담당자 승인 대기</small>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="ops-decision">
            <h2>선택한 권고 검토</h2>
            {selected ? <>
              <p className="case-id">[합성] {selected.household.id}</p>
              <AxisCards detail={selected} />
              <section className="ops-map-context" aria-label="선택한 합성 점과 목록 대안">
                <strong>선택한 합성 점</strong>
                <span>{selected.household.location.current_district_name_20260701} {selected.household.location.current_admin_dong_name_20260701}</span>
                <small>지도는 맥락 확인용입니다. 왼쪽의 키보드 접근 가능 목록으로 같은 업무를 선택할 수 있습니다.</small>
                <div className="ops-map-frame">
                  {mapData ? <MapView
                    data={mapData}
                    metric="age_65_plus_one_person_share_of_age_65_plus_population"
                    showFacilities={false}
                    showTransit={false}
                    showBubbles={false}
                    facilityCategory="전체"
                    selectedZoneId={selected.household.location.geometry_zone_id}
                    syntheticPoint={syntheticPoint}
                    ariaLabel="[합성] 연락업무 위치와 공개 동단위 맥락 지도"
                    onSelectDong={() => {}}
                  /> : <p role="status">공개 동단위 맥락 지도를 불러오는 중입니다.</p>}
                </div>
                {mapError && <p>지도를 불러오지 못했습니다. 목록 검토와 담당자 결정은 계속 사용할 수 있습니다.</p>}
              </section>
              <form className="ops-form" onSubmit={submit}>
                <fieldset>
                  <legend>담당자 결정</legend>
                  <label className="ops-choice"><input checked={decision === 'approved'} onChange={() => setDecision('approved')} type="radio" name="decision" /><span>방문 권고 승인</span></label>
                  <label className="ops-choice"><input checked={decision === 'rejected'} onChange={() => setDecision('rejected')} type="radio" name="decision" /><span>방문 권고 반려</span></label>
                  {decision === 'approved' && <>
                    <label>연결단원 배정
                      <select value={workerId} onChange={() => {}}><option value={workerId}>{workerId}</option></select>
                    </label>
                    <label>승인된 방문 거리 제한 (km)
                      <input min="0.1" max="50" step="0.1" type="number" value={distance} onChange={(event) => setDistance(event.target.value)} required />
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
            </> : <p className="ops-empty">목록에서 합성 연락업무를 선택해 주세요.</p>}
          </section>
        </div>
      )}
    </main>
  )
}
