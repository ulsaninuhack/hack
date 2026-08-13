import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Mic, MicOff, PhoneCall, PhoneOff, Share2, Users } from 'lucide-react'
import QRCode from 'qrcode'

import type { LiveCallJoin } from './liveCallClient'
import { connectLiveCallSession, type LiveCallSession } from './liveCallSession'
import { appendCaption, residentTranscript, type LiveCaption } from './liveCallTranscript'

type CallState = 'idle' | 'connecting' | 'connected' | 'finishing' | 'ended'

interface LiveCallPanelProps {
  join: LiveCallJoin
  inviteUrl?: string
  onFinish?: (residentTranscript: string) => Promise<void> | void
  onCancel?: () => void
}

function speakerLabel(role: LiveCaption['role']) {
  return role === 'surveyor' ? '연결단원' : '연락 대상'
}

function liveErrorText(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return '마이크 권한이 필요합니다. 브라우저 주소창의 권한을 허용한 뒤 다시 연결해 주세요.'
  }
  return cause instanceof Error && cause.message.includes('마이크')
    ? cause.message
    : '실시간 통화를 연결하지 못했습니다. 음성 파일 또는 직접 입력을 사용해 주세요.'
}

export function LiveCallPanel({ join, inviteUrl, onFinish, onCancel }: LiveCallPanelProps) {
  const canShare = typeof navigator.share === 'function'
  const [callState, setCallState] = useState<CallState>('idle')
  const [captions, setCaptions] = useState<LiveCaption[]>([])
  const [participantCount, setParticipantCount] = useState(1)
  const [muted, setMutedState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const sessionRef = useRef<LiveCallSession | null>(null)
  const audioRef = useRef<HTMLDivElement>(null)
  const captionsRef = useRef<LiveCaption[]>([])

  const finalResidentTurns = useMemo(
    () => captions.filter((caption) => caption.role === 'resident' && caption.final).length,
    [captions],
  )

  useEffect(() => {
    if (!inviteUrl) {
      setQrCode(null)
      return
    }
    let active = true
    void QRCode.toDataURL(inviteUrl, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
      .then((value) => { if (active) setQrCode(value) })
      .catch(() => { if (active) setQrCode(null) })
    return () => { active = false }
  }, [inviteUrl])

  useEffect(() => () => {
    void sessionRef.current?.disconnect()
    sessionRef.current = null
  }, [])

  const receiveCaption = (caption: LiveCaption) => {
    setCaptions((current) => {
      const next = appendCaption(current, caption)
      captionsRef.current = next
      return next
    })
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
          {qrCode && <img src={qrCode} alt="연락 대상 참여 QR 코드" width="160" height="160" />}
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
              {join.role === 'surveyor' && <span>연락 대상 확정 발화 {finalResidentTurns}개</span>}
            </header>
            {captions.length === 0
              ? <p className="live-call-caption-empty">말을 시작하면 발화자별 자막이 표시됩니다.</p>
              : <ol>{captions.map((caption) => (
                  <li key={`${caption.role}-${caption.itemId}`} data-role={caption.role} data-final={caption.final}>
                    <strong>{speakerLabel(caption.role)}</strong>
                    <p>{caption.text}</p>
                    {!caption.final && <span>듣는 중</span>}
                  </li>
                ))}</ol>}
          </section>

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
