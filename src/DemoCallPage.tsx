import { useEffect, useState } from 'react'
import { PhoneCall } from 'lucide-react'

import { joinDemoCall, type LiveCallJoin } from './liveCallClient'
import { LiveCallPanel } from './LiveCallPanel'

type DemoCallStatus = 'loading' | 'unavailable' | 'ready'

export function DemoCallPage() {
  const [join, setJoin] = useState<LiveCallJoin | null>(null)
  const [status, setStatus] = useState<DemoCallStatus>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setStatus('loading')
    void joinDemoCall()
      .then((value) => {
        if (!active) return
        setJoin(value)
        setStatus('ready')
      })
      .catch(() => {
        if (!active) return
        setStatus('unavailable')
      })
    return () => {
      active = false
    }
  }, [attempt])

  const retryNow = () => setAttempt((value) => value + 1)

  return (
    <main className="guest-call-page">
      <header>
        <span className="guest-call-mark"><PhoneCall aria-hidden="true" /></span>
        <div>
          <p>이웃연결단 안부확인</p>
          <h1>고정 시연 통화방</h1>
        </div>
      </header>

      {status === 'ready' && join
        ? <LiveCallPanel join={join} />
        : status === 'loading'
          ? <section className="guest-call-invalid" aria-live="polite">
              <h2>시연 통화방을 확인하고 있습니다</h2>
            </section>
          : <section className="guest-call-invalid" role="alert">
              <h2>시연 통화방을 준비하지 못했습니다</h2>
              <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
              <button type="button" className="guest-call-retry" onClick={retryNow}>다시 시도</button>
            </section>}
    </main>
  )
}
