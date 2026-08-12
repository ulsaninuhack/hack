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
