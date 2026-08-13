import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, MapPinned, Mic, Phone, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import MapView from './MapView'
import { loadData } from './data'
import type { DataBundle } from './types'
import {
  ContactOpsClientError,
  emptyObservations,
  submitContact,
} from './contactOpsClient'
import type { CanonicalObservations, ContactResultLabel } from './contactOpsClient'
import {
  ATTENTION_CONTACT_LABELS,
  contactResultLabelFromCode,
  loadReportCard,
  loadTodayLanes,
  managementIntakeLabel,
  uploadVoiceObservationAudio,
} from './threeTierClient'
import type { LaneItem, ReportCard, TodayLanes, VoiceCandidate } from './threeTierClient'
import { createAiObservationCandidate } from './AiObservationClient'
import { formatScore } from './scoreFormat'
import { buildGuestInviteUrl, createLiveCall, type LiveCallCredentials, type LiveCallJoin } from './liveCallClient'
import { LiveCallPanel } from './LiveCallPanel'

const CONTACT_LABELS: ContactResultLabel[] = [
  '안부 확인 완료', '우려 사항 있음', '미응답', '연락(또는 방문) 거부', '연락처 확인 필요',
]

const SIGN_FIELDS: Array<{ key: keyof CanonicalObservations['관찰_6징후']; label: string }> = [
  { key: '우편물_고지서_적체', label: '우편물·고지서 적체' },
  { key: '악취_벌레', label: '악취·벌레' },
  { key: '쓰레기_술병', label: '쓰레기·술병' },
  { key: '인기척_없이_TV_불', label: '인기척 없이 TV·불 켜짐' },
  { key: '외출_없음', label: '최근 외출 없음' },
  { key: '연락_두절', label: '주변에서 확인한 연락 두절' },
]

type Step = 'list' | 'case' | 'done'
type InputPath = 'live' | 'memo' | 'voice' | 'chat' | 'manual'

interface ChatQuestion {
  id: string
  prompt: string
  options: string[]
  apply: (answer: string, draft: { resultLabel: ContactResultLabel | ''; observations: CanonicalObservations }) => void
}

// 결정론 문답 챗봇: 후보만 채운다. 확정은 조사원이 체크리스트에서 한다(INV14).
const CHAT_QUESTIONS: ChatQuestion[] = [
  {
    id: 'result',
    prompt: '통화(또는 방문) 결과는 무엇이었나요?',
    options: [...CONTACT_LABELS],
    apply: (answer, draft) => { draft.resultLabel = answer as ContactResultLabel },
  },
  {
    id: 'meal',
    prompt: '식사는 어떻게 하고 계셨나요?',
    options: ['양호', '불량', '심각', '확인하지 못함'],
    apply: (answer, draft) => {
      draft.observations.식사상태 = answer === '확인하지 못함' ? null : (answer as CanonicalObservations['식사상태'])
    },
  },
  {
    id: 'hygiene',
    prompt: '위생 상태는 어땠나요?',
    options: ['양호', '불량', '확인하지 못함'],
    apply: (answer, draft) => {
      draft.observations.위생상태 = answer === '확인하지 못함' ? null : (answer as CanonicalObservations['위생상태'])
    },
  },
  {
    id: 'distress',
    prompt: '최근 건강이나 마음의 괴로움이 관찰되었나요?',
    options: ['관찰됨', '해당 없음', '확인하지 못함'],
    apply: (answer, draft) => {
      draft.observations.최근_건강_정신_괴로움 = answer === '확인하지 못함' ? null : answer === '관찰됨'
    },
  },
  {
    id: 'network',
    prompt: '도움을 요청할 사람이나 기관이 있으신가요?',
    options: ['있음', '없음', '확인하지 못함'],
    apply: (answer, draft) => {
      draft.observations.관계망_유무 = answer === '확인하지 못함' ? null : (answer as CanonicalObservations['관계망_유무'])
    },
  },
]

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof ContactOpsClientError && cause.code === 'STATE_CONFLICT') {
    return '다른 화면에서 먼저 저장했습니다. 목록으로 돌아가 다시 열어 주세요.'
  }
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function LaneBadge({ item }: { item: LaneItem }) {
  return <span className="grade-chip" data-grade={item.급성도_등급 ?? '미기록'}>{item.급성도_등급 ?? '미기록'}</span>
}

function assignmentStatusLabel(item: LaneItem) {
  if (item.lane === 'visit') return item.assignment_status === 'confirmed' ? '오늘 방문 할당 확정' : '오늘 방문 배치 제안'
  return item.assignment_status === 'confirmed' ? '오늘 전화 할당 확정' : '오늘 전화 배치 제안'
}

function ManagementEntrySummary({ item }: { item: LaneItem }) {
  // 연락 동의·중복 확인 문구는 모든 대상에 동일하므로 목록에서 반복하지
  // 않는다. 상세 화면의 관리 확인 항목에만 남긴다.
  return <span className="mobile-task-meta">등록 근거 · {item.management_entry ? managementIntakeLabel(item.management_entry.intake_channel) : '기록 확인 필요'}</span>
}

function AcuteContributionList({ item }: { item: LaneItem }) {
  const contributions = item.급성도_기여내역.slice(0, 3)
  if (contributions.length === 0) return null
  return <section className="mobile-acute-contributions" aria-label="급성도 주요 기여내역">
    <h3>급성도 주요 기여내역</h3>
    <ul>{contributions.map((entry) => (
      <li key={entry.코드}>
        <span className="acute-reason">{entry.근거}</span>
        <strong className="acute-points">+{formatScore(entry.가산점)}점</strong>
      </li>
    ))}</ul>
  </section>
}

export function MobilePage() {
  const [step, setStep] = useState<Step>('list')
  const [lane, setLane] = useState<'phone' | 'visit'>('phone')
  const [lanesData, setLanesData] = useState<TodayLanes | null>(null)
  const [selected, setSelected] = useState<LaneItem | null>(null)
  const [inputPath, setInputPath] = useState<InputPath | null>(null)
  const [resultLabel, setResultLabel] = useState<ContactResultLabel | ''>('')
  const [observations, setObservations] = useState<CanonicalObservations>(emptyObservations)
  const [candidateNote, setCandidateNote] = useState<string | null>(null)
  const [memoText, setMemoText] = useState('')
  const [candidateFreeText, setCandidateFreeText] = useState<string | null>(null)
  const [criticWarnings, setCriticWarnings] = useState<string[]>([])
  const [nextQuestion, setNextQuestion] = useState<string | null>(null)
  const [chatIndex, setChatIndex] = useState(0)
  const [chatLog, setChatLog] = useState<Array<{ prompt: string; answer: string }>>([])
  const [showDial, setShowDial] = useState(false)
  const [reportCard, setReportCard] = useState<ReportCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [visitMapOpen, setVisitMapOpen] = useState(false)
  const [mapData, setMapData] = useState<DataBundle | null>(null)
  const [liveCallCredentials, setLiveCallCredentials] = useState<LiveCallCredentials | null>(null)
  const [liveInviteUrl, setLiveInviteUrl] = useState<string | null>(null)
  const [liveCandidate, setLiveCandidate] = useState<VoiceCandidate | null>(null)
  const [liveCandidatePending, setLiveCandidatePending] = useState(false)
  const [liveCandidateError, setLiveCandidateError] = useState<string | null>(null)
  const liveCandidateRef = useRef<VoiceCandidate | null>(null)
  const liveCandidateTimerRef = useRef<number | null>(null)
  const liveCandidateGenerationRef = useRef(0)

  useEffect(() => {
    if (!visitMapOpen || mapData) return
    let active = true
    void loadData().then((bundle) => { if (active) setMapData(bundle) }).catch(() => {
      // 지도는 방문 보조 수단이다. 실패해도 주소·목록 흐름은 계속된다.
    })
    return () => { active = false }
  }, [visitMapOpen, mapData])

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setLanesData(await loadTodayLanes())
    } catch (cause) {
      setError(errorText(cause, '오늘 목록을 불러오지 못했습니다.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const invalidateLiveCandidateWork = useCallback(() => {
    liveCandidateGenerationRef.current += 1
    if (liveCandidateTimerRef.current !== null) {
      window.clearTimeout(liveCandidateTimerRef.current)
      liveCandidateTimerRef.current = null
    }
  }, [])

  useEffect(() => () => invalidateLiveCandidateWork(), [invalidateLiveCandidateWork])

  const resetLiveCandidate = useCallback(() => {
    invalidateLiveCandidateWork()
    liveCandidateRef.current = null
    setLiveCandidate(null)
    setLiveCandidatePending(false)
    setLiveCandidateError(null)
  }, [invalidateLiveCandidateWork])

  const scheduleLiveCandidate = useCallback((transcript: string) => {
    if (!selected || !transcript.trim()) return
    const generation = liveCandidateGenerationRef.current + 1
    liveCandidateGenerationRef.current = generation
    if (liveCandidateTimerRef.current !== null) window.clearTimeout(liveCandidateTimerRef.current)
    setLiveCandidatePending(true)
    setLiveCandidateError(null)
    liveCandidateTimerRef.current = window.setTimeout(() => {
      liveCandidateTimerRef.current = null
      void createAiObservationCandidate({
        caseId: selected.case_id,
        revision: selected.revision,
        source: { kind: 'text', text: transcript },
      }).then((response) => {
        if (generation !== liveCandidateGenerationRef.current) return
        liveCandidateRef.current = response.candidate
        setLiveCandidate(response.candidate)
        setLiveCandidatePending(false)
      }).catch(() => {
        if (generation !== liveCandidateGenerationRef.current) return
        setLiveCandidatePending(false)
        setLiveCandidateError('체크리스트 후보를 갱신하지 못했습니다. 자막과 통화는 계속됩니다.')
      })
    }, 700)
  }, [selected])

  const items = useMemo(() => lanesData?.lanes[lane] ?? [], [lanesData, lane])

  const openCase = (item: LaneItem) => {
    setSelected(item)
    setStep('case')
    setVisitMapOpen(false)
    setInputPath(null)
    setResultLabel('')
    setObservations(emptyObservations())
    setCandidateNote(null)
    setCandidateFreeText(null)
    setMemoText('')
    setCriticWarnings([])
    setNextQuestion(null)
    setChatIndex(0)
    setChatLog([])
    setShowDial(false)
    setLiveCallCredentials(null)
    setLiveInviteUrl(null)
    resetLiveCandidate()
  }

  const applyCandidate = (
    candidate: Pick<VoiceCandidate, 'contact_result' | 'observations' | 'free_text' | 'critic'>,
    note: string,
  ) => {
    setObservations(candidate.observations)
    setResultLabel(contactResultLabelFromCode(candidate.contact_result))
    setCandidateNote(note)
    setCandidateFreeText(candidate.free_text.trim() || null)
    setCriticWarnings([
      ...candidate.critic.contradictions,
      ...candidate.critic.warnings,
      ...candidate.critic.missing_fields.map((field) => `누락 확인: ${field}`),
    ])
    setNextQuestion(candidate.critic.next_question)
  }

  const startLiveCall = async () => {
    if (!selected) return
    try {
      setBusy(true)
      setError(null)
      setInputPath('live')
      resetLiveCandidate()
      const credentials = await createLiveCall({ caseId: selected.case_id, revision: selected.revision })
      setLiveCallCredentials(credentials)
      setLiveInviteUrl(buildGuestInviteUrl(credentials))
    } catch (cause) {
      setInputPath(null)
      setError(errorText(cause, '실시간 통화를 시작하지 못했습니다. 음성 파일이나 직접 입력을 사용할 수 있습니다.'))
    } finally {
      setBusy(false)
    }
  }

  const finishLiveCall = async (transcript: string) => {
    if (!selected) return
    try {
      setBusy(true)
      setError(null)
      invalidateLiveCandidateWork()
      const current = liveCandidateRef.current
      const candidate = current?.transcript === transcript
        ? current
        : (await createAiObservationCandidate({
            caseId: selected.case_id,
            revision: selected.revision,
            source: { kind: 'text', text: transcript },
          })).candidate
      applyCandidate(
        candidate,
        '실시간 통화에서 만든 후보입니다. 아래 체크리스트를 확인하고 고친 뒤 제출해 주세요.',
      )
      setLiveCallCredentials(null)
      setLiveInviteUrl(null)
      resetLiveCandidate()
      setInputPath('manual')
    } catch (cause) {
      setLiveCandidatePending(false)
      setError(errorText(cause, '통화 내용에서 체크리스트 후보를 만들지 못했습니다. 음성 파일이나 직접 입력을 사용할 수 있습니다.'))
    } finally {
      setBusy(false)
    }
  }

  const liveHostJoin: LiveCallJoin | null = liveCallCredentials ? {
    callId: liveCallCredentials.call_id,
    serverUrl: liveCallCredentials.server_url,
    participantToken: liveCallCredentials.host.participant_token,
    expiresAt: liveCallCredentials.expires_at,
    role: 'surveyor',
  } : null

  const onVoiceFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selected) return
    try {
      setBusy(true)
      setError(null)
      const response = await uploadVoiceObservationAudio({ caseId: selected.case_id, revision: selected.revision, file })
      applyCandidate(response.candidate, '음성에서 만든 후보입니다. 아래 체크리스트를 확인하고 고친 뒤 제출해 주세요.')
    } catch (cause) {
      setError(errorText(cause, '음성 파일에서 후보를 만들지 못했습니다. 수동 입력을 사용할 수 있습니다.'))
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const submitMemo = async () => {
    if (!selected || !memoText.trim()) return
    try {
      setBusy(true)
      setError(null)
      const response = await createAiObservationCandidate({
        caseId: selected.case_id,
        revision: selected.revision,
        source: { kind: 'text', text: memoText.trim() },
      })
      applyCandidate(response.candidate, '메모에서 만든 AI 후보입니다. 아래 체크리스트를 확인하고 고친 뒤 제출해 주세요.')
    } catch (cause) {
      setError(errorText(cause, '메모에서 후보를 만들지 못했습니다. 문답 또는 직접 체크를 사용할 수 있습니다.'))
    } finally {
      setBusy(false)
    }
  }

  const answerChat = (answer: string) => {
    const question = CHAT_QUESTIONS[chatIndex]
    const draft = { resultLabel, observations: structuredClone(observations) }
    question.apply(answer, draft)
    setResultLabel(draft.resultLabel)
    setObservations(draft.observations)
    setChatLog((log) => [...log, { prompt: question.prompt, answer }])
    if (chatIndex + 1 >= CHAT_QUESTIONS.length) {
      setCandidateNote('문답에서 만든 후보입니다. 아래 체크리스트를 확인하고 고친 뒤 제출해 주세요.')
      setInputPath('manual')
    } else {
      setChatIndex(chatIndex + 1)
    }
  }

  // 이미 답한 질문을 다시 열면 그 지점부터 다시 답한다. 값은 재답변으로 덮어쓴다.
  const revisitChat = (index: number) => {
    setChatIndex(index)
    setChatLog((log) => log.slice(0, index))
    setCandidateNote(null)
    setCandidateFreeText(null)
    setInputPath('chat')
  }

  const submit = async () => {
    if (!selected || !resultLabel) return
    try {
      setBusy(true)
      setError(null)
      await submitContact({
        caseId: selected.case_id,
        revision: selected.revision,
        resultLabel,
        observations,
      })
      const preview = await loadReportCard(selected.case_id)
      setReportCard(preview.report_card)
      setStep('done')
      await refresh()
    } catch (cause) {
      setError(errorText(cause, '통화(또는 방문) 결과를 저장하지 못했습니다.'))
    } finally {
      setBusy(false)
    }
  }

  const updateSign = (key: keyof CanonicalObservations['관찰_6징후'], checked: boolean) => {
    setObservations((value) => ({ ...value, 관찰_6징후: { ...value.관찰_6징후, [key]: checked } }))
  }
  const update = <K extends keyof CanonicalObservations>(key: K, next: CanonicalObservations[K]) => {
    setObservations((value) => ({ ...value, [key]: next }))
  }

  return (
    <main className="tier-page mobile-page">
      <header className="tier-header mobile-header">
        <div>
          <h1>조사원 화면 · {lanesData?.worker_display_name ?? '연결단원 001'}</h1>
          <p className="tier-audience">
            {lanesData?.dong_name ?? '신포동'}
            <span className="live-indicator"><span className="live-dot" aria-hidden="true" />실시간</span>
          </p>
        </div>
        <nav aria-label="3계층 화면 이동">
          <a href="/center">동 센터</a>
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

      {step === 'list' && (
        <section aria-labelledby="mobile-today-heading" className="mobile-list">
          <h2 id="mobile-today-heading">{lane === 'phone' ? '오늘 할당된 연락 대상' : '오늘 방문 대상'}</h2>
          <div className="lane-tabs" role="tablist" aria-label="전화 목록과 방문 목록">
            <button role="tab" aria-selected={lane === 'phone'} onClick={() => setLane('phone')}>
              <Phone aria-hidden="true" size={18} /> 전화 {lanesData?.lanes.phone.length ?? 0}건
            </button>
            <button role="tab" aria-selected={lane === 'visit'} onClick={() => setLane('visit')}>
              방문 {lanesData?.lanes.visit.length ?? 0}건
            </button>
          </div>
          <p className="lane-rule">{lane === 'phone'
            ? '정기 연락 일정과 재연락 기한에 따라 오늘 배정된 연락업무입니다.'
            : '담당자가 승인하고 동 센터가 배치를 확인한 오늘 방문 업무만 표시합니다.'}</p>
          {loading && !lanesData ? <p className="ops-state" role="status">오늘 목록을 불러오는 중입니다.</p> : (
            <ul className="mobile-task-list" aria-label={lane === 'phone' ? '오늘 전화 목록' : '오늘 방문 목록'}>
              {items.length === 0 ? (
                <li className="ops-empty">
                  {(lanesData?.pending_confirmation?.[lane] ?? 0) > 0
                    ? `동 센터가 배치를 배정하면 여기에 나타납니다. (배정 대기 ${lanesData?.pending_confirmation[lane]}건)`
                    : '오늘 이 목록에는 예정된 업무가 없습니다.'}
                </li>
              )
                : items.map((item) => (
                  <li key={item.case_id}>
                    <button className="mobile-task" onClick={() => openCase(item)}>
                      <span className="mobile-task-top">
                        <span className="case-id">{item.display_name} 어르신</span>
                        {item.lane === 'phone'
                          ? <span className="assignment-status" data-status={item.assignment_status}>{assignmentStatusLabel(item)}</span>
                          : <LaneBadge item={item} />}
                      </span>
                      <span className="mobile-task-address">
                        {item.lane === 'visit' && item.location.road_address
                          ? `${item.location.road_address}${item.location.building_name ? ` (${item.location.building_name})` : ''}`
                          : item.location.dong_name}
                      </span>
                      {item.lane === 'phone' ? <>
                        <span className="selection-reasons" aria-label="전화 대상 선정 사유">
                          {item.selection_reason_labels.map((label) => <span key={label}>{label}</span>)}
                        </span>
                        <span className="mobile-task-meta">연락 기한 {item.earliest_due_date ?? '기한 없음'}</span>
                        <span className="mobile-task-meta">담당 {item.worker_display_name ?? '미배정'}</span>
                      </> : <>
                        <span className="visit-approved"><CheckCircle2 aria-hidden="true" size={17} /> 담당자 승인·배치 확인 완료</span>
                        <span className="mobile-acute-summary">급성도 {formatScore(item.급성도_점수, '기록 없음')}{item.급성도_점수 === null ? '' : '점'} · {item.급성도_등급 ?? '등급 기록 없음'}</span>
                        {item.급성도_기여내역.slice(0, 2).map((entry) => <span className="mobile-task-meta" key={entry.코드}>주요 근거 · {entry.근거} (+{formatScore(entry.가산점)}점)</span>)}
                      </>}
                      <span className="mobile-task-facts">
                        <span className="mobile-task-fact">
                          <span className="fact-label">마지막 연락</span>
                          <span className="fact-value">
                            {item.last_contact.date ?? '기록 없음'}
                            <span
                              className="fact-status"
                              data-attention={ATTENTION_CONTACT_LABELS.has(item.last_contact.result_label) || undefined}
                            >
                              {item.last_contact.result_label}
                            </span>
                          </span>
                        </span>
                        {item.lane === 'visit' && item.visit_context && (
                          <span className="mobile-task-fact">
                            <span className="fact-label">선호 시간</span>
                            <span className="fact-value">
                              {item.visit_context.preferred_visit_time_window.start}~{item.visit_context.preferred_visit_time_window.end}
                              {item.visit_context.requires_public_official_companion ? ' · 공무원 동행 필요' : ''}
                              {item.visit_context.requires_two_person_team ? ' · 2인 1조' : ''}
                            </span>
                          </span>
                        )}
                      </span>
                      {item.lane === 'phone' && <ManagementEntrySummary item={item} />}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {step === 'case' && selected && (
        <section className="mobile-case" aria-label={`${selected.display_name} 어르신 상세`}>
          <button className="mobile-back" onClick={() => { setStep('list'); setSelected(null) }}>
            <ChevronLeft aria-hidden="true" /> 오늘 목록으로
          </button>
          <h2>대상 정보</h2>
          <p className="case-id">{selected.display_name} 어르신</p>
          <p className={selected.lane === 'visit' ? 'visit-approved' : 'assignment-status'}>
            {selected.lane === 'visit'
              ? <><CheckCircle2 aria-hidden="true" size={17} /> 담당자 승인·배치 확인 완료</>
              : assignmentStatusLabel(selected)}
          </p>
          <dl className="mobile-case-facts">
            {selected.lane === 'visit' ? <div><dt>급성도</dt><dd>{formatScore(selected.급성도_점수, '기록 없음')}{selected.급성도_점수 === null ? '' : '점'} · <LaneBadge item={selected} /></dd></div> : <>
              <div><dt>선정 사유</dt><dd>{selected.selection_reason_labels.join(' · ') || '선정 사유 확인 중'}</dd></div>
              <div><dt>연락 기한</dt><dd>{selected.earliest_due_date ?? '기한 없음'}</dd></div>
              <div><dt>담당</dt><dd>{selected.worker_display_name ?? '미배정'}</dd></div>
              <div><dt>등록 근거</dt><dd>{selected.management_entry ? managementIntakeLabel(selected.management_entry.intake_channel) : '기록 확인 필요'}</dd></div>
              <div><dt>관리 확인</dt><dd>연락 동의 기록 · 기존 정기 안부확인 중복 없음</dd></div>
            </>}
            <div><dt>위치</dt><dd>{selected.location.district} {selected.location.dong_name}</dd></div>
            {selected.location.road_address && (
              <div><dt>주소</dt><dd>
                {selected.location.road_address}
                {selected.location.building_name ? ` (${selected.location.building_name})` : ''}
                {selected.location.apartment_reference ? ' · 공동주택' : ''}
              </dd></div>
            )}
            <div><dt>마지막 연락</dt><dd>{selected.last_contact.date ?? '기록 없음'} · {selected.last_contact.result_label}</dd></div>
            {selected.visit_context && (
              <div><dt>방문 조건</dt><dd>
                선호 시간 {selected.visit_context.preferred_visit_time_window.start}~{selected.visit_context.preferred_visit_time_window.end}
                {selected.visit_context.requires_public_official_companion ? ' · 공무원 동행 필요' : ''}
                {selected.visit_context.requires_two_person_team ? ' · 2인 1조' : ''}
                {selected.visit_context.stairs_present ? ' · 계단 있음' : ''}
              </dd></div>
            )}
          </dl>
          {selected.lane === 'visit' && <AcuteContributionList item={selected} />}
          {selected.lane === 'visit' && (
            <details className="mobile-map-widget" open={visitMapOpen} onToggle={(event) => setVisitMapOpen((event.target as HTMLDetailsElement).open)}>
              <summary><MapPinned aria-hidden="true" size={18} /> 방문 위치 지도 열기</summary>
              <div className="mobile-map-frame">
                {visitMapOpen && (
                  <button type="button" className="mobile-map-close" aria-label="지도 닫기" onClick={() => setVisitMapOpen(false)}>
                    <X aria-hidden="true" size={20} />
                  </button>
                )}
                {visitMapOpen && mapData ? (
                  <MapView
                    data={mapData}
                    metric="age_65_plus_one_person_share_of_age_65_plus_population"
                    showFacilities={false}
                    showTransit={false}
                    facilityCategory="전체"
                    selectedZoneId={selected.location.geometry_zone_id}
                    syntheticPoint={{
                      caseId: selected.case_id,
                      longitude: selected.location.longitude,
                      latitude: selected.location.latitude,
                    }}
                    ariaLabel="방문 위치 참고 지도"
                    onSelectDong={() => {}}
                  />
                ) : <p role="status">지도를 열면 방문 위치를 확인할 수 있습니다.</p>}
              </div>
            </details>
          )}
          <button className="mobile-dial" onClick={() => setShowDial(true)}>
            <Phone aria-hidden="true" /> {selected.virtual_phone.label} {selected.virtual_phone.display_number}
          </button>
          <p className="mobile-dial-note">{selected.virtual_phone.note}</p>

          {showDial && (
            <div className="mobile-dial-overlay" role="dialog" aria-modal="true" aria-label="가상 발신 화면">
              <p className="mobile-dial-overlay-number">{selected.virtual_phone.label} {selected.virtual_phone.display_number}</p>
              <p>가상 발신 화면입니다. 실제 전화는 걸리지 않습니다.</p>
              <button onClick={() => setShowDial(false)}>가상 발신 화면 닫기</button>
            </div>
          )}

          <h2>통화(또는 방문) 결과 입력</h2>
          {inputPath === null && (
            <div className="mobile-input-paths" role="group" aria-label="입력 방법 선택">
              <button className="mobile-live-call-start" onClick={() => void startLiveCall()} disabled={busy}>
                <Phone aria-hidden="true" /> 실시간 통화 시작
              </button>
              <button onClick={() => setInputPath('memo')}><Sparkles aria-hidden="true" /> 메모로 채우기 (AI 후보)</button>
              <button onClick={() => setInputPath('voice')}><Mic aria-hidden="true" /> 음성 파일로 채우기</button>
              <button onClick={() => setInputPath('chat')}>문답 또는 직접 체크하기</button>
            </div>
          )}

          {inputPath === 'live' && !liveHostJoin && busy && (
            <p className="mobile-path-note" role="status">통화방을 준비하고 있습니다.</p>
          )}

          {inputPath === 'live' && liveHostJoin && liveInviteUrl && !candidateNote && (
            <LiveCallPanel
              join={liveHostJoin}
              inviteUrl={liveInviteUrl}
              onFinish={finishLiveCall}
              onTranscriptUpdate={scheduleLiveCandidate}
              liveCandidate={liveCandidate}
              candidatePending={liveCandidatePending}
              candidateError={liveCandidateError}
              onCancel={() => {
                setLiveCallCredentials(null)
                setLiveInviteUrl(null)
                resetLiveCandidate()
                setInputPath(null)
              }}
            />
          )}

          {inputPath === 'memo' && !candidateNote && (
            <div className="mobile-memo" role="group" aria-label="메모 입력">
              <label className="mobile-memo-label">통화·방문 메모
                <textarea
                  rows={3}
                  value={memoText}
                  onChange={(event) => setMemoText(event.target.value)}
                  placeholder="예: 전화를 안 받으시고, 우편함에 고지서가 쌓여 있었어요"
                  disabled={busy}
                />
              </label>
              <p className="mobile-path-note">이름·연락처 같은 개인정보는 적지 마세요.</p>
              {busy && <p role="status">메모에서 후보를 만드는 중입니다.</p>}
              <button className="mobile-memo-run" onClick={() => void submitMemo()} disabled={busy || !memoText.trim()}>
                <Sparkles aria-hidden="true" size={17} /> AI 후보 만들기
              </button>
              <button className="mobile-secondary" onClick={() => setInputPath(null)}>다른 방법 선택</button>
            </div>
          )}

          {inputPath === 'voice' && !candidateNote && (
            <div className="mobile-voice">
              <label className="mobile-voice-label">통화 녹음 파일 (WAV·MP3·M4A)
                <input type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" onChange={onVoiceFile} disabled={busy} />
              </label>
              {busy && <p role="status">음성에서 후보를 만드는 중입니다.</p>}
              <button className="mobile-secondary" onClick={() => setInputPath(null)}>다른 방법 선택</button>
            </div>
          )}

          {inputPath === 'chat' && chatIndex < CHAT_QUESTIONS.length && (
            <div className="mobile-chat" role="group" aria-label="문답 입력">
              {chatLog.map((entry, index) => (
                <button key={entry.prompt} type="button" className="mobile-chat-log-edit" onClick={() => revisitChat(index)}>
                  <strong>{entry.prompt}</strong> {entry.answer} <span>다시 답하기</span>
                </button>
              ))}
              <p className="mobile-chat-question">{CHAT_QUESTIONS[chatIndex].prompt}</p>
              <div className="mobile-chat-options">
                {CHAT_QUESTIONS[chatIndex].options.map((option) => (
                  <button key={option} onClick={() => answerChat(option)}>{option}</button>
                ))}
              </div>
              <button className="mobile-secondary" onClick={() => setInputPath('manual')}>직접 체크하기</button>
              <button className="mobile-secondary" onClick={() => setInputPath(null)}>다른 방법 선택</button>
            </div>
          )}

          {(inputPath === 'manual' || candidateNote !== null) && (
            <form className="mobile-checklist" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              {candidateNote && <p className="mobile-candidate-note" role="note">{candidateNote}</p>}
              {candidateFreeText && (
                <section className="mobile-extra-note" aria-label="기타 특이사항 확인">
                  <h3>기타 특이사항 확인</h3>
                  <p>{candidateFreeText}</p>
                  <p>해당하는 체크리스트를 확인하면 제출 후 점수에 반영됩니다.</p>
                </section>
              )}
              {criticWarnings.length > 0 && (
                <ul className="mobile-critic" aria-label="후보 검토 주의사항">
                  {criticWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}
              {nextQuestion && (
                <section className="mobile-next-question" aria-labelledby="mobile-next-question-heading">
                  <h3 id="mobile-next-question-heading">다음 확인 질문</h3>
                  <p>{nextQuestion}</p>
                  <span>답을 확인한 뒤 아래 체크리스트를 수정해 주세요.</span>
                </section>
              )}
              <label>통화(또는 방문) 결과
                <select value={resultLabel} onChange={(event) => setResultLabel(event.target.value as ContactResultLabel | '')} required>
                  <option value="">선택해 주세요</option>
                  {CONTACT_LABELS.map((label) => <option key={label}>{label}</option>)}
                </select>
              </label>
              <fieldset className="mobile-signs">
                <legend>{selected.lane === 'phone' ? '주변 확인 신호' : '방문 관찰 체크리스트'}</legend>
                {selected.lane === 'phone' && (
                  <p className="mobile-path-note">통화 중 들었거나 이웃·경비 등 주변에서 확인된 경우에만 체크합니다.</p>
                )}
                {SIGN_FIELDS.map((field) => (
                  <label className="ops-choice" key={field.key}>
                    <input type="checkbox" checked={observations.관찰_6징후[field.key]} onChange={(event) => updateSign(field.key, event.target.checked)} />
                    <span>{field.label}</span>
                  </label>
                ))}
              </fieldset>
              <label>식사 상태
                <select value={observations.식사상태 ?? ''} onChange={(event) => update('식사상태', (event.target.value || null) as CanonicalObservations['식사상태'])}>
                  <option value="">확인하지 못함</option><option>양호</option><option>불량</option><option>심각</option>
                </select>
              </label>
              <label>위생 상태
                <select value={observations.위생상태 ?? ''} onChange={(event) => update('위생상태', (event.target.value || null) as CanonicalObservations['위생상태'])}>
                  <option value="">확인하지 못함</option><option>양호</option><option>불량</option>
                </select>
              </label>
              <label>도움을 요청할 관계망
                <select value={observations.관계망_유무 ?? ''} onChange={(event) => update('관계망_유무', (event.target.value || null) as CanonicalObservations['관계망_유무'])}>
                  <option value="">확인하지 못함</option><option>있음</option><option>없음</option>
                </select>
              </label>
              <label>평소 타인 연락 빈도
                <select value={observations.연락_빈도 ?? ''} onChange={(event) => update('연락_빈도', (event.target.value || null) as CanonicalObservations['연락_빈도'])}>
                  <option value="">확인하지 못함</option>
                  <option value="주_1회_이상">주 1회 이상</option>
                  <option value="주_1회_미만">주 1회 미만</option>
                  <option value="없음">연락 없음</option>
                </select>
              </label>
              <label>최근 건강·마음 괴로움
                <select
                  value={observations.최근_건강_정신_괴로움 === null ? '' : String(observations.최근_건강_정신_괴로움)}
                  onChange={(event) => update('최근_건강_정신_괴로움', event.target.value === '' ? null : event.target.value === 'true')}
                >
                  <option value="">확인하지 못함</option>
                  <option value="false">해당 없음</option>
                  <option value="true">관찰 또는 보고됨</option>
                </select>
              </label>
              <label>공과금 2개월 이상 체납 관찰·보고
                <select
                  value={observations.공과금_2개월_이상_체납 === null ? '' : String(observations.공과금_2개월_이상_체납)}
                  onChange={(event) => update('공과금_2개월_이상_체납', event.target.value === '' ? null : event.target.value === 'true')}
                >
                  <option value="">확인하지 못함</option>
                  <option value="false">해당 없음</option>
                  <option value="true">관찰 또는 보고됨</option>
                </select>
              </label>
              <p className="mobile-confirm-note">제출은 조사원 확정입니다. 제출해야 점수 계산과 동 센터 보고가 이루어집니다.</p>
              <button className="mobile-submit" type="submit" disabled={busy || !resultLabel}>
                <Send aria-hidden="true" /> {busy ? '저장 중' : '확인하고 제출'}
              </button>
            </form>
          )}
        </section>
      )}

      {step === 'done' && reportCard && (
        <section className="mobile-done" aria-label="보고 완료">
          <CheckCircle2 aria-hidden="true" size={44} />
          <h2>동 행정복지센터에 보고됨</h2>
          <p className="case-id">{reportCard.display_name} 어르신</p>
          <dl className="mobile-done-summary">
            <div><dt>등급</dt><dd><span className="grade-chip" data-grade={reportCard.등급}>{reportCard.등급}</span></dd></div>
            <div><dt>급성도</dt><dd>{formatScore(reportCard.급성도_점수)}</dd></div>
            <div><dt>취약도</dt><dd>{formatScore(reportCard.취약도_점수)}</dd></div>
          </dl>
          <section className="mobile-done-agencies" aria-label="권고 기관 미리보기">
            <h3>권고 기관 미리보기</h3>
            {reportCard.권고_기관.length === 0 ? <p>권고할 기관 신호가 없습니다.</p> : (
              <ul>{reportCard.권고_기관.map((agency) => <li key={agency.기관}><strong>{agency.기관}</strong> {agency.사유}</li>)}</ul>
            )}
            <p className="mobile-path-note">기관 연계 확정은 동 행정복지센터가 합니다.</p>
          </section>
          <button className="mobile-submit" onClick={() => { setStep('list'); setSelected(null); setReportCard(null) }}>
            오늘 목록으로 돌아가기
          </button>
        </section>
      )}
    </main>
  )
}
