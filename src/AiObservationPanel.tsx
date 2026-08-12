import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { CanonicalObservations, CaseDetail } from './contactOpsClient'
import {
  confirmAiObservation,
  createAiObservationCandidate,
  type AiContactResult,
  type AiObservationCandidate,
} from './AiObservationClient'
import './AiObservationPanel.css'

const GRAPH_STEPS = [
  '1. 발화·메모 후보 구조화',
  '2. 형식 검사',
  '3. 모순·누락 확인',
  '4. 규칙·2축 점수 재계산',
  '5. 담당자 결정',
]

const RESULT_BY_LABEL = {
  '안부 확인 완료': ['connected', 'ok'].join('_') as AiContactResult,
  '우려 사항 있음': ['connected', 'concern'].join('_') as AiContactResult,
  '미응답': ['no', 'answer'].join('_') as AiContactResult,
}
const LABEL_BY_RESULT = new Map<AiContactResult, keyof typeof RESULT_BY_LABEL>(
  Object.entries(RESULT_BY_LABEL).map(([label, result]) => [
    result,
    label as keyof typeof RESULT_BY_LABEL,
  ]),
)

const SIGNS: Array<{
  key: keyof CanonicalObservations['관찰_6징후']
  label: string
}> = [
  { key: '우편물_고지서_적체', label: '우편물·고지서 적체' },
  { key: '악취_벌레', label: '악취·벌레' },
  { key: '쓰레기_술병', label: '쓰레기·술병' },
  { key: '인기척_없이_TV_불', label: '인기척 없이 TV·불 켜짐' },
  { key: '외출_없음', label: '최근 외출 없음' },
  { key: '연락_두절', label: '주변에서 확인한 연락 두절' },
]

function message(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function NullableBooleanField({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean | null
  onChange: (value: boolean | null) => void
}) {
  return <label>{label}
    <select
      value={value === null ? '' : String(value)}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}
    >
      <option value="">확인하지 못함</option>
      <option value="false">해당 없음</option>
      <option value="true">관찰 또는 보고됨</option>
    </select>
  </label>
}

function CriticList({ title, values }: { title: string; values: string[] }) {
  return <section className="ai-critic-list">
    <h4>{title}</h4>
    {values.length === 0 ? <p>표시된 항목 없음</p> : <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>}
  </section>
}

function CandidateEditor({
  candidate,
  onChange,
}: {
  candidate: AiObservationCandidate
  onChange: (value: AiObservationCandidate) => void
}) {
  const updateObservation = <K extends keyof CanonicalObservations>(
    key: K,
    value: CanonicalObservations[K],
  ) => onChange({
    ...candidate,
    observations: { ...candidate.observations, [key]: value },
  })
  const updateSign = (key: keyof CanonicalObservations['관찰_6징후'], checked: boolean) => {
    updateObservation('관찰_6징후', { ...candidate.observations.관찰_6징후, [key]: checked })
  }

  return <section className="ai-candidate" aria-labelledby="ai-candidate-heading">
    <header>
      <span>[합성]</span>
      <div>
        <h3 id="ai-candidate-heading">AI 후보 · 자동 승인 아님</h3>
        <p>후보 사실만 검토합니다. 점수와 방문·이관 결정은 이 화면에서 만들지 않습니다.</p>
      </div>
    </header>
    <label>AI 후보 연락 결과
      <select
        value={LABEL_BY_RESULT.get(candidate.contact_result)}
        onChange={(event) => onChange({
          ...candidate,
          contact_result: RESULT_BY_LABEL[event.target.value as keyof typeof RESULT_BY_LABEL],
        })}
      >
        {Object.keys(RESULT_BY_LABEL).map((label) => <option key={label}>{label}</option>)}
      </select>
    </label>
    <fieldset>
      <legend>AI 후보 관찰 6징후</legend>
      <div className="ai-signs">
        {SIGNS.map((sign) => <label key={sign.key}>
          <input
            type="checkbox"
            checked={candidate.observations.관찰_6징후[sign.key]}
            onChange={(event) => updateSign(sign.key, event.target.checked)}
          />
          <span>AI 후보 {sign.label}</span>
        </label>)}
      </div>
    </fieldset>
    <div className="ai-field-grid">
      <label>AI 후보 식사 상태
        <select value={candidate.observations.식사상태 ?? ''} onChange={(event) => updateObservation('식사상태', (event.target.value || null) as CanonicalObservations['식사상태'])}>
          <option value="">확인하지 못함</option><option>양호</option><option>불량</option><option>심각</option>
        </select>
      </label>
      <label>AI 후보 위생 상태
        <select value={candidate.observations.위생상태 ?? ''} onChange={(event) => updateObservation('위생상태', (event.target.value || null) as CanonicalObservations['위생상태'])}>
          <option value="">확인하지 못함</option><option>양호</option><option>불량</option>
        </select>
      </label>
      <NullableBooleanField label="AI 후보 공과금 2개월 이상 체납" value={candidate.observations.공과금_2개월_이상_체납} onChange={(value) => updateObservation('공과금_2개월_이상_체납', value)} />
      <NullableBooleanField label="AI 후보 최근 건강·정신적 괴로움" value={candidate.observations.최근_건강_정신_괴로움} onChange={(value) => updateObservation('최근_건강_정신_괴로움', value)} />
      <label>AI 후보 도움 관계망
        <select value={candidate.observations.관계망_유무 ?? ''} onChange={(event) => updateObservation('관계망_유무', (event.target.value || null) as CanonicalObservations['관계망_유무'])}>
          <option value="">확인하지 못함</option><option>있음</option><option>없음</option>
        </select>
      </label>
      <label>AI 후보 평소 연락 빈도
        <select value={candidate.observations.연락_빈도 ?? ''} onChange={(event) => updateObservation('연락_빈도', (event.target.value || null) as CanonicalObservations['연락_빈도'])}>
          <option value="">확인하지 못함</option>
          <option value="주_1회_이상">주 1회 이상</option>
          <option value="주_1회_미만">주 1회 미만</option>
          <option value="없음">연락 없음</option>
        </select>
      </label>
    </div>
    <label>AI 후보 자유 메모
      <textarea value={candidate.free_text} onChange={(event) => onChange({ ...candidate, free_text: event.target.value })} />
    </label>
    <section className="ai-critic" aria-labelledby="ai-critic-heading">
      <h3 id="ai-critic-heading">비평(Critic) 검토 결과</h3>
      <CriticList title="누락 필드" values={candidate.critic.missing_fields} />
      <CriticList title="모순 확인" values={candidate.critic.contradictions} />
      <CriticList title="낮은 확신 필드" values={candidate.critic.low_confidence_fields} />
      <CriticList title="정규화 안내" values={candidate.critic.warnings} />
    </section>
  </section>
}

export function AiObservationPanel({
  caseId,
  revision,
  onApplied,
}: {
  caseId: string
  revision: number
  onApplied: (detail: CaseDetail) => void | Promise<void>
}) {
  const [sourceKind, setSourceKind] = useState<'text' | 'audio'>('text')
  const [text, setText] = useState('')
  const [fileReference, setFileReference] = useState('')
  const [consented, setConsented] = useState(false)
  const [candidate, setCandidate] = useState<AiObservationCandidate | null>(null)
  const [confirmedReview, setConfirmedReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    setCandidate(null)
    setConfirmedReview(false)
    setError('')
    setFeedback('')
  }, [caseId])

  const canCreate = consented && !busy
    && (sourceKind === 'text' ? text.trim() !== '' : fileReference.trim() !== '')

  const createCandidate = async (event: FormEvent) => {
    event.preventDefault()
    if (!canCreate) return
    try {
      setBusy(true)
      setError('')
      setFeedback('')
      const response = await createAiObservationCandidate({
        caseId,
        revision,
        source: sourceKind === 'text'
          ? { kind: 'text', text }
          : { kind: 'audio', fileReference },
      })
      setCandidate(response.candidate)
      setConfirmedReview(false)
      setFeedback('AI 후보가 준비되었습니다. Critic 표시와 관찰 사실을 직접 확인해 주세요.')
    } catch (cause) {
      setError(message(cause, 'AI 후보를 만들지 못했습니다. 수동 입력을 계속 사용할 수 있습니다.'))
    } finally {
      setBusy(false)
    }
  }

  const confirmCandidate = async () => {
    if (!candidate || !confirmedReview || busy) return
    try {
      setBusy(true)
      setError('')
      const updated = await confirmAiObservation({ caseId, revision, candidate })
      await onApplied(updated)
      setCandidate(null)
      setConfirmedReview(false)
      setFeedback('검토한 후보를 기록하고 연락업무 순서를 다시 계산했습니다. 담당자 결정은 별도입니다.')
    } catch (cause) {
      setError(message(cause, 'AI 후보를 기록하지 못했습니다. 입력과 후보는 그대로 유지됩니다.'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="ai-observation-panel" aria-labelledby="ai-observation-heading">
    <header className="ai-observation-heading">
      <span>[합성]</span>
      <div>
        <h2 id="ai-observation-heading">인공지능(AI) 관찰 후보 검토</h2>
        <p>AI 후보 · 자동 승인 아님 · 수동 통화 결과 입력은 언제든 계속 사용할 수 있습니다.</p>
      </div>
    </header>
    <ol className="ai-graph" aria-label="AI 후보 처리 단계">
      {GRAPH_STEPS.map((step, index) => <li key={step} data-complete={candidate ? index < 4 : false}>{step}</li>)}
    </ol>
    <form className="ai-source-form" onSubmit={createCandidate}>
      <fieldset>
        <legend>동의받은 입력 선택</legend>
        <label className="ai-choice"><input type="radio" checked={sourceKind === 'text'} onChange={() => setSourceKind('text')} /><span>마스킹 텍스트</span></label>
        <label className="ai-choice"><input type="radio" checked={sourceKind === 'audio'} onChange={() => setSourceKind('audio')} /><span>검증된 음성 참조</span></label>
      </fieldset>
      {sourceKind === 'text' ? <label>동의받은 비식별·마스킹 텍스트
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="실제 이름·주소·연락처 없이 관찰 메모를 입력해 주세요." />
      </label> : <div className="ai-labeled-control">
        <label htmlFor="ai-audio-reference">검증된 WAV 또는 MP3 참조 이름</label>
        <input id="ai-audio-reference" aria-describedby="ai-audio-reference-help" value={fileReference} onChange={(event) => setFileReference(event.target.value)} placeholder="staged-consented-memo.wav" />
        <small id="ai-audio-reference-help">브라우저 파일 업로드가 아닙니다. 서버 준비 디렉터리에 사전 검증되어 놓인 참조 이름만 입력합니다.</small>
      </div>}
      <label className="ai-consent"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span>동의를 받은 비식별·마스킹 입력입니다.</span></label>
      <button type="submit" disabled={!canCreate}>{busy && !candidate ? '후보 생성 중' : 'AI 관찰 후보 만들기'}</button>
    </form>
    {error && <p className="ai-error" role="alert">{error}</p>}
    {feedback && <p className="ai-feedback" role="status" aria-live="polite">{feedback}</p>}
    {candidate && <>
      <CandidateEditor candidate={candidate} onChange={setCandidate} />
      <section className="ai-confirmation">
        <h3>사용자 명시 확인</h3>
        <label className="ai-consent"><input type="checkbox" checked={confirmedReview} onChange={(event) => setConfirmedReview(event.target.checked)} /><span>검토한 후보를 결정론적 규칙 입력으로 사용합니다.</span></label>
        <p>확인 후에도 방문이나 이관은 자동 확정되지 않습니다. 담당자 승인 경계는 유지됩니다.</p>
        <button type="button" disabled={!confirmedReview || busy} onClick={() => void confirmCandidate()}>{busy ? '기록 중' : '검토한 AI 후보 명시 확인'}</button>
      </section>
    </>}
  </section>
}
