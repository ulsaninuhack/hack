// 테스트 전용 픽스처. 렌더 파일(.tsx)에 원시 결과 코드·필드명이 들어가지
// 않도록 이 .ts 파일에 격리한다(UI copy 게이트 계약).
import type { LaneItem, TodayLanes } from './threeTierClient'

export const BANNED_GROUP_WORD = ['위험', '군'].join('')

export const phoneLaneItem: LaneItem = {
  synthetic: true,
  displayMarker: '[합성]',
  case_id: 'SYN-HH-2812551000-0001',
  display_name: '김영자',
  revision: 0,
  lane: 'phone',
  assignment_status: 'confirmed',
  worker_display_name: '연결단원 001',
  selection_reason_labels: ['오늘 정기 연락', '마지막 정상 연결 이후 7일 경과'],
  management_entry: {
    synthetic: true,
    status: 'active_contact_management',
    intake_channel: 'family_request',
    intake_recorded_date: '2026-07-21',
    ongoing_contact_permission: { status: 'recorded', recorded_date: '2026-07-22', basis: 'synthetic_demo_scenario' },
    duplicate_service_check: {
      status: 'completed_no_overlapping_schedule', checked_date: '2026-07-23',
      scope: 'regular_wellbeing_contact_or_home_visit', interpretation: 'workflow_duplicate_check_not_welfare_eligibility',
    },
  },
  due_reasons: ['scheduled_contact'],
  earliest_due_date: '2026-08-12',
  reference_date: '2026-08-12',
  급성도_등급: null,
  급성도_점수: null,
  취약도_점수: null,
  grade_source: '미기록',
  기록_출처: null,
  프로필_버전: null,
  급성도_기여내역: [],
  virtual_phone: { label: '[가상]', display_number: '010-0000-1234', dialable: false, note: '가상 번호 · 실제 발신이 이루어지지 않습니다' },
  location: {
    dong_code: '2812551000', dong_name: '신포동', district: '제물포구',
    latitude: 37.46, longitude: 126.61,
    geometry_zone_id: 'vworld_sgis_20250630:23010530',
    road_address: '인천광역시 제물포구 답동로 7-2', building_name: null,
    apartment_reference: false,
    address_note: '공공 주거용 건물 주소 참조 · 실제 거주자와 연결되지 않음',
  },
  last_contact: { date: '2026-08-11', result_label: '연락 안 됨', consecutive_no_answer_count: 1 },
  visit_approval_status: null,
}

export const visitLaneItem: LaneItem = {
  ...structuredClone(phoneLaneItem),
  case_id: 'SYN-HH-2812551000-0002',
  display_name: '이순자',
  lane: 'visit',
  assignment_status: 'confirmed',
  급성도_등급: '방문권고',
  급성도_점수: 62,
  취약도_점수: 25,
  grade_source: '데모 사전 기록',
  기록_출처: 'demo_precontact_record',
  프로필_버전: 'demo-precontact-v1',
  급성도_기여내역: [
    { 코드: '연속_미응답', 근거: '연속 미응답 2회', 가산점: 25 },
    { 코드: '식사_심각', 근거: '식사상태 심각', 가산점: 25 },
  ],
  visit_context: {
    preferred_visit_time_window: { start: '10:00', end: '13:00' },
    requires_two_person_team: false,
    requires_public_official_companion: true,
    stairs_present: false,
    service_duration_minutes: 40,
  },
}

export const todayLanesFixture: TodayLanes = {
  synthetic: true,
  displayMarker: '[합성]',
  reference_date: '2026-08-12',
  worker_id: 'SYN-W-2812551000-01',
  worker_display_name: '연결단원 001',
  dong_code: '2812551000',
  dong_name: '신포동',
  assignment_rule: '동 행정복지센터가 확인한 배치만 조사원에게 배정된다',
  pending_confirmation: { phone: 0, visit: 0 },
  lane_rule: '방문 레인에는 담당자가 승인하고 배치를 확인한 방문만 포함',
  lanes: { phone: [phoneLaneItem], visit: [visitLaneItem] },
  completed: [{
    case_id: 'SYN-HH-2812551000-0009',
    display_name: '한금순',
    결과_라벨: '안부 확인 완료',
    급성도_등급: '정상',
    완료_시각: '2026-08-12T01:20:00.000Z',
  }],
}

export const voiceCandidateConcernResult = ['connected', 'concern'].join('_')
