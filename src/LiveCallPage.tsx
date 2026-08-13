import { useEffect, useState } from 'react'
import { PhoneCall } from 'lucide-react'

import { ContactOpsClientError } from './contactOpsClient'
import { parseGuestInviteCode, redeemGuestInvite, type LiveCallJoin } from './liveCallClient'
import { LiveCallPanel } from './LiveCallPanel'

type InviteStatus = 'loading' | 'invalid' | 'unavailable' | 'ready'

function isInvalidInvite(cause: unknown) {
  return cause instanceof ContactOpsClientError
    && ['INVALID_INVITE', 'INVITE_EXPIRED'].includes(cause.code)
}

export function LiveCallPage() {
  const [inviteCode] = useState(() => parseGuestInviteCode(window.location.search))
  const [join, setJoin] = useState<LiveCallJoin | null>(null)
  const [status, setStatus] = useState<InviteStatus>(() => inviteCode ? 'loading' : 'invalid')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!inviteCode) return undefined
    let active = true
    setJoin(null)
    setStatus('loading')
    redeemGuestInvite(inviteCode)
      .then((value) => {
        if (!active) return
        setJoin(value)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (active) setStatus(isInvalidInvite(cause) ? 'invalid' : 'unavailable')
      })
    return () => { active = false }
  }, [attempt, inviteCode])

  return (
    <main className="guest-call-page">
      <header>
        <span className="guest-call-mark"><PhoneCall aria-hidden="true" /></span>
        <div>
          <p>이웃연결단 안부확인</p>
          <h1>안부 통화 참여</h1>
        </div>
      </header>

      {status === 'ready' && join
        ? <LiveCallPanel join={join} />
        : status === 'loading'
          ? <section className="guest-call-invalid" aria-live="polite">
              <h2>통화 참여 정보를 확인하고 있습니다</h2>
            </section>
          : status === 'unavailable'
            ? <section className="guest-call-invalid" role="alert">
                <h2>참여 정보를 불러오지 못했습니다</h2>
                <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
                <button type="button" className="guest-call-retry" onClick={() => setAttempt((value) => value + 1)}>
                  다시 시도
                </button>
              </section>
            : <section className="guest-call-invalid" role="alert">
                <h2>참여 링크를 다시 받아 주세요</h2>
                <p>링크가 만료되었거나 올바르지 않습니다. 연결단원에게 새 참여 링크를 요청해 주세요.</p>
              </section>}
    </main>
  )
}
