import { useEffect, useState } from 'react'
import { PhoneCall } from 'lucide-react'

import { parseGuestInviteCode, redeemGuestInvite, type LiveCallJoin } from './liveCallClient'
import { LiveCallPanel } from './LiveCallPanel'

export function LiveCallPage() {
  const [inviteCode] = useState(() => parseGuestInviteCode(window.location.search))
  const [join, setJoin] = useState<LiveCallJoin | null>(null)
  const [status, setStatus] = useState<'loading' | 'invalid' | 'ready'>(() => inviteCode ? 'loading' : 'invalid')

  useEffect(() => {
    if (!inviteCode) return undefined
    let active = true
    redeemGuestInvite(inviteCode)
      .then((value) => {
        if (!active) return
        setJoin(value)
        setStatus('ready')
      })
      .catch(() => {
        if (active) setStatus('invalid')
      })
    return () => { active = false }
  }, [inviteCode])

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
          : <section className="guest-call-invalid" role="alert">
            <h2>참여 링크를 다시 받아 주세요</h2>
            <p>링크가 만료되었거나 올바르지 않습니다. 연결단원에게 새 참여 링크를 요청해 주세요.</p>
          </section>}
    </main>
  )
}
