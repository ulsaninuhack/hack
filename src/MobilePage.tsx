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
  completedContactDisplaySeverity,
  contactResultLabelFromCode,
  displaySeverity,
  laneItemDisplaySeverity,
  loadReportCard,
  loadTodayLanes,
  submitCaseNote,
  managementIntakeLabel,
  uploadVoiceObservationAudio,
} from './threeTierClient'
import type { LaneItem, ReportCard, TodayLanes, VoiceCandidate } from './threeTierClient'
import { createAiObservationCandidate } from './AiObservationClient'
import { formatScore } from './scoreFormat'
import { buildDemoCallUrl, createLiveCall, type LiveCallCredentials, type LiveCallJoin } from './liveCallClient'
import { LiveCallPanel } from './LiveCallPanel'
import { isCandidateValuePending, restrictLiveCandidateToPhoneEvidence } from './liveCandidatePolicy'

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
const PHONE_SIGN_FIELDS = SIGN_FIELDS.filter((field) => field.key === '외출_없음')
const SURROUNDING_SIGN_FIELDS = SIGN_FIELDS.filter((field) => field.key !== '외출_없음')

const MOBILE_REFRESH_INTERVAL_MS = 5_000
const CONNECTED_CONCERN_CODE = ['connected', 'concern'].join('_')
const CONNECTED_OK_CODE = ['connected', 'ok'].join('_')

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
    prompt: '최근 건강이나 마음 때문에 힘들어하셨나요?',
    options: ['어려움 있음', '어려움 없음', '확인하지 못함'],
    apply: (answer, draft) => {
      draft.observations.최근_건강_정신_괴로움 = answer === '확인하지 못함' ? null : answer === '어려움 있음'
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

function mergeLiveCandidate(previous: VoiceCandidate | null, next: VoiceCandidate): VoiceCandidate {
  if (!previous || previous.case_id !== next.case_id) return next
  const carriedFields = new Set<string>()
  const carry = <K extends Exclude<keyof CanonicalObservations, '관찰_6징후'>>(
    field: K,
  ): CanonicalObservations[K] => {
    if (next.observations[field] !== null || previous.observations[field] === null) {
      return next.observations[field]
    }
    carriedFields.add(field)
    return previous.observations[field]
  }
  const outingField = '관찰_6징후.외출_없음'
  const carryOuting = next.critic.missing_fields.includes(outingField)
    && !previous.critic.missing_fields.includes(outingField)
  if (carryOuting) carriedFields.add(outingField)
  const preservePreviousReviewState = (incoming: string[], prior: string[]) => [
    ...incoming.filter((field) => !carriedFields.has(field)),
    ...prior.filter((field) => carriedFields.has(field)),
  ]
  const observations: CanonicalObservations = {
    ...next.observations,
    관찰_6징후: {
      ...next.observations.관찰_6징후,
      외출_없음: carryOuting
        ? previous.observations.관찰_6징후.외출_없음
        : next.observations.관찰_6징후.외출_없음,
    },
    식사상태: carry('식사상태'),
    위생상태: carry('위생상태'),
    공과금_2개월_이상_체납: carry('공과금_2개월_이상_체납'),
    최근_건강_정신_괴로움: carry('최근_건강_정신_괴로움'),
    관계망_유무: carry('관계망_유무'),
    연락_빈도: carry('연락_빈도'),
  }
  return {
    ...next,
    observations,
    contact_result: carriedFields.size > 0
      && previous.contact_result === CONNECTED_CONCERN_CODE
      && next.contact_result === CONNECTED_OK_CODE
      ? previous.contact_result
      : next.contact_result,
    critic: {
      ...next.critic,
      missing_fields: preservePreviousReviewState(
        next.critic.missing_fields,
        previous.critic.missing_fields,
      ),
      low_confidence_fields: preservePreviousReviewState(
        next.critic.low_confidence_fields,
        previous.critic.low_confidence_fields,
      ),
    },
  }
}

const itemSeverity = laneItemDisplaySeverity

function reportSeverity(card: ReportCard) {
  return displaySeverity({
    급성도_점수: card.급성도_점수,
    취약도_점수: card.취약도_점수,
    결과_라벨: card.evidence.마지막_연락_결과_라벨,
    연속_미응답: card.evidence.연속_미응답_횟수,
  })
}

function reportSeverityGrade(card: ReportCard) {
  return reportSeverity(card).등급 ?? card.등급
}

function LaneBadge({ item }: { item: LaneItem }) {
  const grade = itemSeverity(item).등급 ?? item.급성도_등급 ?? '미기록'
  return <span className="grade-chip" data-grade={grade}>{grade}</span>
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
  const severity = itemSeverity(item)
  const contributions = [
    ...item.급성도_기여내역.slice(0, 3),
    ...severity.상승_근거.map((entry) => ({ 코드: entry.근거, 근거: entry.근거, 가산점: entry.가산점 })),
  ]
  if (contributions.length === 0) return null
  return <section className="mobile-acute-contributions" aria-label="심각도 근거">
    <h3>심각도 근거</h3>
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
  const [lane, setLane] = useState<'phone' | 'visit' | 'completed'>('phone')
  const [lanesData, setLanesData] = useState<TodayLanes | null>(null)
  const [selected, setSelected] = useState<LaneItem | null>(null)
  const [inputPath, setInputPath] = useState<InputPath | null>(null)
  const [resultLabel, setResultLabel] = useState<ContactResultLabel | ''>('')
  const [observations, setObservations] = useState<CanonicalObservations>(emptyObservations)
  const [memoText, setMemoText] = useState('')
  const [candidateFreeText, setCandidateFreeText] = useState<string | null>(null)
  const [candidateCritic, setCandidateCritic] = useState<VoiceCandidate['critic'] | null>(null)
  const [chatIndex, setChatIndex] = useState(0)
  const [chatLog, setChatLog] = useState<Array<{ prompt: string; answer: string }>>([])
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
  const liveCandidateGenerationRef = useRef(0)
  const liveCandidateAppliedGenerationRef = useRef(0)
  const liveCandidateScopeRef = useRef<string | null>(null)

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
  // 동 센터가 방문을 확인하면 조사원 목록에도 바로 반영돼야 한다. 센터와
  // 같은 주기로, 목록 화면이 보일 때만 다시 읽는다.
  useEffect(() => {
    if (step !== 'list') return
    let syncing = false
    const syncWhenVisible = () => {
      if (document.visibilityState !== 'visible' || syncing) return
      syncing = true
      void refresh().finally(() => { syncing = false })
    }
    const intervalId = window.setInterval(syncWhenVisible, MOBILE_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', syncWhenVisible)
    document.addEventListener('visibilitychange', syncWhenVisible)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', syncWhenVisible)
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [refresh, step])

  const invalidateLiveCandidateWork = useCallback(() => {
    liveCandidateGenerationRef.current += 1
  }, [])

  useEffect(() => () => invalidateLiveCandidateWork(), [invalidateLiveCandidateWork])

  const resetLiveCandidate = useCallback(() => {
    invalidateLiveCandidateWork()
    liveCandidateScopeRef.current = null
    liveCandidateRef.current = null
    setLiveCandidate(null)
    setLiveCandidatePending(false)
    setLiveCandidateError(null)
  }, [invalidateLiveCandidateWork])

  const scheduleLiveCandidate = useCallback((transcript: string) => {
    if (!selected || !transcript.trim()) return
    const scope = liveCandidateScopeRef.current
    if (!scope) return
    const generation = liveCandidateGenerationRef.current + 1
    liveCandidateGenerationRef.current = generation
    setLiveCandidatePending(true)
    setLiveCandidateError(null)
    void createAiObservationCandidate({
      caseId: selected.case_id,
      revision: selected.revision,
      source: { kind: 'text', text: transcript },
    }).then((response) => {
      if (scope !== liveCandidateScopeRef.current
          || generation <= liveCandidateAppliedGenerationRef.current) return
      const candidate = mergeLiveCandidate(
        liveCandidateRef.current,
        restrictLiveCandidateToPhoneEvidence(response.candidate),
      )
      liveCandidateAppliedGenerationRef.current = generation
      liveCandidateRef.current = candidate
      setLiveCandidate(candidate)
      setLiveCandidateError(null)
      if (generation === liveCandidateGenerationRef.current) setLiveCandidatePending(false)
    }).catch(() => {
      if (scope !== liveCandidateScopeRef.current
          || generation !== liveCandidateGenerationRef.current) return
      setLiveCandidatePending(false)
      setLiveCandidateError('체크리스트 후보를 갱신하지 못했습니다. 자막과 통화는 계속됩니다.')
    })
  }, [selected])

  const items = useMemo(() => (lane === 'completed' ? [] : lanesData?.lanes[lane] ?? []), [lanesData, lane])

  const openCase = (item: LaneItem) => {
    setSelected(item)
    setStep('case')
    setVisitMapOpen(false)
    setInputPath(null)
    setResultLabel('')
    setObservations(emptyObservations())
    setCandidateFreeText(null)
    setCandidateCritic(null)
    setMemoText('')
    setChatIndex(0)
    setChatLog([])
    setLiveCallCredentials(null)
    setLiveInviteUrl(null)
    resetLiveCandidate()
  }

  const applyCandidate = (
    candidate: Pick<VoiceCandidate, 'contact_result' | 'observations' | 'free_text' | 'critic'>,
  ) => {
    setObservations(candidate.observations)
    setResultLabel(contactResultLabelFromCode(candidate.contact_result))
    setCandidateFreeText(candidate.free_text.trim() || null)
    setCandidateCritic(candidate.critic)
    setInputPath('manual')
  }

  const candidateValuePending = (
    field: Exclude<keyof CanonicalObservations, '관찰_6징후'>,
  ) => candidateCritic !== null && isCandidateValuePending({ observations, critic: candidateCritic }, field)

  const startLiveCall = async () => {
    if (!selected) return
    try {
      setBusy(true)
      setError(null)
      setInputPath('live')
      resetLiveCandidate()
      const credentials = await createLiveCall({
        caseId: selected.case_id,
        revision: selected.revision,
        demoEntry: true,
      })
      liveCandidateScopeRef.current = `${selected.case_id}:${selected.revision}:${credentials.call_id}`
      setLiveCallCredentials(credentials)
      setLiveInviteUrl(buildDemoCallUrl())
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
      const refreshedCandidate = current?.case_id === selected.case_id && current.transcript === transcript
        ? current
        : (await createAiObservationCandidate({
            caseId: selected.case_id,
            revision: selected.revision,
            source: { kind: 'text', text: transcript },
          })).candidate
      const candidate = mergeLiveCandidate(
        current,
        restrictLiveCandidateToPhoneEvidence(refreshedCandidate),
      )
      applyCandidate(candidate)
      setLiveCallCredentials(null)
      setLiveInviteUrl(null)
      resetLiveCandidate()
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
      applyCandidate(response.candidate)
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
      applyCandidate(response.candidate)
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
      setInputPath('manual')
    } else {
      setChatIndex(chatIndex + 1)
    }
  }

  // 이미 답한 질문을 다시 열면 그 지점부터 다시 답한다. 값은 재답변으로 덮어쓴다.
  const revisitChat = (index: number) => {
    setChatIndex(index)
    setChatLog((log) => log.slice(0, index))
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
      // 결과 저장은 성공했다. 이후 단계가 실패해도 "저장 실패"로 되돌리지
      // 않고, 목록만 최신화해 조사원이 다시 시도할 수 있게 둔다.
      let noteFailed = false
      if (candidateFreeText !== null && candidateFreeText.trim() !== '') {
        try {
          await submitCaseNote({ caseId: selected.case_id, note: candidateFreeText.trim() })
        } catch {
          noteFailed = true
        }
      }
      try {
        const preview = await loadReportCard(selected.case_id)
        setReportCard(preview.report_card)
        setStep('done')
      } catch {
        setStep('list')
      }
      if (noteFailed) setError('결과는 저장했습니다. 기타사항만 저장하지 못했습니다.')
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
    setCandidateCritic((critic) => critic === null ? null : ({
      ...critic,
      missing_fields: critic.missing_fields.filter((field) => field !== key),
      low_confidence_fields: critic.low_confidence_fields.filter((field) => field !== key),
    }))
  }

  return (
    <main className="tier-page mobile-page">
      {error && (
        <div className="ops-state" role="alert">
          <AlertTriangle aria-hidden="true" />
          <p>{error}</p>
          <button onClick={() => void refresh()}><RefreshCw aria-hidden="true" /> 다시 시도</button>
        </div>
      )}

      {step === 'list' && (
        <section aria-labelledby="mobile-today-heading" className="mobile-list">
          <h2 id="mobile-today-heading">{lane === 'phone' ? '오늘 할당된 연락 대상' : lane === 'visit' ? '오늘 방문 대상' : '오늘 완료한 업무'}</h2>
          <div className="lane-tabs" role="tablist" aria-label="전화·방문·완료 목록">
            <button role="tab" aria-selected={lane === 'phone'} onClick={() => setLane('phone')}>
              <Phone aria-hidden="true" size={18} /> 전화 {lanesData?.lanes.phone.length ?? 0}건
            </button>
            <button role="tab" aria-selected={lane === 'visit'} onClick={() => setLane('visit')}>
              방문 {lanesData?.lanes.visit.length ?? 0}건
            </button>
            <button role="tab" aria-selected={lane === 'completed'} onClick={() => setLane('completed')}>
              <CheckCircle2 aria-hidden="true" size={18} /> 완료 {lanesData?.completed.length ?? 0}건
            </button>
          </div>
          {lane === 'visit' && <p className="lane-rule">담당자가 승인하고 동 센터가 배치를 확인한 오늘 방문 업무만 표시합니다.</p>}
          {loading && !lanesData ? <p className="ops-state" role="status">오늘 목록을 불러오는 중입니다.</p> : lane === 'completed' ? (
            <ul className="mobile-task-list" aria-label="오늘 완료 목록">
              {(lanesData?.completed ?? []).length === 0
                ? <li className="ops-empty">오늘 완료한 업무가 없습니다.</li>
                : (lanesData?.completed ?? []).map((entry) => (
                  <li key={entry.case_id} className="mobile-completed">
                    <span className="mobile-task-top">
                      <span className="case-id">{entry.display_name} 어르신</span>
                      <span className="grade-chip" data-grade={completedContactDisplaySeverity(entry).등급 ?? entry.급성도_등급 ?? '미기록'}>{completedContactDisplaySeverity(entry).등급 ?? entry.급성도_등급 ?? '미기록'}</span>
                    </span>
                    <span className="mobile-task-facts">
                      <span
                        className="fact-status"
                        data-attention={ATTENTION_CONTACT_LABELS.has(entry.결과_라벨) || undefined}
                      >
                        {entry.결과_라벨}
                      </span>
                      <span className="mobile-task-meta">
                        {new Date(entry.완료_시각).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 제출
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <ul className="mobile-task-list" aria-label={lane === 'phone' ? '오늘 전화 목록' : '오늘 방문 목록'}>
              {items.length === 0 ? (
                <li className="ops-empty">
                  {(lanesData?.pending_confirmation?.[lane as 'phone' | 'visit'] ?? 0) > 0
                    ? `동 센터가 배치를 배정하면 여기에 나타납니다. (배정 대기 ${lanesData?.pending_confirmation[lane as 'phone' | 'visit']}건)`
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
                        <span className="mobile-acute-summary">심각도 {formatScore(itemSeverity(item).점수, '기록 없음')}{itemSeverity(item).점수 === null ? '' : '점'} · {itemSeverity(item).등급 ?? '등급 기록 없음'}</span>
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
            {selected.lane === 'visit' ? <div><dt>심각도</dt><dd>{formatScore(itemSeverity(selected).점수, '기록 없음')}{itemSeverity(selected).점수 === null ? '' : '점'} · <LaneBadge item={selected} /></dd></div> : <>
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

          {inputPath === 'live' && liveHostJoin && liveInviteUrl && (
            <LiveCallPanel
              join={liveHostJoin}
              inviteUrl={liveInviteUrl}
              inviteMode="fixed-demo"
              targetDisplayName={`${selected.display_name} 어르신`}
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

          {inputPath === 'memo' && (
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

          {inputPath === 'voice' && (
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

          {inputPath === 'manual' && (
            <form className="mobile-checklist" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <label className="mobile-extra-note-field">기타사항
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={candidateFreeText ?? ''}
                  onChange={(event) => setCandidateFreeText(event.target.value)}
                  placeholder="통화 중 특이사항이 있으면 적어 주세요"
                />
              </label>
              <label>통화(또는 방문) 결과
                <select value={resultLabel} onChange={(event) => setResultLabel(event.target.value as ContactResultLabel | '')} required>
                  <option value="">선택해 주세요</option>
                  {CONTACT_LABELS.map((label) => <option key={label}>{label}</option>)}
                </select>
              </label>
              {selected.lane === 'phone' ? <>
                <fieldset className="mobile-signs">
                  <legend>통화로 확인</legend>
                  {PHONE_SIGN_FIELDS.map((field) => (
                    <label className="ops-choice" key={field.key}>
                      <input type="checkbox" checked={observations.관찰_6징후[field.key]} onChange={(event) => updateSign(field.key, event.target.checked)} />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="mobile-signs">
                  <legend>방문·주변 확인</legend>
                  {SURROUNDING_SIGN_FIELDS.map((field) => (
                    <label className="ops-choice" key={field.key}>
                      <input type="checkbox" checked={observations.관찰_6징후[field.key]} onChange={(event) => updateSign(field.key, event.target.checked)} />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </fieldset>
              </> : (
                <fieldset className="mobile-signs">
                  <legend>방문 관찰 체크리스트</legend>
                  {SIGN_FIELDS.map((field) => (
                  <label className="ops-choice" key={field.key}>
                    <input type="checkbox" checked={observations.관찰_6징후[field.key]} onChange={(event) => updateSign(field.key, event.target.checked)} />
                    <span>{field.label}</span>
                  </label>
                  ))}
                </fieldset>
              )}
              <label><span className="candidate-pending-label">{`식사 상태${candidateValuePending('식사상태') ? ' (보류)' : ''}`}</span>
                <select aria-label="식사 상태" value={observations.식사상태 ?? ''} onChange={(event) => update('식사상태', (event.target.value || null) as CanonicalObservations['식사상태'])}>
                  <option value="">확인하지 못함</option><option>양호</option><option>불량</option><option>심각</option>
                </select>
              </label>
              <label><span className="candidate-pending-label">{`위생 상태${candidateValuePending('위생상태') ? ' (보류)' : ''}`}</span>
                <select aria-label="위생 상태" value={observations.위생상태 ?? ''} onChange={(event) => update('위생상태', (event.target.value || null) as CanonicalObservations['위생상태'])}>
                  <option value="">확인하지 못함</option><option>양호</option><option>불량</option>
                </select>
              </label>
              <label><span className="candidate-pending-label">{`도움을 요청할 관계망${candidateValuePending('관계망_유무') ? ' (보류)' : ''}`}</span>
                <select aria-label="도움을 요청할 관계망" value={observations.관계망_유무 ?? ''} onChange={(event) => update('관계망_유무', (event.target.value || null) as CanonicalObservations['관계망_유무'])}>
                  <option value="">확인하지 못함</option><option>있음</option><option>없음</option>
                </select>
              </label>
              <label><span className="candidate-pending-label">{`평소 타인 연락 빈도${candidateValuePending('연락_빈도') ? ' (보류)' : ''}`}</span>
                <select aria-label="평소 타인 연락 빈도" value={observations.연락_빈도 ?? ''} onChange={(event) => update('연락_빈도', (event.target.value || null) as CanonicalObservations['연락_빈도'])}>
                  <option value="">확인하지 못함</option>
                  <option value="주_1회_이상">주 1회 이상</option>
                  <option value="주_1회_미만">주 1회 미만</option>
                  <option value="없음">연락 없음</option>
                </select>
              </label>
              <label><span className="candidate-pending-label">{`최근 건강·마음 어려움${candidateValuePending('최근_건강_정신_괴로움') ? ' (보류)' : ''}`}</span>
                <select
                  aria-label="최근 건강·마음 어려움"
                  value={observations.최근_건강_정신_괴로움 === null ? '' : String(observations.최근_건강_정신_괴로움)}
                  onChange={(event) => update('최근_건강_정신_괴로움', event.target.value === '' ? null : event.target.value === 'true')}
                >
                  <option value="">확인하지 못함</option>
                  <option value="false">어려움 없음</option>
                  <option value="true">어려움 있음</option>
                </select>
              </label>
              <label><span className="candidate-pending-label">{`공과금 체납${candidateValuePending('공과금_2개월_이상_체납') ? ' (보류)' : ''}`}</span>
                <select
                  aria-label="공과금 체납"
                  value={observations.공과금_2개월_이상_체납 === null ? '' : String(observations.공과금_2개월_이상_체납)}
                  onChange={(event) => update('공과금_2개월_이상_체납', event.target.value === '' ? null : event.target.value === 'true')}
                >
                  <option value="">확인하지 못함</option>
                  <option value="false">체납 없음</option>
                  <option value="true">체납 있음</option>
                </select>
              </label>
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
            <div><dt>등급</dt><dd>
              <span className="grade-chip" data-grade={reportSeverityGrade(reportCard)}>{reportSeverityGrade(reportCard)}</span>
            </dd></div>
            <div><dt>심각도</dt><dd>{formatScore(reportSeverity(reportCard).점수)}</dd></div>
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
