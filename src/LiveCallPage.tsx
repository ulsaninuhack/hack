import { useEffect, useState } from 'react'
import { PhoneCall } from 'lucide-react'

import { parseGuestJoinFragment, type LiveCallJoin } from './liveCallClient'
import { LiveCallPanel } from './LiveCallPanel'

export function LiveCallPage() {
  const [join] = useState<LiveCallJoin | null>(() => parseGuestJoinFragment(window.location.hash))

  useEffect(() => {
    window.history.replaceState(null, '', '/call')
  }, [])

  return (
    <main className="guest-call-page">
      <header>
        <span className="guest-call-mark"><PhoneCall aria-hidden="true" /></span>
        <div>
          <p>이웃연결단 안부확인</p>
          <h1>안부 통화 참여</h1>
        </div>
      </header>

      {join
        ? <LiveCallPanel join={join} />
        : <section className="guest-call-invalid" role="alert">
            <h2>참여 링크를 다시 받아 주세요</h2>
            <p>링크가 만료되었거나 올바르지 않습니다. 연결단원에게 새 참여 링크를 요청해 주세요.</p>
          </section>}
    </main>
  )
}
