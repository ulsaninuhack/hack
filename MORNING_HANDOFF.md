# Morning Handoff — Care Operations Console

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
| P8 | preview pass; delivery pending | Full local gates/evidence and public preview vertical slice PASS; PR, merge, and live `main` recheck pending |

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
- [ ] live LLM usefulness and failure behavior
- [ ] physical-device touch comfort and keyboard behavior
- [ ] final Korean wording and visual polish
- [ ] judge-readability and complete demo rehearsal
- [ ] whether the 664 synthetic mild-signal accumulation warning is acceptable

## Preview and screenshots

- Preview URL: `https://incheon-care-ops-preview.vercel.app`
- Preview API: `https://incheon-care-api-preview-vy3v2ludma-du.a.run.app`
- Screenshot index: `artifacts/screenshots/README.md`
- Frozen captures: public map, operations overlay, manager review/map at `1440x900`;
  surveyor queue/detail/form and empty/loading/error proof at `390x844`.

## Known blockers and stubs

- The public preview is complete, including the real API queue -> acute 62 recommendation
  -> manager approval path. Draft PR review, merge, and post-merge production verification
  are not yet complete. Do not treat preview proof as production `main` proof.
- P1 operations routes use Firestore only for synthetic session overrides in production.
  Static health/map/facility/transit/summary routes remain independent of it.
- `POST /api/v1/contact-ops/cases/:caseId/ai-observations` now supports candidate and
  explicit-confirmation modes. Live provider calls remain fail-closed unless
  `ENABLE_LIVE_CONTACT_OPS_AI=1`; no live provider key is deployed yet.
- Real-device Korean audio accuracy and live LLM usefulness remain morning-only human gates.
- Before enabling live AI on the public Cloud Run service, add authentication or a finite
  platform/API quota; the current demo endpoint is intentionally synthetic and unauthenticated.
- The reset endpoint is test/E2E-only, gated by `CONTACT_OPS_ENABLE_TEST_RESET=1`, and
  unavailable in the normal production server configuration.
