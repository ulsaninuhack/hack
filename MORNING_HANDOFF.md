# Morning Handoff — Care Operations Console

## 3계층 재설계 (2026-08-13, branch `claude/three-tier-care-redesign-8lpmkw`)

행정 3계층(시·구 `/city` · 동 행정복지센터 `/center` · 조사원 `/m`)으로 화면을
재배치했다. 규범 문서는 `REDESIGN_SPEC.md`(P0 프리즈), 페이즈 증거는 `PROGRESS.md`.
엔진(`contact-ops.mjs`, `contact-triage-scoring.mjs`)은 무수정(INV1 diff 0), 이번
작업은 어댑터(`backend/src/three-tier-ops.mjs`, `three-tier-service.mjs`)와 뷰다.

### 페이즈 상태 (3계층)

| Phase | Status | Evidence |
| --- | --- | --- |
| P0 프리즈 | pass | REDESIGN_SPEC 커밋, Node 24 기준 회귀 그린 |
| P1 어댑터 API | pass | 백엔드 211 테스트, 커버리지 게이트 그린, 저지 PASS + Ralph 지적 3건 수정 커밋 |
| P2 `/center` | pass | 프런트 테스트 6건 + p9 골든 |
| P3 `/m` | pass | 프런트 테스트 7건 + p9 골든(수동 경로) · 방문 탭 지도 위젯 포함 |
| P4 `/city` | pass | 프런트 테스트 4건(INV17 비노출) + p9 골든 |
| P5 데모 봉합 | pass | `e2e/p9-three-tier.spec.ts` 2/2, 전체 ops 스위트 5/5, 스크린샷 14장 |

### 기계 검증됨 (3계층)

- 골든 스파인: 시 지도(`/city` 구 브리핑·AI 요약 라벨) → 동 센터 오늘 배치 일괄
  확인(INV14: 확인 전 POST 없음) → 모바일 가상 발신 모사·수동 체크리스트 제출(62점
  방문권고) → 보고 카드(권고 기관 포함) 확인 → 방문 승인(기존 visit-decisions 재사용,
  approved_visit_constraints 검증) → 시·구 집계·운영 지도 반영(케이스 ID 비노출 유지).
- INV14: 확인·제출·승인 없이 상태가 확정되는 경로 없음. Ralph가 찾은 두 구멍의
  회귀 테스트 포함 — 확인 후 배치에 새로 들어온 제안은 다시 '제안', 새 보고
  리비전은 다시 '미확인'.
- INV15: `010-0000-XXXX` + `[가상]`만 노출, 실번호 패턴 재귀 grep 게이트.
- INV16: 전화/방문 레인 혼합 렌더 금지(백엔드+프런트+E2E 삼중 단언).
- INV17: API 계층에서 강제 — `/city`는 케이스 ID를 제거한 전용
  `three-tier/city-operations-map`을 사용하고, 프런트·E2E는 전체 HTML
  직렬화 기준으로 `SYN-HH-` 부재를 단언(속성 누출 포함 검출).
- INV18: `위험군` 금지어 게이트 추가, 등급 어휘는 엔진 등급만.
- INV19: OpenAI Codex가 작성한 11개 구·군별 해석문에 서버 집계 수치만 주입한다.
  작성본 `codex_authored_v1`, 숫자 토큰 ⊆ 주입 수치 골든, 혼합 스냅샷 경고 2종.
- 조사원·센터 화면은 내부 `SYN-HH-*` 대신 결정적 가상 표시명(예: 김영자 어르신)을
  사용하며 `[합성]` 배지는 표시하지 않는다. 내부 ID와 synthetic 플래그는 API에 유지한다.
- 접근성·가독성: `/m` 390×844에서 본문 ≥18px·타깃 ≥48px·수평 오버플로 0, 세 화면 ×
  두 뷰포트 axe serious/critical 0.

### 미증명 / 사람 확인 필요 (3계층)

- [x] 음성 합성 실파일 경로 — Cloud Run `incheon-care-api-00031-7t8`에서 7초 한국어
  합성 M4A를 모바일과 동일한 multipart 경로로 전송해 HTTP 200, `source_kind=audio`,
  `connected_concern`, 식사 `심각`, `confirmed=false` 후보를 확인했다.
- [ ] 휴대폰 실기기 녹음 — 실제 조사원 음성·전화 음질·사투리·주변 소음은 별도 사람
  리허설이 필요하다(수동·문답 경로는 E2E 증명).
- [ ] Vercel 프리뷰 URL — PR에는 배포 자격 증명이 없어(배포 계약) 미생성. 로컬
  프로덕션 빌드 + `artifacts/screenshots/p9-*.png` 14장으로 대체.
- [ ] 이관 '확정' API — 기존 API에 없음. `/center`는 이관 권고 표시 + 트랙 전환
  워딩("안부확인 트랙 → 사례관리·전문기관 트랙")까지만(의도된 스텁).
- [ ] 할당 '조정' 액션(담당 재배정·레인 이동·시간 변경) — 미구현. 조정 필요
  플래그 표시 + 확인 보류가 현재의 조정 수단(의도된 범위 결정).
- [ ] 할당 확인·보고 확인 상태의 영속화 — 세션 격리 인메모리(데모 범위). Firestore
  미확장(의도된 스텁, `three-tier-service.mjs` 주석 참조).
- [ ] 워딩·실기기·튜닝 경고(현행 647) 등 기존 morning 게이트 전부 유지.

### 데모 동선 대본 (3계층)

1. `/city` 1440×900 — 구 선택(제물포구) → 구조 맥락 vs 운영 부하 비합산 브리핑,
   "구 단위 요약 읽기" → AI 라벨 확인. 증원 검토 표(부하/구조 순위 분리).
2. `/center` — 상단 요약(보고 대기·배치 상태·방문 검토 대기), "오늘 배치 확인"
   전화/방문 레인 → 일괄 확인. 지도는 접힌 위젯.
3. `/m` 390×844 — 전화 탭 → `김영자 어르신`과 주소 확인 → [가상] 전화 탭(발신 모사)
   → "직접 체크하기"(또는 문답/음성) → 미응답+우편물 적체+식사 심각 → 확인하고 제출
   → "동 행정복지센터에 보고됨" + 등급·권고 기관.
4. `/center` — 보고 카드 확인 → 방문 검토 승인(사유 입력) → 완료율 상승.
5. `/city` — 재방문: 집계 반영, 케이스 ID는 끝까지 비노출.

## Current phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| P0 | pass | `PROGRESS.md` P0 entry; independent judge PASS |
| P1 | pass | API/state evidence in `PROGRESS.md`; independent critic PASS |
| P2 | pass | Real API browser vertical slice; independent hostile review PASS |
| P3 | pass | Planner-Critic candidate/confirmation boundary; independent reviews PASS |
| P4 | pass | Frozen production-like API golden path; Playwright 1/1 |
| P5 | pass | Manager transfer/distribution/tuning/13-visit breadth; independent review PASS |
| P6 | pass | Surveyor daily/repeated-no-answer/overdue/transfer and explicit states; independent review PASS |
| P7 | pass | 156-zone structural context and separate operations overlay; independent review PASS |
| P8 | delivery pass | PR #18 merged; `main` CI/CD and live Vercel/Cloud Run/browser verification PASS |

## Machine-verified overnight

- P0 baseline/freeze passed on Node 24, including 97 backend tests, deterministic data,
  Docker, production commit/revision/digest matching, live API, Vercel asset, and a
  1440×900 Playwright screenshot with zero console errors.
- P1 synthetic ContactOps API/state passed 123 backend tests, coverage
  96.73%/90.87%/100%, dependency audit, Firestore adapter tests, full shared regression,
  and a non-root Docker HTTP smoke test. No static map route depends on Firestore.
- P2 surveyor and manager consoles passed 13 component/contract tests and a production
  Playwright E2E using an isolated real API session. It proves queue reorder, separate
  axes and contribution traces, recommendation-only surveyor behavior, manager-only
  approval, persistence after reload, real MapLibre rendering, console/page errors zero,
  axe serious/critical zero, 18px mobile text, 48px targets, and zero horizontal overflow.
- P3 masked text and bounded WAV/MP3 file references pass through a schema-validated
  Planner-Critic candidate contract. Candidate generation does not mutate state; explicit
  user confirmation reuses the deterministic ContactOps rules. Backend P3 tests pass 9/9,
  the voice suite passes 49/49 with one live opt-in test skipped, and forbidden
  server-owned fields are rejected or discarded.
- P4 Playwright locks the exact API path from a 25-point no-answer state to 57 points
  after one observation, recommendation-only status, manager-only approval, and reload
  persistence.
- P5-P7 add manager and surveyor breadth plus a 156-zone public structural context and
  synthetic operations overlay. Structural context is an unvalidated 0-50 candidate with
  raw/rank/contribution/date/missing evidence; operations color and size remain separate.
- P8 full browser regression passes P2/P4/P8 3/3 in two consecutive runs. The final
  evidence has 11 screenshots covering all eight frozen surfaces, console/page errors 0,
  axe serious/critical 0, at least 18px mobile text, at least 48px controls, and no
  horizontal overflow. Backend coverage is 166/166 tests across 33 suites at
  97.43%/92.18%/100%; frontend is 35/35 plus typecheck/build/copy/worker checks.

## Requires morning human review

- [ ] actual Korean/telephone audio accuracy on a real device
- [ ] physical-device touch comfort and keyboard behavior
- [ ] final Korean wording and visual polish
- [ ] judge-readability and complete demo rehearsal
- [ ] whether the 647 synthetic mild-signal accumulation warning is acceptable

## Preview and screenshots

- Preview URL: `https://incheon-care-ops-preview.vercel.app`
- Preview API: `https://incheon-care-api-preview-vy3v2ludma-du.a.run.app`
- Screenshot index: `artifacts/screenshots/README.md`
- Frozen captures: public map, operations overlay, manager review/map at `1440x900`;
  surveyor queue/detail/form and empty/loading/error proof at `390x844`.

## Remaining human gates and stubs

- PR #18 delivered the feature and PR #19 recorded the production proof. The last independently
  verified delivery baseline before the handoff-harness refresh is GitHub Actions run
  `31633711778`, which deployed `main` commit
  `3c914d76ff5d51f388ae9d46ed61eb805addd9bf`; Vercel production and Cloud Run revision
  `incheon-care-api-00020-4bq` were independently rechecked after deployment. The backend image
  digest is `sha256:56a8db8c56df9f8a640528d0144005b4d3afe90b8abe34ab6553463fc844b7a7`.
- P1 operations routes use Firestore only for synthetic session overrides in production.
  Static health/map/facility/transit/summary routes remain independent of it.
- `POST /api/v1/contact-ops/cases/:caseId/ai-observations` now supports candidate and
  explicit-confirmation modes. Live provider calls remain fail-closed unless
  `ENABLE_LIVE_CONTACT_OPS_AI=1`; no live provider key is deployed yet.
- Real-device Korean audio accuracy remains a morning-only human gate.
- Before enabling live AI on the public Cloud Run service, add authentication or a finite
  platform/API quota; the current demo endpoint is intentionally synthetic and unauthenticated.
- The reset endpoint is test/E2E-only, gated by `CONTACT_OPS_ENABLE_TEST_RESET=1`, and
  unavailable in the normal production server configuration.
