import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportCard } from './threeTierClient'

const mocks = vi.hoisted(() => ({
  loadTodayLanes: vi.fn(),
  loadReportCard: vi.fn(),
  uploadVoiceObservationAudio: vi.fn(),
  submitContact: vi.fn(),
  loadData: vi.fn(),
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
  }
})
vi.mock('./contactOpsClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./contactOpsClient')>()
  return { ...actual, submitContact: mocks.submitContact }
})

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
  mocks.loadData.mockResolvedValue({ dongs: { features: [] }, summary: {} })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('MobilePage (조사원 /m)', () => {
  it('separates phone and visit tabs, visit tab carries time window and companion needs (INV16)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    const phoneList = await screen.findByLabelText('오늘 전화 목록')
    expect(within(phoneList).getByText('김영자 어르신')).toBeInTheDocument()
    expect(within(phoneList).queryByText('이순자 어르신')).toBeNull()
    await user.click(screen.getByRole('tab', { name: /방문 1건/ }))
    const visitList = await screen.findByLabelText('오늘 방문 목록')
    expect(within(visitList).getByText('이순자 어르신')).toBeInTheDocument()
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

  it('shows the virtual phone dial mock without any real call (INV15)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    const dialButton = screen.getByRole('button', { name: /\[가상\] 010-0000-1234/ })
    await user.click(dialButton)
    const overlay = screen.getByRole('dialog', { name: '가상 발신 화면' })
    expect(within(overlay).getByText(/실제 전화는 걸리지 않습니다/)).toBeInTheDocument()
    await user.click(within(overlay).getByRole('button', { name: '가상 발신 화면 닫기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('인천광역시 제물포구 답동로 7-2')).toBeInTheDocument()
    expect(screen.queryByText(/실제 거주자와 연결되지 않음/)).toBeNull()
  })

  it('manual path submits only after surveyor confirmation and shows the report screen (INV14)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    await user.selectOptions(screen.getByLabelText('통화 결과'), '미응답')
    await user.click(screen.getByRole('checkbox', { name: '우편물·고지서 적체' }))
    await user.selectOptions(screen.getByLabelText('식사 상태'), '심각')
    expect(mocks.submitContact).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '확인하고 제출' }))
    await waitFor(() => expect(mocks.submitContact).toHaveBeenCalledTimes(1))
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
    await user.click(screen.getByRole('button', { name: '관찰됨' }))
    await user.click(screen.getByRole('button', { name: '없음' }))
    expect(await screen.findByText(/문답에서 만든 후보입니다/)).toBeInTheDocument()
    expect(mocks.submitContact).not.toHaveBeenCalled()
    expect(screen.getByLabelText('통화 결과')).toHaveValue('미응답')
    expect(screen.getByLabelText('식사 상태')).toHaveValue('심각')
    expect(screen.getByLabelText('도움을 요청할 관계망')).toHaveValue('없음')
    expect(screen.getByLabelText('최근 건강·마음 괴로움')).toHaveValue('true')
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
    expect(screen.getByLabelText('통화 결과')).toHaveValue('우려 사항 있음')
  })

  it('the chat path offers a direct jump to the manual checklist (2-way choice)', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    expect(screen.queryByRole('button', { name: '직접 체크하기' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    expect(screen.getByLabelText('통화 결과')).toBeInTheDocument()
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

  it('reframes the sign checklist per lane so phone calls only record externally confirmed signs', async () => {
    arrange()
    const user = userEvent.setup()
    render(<MobilePage />)
    await user.click(await screen.findByText('김영자 어르신'))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    expect(screen.getByText('주변 확인 신호')).toBeInTheDocument()
    expect(screen.getByText(/이웃·경비 등 주변에서 확인된 경우에만 체크/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '오늘 목록으로' }))
    await user.click(screen.getByRole('tab', { name: /방문 1건/ }))
    await user.click(await screen.findByText(/이순자 어르신/))
    await user.click(screen.getByRole('button', { name: '문답 또는 직접 체크하기' }))
    await user.click(screen.getByRole('button', { name: '직접 체크하기' }))
    expect(screen.getByText('방문 관찰 체크리스트')).toBeInTheDocument()
    expect(screen.queryByText(/주변에서 확인된 경우에만 체크/)).toBeNull()
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
        critic: { missing_fields: ['관계망_유무'], contradictions: [], low_confidence_fields: [], warnings: ['악취 관련 후보 확인 필요'] },
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
    expect(await screen.findByText(/음성에서 만든 후보입니다/)).toBeInTheDocument()
    expect(screen.getByText('악취 관련 후보 확인 필요')).toBeInTheDocument()
    expect(screen.getByText('누락 확인: 관계망_유무')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '기타 특이사항 확인' })).toHaveTextContent('최근 약 복용을 자주 빠뜨린다고 말함')
    expect(screen.getByText(/해당하는 체크리스트를 확인하면 제출 후 점수에 반영됩니다/)).toBeInTheDocument()
    expect(screen.getByLabelText('통화 결과')).toHaveValue('우려 사항 있음')
    expect(screen.getByRole('checkbox', { name: '악취·벌레' })).toBeChecked()
    expect(mocks.submitContact).not.toHaveBeenCalled()
  })
})
