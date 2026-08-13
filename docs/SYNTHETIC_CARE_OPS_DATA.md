# 합성 ContactOps 데이터 계약

UI와 전화 안부·후속조치·방문 권고·담당자 승인 흐름을 병렬로 개발하기 위한 결정적 합성 시나리오다. 이 파일의 레코드는 실제 조사원이나 주민이 아니며, 실제 대상자 수·개인 위험·복지 수급 여부·복지 미수혜 규모·이웃연결단 실제 업무량을 추정하지 않는다. `management_entry`도 시연용 유입·연락 동의·일정 중복 확인 기록일 뿐, 실제 주민이나 복지 수급 데이터와 연결되지 않는다.

## 바로 쓰는 파일

| 파일 | 용도 | 현재 건수 |
| --- | --- | ---: |
| `public/data/synthetic-workers.json` | 연결단원 목록·현재 위치·근무/이동 제약 | 162명, 현행 동별 1명 |
| `public/data/synthetic-households.json` | 전화 우선 연락업무·합성 관리 유입·후속조치·방문 권고 전 상태·공개 주거건물 기준점 | 5,869건, 동별 2~97건 |
| `public/data/synthetic-residential-address-anchors.json` | 실제 공개 도로명주소·주거용 건물 대표좌표와 합성 업무의 결정적 연결 | 5,869건, 고유 PNU 5,683개 |
| `public/data/synthetic-care-ops-manifest.json` | 건수, 검증 결과, SHA-256, 사용 경계 | 1개 |
| `data/schemas/synthetic-worker.schema.json` | 연결단원 데이터 JSON Schema 2020-12 | schema `2.0.0` |
| `data/schemas/synthetic-household.schema.json` | 합성 연락업무 JSON Schema 2020-12 | schema `2.0.0` |
| `src/syntheticCareOpsTypes.ts` | 프론트엔드 TypeScript 계약과 승인 방문 판별 helper | schema `2.0.0` 대응 |

## 최소 로딩 예시

```ts
import type {
  SyntheticHouseholdDataset,
  SyntheticWorkerDataset,
} from './syntheticCareOpsTypes'

const [workers, households] = await Promise.all([
  fetch('/data/synthetic-workers.json').then(
    (response) => response.json() as Promise<SyntheticWorkerDataset>,
  ),
  fetch('/data/synthetic-households.json').then(
    (response) => response.json() as Promise<SyntheticHouseholdDataset>,
  ),
])
```

MapLibre 점 레이어는 각 레코드의 `location.longitude`와 `location.latitude`를 GeoJSON `Point`로 변환하면 된다. 폴리곤 선택·집계 조인은 `location.geometry_zone_id`를 사용한다. 현행 동 필터는 `location.current_admin_dong_code_20260701`를 사용한다.

## 현재 seed 요약

| 항목 | 값 |
| --- | ---: |
| 기준일 | `2026-08-12` |
| 현행 읍면동 | 162 |
| 2025 지도구역 | 156 |
| 연결단원 | 162 |
| 합성 연락업무 | 5,869 |
| 활성 연락관리 시나리오 | 5,869 |
| 본인 신청 시나리오 | 1,478 |
| 가족 신청 시나리오 | 1,506 |
| 협력기관 의뢰 시나리오 | 1,450 |
| 현장 발굴 시나리오 | 1,435 |
| 연락 동의 기록 | 5,869 |
| 정기 안부·방문 일정 중복 없음 확인 | 5,869 |
| 기준일까지 연락해야 하는 업무 | 3,597 |
| 기준일 이후 연락업무 | 2,272 |
| 전화 선호 업무 | 5,289 |
| 방문 선호 업무 | 580 |
| 아파트·공동주택 참조 업무 | 2,303 |
| 고유 주거건물 PNU | 5,683 |
| 사전 승인된 방문 | 0 |

## 162개 현행 동과 156개 지도구역

- 레코드는 **2026-07-01 현행 162개 읍면동마다** 생성한다.
- 지도 폴리곤은 검증된 **2025-06-30 공간구역 156개**를 사용한다.
- 운서1·2동과 아라1·2동, 출장소 4곳은 각각 동일한 상위 2025 공간구역을 공유한다.
- 이 구역의 점은 공개 주거건물 주소·대표좌표이지만 공유 폴리곤은 최신 분리 경계를 의미하지 않는다.
- UI에서는 `geometry_resolution`과 `mapping_method`로 이 한계를 표시할 수 있다.

## 연락업무 필드 계약

중심 객체는 `management_entry`, `contact`, `workflow`, `visit_context`, `approved_visit_constraints`다.

### 합성 관리 유입

모든 5,869건에는 `management_entry`가 있다.

- `synthetic=true`, `status=active_contact_management`: 시연용 연락관리 업무임을 명시
- `intake_channel`: `self_request`, `family_request`, `partner_agency_referral`, `field_outreach` 중 하나
- `intake_recorded_date`: 결정적으로 생성한 합성 유입일
- `ongoing_contact_permission.status=recorded`: 시연 시나리오에서 지속 연락 동의가 기록되었다는 뜻
- `ongoing_contact_permission.basis=synthetic_demo_scenario`: 실제 동의 기록이 아님을 명시
- `duplicate_service_check.status=completed_no_overlapping_schedule`: 정기 안부 연락 또는 가정방문 일정의 운영상 중복이 없다는 합성 확인
- `duplicate_service_check.interpretation=workflow_duplicate_check_not_welfare_eligibility`: 복지 적격성·수급·미수혜 판정이 아님을 명시

날짜는 `intake_recorded_date <= ongoing_contact_permission.recorded_date <= duplicate_service_check.checked_date <= scenario_reference_date` 순서를 만족한다. 유입 채널과 날짜는 `stable_int` 기반이라 같은 입력·seed에서는 항상 동일하다. 이 객체만으로 정부 지원 수급 여부나 기존 복지서비스 전체 이용 여부를 판단해서는 안 된다.

### 연락·방문 상태

- `contact.next_contact_date`: 다음 연락일
- `contact.preferred_contact_method`: `phone` 또는 `visit`
- `contact.last_contact_result`: `not_attempted`, `connected_ok`, `connected_concern`, `no_answer`, `refused`, `invalid_contact`
- `contact.consecutive_no_answer_count`: 연속 미응답 횟수
- `workflow.follow_up_deadline`: 후속조치 기한, 없으면 `null`
- `workflow.follow_up_status`: `none`, `required`, `overdue`, `completed`
- `workflow.visit_approval_status`: `null`, `recommended`, `approved`, `rejected`
- `workflow.transfer_status`: `not_required`, `recommended`, `requested`, `transferred`, `closed`
- `workflow.visit_decision`: 담당자 승인·반려 기록, 권고 전에는 `null`
- `approved_visit_constraints`: 승인 방문 제약, 담당자 승인 전에는 항상 `null`

생성된 fixture는 모든 `visit_approval_status`, `visit_decision`, `approved_visit_constraints`를 `null`로 시작한다. 연락·기한 규칙은 후속조치만 만들고, 별도 2축 트리아지가 방문을 권고할 수는 있지만 자동 승인하지 않는다.

실행 서버는 원본 fixture를 바꾸지 않고 동별 1건, 총 162건의 `데모 사전 기록` baseline을 별도로 주입한다. 모두 급성도 55점 이상인 `recommended` 상태라 센터 방문검토 목록에는 보이지만 전화·방문 할당 레인에는 포함되지 않는다. 담당자가 승인한 뒤에만 오늘 방문 레인으로 이동한다. 원본 fixture의 사전 승인 방문 0건 경계는 그대로 유지된다.

오늘 레인 규칙은 다음과 같다.

- `visit_approval_status=approved`: 오늘 방문 대상
- `visit_approval_status=recommended`: 센터 검토 대기, 할당 레인 제외
- `visit_approval_status=null|rejected`이면서 일정 또는 재연락 기한 도래: 오늘 전화 대상
- 전화 카드의 선정 사유·기한·담당자·확인 상태는 기준일에 계산하는 API projection이며 원본 fixture에 고정 저장하지 않는다.

## 텍스트 수직 슬라이스

현재 최소 데모는 LLM 없이 결정론적 규칙으로 돈다.

```bash
npm --prefix backend run demo:contact-ops
```

동작 순서:

1. `buildTodayContactQueue`: 기준일까지 연락해야 하는 큐 생성
2. `applyStructuredContactResult`: 더미 연락결과 입력
3. `evaluateDeterministicRules`: 미응답·후속조치 누락·이관 필요 검사
4. `buildTriageQueue`: 급성도·취약도를 분리해 점수화하고 방문 임계값이면 권고
5. `applyTriageVisitRecommendation`: 같은 케이스의 권고만 ContactOps에 반영
6. `applyManagerVisitDecision`: 담당자가 `approved` 또는 `rejected`를 명시

미응답 2회는 급성도 25점으로 정상 구간이며 재연락 후속조치만 만든다. 미응답 3회 단독도 45점으로 주시 구간이다. 관찰값과 합산해 55점 이상이 된 경우에만 방문 권고가 생긴다. 배점과 큐 계약은 [`CONTACT_TRIAGE_SCORING.md`](CONTACT_TRIAGE_SCORING.md)를 따른다.

## 조건부 경로 입력 규칙

경로 계산에는 담당자가 승인한 예외 방문만 넣는다.

```ts
task.synthetic === true
task.workflow.visit_approval_status === 'approved'
task.workflow.visit_decision?.decision === 'approved'
task.approved_visit_constraints !== null
```

현재 fixture 생성 직후 승인된 합성 방문은 0건이다. `max_route_distance_km`는 승인된 방문의 `approved_visit_constraints` 안에만 존재한다.

경로 최적화는 다음 중 하나가 실제로 생겼을 때만 켠다.

- 같은 날 승인 방문이 여러 건 쌓임
- 2인 1조 또는 공무원 동행이 필요함
- 시간창, 담당구역, 이동수단 제약이 겹침
- 다른 연결단원에게 재배정해야 함

승인 방문이 1~3건이면 VRP가 아니라 가까운 순서 안내면 충분하다. 예외 방문이 시 전체에서 수십 건으로 늘 때도 핵심은 경로보다 인력·동행 배치다.

경로 엔진 최소 입력은 현재 v2 스키마에 존재하는 필드만 사용한다.

- 연결단원: `constraints.available_time_window`, `constraints.max_daily_approved_visits`, `constraints.travel_modes`, `constraints.stairs_allowed`, `constraints.assigned_admin_dong_codes_20260701`
- 승인 방문업무: `approved_visit_constraints.max_route_distance_km`, `approved_visit_constraints.assigned_worker_ids`, `visit_context.preferred_visit_time_window`, `visit_context.service_duration_minutes`, `visit_context.stairs_present`, `visit_context.preferred_worker_gender`, `visit_context.requires_two_person_team`, `visit_context.requires_public_official_companion`
- 공간: 연결단원·업무의 `location.longitude`, `location.latitude`, `location.geometry_zone_id`, `location.current_admin_dong_code_20260701`

`max_route_distance_km`는 연결단원 전역 제약이 아니라 담당자 승인 후 생성되는 승인 방문업무 제약이다. `max_walking_distance_m` 필드는 현재 v2 스키마에 없다.

`requires_public_official_companion=true`인 업무는 항상 `requires_two_person_team=true`다. 이후 OR-Tools 같은 경로 엔진을 붙일 때 이 조건은 LLM 프롬프트가 아니라 하드 제약으로 유지한다.

## LLM·음성 연결

`voice/` 3a 단계는 동의받고 개인정보를 마스킹한 텍스트를 OpenAI Structured Outputs의 고정 JSON 계약으로 구조화하고, 3b는 검증된 WAV/MP3 입력을 같은 계약으로 연결한다. ContactOps 어댑터는 Planner와 별도 Critic 결과를 확인 후보로만 내보내며, 사용자가 명시 확인한 뒤에만 canonical 관찰값을 적용한다. Realtime/WebRTC는 아직 구현하지 않았다. 결정론적 규칙이 최종 상태 전환을 소유하며, LLM 연결은 다음 세 지점에만 붙인다.

- 음성·텍스트 메모를 구조화된 연락결과로 변환
- 이전 기록과 현재 발화의 모순·누락 탐지
- 방문 필요 후보와 이관 필요 후보의 근거 제시

최종 방문 승인, 이관 확정, 경로 입력 전환은 자동화하지 않는다. `voice` 출력의 `risk_score`와 `visit_recommended`는 발화에서 추출한 내용일 뿐 운영 점수·방문 결정이 아니다. 규칙 그래프와 담당자 승인 기록이 있어야 한다.

## 재생성과 검증

```bash
python3 data/scripts/build_synthetic_residential_address_anchors.py
npm run prepare:synthetic-data
npm run validate:synthetic-data
npm run test:synthetic-data
npm run test:contact-triage-schema
npm --prefix backend run report:contact-triage
```

생성기는 seed `20260812`를 사용하며 동일 입력에서 바이트 단위로 같은 결과를 만든다. 검증기는 다음을 강제한다.

- 현행 162개 동 전체 포함
- 2026-07-31 동별 65세 이상 1인세대 관측 수에 비례한 고정 총량 5,869건
- 실제 공개 주거건물 주소·대표좌표 앵커 5,869건과 생성 업무의 1:1 연결
- 동별 연결단원 1명
- 모든 좌표가 선언한 2025 지도구역 내부
- ID 중복 0건
- 모든 5,869건에 완전한 합성 `management_entry` 존재
- 유입일 → 연락 동의 기록일 → 일정 중복 확인일 → 기준일의 날짜 순서 유지
- 네 가지 합성 유입 채널 enum 외 값 0건
- 모든 fixture가 방문 권고 전 `null` 상태로 시작
- 사전 승인 방문 0건
- 최대 경로거리는 담당자 승인 뒤에만 존재
- 원본 household의 급성도·triage 필드와 개인 위험·수혜자·미수혜자·복지 적격성 판정 필드 0건

## 개인정보·표현 경계

- `연결단원 001` 같은 일반 표시명만 사용한다.
- 주민 이름·전화번호·호수·주민 속성은 넣지 않는다.
- `management_entry`는 실제 신청·의뢰·동의·복지 조사 이력이 아니라 합성 시연값이다.
- `duplicate_service_check`는 정기 안부 연락·가정방문 **일정 중복**만 표현하며, 정부 지원 수급 여부나 복지서비스 적격성을 뜻하지 않는다.
- `road_address`와 좌표는 공개 주소DB·주거용 건축물대장·건물도형을 결합한 실제 건물 기준점이다. 해당 주소 거주자의 나이·고립·복지 상태를 뜻하지 않는다.
- 송도5동의 보유 VWorld 도형 누락 14건은 공식 주소DB의 `송도 SK VIEW` 주소와 OSM 주거지 도형 대표점을 사용하며 출처를 별도 컬럼으로 남긴다.
- 운영 표현은 `연락업무`, `안부 확인`, `후속조치`, `방문 권고`, `담당자 승인`, `행정복지센터 이관`을 사용한다.
- `고독사 위험도`, `복지 미수혜 위험도`, `주민 위험점수`, `고위험자`, `미수혜자`로 표시하지 않는다.
- 운영 단계는 전화 우선이며 담당자가 승인한 `visit_approval_status=approved`만 경로 후보에 포함한다.
