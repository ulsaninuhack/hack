import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Inbox, MapPinned, RefreshCw } from 'lucide-react'
import MapView from './MapView'
import { loadData } from './data'
import type { DataBundle } from './types'
import {
  CONTACT_OPS_REFERENCE_DATE,
  ContactOpsClientError,
  loadRecommendations,
  submitDecision,
} from './contactOpsClient'
import type { CaseDetail } from './contactOpsClient'
import {
  DEMO_CENTER_DONG_CODE,
  acknowledgeReport,
  confirmAssignment,
  loadCenterInbox,
} from './threeTierClient'
import type { AssignmentProposalItem, CenterInbox, ReportCard } from './threeTierClient'

const CENTER_ACTOR = '동센터 담당자'
const SYNTHETIC_MESSAGE = '합성 연락업무 데모 · 실제 주민, 실제 업무, 개인 판정이 아닙니다.'
const TRANSFER_TRACK_MESSAGE = '안부확인 트랙에서 사례관리·전문기관 트랙으로 전환하는 권고입니다. 전환 확정은 별도 행정 절차이며 이 합성 데모의 범위 밖입니다.'

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof ContactOpsClientError && cause.code === 'STATE_CONFLICT') {
    return '다른 화면에서 먼저 변경했습니다. 최신 내용을 다시 불러온 뒤 처리해 주세요.'
  }
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function GradeChip({ grade }: { grade: string | null }) {
  const value = grade ?? '미기록'
  return <span className="grade-chip" data-grade={value}>{value}</span>
}

function ProposalRow({
  item,
  onConfirm,
  busy,
}: {
  item: AssignmentProposalItem
  onConfirm: (caseId: string) => void
  busy: boolean
}) {
  return (
    <li className="assignment-row" data-lane={item.lane}>
      <div className="assignment-row-main">
        <span className="case-id">[합성] {item.case_id}</span>
        <GradeChip grade={item.급성도_등급} />
        <span className="assignment-worker">{item.worker_display_name ?? '담당 미배정'}</span>
      </div>
      <p className="assignment-basis">{item.제안_근거.join(' · ')}</p>
      {item.adjustment_flags.length > 0 && (
        <p className="assignment-flags" role="note">조정 필요: {item.adjustment_flags.map((flag) => ({
          no_worker_for_dong: '담당 연결단원 없음',
          time_window_mismatch: '시간창 불일치',
          capacity_exceeded: '일일 방문 용량 초과',
        }[flag] ?? flag)).join(' · ')}</p>
      )}
      {item.status === 'confirmed'
        ? <p className="assignment-confirmed"><CheckCircle2 aria-hidden="true" size={17} /> 확인됨 · {item.confirmed_by}</p>
        : <button className="confirm-one" disabled={busy} onClick={() => onConfirm(item.case_id)}>이 제안 확인</button>}
    </li>
  )
}

function ReportCardView({
  card,
  onAcknowledge,
  busy,
}: {
  card: ReportCard
  onAcknowledge: (card: ReportCard) => void
  busy: boolean
}) {
  const [showTransfer, setShowTransfer] = useState(false)
  return (
    <article className="report-card" aria-label={`[합성] ${card.case_id} 보고 카드`}>
      <header>
        <GradeChip grade={card.등급} />
        <span className="case-id">[합성] {card.case_id}</span>
        <span className="report-meta">{card.evidence.마지막_연락_결과_라벨} · {card.evidence.마지막_연락_일자 ?? '기록 없음'}</span>
      </header>
      <dl className="report-scores">
        <div><dt>급성도</dt><dd>{card.급성도_점수}</dd></div>
        <div><dt>취약도</dt><dd>{card.취약도_점수}</dd></div>
      </dl>
      <section className="report-reasons">
        <h4>사유 요약</h4>
        <ul>{card.사유_요약.map((reason) => <li key={`${reason.축}-${reason.근거}`}>{reason.축} · {reason.근거} · {reason.가산점}점</li>)}</ul>
      </section>
      <section className="report-agencies">
        <h4>권고 기관 (권고와 사유까지만 · 확정은 담당자)</h4>
        {card.권고_기관.length === 0 ? <p>권고할 기관 신호가 없습니다.</p> : (
          <ul>{card.권고_기관.map((agency) => <li key={agency.기관}><strong>{agency.기관}</strong><span>{agency.사유}</span></li>)}</ul>
        )}
      </section>
      <details className="report-evidence">
        <summary>관찰 근거 열기</summary>
        <ul>
          <li>연속 미응답 {card.evidence.연속_미응답_횟수}회</li>
          <li>식사 상태: {card.evidence.관찰.식사상태 ?? '확인하지 못함'}</li>
          <li>위생 상태: {card.evidence.관찰.위생상태 ?? '확인하지 못함'}</li>
          <li>관찰 징후: {Object.entries(card.evidence.관찰.관찰_6징후).filter(([, value]) => value).map(([key]) => key.replaceAll('_', ' ')).join(', ') || '체크된 징후 없음'}</li>
        </ul>
      </details>
      {card.workflow.transfer_label && (
        <p className="report-transfer">{card.workflow.transfer_label}</p>
      )}
      <footer className="report-actions">
        {card.acknowledgement.status === '확인'
          ? <p className="report-acknowledged"><CheckCircle2 aria-hidden="true" size={17} /> 확인함 · {card.acknowledgement.acknowledged_by}</p>
          : <button disabled={busy} onClick={() => onAcknowledge(card)}>보고 확인</button>}
        {card.workflow.visit_approval_status === 'recommended' && (
          <a className="report-jump" href="#center-visit-review">방문 검토로 이동</a>
        )}
        {card.workflow.transfer_label && (
          <button className="report-transfer-toggle" onClick={() => setShowTransfer((value) => !value)} aria-expanded={showTransfer}>이관 안내</button>
        )}
      </footer>
      {showTransfer && <p className="report-transfer-note" role="note">{TRANSFER_TRACK_MESSAGE}</p>}
    </article>
  )
}

export function CenterPage() {
  const [inbox, setInbox] = useState<CenterInbox | null>(null)
  const [recommendations, setRecommendations] = useState<CaseDetail[]>([])
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
  const [lane, setLane] = useState<'phone' | 'visit'>('phone')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mapData, setMapData] = useState<DataBundle | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [distance, setDistance] = useState('2')

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [nextInbox, nextRecommendations] = await Promise.all([
        loadCenterInbox(),
        loadRecommendations(),
      ])
      setInbox(nextInbox)
      const dongRecommendations = nextRecommendations.items.filter(
        (item) => item.household.location.current_admin_dong_code_20260701 === DEMO_CENTER_DONG_CODE,
      )
      setRecommendations(dongRecommendations)
      setSelectedVisitId((current) => dongRecommendations.some((item) => item.household.id === current)
        ? current
        : dongRecommendations[0]?.household.id ?? null)
    } catch (cause) {
      setError(errorText(cause, '동 행정복지센터 인박스를 불러오지 못했습니다.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!mapOpen || mapData) return
    let active = true
    void loadData().then((bundle) => { if (active) setMapData(bundle) }).catch(() => {
      // 지도는 보조 위젯이다. 실패해도 텍스트 업무 흐름은 계속된다.
    })
    return () => { active = false }
  }, [mapOpen, mapData])

  const proposal = inbox?.assignment_proposal ?? null
  const laneItems = useMemo(() => proposal?.lanes[lane] ?? [], [proposal, lane])
  const selectedVisit = recommendations.find((item) => item.household.id === selectedVisitId) ?? null
  const workerId = `SYN-W-${DEMO_CENTER_DONG_CODE}-01`

  const act = async (action: () => Promise<void>, doneMessage: string, failMessage: string) => {
    try {
      setBusy(true)
      setError(null)
      await action()
      setFeedback(doneMessage)
      await refresh()
    } catch (cause) {
      setError(errorText(cause, failMessage))
    } finally {
      setBusy(false)
    }
  }

  const confirmOne = (caseId: string) => act(
    async () => { await confirmAssignment({ dongCode: DEMO_CENTER_DONG_CODE, referenceDate: CONTACT_OPS_REFERENCE_DATE, confirmedBy: CENTER_ACTOR, caseIds: [caseId] }) },
    '할당 제안 1건을 확인했습니다.',
    '할당 제안을 확인하지 못했습니다.',
  )
  const confirmAll = () => act(
    async () => { await confirmAssignment({ dongCode: DEMO_CENTER_DONG_CODE, referenceDate: CONTACT_OPS_REFERENCE_DATE, confirmedBy: CENTER_ACTOR, caseIds: null }) },
    '오늘 배치안을 일괄 확인했습니다.',
    '오늘 배치안을 확인하지 못했습니다.',
  )
  const acknowledge = (card: ReportCard) => act(
    async () => { await acknowledgeReport({ caseId: card.case_id, revision: card.revision, acknowledgedBy: CENTER_ACTOR }) },
    '보고 카드를 확인했습니다.',
    '보고 카드를 확인하지 못했습니다.',
  )

  const submitVisitDecision = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedVisit || !decision || !note.trim()) return
    const numericDistance = Number(distance)
    if (decision === 'approved' && (!Number.isFinite(numericDistance) || numericDistance <= 0)) return
    await act(
      async () => {
        await submitDecision({
          caseId: selectedVisit.household.id,
          revision: selectedVisit.revision,
          decision,
          note: note.trim(),
          ...(decision === 'approved' ? { workerIds: [workerId], distance: numericDistance } : {}),
        })
        setDecision(null)
        setNote('')
      },
      decision === 'approved' ? '방문 권고를 승인했습니다.' : '방문 권고를 반려했습니다.',
      '담당자 결정을 저장하지 못했습니다.',
    )
  }

  return (
    <main className="tier-page center-page">
      <header className="tier-header">
        <div>
          <span className="synthetic-chip">[합성]</span>
          <h1>동 행정복지센터용 · {inbox?.dong_name ?? '신포동'}</h1>
          <p className="tier-audience">{inbox?.district ?? '제물포구'} {inbox?.dong_name ?? '신포동'} 행정복지센터 확인·승인 화면</p>
        </div>
        <p>{SYNTHETIC_MESSAGE}</p>
        <nav aria-label="3계층 화면 이동">
          <a href="/m">조사원 모바일</a>
          <a href="/city">시·구 지도</a>
          <a href="/">공개 지도</a>
        </nav>
      </header>

      {error && (
        <div className="ops-state" role="alert">
          <AlertTriangle aria-hidden="true" />
          <p>{error}</p>
          <button onClick={() => void refresh()}><RefreshCw aria-hidden="true" /> 다시 시도</button>
        </div>
      )}
      {feedback && <p className="ops-feedback" role="status" aria-live="polite">{feedback}</p>}
      {loading && !inbox && <p className="ops-state" role="status">동 행정복지센터 업무를 불러오는 중입니다.</p>}

      {inbox && (
        <>
          <section className="center-summary" aria-label="오늘 처리 요약과 다음 행동">
            <a href="#center-reports"><strong>{inbox.summary.보고_대기_수}건</strong><span>보고 확인 대기</span></a>
            <a href="#center-assignment"><strong>{inbox.summary.배치_상태 === 'confirmed' ? '완료' : inbox.summary.배치_상태 === 'partially_confirmed' ? '일부 확인' : '대기'}</strong><span>오늘 배치 확인</span></a>
            <a href="#center-visit-review"><strong>{inbox.summary.방문승인_대기_수}건</strong><span>방문 검토 대기</span></a>
            <p><strong>{inbox.summary.처리_완료율_pct ?? 0}%</strong><span>보고 처리 완료율</span></p>
          </section>

          <div className="center-columns">
            <div className="center-main">
              <section id="center-assignment" className="center-section" aria-labelledby="assignment-heading">
                <h2 id="assignment-heading"><ClipboardCheck aria-hidden="true" size={20} /> 오늘 배치 확인</h2>
                {proposal === null ? <p className="ops-empty">오늘 예정된 배치 제안이 없습니다.</p> : (
                  <>
                    <p className="center-section-note">
                      결정론 규칙이 만든 <strong>제안</strong>입니다. {proposal.confirmation_rule}.
                      담당 {proposal.worker_display_name} · 일일 승인 방문 용량 {proposal.max_daily_approved_visits}건.
                    </p>
                    <div className="lane-tabs" role="tablist" aria-label="전화 레인과 방문 레인">
                      <button role="tab" aria-selected={lane === 'phone'} onClick={() => setLane('phone')}>전화 레인 {proposal.lanes.phone.length}건</button>
                      <button role="tab" aria-selected={lane === 'visit'} onClick={() => setLane('visit')}>방문 레인 {proposal.lanes.visit.length}건</button>
                    </div>
                    <p className="lane-rule">방문 레인에는 승인된 방문 또는 방문 선호 예정 업무만 들어옵니다. 전화 큐와 섞지 않습니다.</p>
                    <ul className="assignment-list" aria-label={lane === 'phone' ? '전화 레인 할당 제안' : '방문 레인 할당 제안'}>
                      {laneItems.length === 0 ? <li className="ops-empty">이 레인에는 오늘 제안이 없습니다.</li>
                        : laneItems.map((item) => <ProposalRow key={item.case_id} item={item} onConfirm={confirmOne} busy={busy} />)}
                    </ul>
                    {proposal.status !== 'confirmed' && (
                      <button className="confirm-all" disabled={busy} onClick={confirmAll}>오늘 배치 일괄 확인</button>
                    )}
                    {proposal.status === 'confirmed' && <p className="assignment-confirmed" role="status">오늘 배치안이 모두 확인되었습니다.</p>}
                  </>
                )}
              </section>

              <section id="center-reports" className="center-section" aria-labelledby="reports-heading">
                <h2 id="reports-heading"><Inbox aria-hidden="true" size={20} /> 보고 확인</h2>
                <p className="center-section-note">조사원 제출이 도착하면 등급·사유·권고 기관이 담긴 보고 카드가 쌓입니다.</p>
                {inbox.report_cards.length === 0
                  ? <p className="ops-empty">아직 도착한 보고가 없습니다. 조사원 모바일 화면에서 통화 결과를 제출하면 이곳에 나타납니다.</p>
                  : inbox.report_cards.map((card) => (
                    <ReportCardView key={card.card_id} card={card} onAcknowledge={acknowledge} busy={busy} />
                  ))}
              </section>

              <section id="center-visit-review" className="center-section" aria-labelledby="visit-review-heading">
                <h2 id="visit-review-heading"><CheckCircle2 aria-hidden="true" size={20} /> 방문 검토</h2>
                <p className="center-section-note">방문 권고는 담당자의 명시적 승인 또는 반려로만 확정됩니다.</p>
                {recommendations.length === 0 ? <p className="ops-empty">현재 검토할 방문 권고가 없습니다.</p> : (
                  <div className="visit-review">
                    <ul className="visit-review-list" aria-label="방문 권고 대기 목록">
                      {recommendations.map((item) => (
                        <li key={item.household.id}>
                          <button aria-pressed={item.household.id === selectedVisitId} onClick={() => { setSelectedVisitId(item.household.id); setDecision(null) }}>
                            <span className="case-id">[합성] {item.household.id}</span>
                            <span>급성도 {item.triage?.급성도_점수 ?? '–'} · 취약도 {item.triage?.취약도_점수 ?? '–'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {selectedVisit && (
                      <form className="ops-form" onSubmit={submitVisitDecision}>
                        <fieldset>
                          <legend>담당자 결정 · [합성] {selectedVisit.household.id}</legend>
                          <label className="ops-choice"><input checked={decision === 'approved'} onChange={() => setDecision('approved')} type="radio" name="center-decision" /><span>방문 권고 승인</span></label>
                          <label className="ops-choice"><input checked={decision === 'rejected'} onChange={() => setDecision('rejected')} type="radio" name="center-decision" /><span>방문 권고 반려</span></label>
                          {decision === 'approved' && (
                            <>
                              <label>연결단원 배정
                                <select value={workerId} onChange={() => {}}><option value={workerId}>{workerId}</option></select>
                              </label>
                              <label>승인된 방문 거리 제한 (km)
                                <input min="0.1" max="50" step="0.1" type="number" value={distance} onChange={(event) => setDistance(event.target.value)} required />
                              </label>
                            </>
                          )}
                          <label>결정 사유
                            <textarea value={note} onChange={(event) => setNote(event.target.value)} required />
                          </label>
                          <button className={decision === 'rejected' ? 'reject' : 'approve'} disabled={busy || !decision || !note.trim()} type="submit">
                            {decision === 'rejected' ? '방문 권고 반려 기록' : '방문 권고 승인 기록'}
                          </button>
                        </fieldset>
                      </form>
                    )}
                  </div>
                )}
              </section>
            </div>

            <aside className="center-side">
              <details className="center-map-widget" onToggle={(event) => setMapOpen((event.target as HTMLDetailsElement).open)}>
                <summary><MapPinned aria-hidden="true" size={18} /> 우리 동 지도 열기 (참고용)</summary>
                <p className="center-section-note">지도는 위치 확인 보조 수단입니다. 업무 처리는 왼쪽 목록에서 합니다.</p>
                <div className="center-map-frame">
                  {mapOpen && mapData ? (
                    <MapView
                      data={mapData}
                      metric="age_65_plus_one_person_share_of_age_65_plus_population"
                      showFacilities={false}
                      showTransit={false}
                      showBubbles={false}
                      facilityCategory="전체"
                      selectedZoneId={selectedVisit?.household.location.geometry_zone_id ?? 'vworld_sgis_20250630:23010530'}
                      syntheticPoint={selectedVisit ? {
                        caseId: selectedVisit.household.id,
                        longitude: selectedVisit.household.location.longitude,
                        latitude: selectedVisit.household.location.latitude,
                      } : null}
                      ariaLabel="[합성] 우리 동 케이스 위치 참고 지도"
                      onSelectDong={() => {}}
                    />
                  ) : <p role="status">지도를 열면 우리 동 위치를 확인할 수 있습니다.</p>}
                </div>
              </details>
              <section className="center-side-note" aria-label="처리 원칙">
                <h3>처리 원칙</h3>
                <ul>
                  <li>자동 산출은 전부 제안입니다. 확정은 이 화면의 확인·승인 버튼만 만듭니다.</li>
                  <li>전화 레인과 방문 레인은 분리 운영합니다.</li>
                  <li>이관 권고는 {TRANSFER_TRACK_MESSAGE}</li>
                </ul>
              </section>
            </aside>
          </div>
        </>
      )}
    </main>
  )
}
