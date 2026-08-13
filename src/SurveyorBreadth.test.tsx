import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CaseDetail, QueueItem } from './contactOpsClient'
import { SurveyorBreadth, summarizeSurveyorDay } from './SurveyorBreadth'

const CONSECUTIVE_NO_ANSWER_FIELD = ['consecutive', 'no', 'answer', 'count'].join('_')

const queueItems: QueueItem[] = [
  {
    household_id: 'SYN-HH-2812551000-0001',
    revision: 2,
    preferred_contact_method: 'phone',
    due_reasons: ['scheduled_contact', 'follow_up_deadline'],
    triage: {
      급성도_점수: 57,
      취약도_점수: 25,
      점수_기여내역: [
        { 축: '급성도', 코드: '연속_미응답', 근거: '연속 미응답 3회', 가산점: 45 },
        { 축: '급성도', 코드: '관찰_6징후', 근거: '관찰 징후 1개', 가산점: 12 },
      ],
    },
  },
  {
    household_id: 'SYN-HH-2812551000-0002',
    revision: 1,
    preferred_contact_method: 'visit',
    due_reasons: ['scheduled_contact'],
    triage: {
      급성도_점수: 12,
      취약도_점수: 0,
      점수_기여내역: [],
    },
  },
]

function detail(
  id: string,
  input: {
    consecutiveNoAnswer?: number
    followUpStatus?: string
    transferStatus?: string
  } = {},
): CaseDetail {
  return {
    synthetic: true,
    displayMarker: '[합성]',
    revision: 2,
    household: {
      id,
      synthetic: true,
      location: {
        longitude: 126.62,
        latitude: 37.47,
        geometry_zone_id: 'vworld_sgis_20250630:23010530',
        current_admin_dong_code_20260701: '2812551000',
        current_admin_dong_name_20260701: '신포동',
        current_district_name_20260701: '제물포구',
        road_address: '인천광역시 제물포구 답동로 7-2',
        building_name: '',
        apartment_reference: false,
        reference_pnu: '2812513200100110016',
        residential_building_reference: true,
        not_real_resident: true,
      },
      contact: { [CONSECUTIVE_NO_ANSWER_FIELD]: input.consecutiveNoAnswer ?? 0 },
      workflow: {
        visit_approval_status: null,
        follow_up_status: input.followUpStatus ?? 'none',
        transfer_status: input.transferStatus ?? 'not_required',
      },
      approved_visit_constraints: null,
    },
    observations: {
      관찰_6징후: {
        우편물_고지서_적체: false,
        악취_벌레: false,
        쓰레기_술병: false,
        인기척_없이_TV_불: false,
        외출_없음: false,
        연락_두절: false,
      },
      식사상태: null,
      위생상태: null,
      공과금_2개월_이상_체납: null,
      최근_건강_정신_괴로움: null,
      관계망_유무: null,
      연락_빈도: null,
    },
    triage: null,
  }
}

const details = [
  detail(queueItems[0].household_id, {
    consecutiveNoAnswer: 3,
    followUpStatus: 'overdue',
    transferStatus: 'recommended',
  }),
  detail(queueItems[1].household_id),
]

describe('P6 surveyor breadth projection', () => {
  it('summarizes repeated no-answer, overdue, and transfer recommendation separately', () => {
    expect(summarizeSurveyorDay(queueItems, details)).toEqual({
      total: 2,
      repeatedNoAnswer: 1,
      overdue: 1,
      transferRecommended: 1,
    })
  })

  it('renders safe Korean badges, daily summary, and the synthetic boundary', () => {
    render(
      <SurveyorBreadth
        items={queueItems}
        details={details}
        loading={false}
        error={null}
        selectedId={queueItems[0].household_id}
        onSelect={() => {}}
        onRetry={() => {}}
      />,
    )

    expect(screen.getByRole('region', { name: '오늘 연락업무 요약과 목록' })).toBeInTheDocument()
    expect(screen.getByText('김영자 어르신')).toBeInTheDocument()
    expect(screen.getByText('이순자 어르신')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/SYN-HH-|\[합성\]/)
    expect(screen.getByText('오늘 연락업무 2건')).toBeInTheDocument()
    expect(screen.getAllByText('연속 미응답 3회').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('후속조치 기한 지남').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('행정복지센터 이관 권고').length).toBeGreaterThanOrEqual(1)
    for (const hidden of [
      ['no', 'answer'].join('_'),
      ['follow', 'up'].join('_'),
      ['transfer', 'status'].join('_'),
      'recommended',
      ['위험', '도'].join(''),
      ['고위험', '자'].join(''),
      ['미수혜', '자'].join(''),
      ['개인', '예측'].join(''),
    ]) {
      expect(document.body.textContent).not.toContain(hidden)
    }
  })

  it('supports touch/click and arrow-key selection without hover', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <SurveyorBreadth
        items={queueItems}
        details={details}
        loading={false}
        error={null}
        selectedId={queueItems[0].household_id}
        onSelect={onSelect}
        onRetry={() => {}}
      />,
    )

    const first = screen.getByRole('option', { name: /김영자 어르신/ })
    const second = screen.getByRole('option', { name: /이순자 어르신/ })
    expect(first).toHaveStyle({ minHeight: '48px' })
    await user.click(second)
    expect(onSelect).toHaveBeenLastCalledWith(queueItems[1].household_id)

    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(onSelect).toHaveBeenLastCalledWith(queueItems[1].household_id)
    expect(second).toHaveFocus()

    fireEvent.keyDown(second, { key: 'Home' })
    expect(onSelect).toHaveBeenLastCalledWith(queueItems[0].household_id)
    expect(first).toHaveFocus()
  })
})

describe('P6 explicit loading, empty, and error states', () => {
  it('announces loading', () => {
    render(
      <SurveyorBreadth
        items={[]}
        details={[]}
        loading
        error={null}
        selectedId={null}
        onSelect={() => {}}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('연락업무를 불러오는 중입니다.')
  })

  it('announces an empty day without exposing a disabled action', () => {
    render(
      <SurveyorBreadth
        items={[]}
        details={[]}
        loading={false}
        error={null}
        selectedId={null}
        onSelect={() => {}}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('오늘 예정된 연락업무가 없습니다.')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('announces an error and provides a keyboard/touch recovery action', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <SurveyorBreadth
        items={[]}
        details={[]}
        loading={false}
        error="합성 연락업무를 불러오지 못했습니다."
        selectedId={null}
        onSelect={() => {}}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('연락업무를 불러오지 못했습니다.')
    const retry = screen.getByRole('button', { name: '다시 불러오기' })
    expect(retry).toHaveStyle({ minHeight: '48px' })
    await user.tab()
    expect(retry).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
