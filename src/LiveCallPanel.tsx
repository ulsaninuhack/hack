import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, HelpCircle, Mic, MicOff, PhoneCall, PhoneOff, Share2, Users } from 'lucide-react'
import QRCode from 'qrcode'

import type { LiveCallJoin } from './liveCallClient'
import { connectLiveCallSession, type LiveCallSession } from './liveCallSession'
import { appendCaption, residentTranscript, type LiveCaption } from './liveCallTranscript'
import { buildLiveEvidenceGraph, type LiveEvidenceGraph } from './liveEvidenceGraph'
import type { VoiceCandidate } from './threeTierClient'

type CallState = 'idle' | 'connecting' | 'connected' | 'finishing' | 'ended'

interface LiveCallPanelProps {
  join: LiveCallJoin
  inviteUrl?: string
  onFinish?: (residentTranscript: string) => Promise<void> | void
  onTranscriptUpdate?: (residentTranscript: string) => void
  liveCandidate?: Pick<VoiceCandidate, 'contact_result' | 'transcript' | 'observations' | 'critic'> | null
  candidatePending?: boolean
  candidateError?: string | null
  onCancel?: () => void
}

function speakerLabel(role: LiveCaption['role']) {
  return role === 'surveyor' ? '연결단원' : '연락 대상'
}

function liveErrorText(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return '마이크 권한을 허용한 뒤 다시 연결해 주세요.'
  }
  return cause instanceof Error && cause.message.includes('마이크')
    ? cause.message
    : '실시간 통화를 연결하지 못했습니다. 음성 파일 또는 직접 입력을 사용해 주세요.'
}

const LIVE_PREVIEW_SIGNS: Array<{
  key: keyof VoiceCandidate['observations']['관찰_6징후']
  label: string
}> = [
  { key: '외출_없음', label: '최근 외출 없음' },
]

function LiveChecklistPreview({
  candidate,
  captions,
  pending,
  error,
}: {
  candidate?: Pick<VoiceCandidate, 'contact_result' | 'transcript' | 'observations' | 'critic'> | null
  captions: LiveCaption[]
  pending: boolean
  error?: string | null
}) {
  const evidenceGraph = candidate ? buildLiveEvidenceGraph(captions, candidate) : null
  const statusRows = candidate ? [
    { label: '식사 상태', value: candidate.observations.식사상태 },
    { label: '위생 상태', value: candidate.observations.위생상태 },
    { label: '도움 관계망', value: candidate.observations.관계망_유무 },
    {
      label: '건강·마음 어려움',
      value: candidate.observations.최근_건강_정신_괴로움 === null
        ? null
        : candidate.observations.최근_건강_정신_괴로움 ? '어려움 있음' : '어려움 없음',
    },
    {
      label: '공과금 체납',
      value: candidate.observations.공과금_2개월_이상_체납 === null
        ? null
        : candidate.observations.공과금_2개월_이상_체납 ? '체납 있음' : '체납 없음',
    },
  ] : []

  return <section className="live-checklist-preview" aria-label="통화 중 체크리스트 후보">
    <header>
      <div>
        <h3>통화 중 확인된 항목</h3>
        <span>AI 후보 · 미확정</span>
      </div>
      {pending && <p role="status">새 발화를 확인하는 중</p>}
    </header>
    {error && <p className="live-candidate-error" role="status">{error}</p>}
    {!candidate ? (
      <p className="live-candidate-empty">대기 중</p>
    ) : <>
      <ul className="live-candidate-grid">
        {LIVE_PREVIEW_SIGNS.map((sign) => {
          const checked = candidate.observations.관찰_6징후[sign.key]
          return <li key={sign.key} data-candidate={checked || undefined}>
            {checked ? <Check aria-hidden="true" /> : <span aria-hidden="true">—</span>}
            <strong>{sign.label}</strong>
            <em>{checked ? '후보' : '미확인'}</em>
          </li>
        })}
        {statusRows.map((row) => <li key={row.label} data-candidate={row.value !== null ? true : undefined}>
          {row.value !== null ? <Check aria-hidden="true" /> : <span aria-hidden="true">—</span>}
          <strong>{row.label}</strong>
          <em>{row.value === null ? '미확인' : `${row.value} · 후보`}</em>
        </li>)}
      </ul>
      {evidenceGraph && evidenceGraph.turns.length > 0 && (
        <LiveEvidenceLedger graph={evidenceGraph} />
      )}
      {evidenceGraph?.contradictions.map((contradiction) => (
        <section
          className="live-contradiction-card"
          aria-label="추가 확인이 필요한 상충 정보"
          key={`${contradiction.field}-${contradiction.evidenceItemIds.join('-')}`}
        >
          <AlertTriangle aria-hidden="true" />
          <div>
            <h4>{contradiction.label}</h4>
            <ul>{contradiction.evidenceItemIds.map((itemId) => {
              const turn = evidenceGraph.turns.find((entry) => entry.itemId === itemId)
              return turn && <li key={itemId}><strong>발화 {turn.sequence}</strong> · {turn.text}</li>
            })}</ul>
            {contradiction.nextQuestion && <p><strong>확인 질문</strong> · {contradiction.nextQuestion}</p>}
          </div>
        </section>
      ))}
      {candidate.critic.next_question && evidenceGraph?.contradictions.length === 0 && (
        <section className="live-next-question" aria-labelledby="live-next-question-heading">
          <HelpCircle aria-hidden="true" />
          <div>
            <h4 id="live-next-question-heading">다음 확인 질문</h4>
            <p>{candidate.critic.next_question}</p>
          </div>
        </section>
      )}
    </>}
  </section>
}

function LiveEvidenceLedger({ graph }: { graph: LiveEvidenceGraph }) {
  const linkedEntries = [
    ...graph.facts.map((fact) => ({
      key: `fact-${fact.field}`,
      state: fact.state === 'clarification_needed' ? '추가 확인' : 'AI 후보',
      label: `${fact.label} · ${fact.value}`,
      itemIds: fact.evidenceItemIds,
    })),
    ...graph.contradictions.map((entry) => ({
      key: `contradiction-${entry.field}`,
      state: '추가 확인',
      label: entry.label,
      itemIds: entry.evidenceItemIds,
    })),
  ]
  if (linkedEntries.length === 0) return null
  return <section className="live-evidence-ledger" aria-label="통화 근거 원장">
    <header>
      <div>
        <h4>근거 발화</h4>
      </div>
      <span>{graph.turns.length}개 발화</span>
    </header>
    <ul>{linkedEntries.map((entry) => {
      const sequences = entry.itemIds
        .map((itemId) => graph.turns.find((turn) => turn.itemId === itemId)?.sequence)
        .filter((value): value is number => value !== undefined)
      return <li key={entry.key}>
        <span>{entry.state}</span>
        <strong>{entry.label}</strong>
        <em>발화 {sequences.join(', ')}</em>
      </li>
    })}</ul>
  </section>
}

export function LiveCallPanel({
  join,
  inviteUrl,
  onFinish,
  onTranscriptUpdate,
  liveCandidate,
  candidatePending = false,
  candidateError,
  onCancel,
}: LiveCallPanelProps) {
  const canShare = typeof navigator.share === 'function'
  const [callState, setCallState] = useState<CallState>('idle')
  const [captions, setCaptions] = useState<LiveCaption[]>([])
  const [participantCount, setParticipantCount] = useState(1)
  const [muted, setMutedState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrError, setQrError] = useState(false)
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const sessionRef = useRef<LiveCallSession | null>(null)
  const audioRef = useRef<HTMLDivElement>(null)
  const captionsRef = useRef<LiveCaption[]>([])
  const captionsListRef = useRef<HTMLOListElement>(null)
  const liveFlowEndRef = useRef<HTMLDivElement>(null)

  const finalResidentTurns = useMemo(
    () => captions.filter((caption) => caption.role === 'resident' && caption.final).length,
    [captions],
  )

  useEffect(() => {
    if (!inviteUrl) {
      setQrCode(null)
      setQrError(false)
      return
    }
    let active = true
    setQrCode(null)
    setQrError(false)
    void QRCode.toDataURL(inviteUrl, {
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'H',
      margin: 4,
      width: 280,
    })
      .then((value) => {
        if (!active) return
        setQrCode(value)
        setQrError(false)
      })
      .catch(() => {
        if (!active) return
        setQrCode(null)
        setQrError(true)
      })
    return () => { active = false }
  }, [inviteUrl])

  useEffect(() => () => {
    void sessionRef.current?.disconnect()
    sessionRef.current = null
  }, [])

  useEffect(() => {
    if (callState !== 'connected' || (captions.length === 0 && !liveCandidate && !candidatePending)) return
    const frame = window.requestAnimationFrame(() => {
      const list = captionsListRef.current
      if (list) list.scrollTop = list.scrollHeight
      const anchor = liveFlowEndRef.current
      if (anchor && typeof anchor.scrollIntoView === 'function') {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [callState, captions, liveCandidate, candidatePending])

  const receiveCaption = (caption: LiveCaption) => {
    const previousResidentTranscript = residentTranscript(captionsRef.current)
    const next = appendCaption(captionsRef.current, caption)
    captionsRef.current = next
    setCaptions(next)
    if (caption.role === 'resident' && caption.final) {
      const transcript = residentTranscript(next)
      if (transcript && transcript !== previousResidentTranscript) onTranscriptUpdate?.(transcript)
    }
  }

  const connect = async () => {
    try {
      setCallState('connecting')
      setError(null)
      const session = await connectLiveCallSession({
        serverUrl: join.serverUrl,
        participantToken: join.participantToken,
        expectedRole: join.role,
        onCaption: receiveCaption,
        onParticipantCount: setParticipantCount,
        audioContainer: audioRef.current,
      })
      sessionRef.current = session
      setCallState('connected')
    } catch (cause) {
      sessionRef.current = null
      setCallState('idle')
      setError(liveErrorText(cause))
    }
  }

  const toggleMuted = async () => {
    const next = !muted
    try {
      await sessionRef.current?.setMuted(next)
      setMutedState(next)
    } catch {
      setError('마이크 상태를 바꾸지 못했습니다. 통화를 종료하고 다시 연결해 주세요.')
    }
  }

  const finish = async () => {
    if (callState !== 'connected') return
    try {
      setCallState('finishing')
      setError(null)
      await sessionRef.current?.finish()
      await sessionRef.current?.disconnect()
      sessionRef.current = null
      if (join.role === 'surveyor' && onFinish) {
        const transcript = residentTranscript(captionsRef.current)
        if (!transcript) {
          setCallState('ended')
          setError('연락 대상의 확정 자막이 없습니다. 음성 파일 또는 직접 입력을 사용해 주세요.')
          return
        }
        await onFinish(transcript)
      }
      setCallState('ended')
    } catch (cause) {
      setCallState('ended')
      setError(liveErrorText(cause))
    }
  }

  const shareInvite = async () => {
    if (!inviteUrl) return
    try {
      if (canShare) {
        await navigator.share({ title: '안부 통화 참여', url: inviteUrl })
        setShareStatus('참여 링크를 공유했습니다.')
      } else {
        await navigator.clipboard.writeText(inviteUrl)
        setShareStatus('참여 링크를 복사했습니다.')
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setShareStatus('링크를 복사하지 못했습니다. QR 코드를 사용해 주세요.')
    }
  }

  return (
    <section className="live-call-panel" aria-label="실시간 통화">
      <div ref={audioRef} aria-hidden="true" />

      {inviteUrl && callState === 'idle' && (
        <section className="live-call-invite" aria-label="연락 대상 초대">
          <div>
            <h3>연락 대상 참여</h3>
            <p>상대방 휴대전화로 링크를 보내거나 QR 코드를 보여 주세요.</p>
            <button type="button" className="live-call-share" onClick={() => void shareInvite()}>
              {canShare ? <Share2 aria-hidden="true" /> : <Copy aria-hidden="true" />}
              참여 링크 {canShare ? '보내기' : '복사'}
            </button>
            {shareStatus && <p role="status" className="live-call-share-status">{shareStatus}</p>}
          </div>
          {qrCode && <img src={qrCode} alt="연락 대상 참여 QR 코드" width="280" height="280" />}
          {qrError && (
            <p className="live-call-qr-error" role="alert">
              QR 코드를 만들지 못했습니다. 참여 링크 버튼을 사용해 주세요.
            </p>
          )}
        </section>
      )}

      <div className="live-call-status" role="status">
        <span data-state={callState} aria-hidden="true" />
        <strong>{callState === 'connected' ? '통화 중' : callState === 'connecting' ? '연결 중' : callState === 'ended' ? '통화 종료' : '연결 전'}</strong>
        <span><Users aria-hidden="true" /> {participantCount}명 참여</span>
      </div>

      {error && <p className="live-call-error" role="alert">{error}</p>}

      {callState === 'idle' && (
        <div className="live-call-start-actions">
          <button type="button" className="live-call-primary" onClick={() => void connect()}>
            <PhoneCall aria-hidden="true" /> 통화 연결
          </button>
          {onCancel && <button type="button" className="live-call-secondary" onClick={onCancel}>다른 방법 선택</button>}
        </div>
      )}

      {callState === 'connecting' && <p className="live-call-wait">마이크와 통화방을 연결하고 있습니다.</p>}

      {(callState === 'connected' || callState === 'finishing') && (
        <>
          <section className="live-call-captions" aria-label="실시간 자막" aria-live="polite">
            <header>
              <h3>실시간 자막</h3>
              {join.role === 'surveyor' && <span>상대 발화 {finalResidentTurns}개</span>}
            </header>
            {captions.length === 0
              ? <p className="live-call-caption-empty">자막 대기 중</p>
              : <ol ref={captionsListRef}>{captions.map((caption) => (
                  <li key={`${caption.role}-${caption.itemId}`} data-role={caption.role} data-final={caption.final}>
                    <strong>{speakerLabel(caption.role)}</strong>
                    <p>{caption.text}</p>
                    {!caption.final && <span>듣는 중</span>}
                  </li>
                ))}</ol>}
          </section>

          {join.role === 'surveyor' && (
            <LiveChecklistPreview
              candidate={liveCandidate}
              captions={captions}
              pending={candidatePending}
              error={candidateError}
            />
          )}

          <div ref={liveFlowEndRef} className="live-call-follow-anchor" aria-hidden="true" />

          <div className="live-call-controls">
            <button type="button" className="live-call-secondary" onClick={() => void toggleMuted()} disabled={callState === 'finishing'}>
              {muted ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
              {muted ? '마이크 켜기' : '마이크 끄기'}
            </button>
            <button type="button" className="live-call-end" onClick={() => void finish()} disabled={callState === 'finishing'}>
              <PhoneOff aria-hidden="true" />
              {join.role === 'surveyor' ? '통화 종료하고 체크리스트 만들기' : '통화 종료'}
            </button>
          </div>
        </>
      )}

      {callState === 'ended' && !error && <p className="live-call-ended" role="status">통화가 종료되었습니다.</p>}
    </section>
  )
}
