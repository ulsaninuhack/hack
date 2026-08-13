import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportCard } from './threeTierClient'

const mocks = vi.hoisted(() => ({
  loadTodayLanes: vi.fn(),
  loadReportCard: vi.fn(),
  uploadVoiceObservationAudio: vi.fn(),
  createAiObservationCandidate: vi.fn(),
  submitContact: vi.fn(),
  submitCaseNote: vi.fn(),
  loadData: vi.fn(),
  createLiveCall: vi.fn(),
  buildGuestInviteUrl: vi.fn(),
}))

vi.mock('./data', () => ({ loadData: mocks.loadData }))
vi.mock('./MapView', () => ({ default: () => <div role="region" aria-label="방문 위치 참고 지도" /> }))

vi.mock('./threeTierClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./threeTierClient')>()
  return {
    ...actual,
    loadTodayLanes: mocks.loadTodayLanes,
    loadReportCard: mocks.loadReportCard,
    uploadVoiceObservationAudio: mocks.uploadVoiceObservationAudio,
    submitCaseNote: mocks.submitCaseNote,
  }
})
vi.mock('./contactOpsClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./contactOpsClient')>()
  return { ...actual, submitContact: mocks.submitContact }
})
vi.mock('./liveCallClient', () => ({
  createLiveCall: mocks.createLiveCall,
  buildGuestInviteUrl: mocks.buildGuestInviteUrl,
}))
vi.mock('./AiObservationClient', () => ({
  createAiObservationCandidate: mocks.createAiObservationCandidate,
}))
vi.mock('./LiveCallPanel', () => ({
  LiveCallPanel: ({ onFinish, onTranscriptUpdate, liveCandidate, targetDisplayName }: {
    onFinish: (transcript: string) => Promise<void>
    onTranscriptUpdate: (transcript: string) => void
    liveCandidate?: { critic: { next_question: string | null } } | null
    targetDisplayName?: string
  }) => (
    <section aria-label="실시간 통화 테스트">
      <p>통화 상대: {targetDisplayName}</p>
      <button type="button" onClick={() => onTranscriptUpdate('밥을 잘 못 먹어요.')}>실시간 발화 테스트</button>
      {liveCandidate?.critic.next_question && <p>{liveCandidate.critic.next_question}</p>}
      <button type="button" onClick={() => void onFinish('밥을 잘 못 먹어요.')}>통화 종료 테스트</button>
    </section>
  ),
}))

import { MobilePage } from './MobilePage'
import { phoneLaneItem as phoneItem, todayLanesFixture as lanes, voiceCandidateConcernResult } from './threeTierTestFixtures'

const reportCard: ReportCard = {
  synthetic: true, displayMarker: '[합성]',
  card_id: 'RPT-SYN-HH-2812551000-0001-r1', case_id: 'SYN-HH-2812551000-0001', display_name: '김영자',
  road_address: '인천광역시 제물포구 답동로 7-2', revision: 1,
  dong_code: '2812551000', dong_name: '신포동', district: '제물포구',
  등급: '방문권고', 급성도_점수: 62, 취약도_점수: 25, 권고_액션: '방문권고',
  사유_요약: [{ 축: '급성도', 근거: '식사상태 심각', 가산점: 25 }],
  evidence: {
    관찰: {
      관찰_6징후: { 우편물_고지서_적체: true, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
      식사상태: '심각', 위생상태: null, 공과금_2개월_이상_체납: null,
      최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
    },
    마지막_연락_일자: '2026-08-12', 마지막_연락_결과_라벨: '연락 안 됨', 연속_미응답_횟수: 2,
  },
  권고_기관: [{ 기관: '보건소·의료 연계', 사유: '식사상태 심각 관찰', 근거_문서: ['매뉴얼_p49'], 성격: '권고', 확정_권한: '동 행정복지센터' }],
  workflow: { follow_up_status: 'required', transfer_status: 'not_required', transfer_label: null, visit_approval_status: 'recommended' },
  virtual_phone: phoneItem.virtual_phone,
  acknowledgement: { status: '미확인' },
}

function arrange() {
  mocks.loadTodayLanes.mockResolvedValue(structuredClone(lanes))
  mocks.loadReportCard.mockResolvedValue({ report_card: structuredClone(reportCard), destination: '동 행정복지센터 인박스' })
  mocks.submitContact.mockResolvedValue({ revision: 1 })
  mocks.submitCaseNote.mockResolvedValue({ case_id: 'SYN-HH-2812551000-0001', 기타사항: '기록됨' })
  mocks.loadData.mockResolvedValue({ dongs: { features: [] }, summary: {} })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('MobilePage (조사원 /m)', () => {
  it('lists the contacts submitted today in the 완료 tab', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await screen.findByLabelText('오늘 전화 목록')
    await user.click(screen.getByRole('tab', { name: /완료 1건/ }))
    const doneList = await screen.findByLabelText('오늘 완료 목록')
    expect(within(doneList).getByText('한금순 어르신')).toBeInTheDocument()
    expect(within(doneList).getByText('안부 확인 완료')).toBeInTheDocument()
    expect(within(doneList).getByText(/제출/)).toBeInTheDocument()
  })

  it('separates phone and visit tabs, visit tab carries time window and companion needs (INV16)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    const phoneList = await screen.findByLabelText('오늘 전화 목록')
    expect(screen.getByRole('heading', { name: '오늘 할당된 연락 대상' })).toBeInTheDocument()
    expect(within(phoneList).getByText('김영자 어르신')).toBeInTheDocument()
    expect(within(phoneList).getByText('오늘 전화 할당 확정')).toBeInTheDocument()
    expect(within(phoneList).getByText('오늘 정기 연락')).toBeInTheDocument()
    expect(within(phoneList).getByText('마지막 정상 연결 이후 7일 경과')).toBeInTheDocument()
    expect(within(phoneList).getByText('연락 기한 2026-08-12')).toBeInTheDocument()
    expect(within(phoneList).getByText('담당 연결단원 001')).toBeInTheDocument()
    expect(within(phoneList).getByText('등록 근거 · 가족 신청')).toBeInTheDocument()
    expect(within(phoneList).queryByText('연락 동의 기록 · 기존 정기 안부확인 중복 없음')).toBeNull()
    expect(within(phoneList).queryByText('미기록')).toBeNull()
    expect(within(phoneList).queryByText('이순자 어르신')).toBeNull()
    await user.click(screen.getByRole('tab', { name: /방문 1건/ }))
    const visitList = await screen.findByLabelText('오늘 방문 목록')
    expect(screen.getByRole('heading', { name: '오늘 방문 대상' })).toBeInTheDocument()
    expect(within(visitList).getByText('이순자 어르신')).toBeInTheDocument()
    expect(within(visitList).getByText('담당자 승인·배치 확인 완료')).toBeInTheDocument()
    expect(within(visitList).getByText('심각도 68점 · 방문권고')).toBeInTheDocument()
    expect(within(visitList).getByText('주요 근거 · 연속 미응답 2회 (+25점)')).toBeInTheDocument()
    expect(within(visitList).queryByText('김영자 어르신')).toBeNull()
    expect(within(visitList).getByText('선호 시간')).toBeInTheDocument()
    expect(within(visitList).getByText(/10:00~13:00/)).toBeInTheDocument()
    expect(within(visitList).getByText(/공무원 동행 필요/)).toBeInTheDocument()
  })

  it('visit cases carry a collapsed map widget; phone cases do not (P3 지도)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByRole('tab', { name: /방문 1건/ }))
    await user.click(await screen.findByText(/이순자 어르신/))
    const mapSummary = screen.getByText('방문 위치 지도 열기')
    expect(mapSummary).toBeInTheDocument()
    await user.click(mapSummary)
    expect(await screen.findByRole('region', { name: '방문 위치 참고 지도' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '오늘 목록으로' }))
    await user.click(screen.getByRole('tab', { name: /전화 1건/ }))
    await user.click(await screen.findByText(/김영자 어르신/))
    expect(screen.queryByText('방문 위치 지도 열기')).toBeNull()
  })

  it('uses the realtime call path without rendering the obsolete virtual dial mock', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    expect(screen.getByRole('button', { name: '실시간 통화 시작' })).toBeInTheDocument()
    expect(screen.queryByText(/\[가상\]|가상 번호|실제 전화는 걸리지 않습니다/)).toBeNull()
    expect(screen.queryByRole('dialog', { name: '가상 발신 화면' })).toBeNull()
    expect(screen.getByText('인천광역시 제물포구 답동로 7-2')).toBeInTheDocument()
  })

  it('manual path submits only after surveyor confirmation and shows the report screen (INV14)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    await user.selectOptions(screen.getByLabelText('통화(또는 방문) 결과'), '미응답')
    await user.click(screen.getByRole('checkbox', { name: '우편물·고지서 적체' }))
    await user.selectOptions(screen.getByLabelText('식사 상태'), '심각')
    await user.type(screen.getByLabelText('기타사항'), '문 앞에 우유가 쌓여 있었어요')
    expect(mocks.submitContact).not.toHaveBeenCalled()
    expect(mocks.submitCaseNote).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '확인하고 제출' }))
    await waitFor(() => expect(mocks.submitContact).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.submitCaseNote).toHaveBeenCalledWith({
      caseId: 'SYN-HH-2812551000-0001', note: '문 앞에 우유가 쌓여 있었어요',
    }))
    const payload = mocks.submitContact.mock.calls[0][0]
    expect(payload.caseId).toBe('SYN-HH-2812551000-0001')
    expect(payload.resultLabel).toBe('미응답')
    expect(payload.observations.관찰_6징후.우편물_고지서_적체).toBe(true)
    expect(payload.observations.식사상태).toBe('심각')
    expect(await screen.findByRole('heading', { name: '동 행정복지센터에 보고됨' })).toBeInTheDocument()
    expect(screen.getByText('김영자 어르신')).toBeInTheDocument()
    expect(screen.getByText('방문권고')).toBeInTheDocument()
    expect(screen.getByText('보건소·의료 연계')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/SYN-HH-|\[합성\]/)
  })

  it('chatbot path fills candidates only and converges to the same checklist (INV14)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '미응답' }))
    await user.click(screen.getByRole('button', { name: '심각' }))
    await user.click(screen.getByRole('button', { name: '확인하지 못함' }))
    await user.click(screen.getByRole('button', { name: '어려움 있음' }))
    await user.click(screen.getByRole('button', { name: '없음' }))
    expect(screen.getByLabelText('통화(또는 방문) 결과')).toBeInTheDocument()
    expect(mocks.submitContact).not.toHaveBeenCalled()
    expect(screen.getByLabelText('통화(또는 방문) 결과')).toHaveValue('미응답')
    expect(screen.getByLabelText('식사 상태')).toHaveValue('심각')
    expect(screen.getByLabelText('도움을 요청할 관계망')).toHaveValue('없음')
    expect(screen.getByLabelText('최근 건강·마음 어려움')).toHaveValue('true')
  })

  it('chatbot answers can be revised by reopening an answered question', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '미응답' }))
    expect(screen.getByText('식사는 어떻게 하고 계셨나요?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /통화\(또는 방문\) 결과는 무엇이었나요\?.*다시 답하기/ }))
    expect(screen.getByText('통화(또는 방문) 결과는 무엇이었나요?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '우려 사항 있음' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    expect(screen.getByLabelText('통화(또는 방문) 결과')).toHaveValue('우려 사항 있음')
  })

  it('the chat path offers a direct jump to the manual checklist (2-way choice)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    expect(screen.queryByRole('button', { name: '직접 체크하기' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    expect(screen.getByRole('heading', { name: '통화(또는 방문) 결과 입력' })).toBeInTheDocument()
    expect(screen.getByLabelText('통화(또는 방문) 결과')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '연락(또는 방문) 거부' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^연락 거부$/ })).toBeNull()
  })

  it('shows a waiting note in the visit lane until the center confirms (배정 파이프라인)', async () => {
    arrange()
    const user = userEvent.setup()
    const waiting = structuredClone(lanes)
    waiting.lanes.visit = []
    waiting.pending_confirmation = { phone: 0, visit: 2 }
    mocks.loadTodayLanes.mockResolvedValue(waiting)
    render(<MobilePage />)
    await user.click(await screen.findByRole('tab', { name: /방문 0건/ }))
    expect(await screen.findByText(/동 센터가 배치를 배정하면 여기에 나타납니다. \(배정 대기 2건\)/)).toBeInTheDocument()
  })

  it('the open visit map exposes an explicit close button', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByRole('tab', { name: /방문 1건/ }))
    await user.click(await screen.findByText(/이순자 어르신/))
    expect(screen.queryByRole('button', { name: '지도 닫기' })).toBeNull()
    await user.click(screen.getByText('방문 위치 지도 열기'))
    expect(await screen.findByRole('region', { name: '방문 위치 참고 지도' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '지도 닫기' }))
    expect(screen.queryByRole('region', { name: '방문 위치 참고 지도' })).toBeNull()
    expect(screen.queryByRole('button', { name: '지도 닫기' })).toBeNull()
  })

  it('separates phone-confirmable outing from visit or surrounding confirmation signs', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    expect(screen.getByText('통화로 확인')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '최근 외출 없음' })).toBeInTheDocument()
    expect(screen.getByText('방문·주변 확인')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '우편물·고지서 적체' })).toBeInTheDocument()
    expect(screen.queryByText(/통화 중 들었거나|이웃·경비 등/)).toBeNull()
    await user.click(screen.getByRole('button', { name: '오늘 목록으로' }))
    await user.click(screen.getByRole('tab', { name: /방문 1건/ }))
    await user.click(await screen.findByText(/이순자 어르신/))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    expect(screen.getByText('방문 관찰 체크리스트')).toBeInTheDocument()
    expect(screen.queryByText('통화로 확인')).toBeNull()
  })

  it('voice path fills checklist candidates from the upload contract without auto-submitting (INV14)', async () => {
    arrange()
    mocks.uploadVoiceObservationAudio.mockResolvedValue({
      synthetic: true, displayMarker: '[합성]', revision: 0,
      candidate: {
        case_id: 'SYN-HH-2812551000-0001',
        contact_result: voiceCandidateConcernResult,
        observations: {
          관찰_6징후: { 우편물_고지서_적체: false, 악취_벌레: true, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
          식사상태: '불량', 위생상태: '불량', 공과금_2개월_이상_체납: null,
          최근_건강_정신_괴로움: true, 관계망_유무: null, 연락_빈도: null,
        },
        transcript: '[마스킹] 통화 내용',
        free_text: '최근 약 복용을 자주 빠뜨린다고 말함',
        critic: { missing_fields: ['관계망_유무'], contradictions: [], low_confidence_fields: [], warnings: ['악취 관련 후보 확인 필요'], next_question: null },
        requires_user_confirmation: true,
      },
    })
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '음성 파일로 채우기' }))
    const file = new File(['RIFFxxxxWAVE'], 'memo.wav', { type: 'audio/wav' })
    await user.upload(screen.getByLabelText(/통화 녹음 파일/), file)
    await waitFor(() => expect(mocks.uploadVoiceObservationAudio).toHaveBeenCalledTimes(1))
    expect(await screen.findByLabelText('통화(또는 방문) 결과')).toBeInTheDocument()
    expect(screen.queryByText('악취 관련 후보 확인 필요')).toBeNull()
    expect(screen.queryByText('누락 확인: 관계망_유무')).toBeNull()
    expect(screen.getByLabelText('기타사항')).toHaveValue('최근 약 복용을 자주 빠뜨린다고 말함')
    expect(screen.queryByText(/해당하는 체크리스트를 확인하면 제출 후 점수에 반영됩니다/)).toBeNull()
    expect(screen.getByLabelText('통화(또는 방문) 결과')).toHaveValue('우려 사항 있음')
    expect(screen.getByRole('checkbox', { name: '악취·벌레' })).toBeChecked()
    expect(mocks.submitContact).not.toHaveBeenCalled()
  })

  it('memo path fills checklist candidates from free text without auto-submitting (INV14)', async () => {
    arrange()
    mocks.createAiObservationCandidate.mockResolvedValue({
      candidate: {
        case_id: 'SYN-HH-2812551000-0001',
        contact_result: ['no', 'answer'].join('_'),
        observations: {
          관찰_6징후: { 우편물_고지서_적체: true, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
          식사상태: null, 위생상태: null, 공과금_2개월_이상_체납: null,
          최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
        },
        transcript: '[마스킹] 메모 내용',
        free_text: '우편함에 고지서가 쌓여 있었음',
        critic: { missing_fields: ['식사상태'], contradictions: [], low_confidence_fields: [], warnings: [], next_question: '오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?' },
        requires_user_confirmation: true,
      },
    })
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: /메모로 채우기/ }))
    await user.type(screen.getByLabelText('통화·방문 메모'), '전화를 안 받으시고 우편함에 고지서가 쌓여 있었어요')
    expect(mocks.createAiObservationCandidate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'AI 후보 만들기' }))
    await waitFor(() => expect(mocks.createAiObservationCandidate).toHaveBeenCalledTimes(1))
    const request = mocks.createAiObservationCandidate.mock.calls[0][0]
    expect(request.caseId).toBe('SYN-HH-2812551000-0001')
    expect(request.source).toEqual({ kind: 'text', text: '전화를 안 받으시고 우편함에 고지서가 쌓여 있었어요' })
    expect(await screen.findByLabelText('통화(또는 방문) 결과')).toBeInTheDocument()
    expect(screen.queryByText('누락 확인: 식사상태')).toBeNull()
    expect(screen.queryByRole('heading', { name: '다음 확인 질문' })).toBeNull()
    expect(screen.queryByText('오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?')).toBeNull()
    expect(screen.getByLabelText('통화(또는 방문) 결과')).toHaveValue('미응답')
    expect(screen.getByRole('checkbox', { name: '우편물·고지서 적체' })).toBeChecked()
    expect(screen.getByLabelText('기타사항')).toHaveValue('우편함에 고지서가 쌓여 있었음')
    expect(mocks.submitContact).not.toHaveBeenCalled()
  })

  it('live call uses resident speech to fill a candidate without auto-submitting (INV14)', async () => {
    arrange()
    mocks.createLiveCall.mockResolvedValue({
      provider: 'livekit', call_id: 'call123', room_name: 'care-call-call123',
      server_url: 'wss://example.livekit.cloud', expires_at: '2030-08-13T12:00:00.000Z',
      transcription: { provider: 'openai', model: 'gpt-live-transcribe', language: 'ko' },
      host: { role: 'surveyor', participant_token: 'host.token.signature' },
      guest: { role: 'resident', invite_code: 'invitecode0123456789abcdef012345' },
    })
    mocks.buildGuestInviteUrl.mockReturnValue('https://demo.example/call?invite=invitecode0123456789abcdef012345')
    mocks.createAiObservationCandidate.mockResolvedValue({
      revision: 0,
      candidate: {
        case_id: 'SYN-HH-2812551000-0001',
        contact_result: voiceCandidateConcernResult,
        observations: {
          관찰_6징후: { 우편물_고지서_적체: true, 악취_벌레: true, 쓰레기_술병: true, 인기척_없이_TV_불: true, 외출_없음: true, 연락_두절: true },
          식사상태: '불량', 위생상태: null, 공과금_2개월_이상_체납: null,
          최근_건강_정신_괴로움: true, 관계망_유무: '없음', 연락_빈도: null,
        },
        transcript: '밥을 잘 못 먹어요.',
        free_text: '',
        critic: { missing_fields: [], contradictions: [], low_confidence_fields: [], warnings: [], next_question: '오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?' },
        requires_user_confirmation: true,
      },
    })
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '실시간 통화 시작' }))
    await waitFor(() => expect(mocks.createLiveCall).toHaveBeenCalledWith({
      caseId: 'SYN-HH-2812551000-0001', revision: 0,
    }))
    expect(screen.getByText('통화 상대: 김영자 어르신')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '실시간 발화 테스트' }))
    expect(await screen.findByText('오늘 식사를 한 끼도 하지 못한 건가요, 아니면 평소보다 양이 줄어든 건가요?', {}, { timeout: 2_000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '통화 종료 테스트' }))
    await waitFor(() => expect(mocks.createAiObservationCandidate).toHaveBeenCalledWith({
      caseId: 'SYN-HH-2812551000-0001',
      revision: 0,
      source: { kind: 'text', text: '밥을 잘 못 먹어요.' },
    }))
    expect(await screen.findByLabelText('통화(또는 방문) 결과')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '다음 확인 질문' })).toBeNull()
    expect(screen.getByLabelText('식사 상태')).toHaveValue('불량')
    expect(screen.getByRole('checkbox', { name: '최근 외출 없음' })).toBeChecked()
    for (const label of ['우편물·고지서 적체', '악취·벌레', '쓰레기·술병', '인기척 없이 TV·불 켜짐', '주변에서 확인한 연락 두절']) {
      expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
    }
    expect(screen.queryByText(/실시간 통화에서 만든 후보입니다|제출은 조사원 확정입니다/)).toBeNull()
    expect(mocks.submitContact).not.toHaveBeenCalled()
  })

  it('uses concise labels for health and utility answers', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))

    expect(screen.getByLabelText('최근 건강·마음 어려움')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '어려움 있음' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '어려움 없음' })).toBeInTheDocument()
    expect(screen.getByLabelText('공과금 2개월 이상 체납')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '체납 있음' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '체납 없음' })).toBeInTheDocument()
    expect(screen.queryByText('관찰 또는 보고됨')).toBeNull()
  })
})
