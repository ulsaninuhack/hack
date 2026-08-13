import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, HelpCircle, LoaderCircle, Mic, MicOff, PhoneCall, PhoneOff, Share2, Users } from 'lucide-react'
import QRCode from 'qrcode'

import type { LiveCallJoin } from './liveCallClient'
import { isCandidateValuePending, selectLiveNextQuestion } from './liveCandidatePolicy'
import { connectLiveCallSession, type LiveCallSession } from './liveCallSession'
import { appendCaption, residentTranscript, type LiveCaption } from './liveCallTranscript'
import type { VoiceCandidate } from './threeTierClient'

type CallState = 'idle' | 'connecting' | 'connected' | 'finishing' | 'ended'

interface LiveCallPanelProps {
  join: LiveCallJoin
  inviteUrl?: string
  inviteMode?: 'qr' | 'fixed-demo'
  targetDisplayName?: string
  onFinish?: (residentTranscript: string) => Promise<void> | void
  onTranscriptUpdate?: (residentTranscript: string) => void
  liveCandidate?: Pick<VoiceCandidate, 'contact_result' | 'transcript' | 'observations' | 'critic'> | null
  candidatePending?: boolean
  candidateError?: string | null
  onCancel?: () => void
}

function speakerLabel(role: LiveCaption['role'], targetDisplayName?: string) {
  return role === 'surveyor' ? '연결단원' : (targetDisplayName ?? '상대방')
}

function liveErrorText(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return '마이크 권한을 허용한 뒤 다시 연결해 주세요.'
  }
  return cause instanceof Error && cause.message.includes('마이크')
    ? cause.message
    : '실시간 통화를 연결하지 못했습니다. 음성 파일 또는 직접 입력을 사용해 주세요.'
}

function LiveChecklistPreview({
  candidate,
  pending,
  error,
}: {
  candidate?: Pick<VoiceCandidate, 'contact_result' | 'transcript' | 'observations' | 'critic'> | null
  pending: boolean
  error?: string | null
}) {
  const outingMissing = !candidate
    || candidate.critic.missing_fields.includes('관찰_6징후.외출_없음')
  const statusRows = [
    {
      label: '최근 외출',
      value: outingMissing
        ? null
        : candidate.observations.관찰_6징후.외출_없음 ? '없음' : '있음',
      pending: false,
    },
    {
      label: '식사 상태',
      value: candidate?.observations.식사상태 ?? null,
      pending: candidate ? isCandidateValuePending(candidate, '식사상태') : false,
    },
    {
      label: '위생 상태',
      value: candidate?.observations.위생상태 ?? null,
      pending: candidate ? isCandidateValuePending(candidate, '위생상태') : false,
    },
    {
      label: '도움 관계망',
      value: candidate?.observations.관계망_유무 ?? null,
      pending: candidate ? isCandidateValuePending(candidate, '관계망_유무') : false,
    },
    {
      label: '건강·마음 어려움',
      value: candidate?.observations.최근_건강_정신_괴로움 == null
        ? null
        : candidate.observations.최근_건강_정신_괴로움 ? '어려움 있음' : '어려움 없음',
      pending: candidate ? isCandidateValuePending(candidate, '최근_건강_정신_괴로움') : false,
    },
    {
      label: '공과금 체납',
      value: candidate?.observations.공과금_2개월_이상_체납 == null
        ? null
        : candidate.observations.공과금_2개월_이상_체납 ? '체납 있음' : '체납 없음',
      pending: candidate ? isCandidateValuePending(candidate, '공과금_2개월_이상_체납') : false,
    },
  ]

  return <section className="live-checklist-preview" aria-label="통화 중 확인할 항목">
    <header>
      <h3>통화 중 확인할 항목</h3>
      {pending && <p role="status">항목 갱신 중</p>}
    </header>
    {error && <p className="live-candidate-error" role="status">{error}</p>}
    <ul className="live-candidate-grid">
      {statusRows.map((row) => {
        const checked = row.value !== null
        return <li key={row.label} data-candidate={checked}>
          {checked ? <Check aria-hidden="true" /> : <span aria-hidden="true">—</span>}
          <strong>{row.label}</strong>
          <em>{row.value === null ? '미확인' : `${row.value}${row.pending ? ' (보류)' : ''}`}</em>
        </li>
      })}
    </ul>
  </section>
}

function LiveNextQuestion({ question, pending }: { question: string; pending: boolean }) {
  return <section className="live-next-question" aria-labelledby="live-next-question-heading" aria-busy={pending}>
    <HelpCircle aria-hidden="true" />
    <div>
      <h4 id="live-next-question-heading">다음 확인 질문</h4>
      <p>{question}</p>
    </div>
  </section>
}

export function LiveCallPanel({
  join,
  inviteUrl,
  inviteMode = 'qr',
  targetDisplayName,
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

  const finalResidentTurns = useMemo(
    () => captions.filter((caption) => caption.role === 'resident' && caption.final).length,
    [captions],
  )
  const nextQuestion = selectLiveNextQuestion(liveCandidate)

  useEffect(() => {
    if (!inviteUrl || inviteMode === 'fixed-demo') {
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
  }, [inviteMode, inviteUrl])

  useEffect(() => () => {
    void sessionRef.current?.disconnect()
    sessionRef.current = null
  }, [])

  useEffect(() => {
    if (!['connected', 'finishing'].includes(callState) || captions.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      const list = captionsListRef.current
      if (list) list.scrollTop = list.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [callState, captions])

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
      setShareStatus(inviteMode === 'fixed-demo'
        ? '고정 링크를 복사하지 못했습니다. 화면의 주소를 직접 입력해 주세요.'
        : '링크를 복사하지 못했습니다. QR 코드를 사용해 주세요.')
    }
  }

  return (
    <section className="live-call-panel" aria-label="실시간 통화" aria-busy={callState === 'finishing'}>
      <div ref={audioRef} aria-hidden="true" />

      {inviteUrl && inviteMode === 'fixed-demo' && callState === 'idle' && (
        <section className="live-call-fixed-invite" aria-label="연락 대상 초대">
          <h3>시연 고정 입장 주소</h3>
          <p>상대방은 미리 이 주소를 열어 두면 됩니다. QR 촬영은 필요하지 않습니다.</p>
          <code>{inviteUrl}</code>
          <button type="button" className="live-call-share" onClick={() => void shareInvite()}>
            {canShare ? <Share2 aria-hidden="true" /> : <Copy aria-hidden="true" />}
            고정 링크 {canShare ? '보내기' : '복사'}
          </button>
          {shareStatus && <p role="status" className="live-call-share-status">{shareStatus}</p>}
        </section>
      )}

      {inviteUrl && inviteMode === 'qr' && callState === 'idle' && (
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
        <strong>{callState === 'connected' ? '통화 중' : callState === 'finishing' ? '통화 종료 중' : callState === 'connecting' ? '연결 중' : callState === 'ended' ? '통화 종료' : '연결 전'}</strong>
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
                    <strong>{speakerLabel(caption.role, targetDisplayName)}</strong>
                    <p>{caption.text}</p>
                    {!caption.final && <span>듣는 중</span>}
                  </li>
                ))}</ol>}
          </section>

          {join.role === 'surveyor' && nextQuestion && (
            <LiveNextQuestion question={nextQuestion} pending={candidatePending} />
          )}

          {join.role === 'surveyor' && (
            <LiveChecklistPreview
              candidate={liveCandidate}
              pending={candidatePending}
              error={candidateError}
            />
          )}

          <div className="live-call-controls">
            <button type="button" className="live-call-secondary" onClick={() => void toggleMuted()} disabled={callState === 'finishing'}>
              {muted ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
              {muted ? '마이크 켜기' : '마이크 끄기'}
            </button>
            <button type="button" className="live-call-end" onClick={() => void finish()} disabled={callState === 'finishing'}>
              {callState === 'finishing'
                ? <><LoaderCircle className="live-call-spinner" aria-hidden="true" /> 마지막 대화 정리 중</>
                : <><PhoneOff aria-hidden="true" /> 통화 종료</>}
            </button>
          </div>
        </>
      )}

      {callState === 'ended' && !error && <p className="live-call-ended" role="status">통화가 종료되었습니다.</p>}
    </section>
  )
}
