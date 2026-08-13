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
  due_reasons: ['scheduled_contact'],
  earliest_due_date: '2026-08-12',
  reference_date: '2026-08-12',
  급성도_등급: null,
  급성도_점수: null,
  취약도_점수: null,
  grade_source: '미기록',
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
  lane_rule: '방문 레인에는 승인된 방문 또는 방문 선호 예정 업무만 포함',
  lanes: { phone: [phoneLaneItem], visit: [visitLaneItem] },
}

export const voiceCandidateConcernResult = ['connected', 'concern'].join('_')
