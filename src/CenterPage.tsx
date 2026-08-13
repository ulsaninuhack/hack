import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, CalendarDays, CheckCircle2, History, RefreshCw } from 'lucide-react'
import {
  CONTACT_OPS_REFERENCE_DATE,
  ContactOpsClientError,
  loadRecommendations,
  submitDecision,
} from './contactOpsClient'
import type { CaseDetail } from './contactOpsClient'
import {
  ATTENTION_CONTACT_LABELS,
  DEMO_CENTER_DONG_CODE,
  DEMO_WORKER_ID,
  acknowledgeReport,
  confirmAssignment,
  escalateCase,
  loadCaseHistory,
  loadCaseHistorySummary,
  loadCenterCalendar,
  loadCenterInbox,
  managementIntakeLabel,
} from './threeTierClient'
import type {
  AssignmentProposalItem,
  CaseHistory,
  CaseHistorySummary,
  CenterCalendar,
  CenterInbox,
  ReportCard,
} from './threeTierClient'
import { caseDisplayName } from './caseDisplayName'
import { formatScore } from './scoreFormat'

const CENTER_ACTOR = '동센터 담당자'
const CENTER_REFRESH_INTERVAL_MS = 5_000
const TRANSFER_TRACK_MESSAGE = '안부확인 트랙에서 사례관리·전문기관 트랙으로 전환하는 권고입니다. 전환 확정은 별도 행정 절차로 진행합니다.'

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

// 어르신별 과거 기록 아코디언. 열 때 한 번만 불러오고, 요약은 기록보다
// 늦게 도착해도 되도록 따로 채운다(런타임 LLM이 느릴 수 있다).
function CaseHistoryPanel({ caseId }: { caseId: string }) {
  const [history, setHistory] = useState<CaseHistory | null>(null)
  const [summary, setSummary] = useState<CaseHistorySummary | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')

  const open = async () => {
    if (status !== 'idle') return
    setStatus('loading')
    try {
      setHistory(await loadCaseHistory(caseId))
      setStatus('ready')
      void loadCaseHistorySummary(caseId).then(setSummary).catch(() => setSummary(null))
    } catch {
      setStatus('error')
    }
  }

  return (
    <details
      className="case-history"
      onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) void open() }}
    >
      <summary><History aria-hidden="true" size={16} /> 지난 기록</summary>
      {status === 'loading' && <p role="status">지난 기록을 불러오는 중입니다.</p>}
      {status === 'error' && <p role="alert">지난 기록을 불러오지 못했습니다.</p>}
      {status === 'ready' && history !== null && (
        <div className="case-history-body">
          <p className="case-history-summary">
            <span className="case-history-ai-label">{summary?.label ?? '기록 요약'}</span>
            {summary?.summary_text ?? '요약을 만드는 중입니다.'}
          </p>
          <ul className="case-history-entries" aria-label="지난 기록 목록">
            {history.entries.map((entry) => (
              <li key={`${entry.일자}-${entry.출처}`}>
                <span className="case-history-date">{entry.일자}</span>
                <span
                  className="fact-status"
                  data-attention={ATTENTION_CONTACT_LABELS.has(entry.결과_라벨) || undefined}
                >
                  {entry.결과_라벨}
                </span>
                {entry.식사상태 !== null && <span className="case-history-obs">식사 {entry.식사상태}</span>}
                {entry.위생상태 !== null && <span className="case-history-obs">위생 {entry.위생상태}</span>}
                {entry.특이_징후_수 > 0 && <span className="case-history-obs">특이 징후 {entry.특이_징후_수}건</span>}
                <span className="case-history-source">{entry.출처}</span>
              </li>
            ))}
          </ul>
          <p className="case-history-note">{history.source_note}</p>
        </div>
      )}
    </details>
  )
}

const CALENDAR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

// 우리 동 기록 캘린더. 참조 월의 일자별 기록 수를 보여주고, 날짜를 누르면
// 그날의 기록 목록을 펼친다.
function CenterCalendarPanel({ month }: { month: string }) {
  const [calendar, setCalendar] = useState<CenterCalendar | null>(null)
  const [failed, setFailed] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadCenterCalendar({ month })
      .then((next) => { if (active) setCalendar(next) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [month])

  const dayMap = useMemo(
    () => new Map((calendar?.days ?? []).map((day) => [day.일자, day])),
    [calendar],
  )
  const [year, monthNumber] = month.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const selected = selectedDay === null ? null : dayMap.get(selectedDay) ?? null

  return (
    <section className="center-calendar" aria-label="우리 동 기록 캘린더">
      <h3><CalendarDays aria-hidden="true" size={18} /> 기록 캘린더 · {year}년 {monthNumber}월</h3>
      {failed && <p role="alert">기록 캘린더를 불러오지 못했습니다.</p>}
      {!failed && calendar === null && <p role="status">기록을 불러오는 중입니다.</p>}
      {!failed && calendar !== null && (
        <>
          <div className="calendar-grid">
            {CALENDAR_WEEKDAYS.map((weekday) => <span key={weekday} className="calendar-weekday">{weekday}</span>)}
            {Array.from({ length: firstWeekday }, (_, index) => <span key={`pad-${index}`} className="calendar-empty" />)}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const iso = `${month}-${String(index + 1).padStart(2, '0')}`
              const info = dayMap.get(iso)
              return (
                <button
                  key={iso}
                  className="calendar-day"
                  data-selected={selectedDay === iso || undefined}
                  data-has-records={info !== undefined || undefined}
                  onClick={() => setSelectedDay(selectedDay === iso ? null : iso)}
                  aria-label={`${iso} 기록 ${info?.기록_수 ?? 0}건`}
                >
                  <span className="calendar-day-number">{index + 1}</span>
                  {info !== undefined && (
                    <span className="calendar-count" data-attention={info.미응답_수 > 0 || undefined}>{info.기록_수}</span>
                  )}
                </button>
              )
            })}
          </div>
          {selected !== null ? (
            <ul className="calendar-day-list" aria-label={`${selected.일자} 기록 목록`}>
              {selected.사례.map((entry) => (
                <li key={entry.case_id}>
                  <span className="case-id">{entry.display_name} 어르신</span>
                  <span
                    className="fact-status"
                    data-attention={ATTENTION_CONTACT_LABELS.has(entry.결과_라벨) || undefined}
                  >
                    {entry.결과_라벨}
                  </span>
                  <span className="case-history-source">{entry.출처}</span>
                </li>
              ))}
            </ul>
          ) : <p className="calendar-hint">날짜를 누르면 그날의 기록이 보입니다.</p>}
          <p className="calendar-note">{calendar.source_note}</p>
        </>
      )}
    </section>
  )
}

function ProposalRow({
  item,
  onConfirm,
  onEscalate,
  busy,
}: {
  item: AssignmentProposalItem
  onConfirm: (caseId: string) => void
  onEscalate: (caseId: string) => void
  busy: boolean
}) {
  return (
    <li className="assignment-row" data-lane={item.lane}>
      <div className="assignment-row-main">
        <span className="case-id">{item.display_name} 어르신</span>
        <GradeChip grade={item.급성도_등급} />
        <span className="assignment-worker">{item.worker_display_name ?? '담당 미배정'}</span>
      </div>
      <p className="assignment-address">{item.road_address ?? '주소 정보 없음'}</p>
      {item.lane === 'phone' && <div className="selection-reasons" aria-label="전화 대상 선정 사유">
        {item.selection_reason_labels.map((label) => <span key={label}>{label}</span>)}
      </div>}
      {item.lane === 'visit' && <p className="mobile-acute-summary">급성도 {formatScore(item.급성도_점수, '기록 없음')}{item.급성도_점수 === null ? '' : '점'} · {item.급성도_등급 ?? '등급 기록 없음'}</p>}
      <dl className="assignment-facts">
        <div className="assignment-fact">
          <dt>마지막 연락</dt>
          <dd>
            {item.last_contact.date === null ? '기록 없음' : (
              <>
                {item.last_contact.date}
                <span
                  className="fact-status"
                  data-attention={ATTENTION_CONTACT_LABELS.has(item.last_contact.result_label) || undefined}
                >
                  {item.last_contact.result_label}
                </span>
              </>
            )}
          </dd>
        </div>
        {item.lane === 'phone' && item.earliest_due_date !== null && (
          <div className="assignment-fact">
            <dt>연락 기한</dt>
            <dd>{item.earliest_due_date}</dd>
          </div>
        )}
        {item.lane === 'phone' && <>
          <div className="assignment-fact"><dt>등록 근거</dt><dd>{item.management_entry ? managementIntakeLabel(item.management_entry.intake_channel) : '기록 확인 필요'}</dd></div>
        </>}
      </dl>
      {item.lane === 'visit' && item.급성도_기여내역.length > 0 && <ul className="mobile-acute-contributions" aria-label="급성도 주요 기여내역">
        {item.급성도_기여내역.map((entry) => <li key={entry.코드}>{entry.근거} · +{formatScore(entry.가산점)}점</li>)}
      </ul>}
      {item.adjustment_flags.length > 0 && (
        <p className="assignment-flags" role="note">조정 필요: {item.adjustment_flags.map((flag) => ({
          no_worker_for_dong: '담당 연결단원 없음',
          time_window_mismatch: '시간창 불일치',
          capacity_exceeded: '일일 방문 용량 초과',
        }[flag] ?? flag)).join(' · ')}</p>
      )}
      <CaseHistoryPanel caseId={item.case_id} />
      {item.lane === 'phone'
        ? <p className="assignment-confirmed assignment-auto"><CheckCircle2 aria-hidden="true" size={17} /> 자동 배정됨</p>
        : item.escalation
          ? <p className="assignment-escalated"><AlertTriangle aria-hidden="true" size={17} /> 상급기관 신고됨 · {item.escalation.agency}</p>
          : item.status === 'confirmed'
            ? <p className="assignment-confirmed"><CheckCircle2 aria-hidden="true" size={17} /> 방문 확인됨 · {item.confirmed_by}</p>
            : (
              <div className="assignment-actions">
                <button className="confirm-one" disabled={busy} onClick={() => onConfirm(item.case_id)}>확인</button>
                <button className="escalate-one" disabled={busy} onClick={() => onEscalate(item.case_id)}>신고</button>
              </div>
            )}
    </li>
  )
}

function ReportCardView({
  card,
  onAcknowledge,
  onEscalate,
  busy,
  collapsible = false,
}: {
  card: ReportCard
  onAcknowledge: (card: ReportCard) => void
  onEscalate: (caseId: string) => void
  busy: boolean
  collapsible?: boolean
}) {
  const [showTransfer, setShowTransfer] = useState(false)
  const heading = (
    <>
        <GradeChip grade={card.등급} />
        <span className="case-id">{card.display_name} 어르신</span>
        <span className="report-meta">{card.evidence.마지막_연락_결과_라벨} · {card.evidence.마지막_연락_일자 ?? '기록 없음'}</span>
    </>
  )
  const cardBody = (
    <>
      {card.road_address !== null && <p className="report-address">{card.road_address}</p>}
      <dl className="report-scores">
        <div><dt>급성도</dt><dd>{formatScore(card.급성도_점수)}</dd></div>
        <div><dt>취약도</dt><dd>{formatScore(card.취약도_점수)}</dd></div>
      </dl>
      <section className="report-reasons">
        <h4>사유</h4>
        <ul>{card.사유_요약.map((reason) => <li key={`${reason.축}-${reason.근거}`}>{reason.축} · {reason.근거} · {formatScore(reason.가산점)}점</li>)}</ul>
      </section>
      <section className="report-agencies">
        <h4>권고 기관</h4>
        {card.권고_기관.length === 0 ? <p>권고할 기관 신호가 없습니다.</p> : (
          <ul>{card.권고_기관.map((agency) => <li key={agency.기관}><strong>{agency.기관}</strong><span>{agency.사유}</span></li>)}</ul>
        )}
      </section>
      <details className="report-evidence">
        <summary>관찰 근거</summary>
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
      <CaseHistoryPanel caseId={card.case_id} />
      <footer className="report-actions">
        {card.acknowledgement.status === '확인'
          ? <p className="report-acknowledged"><CheckCircle2 aria-hidden="true" size={17} /> 확인함 · {card.acknowledgement.acknowledged_by}</p>
          : <button disabled={busy} onClick={() => onAcknowledge(card)}>보고 확인</button>}
        {card.workflow.visit_approval_status === 'recommended' && (
          <a className="report-jump" href={`/center/visit-review/${encodeURIComponent(card.case_id)}`}>방문 승격 검토</a>
        )}
        {card.escalation
          ? <p className="assignment-escalated"><AlertTriangle aria-hidden="true" size={17} /> 기관 연락됨 · {card.escalation.agency}</p>
          : <button className="report-escalate" disabled={busy} onClick={() => onEscalate(card.case_id)}>기관 연락</button>}
        {card.workflow.transfer_label && (
          <button className="report-transfer-toggle" onClick={() => setShowTransfer((value) => !value)} aria-expanded={showTransfer}>이관 안내</button>
        )}
      </footer>
      {showTransfer && <p className="report-transfer-note" role="note">{TRANSFER_TRACK_MESSAGE}</p>}
    </>
  )

  const article = (
    <article className="report-card" data-grade={card.등급} aria-label={`${card.display_name} 어르신 보고 카드`}>
      {!collapsible && <header>{heading}</header>}
      {cardBody}
    </article>
  )

  return collapsible ? (
    <details className="report-accordion" data-grade={card.등급}>
      <summary>{heading}<span className="report-accordion-score">급성도 {formatScore(card.급성도_점수)}</span></summary>
      {article}
    </details>
  ) : article
}

export function CenterPage({ reviewCaseId = null }: { reviewCaseId?: string | null }) {
  const [inbox, setInbox] = useState<CenterInbox | null>(null)
  const [recommendations, setRecommendations] = useState<CaseDetail[]>([])
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(reviewCaseId)
  const [lane, setLane] = useState<'phone' | 'visit'>('phone')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = useState('')

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
      setSelectedVisitId((current) => {
        if (reviewCaseId !== null) {
          return dongRecommendations.some((item) => item.household.id === reviewCaseId) ? reviewCaseId : null
        }
        return dongRecommendations.some((item) => item.household.id === current)
          ? current
          : dongRecommendations[0]?.household.id ?? null
      })
    } catch (cause) {
      setError(errorText(cause, '동 행정복지센터 인박스를 불러오지 못했습니다.'))
    } finally {
      setLoading(false)
    }
  }, [reviewCaseId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    let syncing = false
    const syncWhenVisible = () => {
      if (document.visibilityState !== 'visible' || syncing) return
      syncing = true
      void refresh().finally(() => { syncing = false })
    }
    const intervalId = window.setInterval(syncWhenVisible, CENTER_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', syncWhenVisible)
    document.addEventListener('visibilitychange', syncWhenVisible)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', syncWhenVisible)
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [refresh])

  const proposal = inbox?.assignment_proposal ?? null
  const phoneReports = useMemo(() => (inbox?.report_cards ?? []).filter((card) => card.report_lane !== 'visit'), [inbox])
  const visitReports = useMemo(() => (inbox?.report_cards ?? []).filter((card) => card.report_lane === 'visit'), [inbox])
  // 상급기관에 신고한 어르신은 방문 확인 목록에서 빼고 아래 신고됨 칸으로
  // 옮긴다. 신고 이력은 보고 카드의 '기관 연락됨' 상태로도 남는다.
  const laneItems = useMemo(() => {
    const items = proposal?.lanes[lane] ?? []
    return lane === 'visit' ? items.filter((item) => !item.escalation) : items
  }, [proposal, lane])
  const escalatedVisits = useMemo(
    () => (proposal?.lanes.visit ?? []).filter((item) => item.escalation),
    [proposal],
  )
  const pendingVisitIds = useMemo(() => (proposal?.lanes.visit ?? [])
    .filter((item) => item.status !== 'confirmed' && !item.escalation)
    .map((item) => item.case_id), [proposal])
  const selectedVisit = recommendations.find((item) => item.household.id === selectedVisitId) ?? null
  const selectedVisitReport = inbox?.report_cards.find((card) => card.case_id === selectedVisitId) ?? null
  const displayNameForCase = (caseId: string) => {
    const reportName = inbox?.report_cards.find((card) => card.case_id === caseId)?.display_name
    if (reportName) return reportName
    const assignment = inbox?.assignment_proposal
    return [...(assignment?.lanes.phone ?? []), ...(assignment?.lanes.visit ?? [])]
      .find((item) => item.case_id === caseId)?.display_name ?? caseDisplayName(caseId)
  }
  const selectedVisitDisplayName = selectedVisit ? displayNameForCase(selectedVisit.household.id) : ''
  const workerId = DEMO_WORKER_ID

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
    '방문 1건을 확인했습니다. 조사원 방문 목록에 반영됩니다.',
    '방문을 확인하지 못했습니다.',
  )
  const confirmAllVisits = (caseIds: string[]) => act(
    async () => { await confirmAssignment({ dongCode: DEMO_CENTER_DONG_CODE, referenceDate: CONTACT_OPS_REFERENCE_DATE, confirmedBy: CENTER_ACTOR, caseIds }) },
    '오늘 방문을 일괄 확인했습니다. 조사원 방문 목록에 반영됩니다.',
    '오늘 방문을 확인하지 못했습니다.',
  )
  const escalateOne = (caseId: string) => act(
    async () => { await escalateCase({ caseId, reportedBy: CENTER_ACTOR }) },
    '상급기관에 신고했습니다. 해당 방문은 조사원 배정에서 제외됩니다.',
    '상급기관 신고를 기록하지 못했습니다.',
  )
  const acknowledge = (card: ReportCard) => act(
    async () => { await acknowledgeReport({ caseId: card.case_id, revision: card.revision, acknowledgedBy: CENTER_ACTOR }) },
    '보고 카드를 확인했습니다.',
    '보고 카드를 확인하지 못했습니다.',
  )

  const submitVisitDecision = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedVisit || !decision || !note.trim()) return
    await act(
      async () => {
        await submitDecision({
          caseId: selectedVisit.household.id,
          revision: selectedVisit.revision,
          decision,
          note: note.trim(),
          ...(decision === 'approved' ? { workerIds: [workerId] } : {}),
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
      <header className="center-header">
        <h1>{inbox?.dong_name ?? '신포동'} 행정복지센터</h1>
        <nav aria-label="3계층 화면 이동">
          <a href="/m">조사원</a>
          <a href="/city">시·구</a>
          <a href="/">지도</a>
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
      {loading && !inbox && <p className="ops-state" role="status">불러오는 중입니다.</p>}

      {inbox && reviewCaseId !== null && (
        <section className="center-review-page" aria-labelledby="center-review-title">
          <a className="center-review-back" href="/center" aria-label="센터 업무로 돌아가기">← 센터 업무로 돌아가기</a>
          <div className="center-review-heading">
            <div>
              <span>{inbox.district} {inbox.dong_name}</span>
              <h2 id="center-review-title">방문 승격 검토</h2>
            </div>
            {selectedVisit && <GradeChip grade={selectedVisit.triage?.급성도_등급 ?? selectedVisitReport?.등급 ?? null} />}
          </div>

          {selectedVisit === null ? (
            <div className="ops-empty center-review-empty">
              <p>이미 처리되었거나 현재 검토 목록에 없는 대상입니다.</p>
              <a href="/center">센터 업무 목록 확인</a>
            </div>
          ) : (
            <div className="center-review-grid">
              <article className="center-review-context" aria-label={`${selectedVisitDisplayName} 어르신 방문 승격 근거`}>
                <header>
                  <div>
                    <span className="center-review-kicker">검토 대상</span>
                    <h3>{selectedVisitDisplayName} 어르신</h3>
                  </div>
                  <div className="center-review-scores" aria-label="급성도와 취약도">
                    <span>급성도 <strong>{formatScore(selectedVisit.triage?.급성도_점수)}</strong></span>
                    <span>취약도 <strong>{formatScore(selectedVisit.triage?.취약도_점수)}</strong></span>
                  </div>
                </header>
                <p className="center-review-address">{selectedVisitReport?.road_address ?? selectedVisit.household.location.road_address}</p>
                {selectedVisitReport && (
                  <dl className="center-review-contact">
                    <div><dt>최근 결과</dt><dd>{selectedVisitReport.evidence.마지막_연락_결과_라벨}</dd></div>
                    <div><dt>확인 일자</dt><dd>{selectedVisitReport.evidence.마지막_연락_일자 ?? '기록 없음'}</dd></div>
                  </dl>
                )}
                <section className="center-review-evidence">
                  <h4>판단 근거</h4>
                  {selectedVisit.triage?.점수_기여내역.length ? (
                    <ul>{selectedVisit.triage.점수_기여내역.map((entry) => (
                      <li key={`${entry.축}-${entry.코드 ?? entry.근거}`}>
                        <span>{entry.근거}</span><strong>+{formatScore(entry.가산점)}점</strong>
                      </li>
                    ))}</ul>
                  ) : <p>기록된 점수 근거가 없습니다.</p>}
                </section>
                <section className="center-review-observations">
                  <h4>확인된 내용</h4>
                  <dl>
                    <div><dt>연속 미응답</dt><dd>{selectedVisitReport?.evidence.연속_미응답_횟수 ?? 0}회</dd></div>
                    <div><dt>식사 상태</dt><dd>{selectedVisit.observations.식사상태 ?? '확인하지 못함'}</dd></div>
                    <div><dt>위생 상태</dt><dd>{selectedVisit.observations.위생상태 ?? '확인하지 못함'}</dd></div>
                    <div><dt>관계망</dt><dd>{selectedVisit.observations.관계망_유무 ?? '확인하지 못함'}</dd></div>
                  </dl>
                </section>
                {selectedVisitReport && selectedVisitReport.권고_기관.length > 0 && (
                  <section className="center-review-agencies">
                    <h4>연계 검토</h4>
                    <ul>{selectedVisitReport.권고_기관.map((agency) => (
                      <li key={agency.기관}><strong>{agency.기관}</strong><span>{agency.사유}</span></li>
                    ))}</ul>
                  </section>
                )}
              </article>

              <form className="ops-form center-review-decision" onSubmit={submitVisitDecision}>
                <fieldset>
                  <legend>담당자 결정</legend>
                  <label className="ops-choice"><input checked={decision === 'approved'} onChange={() => setDecision('approved')} type="radio" name="center-review-decision" /><span>방문 권고 승인</span></label>
                  <label className="ops-choice"><input checked={decision === 'rejected'} onChange={() => setDecision('rejected')} type="radio" name="center-review-decision" /><span>방문 권고 반려</span></label>
                  {decision === 'approved' && (
                    <label>연결단원 배정
                      <select value={workerId} onChange={() => {}}><option value={workerId}>{inbox.assignment_proposal?.worker_display_name ?? '연결단원 001'}</option></select>
                    </label>
                  )}
                  <label>결정 사유
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} required placeholder="확인한 근거와 결정 내용을 입력하세요." />
                  </label>
                  <button className={decision === 'rejected' ? 'reject' : 'approve'} disabled={busy || !decision || !note.trim()} type="submit">
                    {decision === 'rejected' ? '방문 권고 반려 기록' : '방문 권고 승인 기록'}
                  </button>
                </fieldset>
              </form>
            </div>
          )}
        </section>
      )}

      {inbox && reviewCaseId === null && (
        <>
          <section className="center-hero" aria-label="오늘 처리 요약과 다음 행동">
            <div className="center-hero-lead">
              <span className="center-hero-date">{inbox.reference_date} · {inbox.district} {inbox.dong_name}</span>
              <strong className="center-hero-count">오늘 처리할 일 {inbox.summary.보고_대기_수 + inbox.summary.방문승인_대기_수}건</strong>
            </div>
            <div className="center-hero-pills">
              <a href="#center-reports"><strong>{phoneReports.filter((card) => card.acknowledgement.status !== '확인' && !card.escalation).length}건</strong><span>전화 확인 대기</span></a>
              <a href="#center-visit-reports"><strong>{visitReports.filter((card) => card.acknowledgement.status !== '확인' && !card.escalation).length}건</strong><span>방문 확인 대기</span></a>
              <a href="#center-assignment"><strong>{(proposal?.lanes.visit.length ?? 0) === 0 ? '없음' : pendingVisitIds.length === 0 ? '완료' : `대기 ${pendingVisitIds.length}건`}</strong><span>방문 배정</span></a>
              <a href={recommendations[0] ? `/center/visit-review/${encodeURIComponent(recommendations[0].household.id)}` : '#center-visit-review'}><strong>{inbox.summary.방문승인_대기_수}건</strong><span>방문 승격 대기</span></a>
              <div
                className="center-hero-ring"
                role="img"
                aria-label={`보고 처리 완료율 ${inbox.summary.처리_완료율_pct ?? 0}%`}
                style={{ '--ring': String(inbox.summary.처리_완료율_pct ?? 0) } as React.CSSProperties}
              >
                <span>{inbox.summary.처리_완료율_pct ?? 0}%</span>
                <small>처리율</small>
              </div>
            </div>
          </section>

          <div className="center-columns">
            <div className="center-main">
              <section id="center-assignment" className="center-section" aria-labelledby="assignment-heading">
                <h2 id="assignment-heading">오늘 배치</h2>
                <p className="assignment-rule-note">전화는 자동 배정됩니다. 방문은 확인 또는 상급기관 신고로 처리합니다. 모든 대상은 연락 동의 기록과 정기 안부확인 중복 확인을 마친 관리 대상입니다.</p>
                {proposal === null ? <p className="ops-empty">오늘 예정된 배치 제안이 없습니다.</p> : (
                  <>
                    <div className="lane-tabs" role="tablist" aria-label="전화 레인과 방문 레인">
                      <button role="tab" aria-selected={lane === 'phone'} onClick={() => setLane('phone')}>전화 {proposal.lanes.phone.length}</button>
                      <button role="tab" aria-selected={lane === 'visit'} onClick={() => setLane('visit')}>방문 {proposal.lanes.visit.length - escalatedVisits.length}</button>
                    </div>
                    <ul className="assignment-list" aria-label={lane === 'phone' ? '전화 레인 할당 제안' : '방문 레인 할당 제안'}>
                      {laneItems.length === 0 ? <li className="ops-empty">이 레인에는 오늘 제안이 없습니다.</li>
                        : laneItems.map((item) => <ProposalRow key={item.case_id} item={item} onConfirm={confirmOne} onEscalate={escalateOne} busy={busy} />)}
                    </ul>
                    {lane === 'visit' && escalatedVisits.length > 0 && (
                      <section className="escalated-box" aria-labelledby="escalated-heading">
                        <h3 id="escalated-heading"><AlertTriangle aria-hidden="true" size={16} /> 상급기관 신고됨 {escalatedVisits.length}건</h3>
                        <ul className="escalated-list" aria-label="상급기관 신고 목록">
                          {escalatedVisits.map((item) => (
                            <li key={item.case_id}>
                              <span className="case-id">{item.display_name} 어르신</span>
                              <GradeChip grade={item.급성도_등급} />
                              <span className="escalated-meta">{item.escalation!.agency} · {item.escalation!.reported_at.slice(0, 10)}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="assignment-escalated-note">신고한 어르신은 방문 목록에서 제외되며, 후속 처리는 신고 기관이 담당합니다.</p>
                      </section>
                    )}
                    {lane === 'visit' && pendingVisitIds.length > 0 && (
                      <button className="confirm-all" disabled={busy} onClick={() => confirmAllVisits(pendingVisitIds)}>오늘 방문 일괄 확인</button>
                    )}
                    {lane === 'visit' && proposal.lanes.visit.length > 0 && pendingVisitIds.length === 0 && (
                      <p className="assignment-confirmed" role="status">오늘 방문이 모두 처리되었습니다. 확인된 방문은 조사원 목록에 반영됩니다.</p>
                    )}
                  </>
                )}
              </section>

              <section id="center-reports" className="center-section" aria-labelledby="reports-heading">
                <h2 id="reports-heading">전화 확인</h2>
                {phoneReports.length === 0
                  ? <p className="ops-empty">아직 도착한 전화 보고가 없습니다.</p>
                  : phoneReports.map((card) => (
                    <ReportCardView key={card.card_id} card={card} onAcknowledge={acknowledge} onEscalate={escalateOne} busy={busy} collapsible />
                  ))}
              </section>

              <section id="center-visit-reports" className="center-section" aria-labelledby="visit-reports-heading">
                <h2 id="visit-reports-heading">방문 확인</h2>
                 {visitReports.length === 0
                   ? <p className="ops-empty">아직 도착한 방문 보고가 없습니다.</p>
                   : visitReports.map((card) => (
                     <ReportCardView key={card.card_id} card={card} onAcknowledge={acknowledge} onEscalate={escalateOne} busy={busy} />
                   ))}
               </section>

              <section id="center-visit-review" className="center-section" aria-labelledby="visit-review-heading">
                <h2 id="visit-review-heading">방문 승격 대기</h2>
                {recommendations.length === 0 ? <p className="ops-empty">현재 승격 대기인 대상이 없습니다.</p> : (
                  <ul className="visit-review-list" aria-label="방문 권고 대기 목록">
                    {recommendations.map((item) => (
                      <li key={item.household.id}>
                        <a href={`/center/visit-review/${encodeURIComponent(item.household.id)}`}>
                          <span className="case-id">{displayNameForCase(item.household.id)} 어르신</span>
                          <span>급성도 {formatScore(item.triage?.급성도_점수)} · 취약도 {formatScore(item.triage?.취약도_점수)}</span>
                          <strong>검토하기 →</strong>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className="center-side">
              <CenterCalendarPanel month={CONTACT_OPS_REFERENCE_DATE.slice(0, 7)} />
            </aside>
          </div>
        </>
      )}
    </main>
  )
}
