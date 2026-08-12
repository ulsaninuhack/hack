# Care Operations Console — Frozen Overnight Specification

- Spec version: `1.0.0`
- Baseline: `origin/main@1fab6889f0608a3f860137188ec3158d08ed755a`
- Work branch: `agent/ui-ops`
- Freeze time: `2026-08-13 01:20 KST`
- Source objective: `/Users/coldmans/.codex/attachments/856b9ab2-10cf-4fb5-9419-505e8aa8f34b/goal-objective.md`
- Frozen by: Codex builder; acceptance remains owned by the objective and independent judge evidence.

This file is the only overnight completion contract. After the freeze commit, it and
`UI_UX_RUBRIC.md` may not change. `scripts/verify-overnight-freeze.mjs` compares their
bytes to hashes in `overnight-freeze.json`; the same gate runs in CI. A changed hash is
a failure, not a documentation update. There is no self-approved exception path.

## Product truth

The winning path is a synthetic operating loop:

1. a surveyor records or speaks a consented observation;
2. the Planner structures candidate facts;
3. schema validation and the Critic expose missing, contradictory, or low-confidence facts;
4. existing deterministic ContactOps rules and the separate acute/vulnerability axes
   update the queue;
5. a manager explicitly approves or rejects a recommended visit.

The LLM never produces the final visit or transfer decision. This is not a personal-risk
model, eligibility screen, or service-nonrecipient finder. Operational records are
synthetic only. The existing public map remains an observed aggregate context map.

## Frozen API and state contract

All endpoints use the existing `{apiVersion:"v1", data|error}` envelope. Mutation bodies
are bounded JSON and require `Content-Type: application/json`. Every operations response
contains `synthetic: true` and the exact display marker `[합성]`. Raw internal enums remain
inside the API and are translated before rendering.

| Method and path | Purpose | Required inputs | Success / errors |
| --- | --- | --- | --- |
| `GET /api/v1/contact-ops/today?referenceDate=YYYY-MM-DD&workerId=` | Today queue, already ordered by acute desc, vulnerability desc, elapsed days desc | valid date, optional synthetic worker ID | `200`; `400 INVALID_QUERY` |
| `GET /api/v1/contact-ops/cases/:caseId` | Case detail, separated axes and contribution traces | synthetic case ID | `200`; `404 CASE_NOT_FOUND` |
| `POST /api/v1/contact-ops/cases/:caseId/contact-results` | Apply one canonical contact result, observations, rules, rescore, and persist | `expected_revision`, date, result, observation DTO | `200`; `400`; `409 STATE_CONFLICT` |
| `POST /api/v1/contact-ops/cases/:caseId/triage/recalculate` | Re-run deterministic scoring from persisted synthetic state | `expected_revision`, reference date | `200`; `409` |
| `GET /api/v1/contact-ops/visit-recommendations` | Manager review queue | optional district | `200`; `400` |
| `POST /api/v1/contact-ops/cases/:caseId/visit-decisions` | Call `applyManagerVisitDecision` only | expected revision, approve/reject, worker IDs, note, approved-only distance | `200`; `400`; `409` |
| `POST /api/v1/contact-ops/cases/:caseId/ai-observations` | Planner → schema → Critic candidate; optionally apply only after explicit user confirmation | expected revision, consented masked text or validated file reference | `200` candidate; never final approval |

`X-Demo-Session-ID` is mandatory for operations mutations and optional for reads. It is a
random opaque demo namespace, never a person identifier. Memory and Firestore state keys
are `session_id + case_id`. PR previews and local E2E use isolated session IDs. Production
may store only `{schemaVersion, synthetic:true, session_id, revision, household,
observations, triage, updated_at}` in Firestore. Non-synthetic IDs or payloads are rejected.
Static map requests never depend on Firestore. `CONTACT_OPS_STATE_BACKEND=memory` is the
local/test default; production uses `firestore`. A reset endpoint is test-only and is not
deployed.

The checked-in fixture is immutable seed data. Duplicate writes use optimistic revision
checks, so a retry cannot increment a no-answer count twice.

## Frozen demonstration seed

The demo seed must deterministically provide at least these generic cases, all labeled
`[합성]` and containing no name, address, or phone number:

- repeated no-answer case that rises when one observation is added;
- priority recommendation with separated contribution traces;
- transfer-recommended case;
- just-approved case created only by a recorded manager decision;
- 13 approved-visit fixtures for a nearest-order hint (explicitly not VRP).

## P0 — Baseline, freeze, and production truth

Done only when:

- this file, `UI_UX_RUBRIC.md`, freeze manifest, verifier, `PROGRESS.md`, and
  `MORNING_HANDOFF.md` are committed on `agent/ui-ops`;
- all pre-existing validation, frontend build, backend coverage, demo/report, voice tests,
  agent check, and Docker build pass on Node 24;
- baseline backend tests remain at least 97 passing across at least 19 suites and coverage
  remains at least 96.05% lines, 90.47% branches, and 100% functions;
- production proof ties `main@1fab6889f0608a3f860137188ec3158d08ed755a`
  to GitHub Actions run `31616839239`, Cloud Run revision `incheon-care-api-00015-j27`,
  image digest `sha256:da6527b3124fb9342fb2f37c1809c9501b0d5f709cbd2dea409143cc0174e171`, Vercel
  public asset, `/health`, and current summary counts;
- the baseline browser is visually inspected without console errors.

Non-goal: feature implementation.

## P1 — Synthetic operations API

Done only when the frozen API routes work through a service/state abstraction, reuse
`contact-ops.mjs` and `contact-triage-scoring.mjs` unchanged, persist only synthetic state,
and have contract tests for success, malformed JSON, unsupported content type/method,
invalid ID, non-synthetic payload, stale revision, duplicate submission, Firestore
transaction behavior, CORS, and Firestore unavailability. Manager approval before a
recommendation fails. Rejection creates no route constraints. Static map API tests remain
green and map reads remain available when ContactOps state is unavailable.

## P2 — Core worker-to-manager vertical slice

Done only when:

- `/ops/surveyor` at `390x844` shows today's queue, acute as the primary color cue,
  vulnerability as a secondary value, separated contribution disclosure, and a labeled
  contact-result form;
- `connected`, `no answer`, `refused`, and `invalid` are rendered in safe Korean, while a
  concern form captures six signs, meal, hygiene, utility arrears observation,
  health/mental distress, social network, contact frequency, and free memo;
- submission invokes the real API, deterministic rules and score engine reorder the queue,
  and a recommendation says `담당자 승인 대기`;
- `/ops/manager` shows recommendation review, approve/reject, worker assignment,
  approved-only distance constraint, note, and the synthetic point on the existing map;
- surveyor UI cannot send an approval and manager UI cannot approve a non-recommended case;
- browser component tests and mobile/desktop screenshots prove the flow; no browser-direct
  Firestore access exists.

P2 completion means the deterministic demo is usable even when AI is disabled.

## P3 — Planner/Critic AI adapter

Done only when consented masked text and validated WAV/MP3 input pass through:

`Planner candidate → JSON schema → Korean/English adapter → Critic flags → explicit user
confirmation → existing deterministic rules/scoring → queue update → manager boundary`.

Planner output cannot include or mutate server-owned streak, deadline, score, approval,
transfer completion, or route constraints. The Critic returns explicit arrays for
`missing_fields`, `contradictions`, and `low_confidence_fields`. `위생상태: 심각` is mapped
to the canonical supported observation without silently inventing a new score weight.
Mocked goldens prove deterministic behavior; a live LLM requires an explicit environment
gate and is recorded as morning human verification, never overnight completion proof.

## P4 — Core E2E golden in CI

Done only when Playwright locks this exact path with an isolated demo session:

`오늘 연락 → 미응답 → 관찰 1개 추가 → 급성도 상승 → 방문 권고 → 관리자 승인`.

The test asserts both axes remain separate, every operation surface says `[합성]`, manager
approval is the sole approval transition, state survives a browser reload, there are no
console errors, and the same spec runs in CI. CI uploads trace, screenshots, and axe
artifacts on failure.

## P5 — Manager breadth

Done only when the manager console adds:

- transfer-recommendation queue;
- grade distribution without a composite score;
- a `합성 배점 튜닝 경고` panel reporting the current deterministic mild-signal count
  (baseline 664, updated only through the report test);
- 13 approved synthetic visits with a simple nearest-order hint labeled `VRP 아님`.

No optimization or dispatch claim is allowed.

## P6 — Surveyor breadth

Done only when the worker mobile view adds repeated-no-answer/overdue badges, transfer
recommendation, a daily summary, and verified empty/loading/error states. All core
actions work by keyboard and touch without hover. Screenshots cover every state.

## P7 — Operations map and transparent structural context

Done only when the map has separate `공개 인구 맥락` and `[합성] 연락업무` modes. In
operations mode, color is acute and size is vulnerability; click opens separate
contributions. Rollup uses the real current-dong-to-156-zone crosswalk.

The public structural component is `[MODEL OUTPUT — UNVALIDATED]` and exactly 0-50. Each
of the four indicators—older-population share, one-person-household share, 30+-year
residential-building-record share, and basic-livelihood context density—is converted to a
midrank percentile over non-missing comparable geography. Each contributes
`12.5 × percentile_rank`; missing input contributes no points and is shown as missing,
while the available-indicator denominator and completeness are shown. Ties use midrank:
`(count_lower + 0.5 × (count_equal - 1)) / (n - 1)`, with a single observation assigned
`0.5`. No direction, weight, or imputation other than this frozen equal maximum is added.
The four raw values, ranks, contributions, reference dates, and missingness are displayed.
This is an unvalidated context candidate, not personal vulnerability or a probability.

P2 population ratios retain the numerator `2026-07-31`, denominator `2026-06-30`, and
mixed-snapshot warning on every visible occurrence.

## P8 — Demo hardening and delivery

Done only when:

- the frozen narrative seed loads and resets deterministically for an isolated session;
- all edge/component/E2E/data tests, typecheck, build, Docker, console-zero, axe AA, font,
  touch-target, contrast, and denylist gates pass;
- mobile, desktop, manager, worker, map overlay, empty, loading, and error screenshots are
  recorded under `artifacts/screenshots/` with an index;
- an adversarial review finds and fixes stubs, silent scope cuts, semantic errors, and
  unsupported claims;
- `PROGRESS.md` is append-only and `MORNING_HANDOFF.md` distinguishes machine proof from
  human checks;
- a Vercel preview URL is posted, a draft PR is opened, checks pass, review punch-list is
  resolved, then the PR is made ready and merged only after the user-authorized delivery
  gate;
- final `main` validation deploys Vercel and Cloud Run, and live commit/revision/digest,
  API flow, 162/156 counts, and frontend behavior are reverified.

## INV1-INV13 — Non-negotiable invariants

### INV1 — Core logic immutability
`git diff --exit-code 1fab6889 -- backend/src/contact-ops.mjs backend/src/contact-triage-scoring.mjs`.

### INV2 — Two axes, never one score
No schema, API, state, UI, or copy may emit a composite/total/combined score. Tests must
prove ordering is acute first and vulnerability second, never their sum.

### INV3 — Safe user-facing language
Rendered UI contains none of `위험도`, `고위험자`, `미수혜자`, `개인예측`, `개인 예측`,
or raw enums such as `no_answer`, `connected_ok`, `connected_concern`, `invalid_contact`.

### INV4 — Synthetic identity boundary
Every operations page, case, modal, printout, API response, and screenshot says `[합성]`.
No generator or fixture creates a resident name, address, or phone number.

### INV5 — No secrets
Diff and repository scans contain no API keys, private keys, credentials, `.env` payload,
or browser-delivered service credentials.

### INV6 — Manager-only approval
Only `applyManagerVisitDecision` may produce `approved` or `rejected`. Planner, Critic,
scoring, rule evaluation, surveyor UI, seed, and state adapter may not.

### INV7 — Monotonic regression evidence
No existing test is deleted, skipped, weakened, or replaced. Backend test count, suites,
line/branch/function coverage do not fall below the P0 recorded baseline. All existing
frontend/data/voice checks remain green.

### INV8 — Geography and validation
162 current dongs, 156 geometry zones, data validation `pass`, and map totals remain.

### INV9 — Mixed-snapshot disclosure
Every visible P2 value has the exact reference dates and says it is not a same-date rate.

### INV10 — Objective UI proof
Typecheck/build pass, console errors are zero, axe has zero serious/critical violations,
and mobile/desktop screenshots are captured from fresh production-like builds.

### INV11 — Anti-marketing copy
The denylist in `UI_UX_RUBRIC.md` is absent from rendered source strings. A denylisted
phrase inside the rubric itself is not a violation.

### INV12 — Legibility and targets
At `390x844`, normal body text computes to at least 18px and every interactive target
computes to at least 48×48px. Contrast meets WCAG AA. Web UI uses full Korean labels and
never exposes an unexplained acronym.

### INV13 — Golden E2E
The P4 golden path passes in local production-like mode and GitHub Actions.

## Phase loop and stop rule

Every phase uses TDD red → green → refactor, then runs all invariants and its done
condition. A separate reviewer receives only the frozen files, diff, objective outputs,
and screenshots and reports PASS/FAIL with reasons. A PASS is followed by one hostile
Ralph check for stubs, silent cuts, or semantic mismatches. Only then are `PROGRESS.md`
and `MORNING_HANDOFF.md` updated and the phase committed. A phase gets at most five failed
gate attempts; on the sixth failure work stops at that phase and the blocker is recorded.

## Morning-only human gate

Overnight automation cannot mark these complete: real Korean/telephone audio accuracy,
physical-device touch feel, final visual taste, Korean pitch wording, judge-readability,
demo rehearsal, live LLM usefulness, or whether the 664-case tuning warning is an
acceptable policy tradeoff. `MORNING_HANDOFF.md` must list them as unchecked until a human
records the review. The overnight build may still be merged only when the user explicitly
authorizes that delivery despite these named morning checks.

## Explicitly out of scope

- time-axis prediction;
- personal utility anomaly feeds;
- real resident, beneficiary, or case data;
- automatic visit approval or transfer completion;
- full vehicle-routing optimization;
- arbitrary learned or hand-tuned composite score.
