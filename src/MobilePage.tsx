import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, MapPinned, Mic, Phone, RefreshCw, Send, X } from 'lucide-react'
import MapView from './MapView'
import { loadData } from './data'
import type { DataBundle } from './types'
import {
  CONTACT_OPS_REFERENCE_DATE,
  ContactOpsClientError,
  emptyObservations,
  submitContact,
} from './contactOpsClient'
import type { CanonicalObservations, ContactResultLabel } from './contactOpsClient'
import {
  contactResultLabelFromCode,
  loadReportCard,
  loadTodayLanes,
  uploadVoiceObservationAudio,
} from './threeTierClient'
import type { LaneItem, ReportCard, TodayLanes, VoiceCandidate } from './threeTierClient'

const CONTACT_LABELS: ContactResultLabel[] = [
  '안부 확인 완료', '우려 사항 있음', '미응답', '연락 거부', '연락처 확인 필요',
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
type InputPath = 'voice' | 'chat' | 'manual'

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

export function MobilePage() {
  const [step, setStep] = useState<Step>('list')
  const [lane, setLane] = useState<'phone' | 'visit'>('phone')
  const [lanesData, setLanesData] = useState<TodayLanes | null>(null)
  const [selected, setSelected] = useState<LaneItem | null>(null)
  const [inputPath, setInputPath] = useState<InputPath | null>(null)
  const [resultLabel, setResultLabel] = useState<ContactResultLabel | ''>('')
  const [observations, setObservations] = useState<CanonicalObservations>(emptyObservations)
  const [candidateNote, setCandidateNote] = useState<string | null>(null)
  const [criticWarnings, setCriticWarnings] = useState<string[]>([])
  const [chatIndex, setChatIndex] = useState(0)
  const [chatLog, setChatLog] = useState<Array<{ prompt: string; answer: string }>>([])
  const [showDial, setShowDial] = useState(false)
  const [reportCard, setReportCard] = useState<ReportCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [visitMapOpen, setVisitMapOpen] = useState(false)
  const [mapData, setMapData] = useState<DataBundle | null>(null)

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

  const items = useMemo(() => lanesData?.lanes[lane] ?? [], [lanesData, lane])

  const openCase = (item: LaneItem) => {
    setSelected(item)
    setStep('case')
    setVisitMapOpen(false)
    setInputPath(null)
    setResultLabel('')
    setObservations(emptyObservations())
    setCandidateNote(null)
    setCriticWarnings([])
    setChatIndex(0)
    setChatLog([])
    setShowDial(false)
  }

  const applyVoiceCandidate = (candidate: VoiceCandidate) => {
    setObservations(candidate.observations)
    setResultLabel(contactResultLabelFromCode(candidate.contact_result))
    setCandidateNote('음성에서 만든 후보입니다. 아래 체크리스트를 확인하고 고친 뒤 제출해 주세요.')
    setCriticWarnings([
      ...candidate.critic.contradictions,
      ...candidate.critic.warnings,
      ...candidate.critic.missing_fields.map((field) => `누락 확인: ${field}`),
    ])
  }

  const onVoiceFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selected) return
    try {
      setBusy(true)
      setError(null)
      const response = await uploadVoiceObservationAudio({ caseId: selected.case_id, revision: selected.revision, file })
      applyVoiceCandidate(response.candidate)
    } catch (cause) {
      setError(errorText(cause, '음성 파일에서 후보를 만들지 못했습니다. 수동 입력을 사용할 수 있습니다.'))
    } finally {
      setBusy(false)
      event.target.value = ''
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
      setError(errorText(cause, '통화 결과를 저장하지 못했습니다.'))
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
          <p className="tier-audience">{lanesData?.dong_name ?? '신포동'} · 기준일 {CONTACT_OPS_REFERENCE_DATE}</p>
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
          <h2 id="mobile-today-heading">오늘 연락·방문</h2>
          <div className="lane-tabs" role="tablist" aria-label="전화 목록과 방문 목록">
            <button role="tab" aria-selected={lane === 'phone'} onClick={() => setLane('phone')}>
              <Phone aria-hidden="true" size={18} /> 전화 {lanesData?.lanes.phone.length ?? 0}건
            </button>
            <button role="tab" aria-selected={lane === 'visit'} onClick={() => setLane('visit')}>
              방문 {lanesData?.lanes.visit.length ?? 0}건
            </button>
          </div>
          <p className="lane-rule">방문 목록에는 승인된 방문과 방문 선호 예정 업무만 나옵니다.</p>
          {loading && !lanesData ? <p className="ops-state" role="status">오늘 목록을 불러오는 중입니다.</p> : (
            <ul className="mobile-task-list" aria-label={lane === 'phone' ? '오늘 전화 목록' : '오늘 방문 목록'}>
              {items.length === 0 ? <li className="ops-empty">오늘 이 목록에는 예정된 업무가 없습니다.</li>
                : items.map((item) => (
                  <li key={item.case_id}>
                    <button className="mobile-task" onClick={() => openCase(item)}>
                      <span className="case-id">{item.display_name} 어르신</span>
                      <LaneBadge item={item} />
                      <span className="mobile-task-meta">
                        {item.location.dong_name} · 마지막 연락 {item.last_contact.date ?? '기록 없음'} · {item.last_contact.result_label}
                      </span>
                      {item.lane === 'visit' && item.visit_context && (
                        <span className="mobile-task-meta">
                          선호 시간 {item.visit_context.preferred_visit_time_window.start}~{item.visit_context.preferred_visit_time_window.end}
                          {item.visit_context.requires_public_official_companion ? ' · 공무원 동행 필요' : ''}
                          {item.visit_context.requires_two_person_team ? ' · 2인 1조' : ''}
                        </span>
                      )}
                      {item.lane === 'visit' && item.location.road_address && (
                        <span className="mobile-task-meta">{item.location.road_address}{item.location.building_name ? ` (${item.location.building_name})` : ''}</span>
                      )}
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
          <dl className="mobile-case-facts">
            <div><dt>등급</dt><dd><LaneBadge item={selected} /> <small>({selected.grade_source})</small></dd></div>
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
                    showBubbles={false}
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

          <h2>통화 결과 입력</h2>
          {inputPath === null && (
            <div className="mobile-input-paths" role="group" aria-label="입력 방법 선택">
              <button onClick={() => setInputPath('voice')}><Mic aria-hidden="true" /> 음성 파일로 채우기</button>
              <button onClick={() => setInputPath('chat')}>문답 또는 직접 체크하기</button>
              <p className="mobile-path-note">두 방법 모두 같은 체크리스트로 모입니다. 제출 전 조사원 확인이 항상 필요합니다.</p>
            </div>
          )}

          {inputPath === 'voice' && !candidateNote && (
            <div className="mobile-voice">
              <label className="mobile-voice-label">통화 녹음 파일 (WAV·MP3·M4A)
                <input type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" onChange={onVoiceFile} disabled={busy} />
              </label>
              <p className="mobile-path-note">파일에서 전사·후보를 만든 뒤 체크리스트 후보를 채웁니다. 자동 제출되지 않습니다.</p>
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
              <p className="mobile-path-note">답한 내용은 후보로만 채워집니다. 마지막에 체크리스트에서 확인하고 고칠 수 있습니다.</p>
              <button className="mobile-secondary" onClick={() => setInputPath('manual')}>직접 체크하기</button>
              <button className="mobile-secondary" onClick={() => setInputPath(null)}>다른 방법 선택</button>
            </div>
          )}

          {(inputPath === 'manual' || candidateNote !== null) && (
            <form className="mobile-checklist" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              {candidateNote && <p className="mobile-candidate-note" role="note">{candidateNote}</p>}
              {criticWarnings.length > 0 && (
                <ul className="mobile-critic" aria-label="후보 검토 주의사항">
                  {criticWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}
              <label>통화 결과
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
            <div><dt>급성도</dt><dd>{reportCard.급성도_점수}</dd></div>
            <div><dt>취약도</dt><dd>{reportCard.취약도_점수}</dd></div>
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
