# Overnight Progress Ledger

This file is append-only. Each phase records objective commands, evidence, judge verdict,
hostile follow-up, commit, preview, and blockers. Existing entries are never rewritten.

## 2026-08-13 01:20 KST — P0 started

- Branch: `agent/ui-ops`
- Baseline: `1fab6889f0608a3f860137188ec3158d08ed755a` (includes merged PR #16 rubric gate)
- Context snapshot: `.omx/context/care-ops-console-20260812T161509Z.md` (local ignored state)
- Status: freeze contract authored; baseline regression and independent verdict pending.
- Attempts: 1/5.

## 2026-08-13 01:36 KST — P0 PASS

- Freeze: `npm run verify:overnight-freeze` PASS for two frozen files.
- Node: local bundled Node `v24.14.0`; GitHub Actions Node `v24.18.0`.
- Existing frontend/data gates: UI copy 10/10, synthetic Python 8/8, triage schema
  11/11, data hashes, typecheck, build, MapLibre worker, and `agent-check` PASS.
- Backend baseline: 97/97 tests, 19 suites, 96.05% lines, 90.47% branches,
  100% functions. Demo queue and 5,869-case report PASS; 162 current dongs and 156
  geometry zones preserved; synthetic mild-signal warning remains 664.
- Voice baseline: 34 pass, 1 explicit live opt-in skip, 0 fail.
- Docker attempt 1/5 failed because Docker Desktop was not running. After starting the
  daemon, attempt 2/5 built `linux/amd64`, returned `/health` validation `pass`, and ran
  as non-root uid 1000.
- Production: `main@1fab6889`, Actions run `31616839239`, Cloud Run revision
  `incheon-care-api-00015-j27`, image digest
  `sha256:da6527b3124fb9342fb2f37c1809c9501b0d5f709cbd2dea409143cc0174e171`,
  100% traffic. Vercel public asset references the same API origin.
- Browser: `output/playwright/p0-production-desktop.png` is 1440×900,
  `data-map-ready=true`, console errors 0, mixed-snapshot disclosure visible.
- Independent judge: PASS. P1-P8 were explicitly not credited.
- Ralph hostile recheck: frozen hashes PASS; core logic diff zero; diff check and secret
  pattern scan PASS; no test deletion or scope-cut evidence.
- Morning-only gates remain unchecked exactly as listed in `MORNING_HANDOFF.md`.

## 2026-08-13 01:55 KST — P1 PASS candidate

- Synthetic ContactOps state/API is implemented behind `X-Demo-Session-ID`, with
  optimistic `expected_revision` conflict protection and immutable source fixtures.
- Local/test state uses isolated memory overlays. Production is configured for Firestore
  session overrides; Firestore reads do not create seed documents, writes validate an
  exact synthetic-record allowlist, and the public map routes remain state-independent.
- Deterministic vertical slice: today's queue -> contact result -> rule findings ->
  separate acute/vulnerability triage -> recommendation-only visit handoff -> explicit
  manager approve/reject. No composite score and no automatic visit approval were added.
- API coverage includes today's queue, case detail, contact results, triage recalculation,
  visit recommendations, and manager decisions. The `ai-observations` endpoint remains
  `501 FEATURE_NOT_AVAILABLE` until P3 by design; returning a fabricated AI candidate in
  P1 would violate the no-stub and human-approval contracts.
- Backend verification: 123/123 tests across 24 suites; 96.73% lines, 90.87% branches,
  and 100% functions, all above the frozen P0 baseline. Production dependency audit has
  0 vulnerabilities at the configured threshold.
- Regression: overnight freeze, UI copy 10/10, synthetic data, triage schemas, data
  hashes, typecheck, frontend build, MapLibre worker emission, and `agent-check` PASS.
  The existing ContactOps rule/scoring modules are byte-for-byte unchanged from baseline.
- Docker `linux/amd64` image build PASS. Runtime smoke returned `/health` 200 and a
  worker-filtered 27-item synthetic queue; the container was healthy and ran as uid 1000.
- Independent critic accepted the P1/P3 engineering boundary and requested only this
  explicit progress record before final P1 verdict.

## 2026-08-13 02:00 KST — P1 PASS

- Independent critic: PASS after rerunning the P1/Firestore subset (33/33), full coverage
  gate (123/123 across 24 suites; 96.73% lines, 90.87% branches, 100% functions),
  production dependency audit (0 vulnerabilities), frozen-core immutability, and
  `agent-check`.
- Ralph hostile recheck: frozen contract hashes and diff check PASS; no composite score,
  automatic approval, test deletion, silent static-map dependency, or fake AI candidate
  was introduced.
- P3 debt remains explicit: `ai-observations` is 501 until the real Planner-Critic
  candidate and confirmation boundary is implemented.

## 2026-08-13 02:41 KST — P2 PASS

- `/ops/surveyor` and `/ops/manager` now complete the deterministic worker-to-manager
  vertical slice against the real P1 HTTP API. The surveyor records a contact result and
  observations, sees separate acute/vulnerability traces, and can create only a visit
  recommendation; only the manager route can record an approval or rejection.
- The isolated Playwright session proved queue reordering from a 62-point acute score,
  reload persistence, manager-only approval, approved-only worker/distance constraints,
  a real MapLibre synthetic point, and zero page/console errors.
- Browser evidence: 13 component/contract tests and the 1-test production-build E2E pass;
  axe reports no serious/critical WCAG 2.1 A/AA violations. Mobile body text is at least
  18px, controls are at least 48px, horizontal overflow is zero, and the mobile content
  grid is one column at 390x844.
- The first hostile review found an external Google Fonts 404 that violated the console
  gate. The remote import was removed, the assertion was not weakened, and a fresh E2E
  rerun passed. A second hostile review returned PASS with no remaining P2 machine gap.
- Regression: UI copy and overnight freeze gates, typecheck, production build, MapLibre
  worker verification, 123 backend tests across 24 suites, and frozen core logic all pass.
- Screenshots are indexed in `artifacts/screenshots/README.md` at the required mobile and
  desktop dimensions. Morning human visual/touch review and a preview URL remain separate
  delivery gates rather than machine-completion claims.

## 2026-08-13 03:08 KST — P3 PASS

- Added a schema-validated Planner-Critic adapter for consented masked text and bounded
  WAV/MP3 file references. Candidate generation is non-mutating, and only an explicit
  confirmation applies canonical facts through the existing deterministic ContactOps rules.
- The adapter strips model-produced `risk_score` and `visit_recommended`, rejects all other
  server-owned fields, keeps route case IDs authoritative, exposes missing/contradictory/
  low-confidence evidence, and never approves a visit or completes a transfer.
- P3 backend tests pass 9/9. The complete voice suite passes 49/49 with one deliberately
  skipped live opt-in test. Full backend coverage reached 96.81% lines, 91.03% branches,
  and 100% functions before later TDD breadth slices entered their temporary RED phase.
- Linux/amd64 Docker build, non-root runtime, dependency audit, frozen-core immutability,
  synthetic/map regressions, TypeScript, Vite production build, and MapLibre worker checks pass.
- Independent implementation and security reviewers returned PASS for the synthetic,
  live-disabled demo boundary. Live production enablement remains blocked on authentication
  or a finite quota/rate guardrail; real-device Korean audio and live LLM usefulness remain
  morning-only human gates.

## 2026-08-13 03:09 KST — P4 PASS

- Added a production-like Playwright golden path using the real memory backend and an
  isolated synthetic session: no-answer yields acute 25, the next no-answer plus exactly
  one observed sign yields acute 57 and `recommended`, then only the manager decision
  endpoint may approve the visit.
- The test preserves separate acute/vulnerability axes, `[합성]` on both operator surfaces,
  reload persistence before and after approval, and zero browser console/page errors.
- Node 24 focused P4 passes 1/1; the combined P2+P4 browser regression passes 2/2.

## 2026-08-13 03:47 KST — P3 UI addendum and global recheck PASS

- The surveyor route now exposes the optional AI observation review loop without replacing
  the deterministic manual form: consented masked text or a staged validated WAV/MP3
  basename -> Planner candidate -> schema validation -> Critic evidence -> editable Korean
  canonical observations -> explicit confirmation -> existing rule and score engines.
- Candidate generation remains non-mutating. The UI displays all five frozen graph stages,
  missing/contradictory/low-confidence evidence, and `AI 후보 · 자동 승인 아님`; a failed
  candidate request preserves the typed text and the manual form remains usable.
- P3 UI/client/component tests are included in the 34/34 frontend suite. The voice suite
  remains 49 passing with one explicit live opt-in skip. Independent security and hostile
  reviewers found no synthetic-demo blocker; live public enablement still requires an
  authentication or finite-quota decision and remains disabled.
- The earlier global review failures were resolved: P8 evidence now exists, and MapView
  readiness no longer waits for external-tile `idle`. Required sources/layers plus the
  first render define readiness; guarded reactive updates prevent pre-registration access.

## 2026-08-13 03:47 KST — P5 PASS

- Manager breadth is served by `GET /api/v1/contact-ops/manager-breadth` from real
  session-overlay state and the canonical deterministic 5,869-case report.
- It includes the transfer-recommendation queue, separate acute/vulnerability
  distributions, the evidence-derived 664-case synthetic tuning warning, and all 13
  explicitly approved visits as `단순 근접 순서 · VRP 아님(차량 경로 최적화 미사용)`.
- No route constraints are exposed before approval and no optimization/dispatch claim is
  made. Independent review returned PASS.

## 2026-08-13 03:47 KST — P6 PASS

- The surveyor mobile view includes the daily summary, repeated-no-answer, overdue, and
  transfer-recommendation cues while preserving the keyboard list and core contact form.
- Empty, loading, and recoverable error states were captured and independently axe-audited.
  The production-like mobile gate records at least 18px normal text, 48px controls, and
  zero horizontal overflow. Independent review returned PASS.

## 2026-08-13 03:47 KST — P7 PASS

- `public/data/structural-context.json` deterministically covers 156 geometry zones and
  162 current dongs. Four public indicators use the frozen midrank formula, equal 12.5
  maxima, no imputation, explicit denominators/completeness, raw values, dates, ranks,
  contributions, and missing reasons. Two unresolved welfare split zones remain null.
- `GET /api/v1/contact-ops/operations-map` overlays session-scoped synthetic cases using
  color=max acute and size=max vulnerability with deterministic tie rules and separate
  contribution summaries. The public and operations map modes remain distinct.
- The UI labels structural context `[MODEL OUTPUT — UNVALIDATED]`, keeps the exact P2
  mixed-snapshot disclosure, and never combines the two operational score axes.
  Independent review returned PASS.

## 2026-08-13 03:47 KST — P8 machine gates PASS; delivery pending

- The immutable narrative fixtures cover repeated no-answer, priority contribution,
  transfer, manager-approved, and 13 approved-visit scenarios. A test-only reset route is
  absent by default and enabled only with `CONTACT_OPS_ENABLE_TEST_RESET=1`; it resets one
  isolated session to revision-zero seed state and is never deployed in production.
- Backend coverage: 165/165 tests across 33 suites, 97.23% lines, 91.93% branches, and
  100% functions. Frontend: 34/34 tests, typecheck, copy gate, production build, and
  MapLibre worker verification PASS. Frozen core modules remain unchanged.
- Production-like P2/P4/P8 Playwright passes 3/3 in two consecutive full runs after the
  readiness guard. P8 produced 11 screenshots including all eight frozen surfaces,
  console/page errors 0, axe serious/critical 0, and explicit empty/loading/error proof.
- The first P8 run found a MapLibre attribution distinction violation and fixed it with a
  visible underline. Visual inspection then found and fixed the manager workbench wrap by
  assigning explicit queue/breadth/decision grid areas. Assertions were not suppressed.
- `npm run verify:overnight` PASS: frozen hashes, denylist, screenshots, separated axes,
  `[합성]`, P2 disclosure, unvalidated model label, no composite score, no browser
  Firestore, and frozen core logic.
- Still pending for P8 delivery: preview URL, draft PR checks/review, ready/merge, and final
  `main` Vercel/Cloud Run commit-revision-digest plus live API/browser verification.

## 2026-08-13 03:57 KST — Exclusive pre-preview verification PASS

- After concurrent Playwright processes produced stale screenshots and connection failures,
  Root took exclusive ownership of the browser evidence and reran the CI contract with fresh
  servers: `CI=1 ... npm run test:e2e:ops` passed P2/P4/P8 3/3 in 10.6 seconds.
- The regenerated screenshots were inspected directly. The mobile queue contains 27 real
  synthetic tasks, the selected case reaches acute 62 with recommendation-only status, and
  the 156-zone operations overlay shows separate acute/vulnerability contribution evidence.
- `npm run verify:overnight` passed with 11 screenshots, console/page errors 0, axe
  serious/critical 0, 18px minimum mobile text, 48px controls, zero overflow, separate axes,
  the mixed-snapshot warning, the model-output label, and no composite score.
- A Linux/amd64 Docker image passed `/health`, the 27-task worker queue, 156-zone/162-dong
  operations-map checks, and ran as UID 1000. Root/backend/voice dependency audits reported
  zero vulnerabilities; actionlint 1.7.7 and `git diff --check` passed.
- Independent source-only judges accepted the exclusive evidence and returned PASS for the
  pre-preview gate. Preview, remote PR checks, merge, and live production proof remain
  delivery gates rather than local completion claims.

## 2026-08-13 04:15 KST — Public preview and real runtime vertical slice PASS

- Published the public frontend preview at `https://incheon-care-ops-preview.vercel.app`
  against the isolated Cloud Run preview API
  `https://incheon-care-api-preview-vy3v2ludma-du.a.run.app`. The preview service uses
  min 0 / max 1, a separate synthetic Firestore collection, exact preview-origin CORS,
  and live AI disabled. Production CORS and production state were restored and left separate.
- The first real container preview exposed a runtime-only bug: the triage-report process
  resolved `../../public/data` from the container working directory and ignored `DATA_DIR`.
  A new isolated-runtime test failed first, then the report process was fixed to resolve
  `synthetic-households.json` from `DATA_DIR`. Focused tests pass 4/4 and full backend
  coverage passes 166/166 at 97.43% lines, 92.18% branches, and 100% functions.
- CI now runs the built backend image as UID 1000 and smokes `/health`, manager breadth,
  and the 156-zone/162-dong operations map. This prevents a source-only test pass from
  hiding a broken Docker data path.
- A real public-preview browser session loaded the 27-item worker queue, submitted a
  synthetic no-answer + one observation + severe-meal case, obtained acute 62 and a
  recommendation-only state, then loaded the manager queue, the 664-case tuning warning,
  the unvalidated four-indicator structural panel, and recorded an explicit manager
  approval through a 200 response. Console errors and warnings were zero.
- That run also found a stale manager-summary view after approval. A RED component test
  now freezes breadth refresh and one-render-per-axis behavior; the minimal refresh fix is
  GREEN. The corrected Vercel deployment `dpl_6Qfng1L3yTDwdUdTZ3bPGSu53uff` and preview
  Cloud Run revision `incheon-care-api-preview-00006-bc9` is labeled with the runtime-fix
  commit `daa8a65`; both retain
  min 0 / service-and-revision max 1, exact preview CORS, and return the 664-case report.
  A fresh public-browser rerun reached `승인된 방문 1건` immediately after the manager
  decision with zero console errors. Remote PR checks, merge, production deploy, and final
  live `main` verification remain the delivery gates.

## 2026-08-13 04:36 KST — P8 delivery and production verification PASS

- PR #18 passed two independent GitHub validation runs, received an independent source and
  safety PASS, was marked ready, and merged as
  `6e43bce8b95e91aaa2abb0c5daba39d7c8bbc9fe`.
- Production Actions run `31632681184` completed all three jobs: validation in 2m10s,
  Vercel production in 40s, and Cloud Run production in 1m26s. The deployed frontend is
  Vercel deployment `dpl_4is4mseSqNR9snXw1C5tjQS9MYiJ` at
  `https://incheon-care-map.vercel.app`.
- Cloud Run revision `incheon-care-api-00019-qsh` receives 100% traffic, carries the exact
  merge SHA label, and runs image
  `sha256:d577249792b5e994b4447b471a3baea4d5b30e1d0e628ac2705b0fa7be364595`.
  Its exact production CORS origin is the Vercel alias; an unapproved origin returns 403,
  the test-only reset route returns 404, and the API returns 27 queue items, tuning 664,
  156 geometry zones, 162 current dongs, and 2,816 relevant facility points.
- A fresh production-browser synthetic session reached acute 62 and recommendation-only
  status from a no-answer/observation result. Only the manager route approved it; the
  `승인된 방문 1건` summary survived reload. A second fresh session confirmed the 664
  tuning warning, separate acute/vulnerability axes, and `[MODEL OUTPUT — UNVALIDATED]`.
  Both browser runs had zero console errors or warnings.
- Machine delivery is complete. Remaining work is human-only: real-device Korean audio
  accuracy, live-model usefulness before enablement, physical-device touch review, final
  Korean polish, and full judge rehearsal. The temporary min-0/max-1 preview service has a
  keep/delete decision on 2026-08-15 KST.

## 2026-08-13 08:10 KST — Claude/Codex handoff harness refresh PASS

- A clean worktree from `origin/main` reproduced a stale handoff-gate failure before edits:
  `scripts/agent-check.sh` expected an obsolete `PRODUCTION_ORIGIN` workflow spelling while
  production uses the equivalent `production_origin` shell variable. The failure was retained
  as RED evidence rather than bypassed.
- Added a three-test handoff contract covering the shared `CLAUDE.md` → `AGENTS.md` entry path,
  clean-worktree bootstrap, the last independently verified production baseline, and the actual
  production-origin workflow contract. The focused suite is GREEN 3/3 and now runs in CI.
- `npm run agent:check` is the common next-agent command. On Node 24.19.0 it passes frontend
  35/35 plus copy/type/build/MapLibre checks, deterministic data/schema gates, backend 166/166
  with 97.23% lines / 91.85% branches / 100% functions, and voice 49 pass with one explicit
  live-provider opt-in skip.
- `docs/AGENT_HANDOFF.md` now has a 60-second clean-worktree takeover, subsystem continuation
  seams, non-bypass rules, and historical production identifiers. `AGENTS.md` records the same
  generic Claude/Codex bootstrap. GitHub visibility is stated accurately as public while
  `package.json` remains private only to prevent accidental npm publication.

## 2026-08-13 10:13 KST — Public residential-address synthetic operations PASS locally

- Replaced arbitrary per-dong synthetic workload placement with a deterministic 5,869-task
  allocation proportional to the observed 2026-07-31 `65+ one-person households` count across
  all 162 current dongs. The resulting range is 2–97 tasks per dong and still rolls up to the
  verified 156 map geometry zones.
- Built 5,869 public residential-building anchors by joining the official 2026-07 Juso building
  database, VWorld residential building-age records, and VWorld AL_D010 building polygons. The
  generated contract contains 5,683 unique PNU references and 2,303 apartment/collective-housing
  task references. Fourteen 송도5동 tasks use one source-recorded OpenStreetMap residential
  building point where the held VWorld polygon snapshot had no usable match.
- TDD added a recommendation-point API contract before implementation. Fresh-session
  `GET /api/v1/contact-ops/operations-map` now returns 97 sorted `visit_review_points`, including
  33 apartment points, with public road address, representative coordinate, building name,
  separate acute/vulnerability scores, contribution traces, and recommendation-only status.
  No visit is auto-approved.
- Public structural context is injected before a phone result exists. A browser regression found
  that fractional structural vulnerability scores were rejected by the older manager-breadth
  integer guard; a focused RED test now freezes finite 0–100 vulnerability decimals while acute
  scores remain integer.
- Local evidence: deterministic anchor rebuild SHA-256
  `b64cbac9053c00e0b5dfc2cdfbd8a5ff6dc64a7e439a8996627519f1d3625852`, synthetic tests 9/9,
  P2/P4/P8 browser flows 3/3, Node 24 type/build/worker checks, voice 49 pass plus one explicit
  live opt-in skip, actionlint 1.7.12, data checksums 323/323, and Linux/amd64 Docker smoke with
  UID 1000. PR, merge, production deploy, and live API proof remain delivery gates.
## 2026-08-13 — 3계층 재설계 P0 PASS (branch claude/three-tier-care-redesign-8lpmkw)

- REDESIGN_SPEC.md 프리즈 커밋: 철학·INV14~19·페이즈 done 조건·환경 확정 사항.
- 회귀 베이스라인: 컨테이너 기본 Node v22.22.2에서는 백엔드 커버리지 게이트가
  functions 98.51%로 실패(테스트 파일 함수 계측 차이). Node v24.19.0(/opt/node24)
  설치 후 `npm --prefix backend run test:coverage` PASS (lines 96.47%, branches 90.66%,
  functions 100%). 그 외 `npm run agent:check` 전 단계는 Node 22에서도 PASS였고,
  이후 검증은 전부 Node 24로 실행한다.
- INV15/INV4 충돌 조정 확정: 가상 전화번호는 픽스처가 아닌 어댑터 계층에서 케이스 ID로
  결정적 유도(스펙 본문 참조).
- Attempts: 1/5.

## 2026-08-13 — 3계층 P1 저지/Ralph 게이트

- 독립 저지: PASS (엔진 동결 확인, INV14~19 테스트 근거 확인, Node24 재검증).
- Ralph 재확인: FAIL 3건 → 즉시 수정 (attempt 2/5):
  1) 일괄 확인이 case_ids:null로 저장되어 확인 이후 배치에 새로 들어온 제안이
     자동 '확인됨'으로 보이던 INV14 구멍 → 확인 시점 (레인,케이스) 스냅샷 저장으로 수정.
  2) 보고 확인이 케이스 ID 기준이라 새 리비전 카드가 이전 확인을 상속하던 INV14
     구멍 → 확인 리비전=카드 리비전일 때만 유효하도록 수정.
  3) 급성도 등급이 할당 엔진에서 표시용으로만 쓰이던 스코프컷 → 방문 레인
     정렬·용량 판단에 급성도 점수 참여하도록 수정.
  각각 회귀 테스트 추가(211 tests). 위험군 금지어 전용 단언, 실번호 grep 재귀화 포함.

## 2026-08-13 — 3계층 P2 (/center 동 행정복지센터)

- 인박스 피드(보고 카드: 등급·사유·권고 기관·[보고 확인][이관 안내][방문 검토]),
  오늘 배치 확인(전화/방문 레인 탭 분리, 일괄/개별 확인), 방문 검토(기존
  visit-decisions API 재사용), 접힌 지도 사이드 위젯, 상단 처리 요약.
- 이관 확정 API는 데모 범위 밖 — 워딩·안내만(스텁 명시).
- 프런트 테스트 6건: INV14(명시 확인 액션만), INV16(레인 혼합 렌더 금지),
  INV18(위험군 부재·등급 어휘), 이관 워딩.

## 2026-08-13 — 3계층 P3 (/m 조사원 모바일)

- 오늘 목록 전화/방문 탭 분리(INV16), 방문 탭에 동 단위 위치·선호 시간창·동행 요건.
- 대상 정보: [가상] 전화(탭하면 가상 발신 화면 모사, 실제 발신 없음 명시),
  마지막 연락, 등급. 주소는 합성 데이터 부재를 명시하고 동 단위 위치로 대체(INV4).
- 입력 3경로 수렴: ① 음성 파일 업로드(3b multipart 계약→후보), ② 결정론 문답
  챗봇(후보만), ③ 수동 체크 — 전부 같은 체크리스트에서 조사원 확정 후 제출(INV14)
  → 기존 결정론 점수·규칙 → 보고 카드 → "동 행정복지센터에 보고됨" 확인 화면.
- 프런트 테스트 5건(INV14/15/16, 음성·문답 후보 경로).

## 2026-08-13 — 3계층 P4 (/city 시·구)

- 인천 전체 지도(운영 오버레이 유지). 동 클릭은 동 단위 롤업까지만 — 케이스 ID
  비노출 프런트 테스트 포함(INV17).
- 구 단위 AI 분석 요약 패널(구 선택 → 집계 인용 해석문 + [AI 생성 · 관측 집계
  해석 · 개인 예측 아님] 라벨 + 혼합 스냅샷 경고, INV19).
- 증원 검토 패널: 구조 맥락(0~50 평균·순위)과 운영 부하(연결단원당 건수·순위)를
  나란히 비합산 표기, "배치 최적화" 명명 금지 유지.
- 프런트 테스트 4건(INV17 2건, INV19, 비합산 표기).

## 2026-08-13 — 3계층 P5 데모 봉합

- 신규 골든 `e2e/p9-three-tier.spec.ts`: 시 지도 → 동 센터 배치 일괄 확인(확인 전
  POST 부재 단언) → 모바일 가상 발신 모사·수동 체크리스트 제출(급성도 62) → 보고
  카드·명시 확인 → 방문 승인(approved_visit_constraints 검증) → 시·구 집계·운영
  지도 반영 + INV17 비노출 유지. 모바일 측정 게이트(≥18px·≥48px·오버플로 0)와
  axe 게이트(세 화면 × 두 뷰포트) 포함. 스크린샷 매트릭스 테스트 별도.
- 전체 ops 스위트 5/5 통과(47.4s). 기존 p2/p4/p8 스펙은 단언 무약화 유지 —
  변경은 (a) 샌드박스 전용 외부 베이스맵 소음 필터(앱 오리진 오류는 여전히 실패),
  (b) 지도 준비 대기 타임아웃 20s→45s 두 가지뿐. 샌드박스에서는
  PLAYWRIGHT_CHROMIUM_EXECUTABLE env로 사전 설치 Chromium + 데드 프록시를 쓰며,
  CI 동작은 불변(env 미설정 시 기존 경로).
- 스크린샷 14장: artifacts/screenshots/p9-*.png (390×844·1440×900 매트릭스 포함).
  샌드박스는 외부 타일 접근이 없어 지도 배경이 비어 있음(데이터 레이어는 렌더).
- 백엔드 211 테스트·커버리지 게이트 그린, 프런트 50 테스트·typecheck·build 그린.
- MORNING_HANDOFF 3계층 섹션(증명/미증명 분리·데모 대본), AGENT_HANDOFF 시임 갱신.

## 2026-08-13 — main #25 병합 및 3계층 주소 반영

- origin/main(#25 공공 주거 주소 합성 데이터)을 3계층 브랜치에 병합. PROGRESS
  충돌은 양쪽 기록 모두 유지로 해소.
- 의미 병합: 레인 API `location`에 `road_address`·`building_name`·
  `apartment_reference` 추가, `/m` 대상 정보·방문 목록에 공공 건물 주소 표기
  ("실제 거주자와 연결되지 않음" 병기). "주소 없음" 대체 표기는 폐기하고
  REDESIGN_SPEC에 개정 기록. 튜닝 경고 수치 664→647 갱신.
- 검증: 백엔드 214 테스트·커버리지 게이트 그린, 프런트 50, E2E 5/5,
  `agent:check` 전체 그린.

## 2026-08-13 — P2~P5 저지/Ralph 게이트 및 수정 라운드 (머지 후)

- PR #26 머지 후 독립 저지·Ralph 판정 도착: FAIL. 지적과 조치:
  1) P3 "방문 탭엔 지도" 누락(무언 스코프컷) → `/m` 방문 케이스 상세에 접힌
     "방문 위치 지도 열기" 위젯 추가(케이스 좌표 합성 점 + 구역 강조),
     레인 API에 geometry_zone_id 추가, 단위 테스트 추가.
  2) E2E 콘솔 소음 필터가 CI에서도 무조건 적용 → PLAYWRIGHT_CHROMIUM_EXECUTABLE
     env가 설정된 샌드박스에서만 필터하도록 게이트(CI는 필터 0건, 기존과 동일).
     직전 PROGRESS의 "샌드박스 전용" 서술 오류 정정.
  3) INV17이 렌더 계층만 강제 → 서버가 구역 최대값 케이스 ID를 제거한
     `three-tier/city-operations-map` 엔드포인트 신설, /city가 이를 사용.
     프런트·E2E 단언을 innerText → 전체 HTML(page.content)로 강화.
  4) 모바일 측정 게이트 공집합 통과 가능성 → 측정 요소 수 > 0 단언 추가.
  5) 음성 업로드 클라이언트 FormData 필드명 무검증 → 3b 계약 필드명 단위
     테스트(threeTierClient.test.ts) 추가.
  6) p9 '62' 무스코프 단언 → .mobile-done-summary로 스코프.
  - 미수정(기록만): '개별 조정'은 확인 보류+플래그로 해석(HANDOFF에 명시),
    드래프트 PR은 게시 직후 관리자가 ready로 전환(정상 흐름).
- 검증: 백엔드 216 테스트·커버리지 게이트(97.27/91.08/100), 프런트 53,
  E2E 5/5, typecheck·copy 게이트 그린.
- 브랜치는 머지 규칙에 따라 origin/main(1b03d9a)에서 재시작해 후속 커밋.

## 2026-08-13 — /center 워딩 정리 + 토스·애플 톤 재스타일 (제품 오너 지시)

- 설명성 카피 제거: 처리 원칙 블록, 화면 소개문·합성 디스클레이머 문단, 배치 제안
  설명문, 레인 규칙 문장, "(참고용)" 등. [합성] 표기는 헤더의 작은 "[합성] 데모"
  배지 하나로 축소(합성 데이터 정직성 표기는 유지하되 도배 제거).
- 재스타일(.center-page 범위 한정, /city·/m 무영향): Pretendard(웹폰트 CDN),
  화이트 카드(radius 16~20)·서브틀 섀도, 토스 블루(#3182f6) 프라이머리,
  애플 세그먼트 컨트롤형 레인 탭, 텍스트 버튼·칩 재정렬.
- axe 대비 게이트로 회색 팔레트 2회 보정(#8b95a1→#6b7684, 미기록 칩) 후
  세 화면 × 두 뷰포트 serious/critical 0 유지.
- 검증: 프런트 53, E2E 5/5, copy 게이트·typecheck 그린. 골든 문자열 갱신은
  IA 변경 규칙 내(단언 수·강도 유지).

## 2026-08-13 — /center v3: frontend-design 스킬 적용

- anthropics/skills의 frontend-design 스킬을 받아 지침대로 적용: 볼드함은 시그니처
  하나(딥 네이비 "오늘 브리핑" 히어로 — 큰 합계, 반투명 스탯 필, conic 완료율 링)에
  집중하고 나머지는 절제. 보고 카드 등급 컬러 레일, 섹션 블루 틱, 카드 스태거
  등장(0.4s, prefers-reduced-motion 존중).
- axe 게이트가 등장 애니메이션 중간의 블렌딩 색으로 오탐 → 매트릭스 스캔 대기를
  애니메이션 종료 후(800ms)로 조정. 세 화면 × 두 뷰포트 serious/critical 0 유지.
- 검증: 프런트 53, E2E 5/5, typecheck·copy 게이트 그린.

## 2026-08-13 — /center v4: Gamegoo-front-v2 디자인 언어 이식 (제품 오너 지정 레퍼런스)

- 레퍼런스 저장소(Gamegoo-repo/gamegoo-front-v2)의 디자인 시스템을 분석해 토큰
  수준으로 이식: 바이올렛 프라이머리(#5a42ee/#452aea), 블루틴트 그레이 스케일
  (페이지 #f1f5fa · 보더 #d7dfea · 트랙 #edf2f8), radius 10px 버튼 + active
  scale(0.95~0.97), 보더 중심 카드(섀도 최소), Pretendard 150% 행간, 레드
  경고(#ee173c). 히어로는 바이올렛 그라디언트로 재도색, 등급 칩·레일도 동일
  계열로 정렬. 코드가 아닌 시각 언어(팔레트·라운드·모션 규약)만 가져옴.
- 레퍼런스의 gray-600(#747a83)은 AA 4.5:1 미달(4.32)이라 #656b75로 보정.
- 검증: 프런트 53, E2E 5/5(axe 대비 게이트 포함), typecheck·copy 게이트 그린.

## 2026-08-13 — CI 슬림화 (PR 피드백 ~1분)

- PR에서는 Playwright 브라우저 E2E를 건너뛰고 main 푸시에서만 실행(로컬
  test:e2e:ops 의무는 유지). Markdown·artifacts만 바뀐 커밋은 파이프라인 전체
  스킵(paths-ignore). 연속 푸시 취소(concurrency)는 기존 구성 확인.
- AGENTS.md 배포 계약 문단에 동일 내용 기록. agent:check 그린.

## 2026-08-13 — 자연어 대상 표시와 구별 분석 문장 반영

- 내부 `SYN-HH-*` 식별 계약은 유지하되 API 표시값 `display_name`을 추가하고,
  모바일·동 센터·기존 운영 화면에는 `김영자 어르신` 같은 결정적 한국어 이름만
  표시. 동별 최대 50건 이름 중복 방지 테스트를 추가.
- 프로덕션 UI에서 내부 식별자와 `합성` 표식을 제거하고, 다시 들어오지 못하도록
  UI copy gate를 확장. 실제 주민 상태가 아니라는 설명은 `고정 운영 예시`로 유지.
- 런타임 OpenAI 호출과 키 요구를 제거. Codex가 작성한 인천 11개 구별 분석 문장에
  서버가 고령비율·일인가구비율·기초수급 밀도·시설 수·업무 부하 집계값을 주입하는
  `codex_authored_v1` 어댑터로 고정.
- 검증: `agent:check` 전체 그린(프런트 55, 백엔드 218·라인 97.29%·브랜치
  90.99%·함수 100%, 음성 50 통과·라이브 1 skip), P9 실브라우저 골든 2/2 통과.

## 2026-08-13 — /center v5: 지도 오버레이·스크롤 픽스 + 주소·연락 이력 표기

- 지도 위젯 오버레이 사고 수정: 전역 `.map`(position:absolute)이 포지셔닝 안 된
  프레임에서 뷰포트 전체를 덮던 문제 → `.center-map-frame`/`.mobile-map-frame`에
  position:relative + contain 부여.
- 페이지 스크롤 수정: 전역 body overflow:hidden 아래에서 .tier-page 높이 미고정
  으로 스크롤 불가 → height:100dvh + overflow-y:auto.
- 배치 행·보고 카드에 도로명 주소(#25 `road_address`)·마지막 연락 결과·예정일
  표기를 추가. 대상 표시는 main의 `display_name` 자연어 이름 체계로 통일(merge).
- `[합성] 데모` 배지 제거(제품 오너 명시 지시). 합성 고지는 API displayMarker·
  문서에 유지.
