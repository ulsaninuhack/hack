# Agent Handoff

## Current State

- Project: currently public GitHub hackathon MVP, "I5 도시 돌봄" / Incheon care-context map.
  `package.json` is private only to block accidental npm publication; it does not describe the
  repository's GitHub visibility.
- Frontend: React 19, TypeScript, Vite 8, MapLibre, static assets from `public/data/`.
- Frontend production: `https://incheon-care-map.vercel.app` is live.
- Current public review preview: `https://incheon-care-ops-preview.vercel.app`, backed by
  the isolated preview API `https://incheon-care-api-preview-vy3v2ludma-du.a.run.app`.
- Runtime data boundary: Cloud Run API-first loading is merged while `public/data/` remains the outage/local fallback. Production CI verifies both the built bundle and the public Vercel alias reference the API.
- Deployment owner: GitHub Actions workflow `CI / Production Deploy`.
- Backend local source: Node 24 API for curated read-only `public/data/` routes plus session-isolated synthetic ContactOps operations, with `src/`, tests, coverage gate, Dockerfile, `.dockerignore`, and README.
- Backend production: `https://incheon-care-api-vy3v2ludma-du.a.run.app/health` is live. Match the successful `main` run, revision commit label, and image digest before claiming an exact commit is deployed.
- Backend health convention: `/health` is canonical externally. `/healthz` exists in source/tests, but Cloud Run's frontend intercepts that path and returns its own 404, so external smoke tests use `/health`.
- Voice input: `voice/` stage 3a converts consented, PII-masked text into the fixed JSON contract through OpenAI or the authenticated Mac mini Codex bridge. Stage 3b validates WAV/MP3/M4A files, calls an injectable OpenAI transcription adapter, masks the raw transcript immediately, and reuses 3a. Stage 3c creates a short-lived two-person LiveKit room, shares a short `/call?invite=...` code instead of a fragment-embedded participant token, exchanges that code through the backend, transcribes each browser microphone through OpenAI Realtime, labels speakers from server-signed participant identities, and sends only finalized contact-target turns into the existing confirmation-required candidate path. Every finalized resident turn immediately starts a cumulative Planner–Critic request without waiting for an older request; only the newest request in the current case/revision/call scope may update the checklist. Realtime transcription language is fixed to Korean (`ko`). Browser automatic gain is disabled and server VAD threshold is `0.80` to reduce nearby speech pickup while retaining near-field noise reduction. The call UI keeps the transcript scrolled to the newest line, always renders the six phone-checklist fields (unknown values as `미확인`), and places one next question directly below the transcript with missing fields preferred after concrete contradictions. In a live phone call, only the resident's explicit recent-outing statement may prefill the six environmental-sign fields; the other five environmental signs remain manual visit/surrounding-confirmation items. Candidate v2 includes one bounded nullable `next_question`, shown during the call but not repeated after hangup. Production invite records contain only a SHA-256 code hash plus non-personal room metadata in Firestore, so links work across Cloud Run instances. The backend accepts a bounded multipart fallback upload, uses a random temporary filename, and deletes it after candidate generation. Mock tests verify wiring; actual Galaxy/iPhone microphone behavior, live latency, nearby-speaker rejection, and Korean telephone-speech accuracy remain a human gate.
- Mac mini LLM bridge: `macmini-llm-bridge/` implements the Capston-style persistent `codex app-server` transport behind a localhost-only authenticated schema allowlist and the dedicated `/incheon-care-codex-bridge` Tailscale Funnel path. PR #55 merged as `a9befee8b8f05d8cdf6fcc0345b5ef91df2deab6`; production run `31677305479` passed. The later current revision `incheon-care-api-00056-lch` (`02dca9a42fde5facd3bc978e83fab36e2f419758`, image `sha256:ac3f8bfe779f977ffab06ad0773c842f8d629da3397cc0d5d1a0d502b75d733e`) preserves the bridge URL and Secret Manager token. A synthetic text E2E returned HTTP 200, left revision 0 unchanged, and returned `confirmed=false`, `requires_user_confirmation=true`, and the exact Critic shape. Candidate v2 adds one nullable, bounded `next_question` beside the four Critic arrays. When the existing transcription `OPENAI_API_KEY` is also configured, bridge network errors, timeouts, HTTP 503/504, and non-JSON gateway 502 responses retry through OpenAI; authentication, rate-limit, JSON model-output 502, and response-contract failures remain closed. See `docs/MAC_MINI_CODEX_BRIDGE.md`.
- Cloud Run CD status: the merged workflow validates pull requests and runs sibling Vercel and Cloud Run deploy jobs after successful `main` validation.
- GCP auth: use Workload Identity Federation only. Do not add JSON service-account keys.
- GCP DB: Firestore Standard Native `(default)` is provisioned in `asia-northeast3`; the runtime service account has `roles/datastore.user`. P1 uses it only for synthetic, session-isolated ContactOps overrides. Static health/map/facility/transit/summary routes remain independent of Firestore, and browser-direct access is prohibited.
- Synthetic ContactOps contract: deterministic fixtures now exist in `public/data/synthetic-workers.json`, `public/data/synthetic-households.json`, and `public/data/synthetic-residential-address-anchors.json`, with JSON Schemas, TypeScript types, tests, and a manifest. They cover 162 current dongs with 162 generic workers and 5,869 synthetic contact tasks allocated from the observed 65+ one-person-household distribution; 3,597 are due on the reference date, 5,289 prefer phone, 580 prefer visit, 2,303 use apartment/collective-housing references, and 0 are preapproved visits. Every task carries a public residential-building road address and representative point; it is not linked to an actual resident. See `docs/SYNTHETIC_CARE_OPS_DATA.md` before wiring voice output, scoring, UI, or routing.
- ContactOps vertical slice: `backend/src/contact-ops.mjs`, `backend/src/contact-triage-scoring.mjs`, `backend/src/contact-ops-service.mjs`, and `backend/src/contact-ops-state.mjs` provide session-isolated API/state for queue -> contact result -> follow-up rules -> separate acute/vulnerability scores -> recommendation-only handoff -> manager approval. Fresh demo sessions inject 162 explicitly labelled `demo_precontact_record` recommendations, one per current dong, without approval or route constraints. Today routing is `approved -> visit`, `recommended -> center review only`, and due `null/rejected -> phone`; confirmation state and human-readable due reasons flow through the three-tier API. Production selects Firestore for synthetic overrides while static map routes remain independent. `ai-observations` connects the voice contract through Planner -> schema -> Korean DTO -> Critic and requires a separate explicit confirmation before existing deterministic rules run. Realtime input reaches this same candidate boundary. `/center`는 보이는 탭에서 5초 간격으로 인박스를 다시 읽고 포커스 복귀 시 즉시 동기화한다. WebSocket/SSE 기반 push, route optimization, 실기기 live model/audio quality는 아직 구현되지 않았거나 human gate다.
- Operations breadth: manager breadth exposes transfer review, separate distributions, the deterministic 647-case tuning warning, and 13 approved-visit nearest-order hints labeled not-VRP. Surveyor breadth exposes daily, repeated-no-answer, overdue, transfer, empty, loading, and recoverable-error states.
- Operations map: `public/data/structural-context.json` and `GET /api/v1/contact-ops/operations-map` preserve 162 current dongs in 156 geometry zones. Public structure uses four equal midrank contributions with missingness and `[MODEL OUTPUT — UNVALIDATED]`; synthetic overlay color=max acute and size=max vulnerability with no combined score. Fresh sessions no longer look empty: one deterministic scenario example per current dong (162 total) covers all 156 zones, while the UI labels it `데모 예시` and separately exposes session-recorded, scenario, and unrecorded counts. The same response includes sorted recommendation-only `visit_review_points` with public residential addresses, representative coordinates, apartment flags, both scores, and contribution traces. These examples do not mutate workflow or approve visits.
- Triage evidence: all scores carry contribution traces, no composite score exists, and the deterministic 5,869-case simulation reports 647 mild-signal accumulation cases among 1,969 `방문권고-우선` cases. This is a tuning warning from synthetic profiles, not an observed-person result. See `docs/CONTACT_TRIAGE_SCORING.md`.
- Voice file input: `voice/` supports consented masked text and mock-verified WAV/MP3/M4A transcription. Its adapter emits only a confirmation-required candidate; confirmed canonical observations are applied by the backend while scores and manager approval remain server-owned.
- Realtime call proof: a local two-browser smoke used separate fake-microphone WAVs against the real LiveKit Cloud and OpenAI Realtime services. Both participants joined and one finalized turn per signed role returned. The current session uses `gpt-realtime-2.1` with automatic responses disabled, `server_vad` for turn boundaries, and `gpt-live-transcribe` as input transcription. This is cloud wiring proof, not Galaxy/iPhone device proof.
- UI review contract: all UI milestones follow `docs/UI_UX_REVIEW_RUBRIC.md`; hard-ban copy is CI-gated, and each milestone must record its Vercel Preview URL plus Claude screenshot review in this file and `docs/PROGRESS.md`.
- Latest P8 review milestone: PR #18 is merged and GitHub Actions run `31632681184`
  successfully deployed merge commit `6e43bce8b95e91aaa2abb0c5daba39d7c8bbc9fe` to
  Vercel production and Cloud Run revision `incheon-care-api-00019-qsh`. The live browser
  completes synthetic queue -> acute 62 recommendation -> manager-only approval -> reload
  persistence, shows the 647 tuning warning and unvalidated structural context, and reports
  zero console errors.

## 60-Second Takeover

This handoff is shared by Claude and Codex. `CLAUDE.md` points Claude to the canonical
`AGENTS.md`; both agents must follow the same data, safety, deployment, and verification rules.

Start from current `origin/main`, not from one of the merged delivery branches:

```sh
git fetch origin main
git worktree add ../hack-next-agent -b agent/next-task origin/main
cd ../hack-next-agent
git status --short --branch
npm ci
npm --prefix backend ci
npm --prefix voice ci
npm run agent:check
```

For UI or cross-layer ContactOps work, also run `npm run test:e2e:ops`. For deployment work,
read `docs/DEPLOYMENT.md` and inspect the latest GitHub Actions run, Cloud Run revision label,
and deployed image digest before stating that a commit is live. Never reuse a dirty user
checkout, silently reset another agent's work, or treat screenshots as deployment proof.

Three-tier redesign (2026-08-13, branch `claude/three-tier-care-redesign-8lpmkw`):
`REDESIGN_SPEC.md` freezes the phases and INV14-19. Routes: `/city` (시·구, dong
rollups only — no case IDs), `/center` (동 행정복지센터 inbox/confirm/approve),
`/m` (surveyor mobile, three input paths converging on one confirm-required
checklist). Adapter modules `backend/src/three-tier-ops.mjs` +
`three-tier-service.mjs` sit on top of the frozen engines; virtual-phone fields remain in the
compatibility response, but `/m` no longer renders the obsolete simulated-dial control and uses
the realtime LiveKit call path instead.
Assignment-confirmation and report-acknowledgement state is deliberately
session-scoped in-memory demo state (not Firestore) and resets with the session;
a transfer-'confirm' API intentionally does not exist (wording-only track-switch
guidance in `/center`). District AI summaries use OpenAI Codex-authored guidance
for all 11 current districts and quote server-injected aggregates only. They are
versioned as `codex_authored_v1`; no runtime API key or mock generator is used.
Golden E2E: `e2e/p9-three-tier.spec.ts`.
Case history (`backend/src/three-tier-history.mjs` + `/center` 지난 기록 아코디언·
기록 캘린더): per-case timelines are deterministic synthetic entries seeded from the
case ID, with the current session's submitted contact merged on top; the accordion
summary uses a runtime LLM only when `OPENAI_API_KEY` is set (banned-word filtered,
labeled `[AI 생성 · 기록 요약 · 개인 예측 아님]`) and otherwise a deterministic
template. It never emits scores or predictions.
Proven/unproven split lives in `MORNING_HANDOFF.md`.

The primary continuation seams are:

| Work area | Start here | Contract to preserve |
| --- | --- | --- |
| Three-tier views | `src/CityPage.tsx`, `src/CenterPage.tsx`, `src/MobilePage.tsx`, `src/threeTierClient.ts` | INV14 proposals-vs-explicit-confirmation, INV16 lane separation, INV17 no case IDs on `/city`, INV18 grade vocabulary, INV19 AI summary label/quoting |
| Three-tier adapter API | `backend/src/three-tier-ops.mjs`, `backend/src/three-tier-service.mjs`, routes in `backend/src/app.mjs` under `/api/v1/contact-ops/three-tier/` | frozen engines untouched; deterministic proposals only; in-memory confirmation state is demo-scope |
| Public and operations UI | `src/App.tsx`, `src/Operations.tsx`, `src/MapView.tsx` | static outage fallback, 156 zones / 162 current dongs, separate axes |
| Frontend/API integration | `src/contactOpsClient.ts`, `src/AiObservationClient.ts` | session header, revision conflicts, explicit AI confirmation |
| ContactOps backend | `backend/src/app.mjs`, `backend/src/contact-ops-service.mjs`, `backend/src/contact-ops-state.mjs` | synthetic-only Firestore state, no browser-direct database access |
| Deterministic scoring | `backend/src/contact-triage-scoring.mjs`, `docs/CONTACT_TRIAGE_SCORING.md` | acute and vulnerability remain separate with contribution traces |
| Voice/LLM adapter | `voice/src/contact-ops-adapter.mjs`, `voice/src/llm-client.mjs`, `voice/README.md` | OpenAI or Mac mini text transport; candidate-only output |
| Mac mini bridge | `macmini-llm-bridge/`, `docs/MAC_MINI_CODEX_BRIDGE.md` | localhost Codex app-server, bearer/TLS edge, schema allowlist, no tools |
| Deploy and live proof | `.github/workflows/ci-deploy.yml`, `docs/DEPLOYMENT.md` | PR validates only; `main` deploys with WIF and digest-pinned image |

### Last independently verified production baseline

This is historical delivery evidence, not permission to assume a later commit is deployed:

- Final documentation PR: #19, merged to `main` as
  `3c914d76ff5d51f388ae9d46ed61eb805addd9bf`.
- Successful production workflow: `31633711778`.
- Vercel production alias: `https://incheon-care-map.vercel.app`.
- Cloud Run ready revision: `incheon-care-api-00020-4bq`, 100% traffic.
- Deployed backend image:
  `sha256:56a8db8c56df9f8a640528d0144005b4d3afe90b8abe34ab6553463fc844b7a7`.
- Live contract rechecked after deployment: `/health` pass, exact production CORS, 156
  geometry zones, 162 current admin dongs, 2,816 facility points, and 6,231 transit points.

## Evidence Files

| Topic | Source |
| --- | --- |
| Product scope and safe interpretation | `README.md` |
| Data build order and limitations | `data/README.md` |
| Metric contract | `data/metadata/CARE_PRIORITY_METRIC_SPEC.md` |
| Runtime asset manifest | `public/data/manifest.json` |
| Runtime validation status | `public/data/validation.json` |
| Synthetic ContactOps contract | `docs/SYNTHETIC_CARE_OPS_DATA.md`, `public/data/synthetic-care-ops-manifest.json` |
| ContactOps rule slice | `backend/src/contact-ops.mjs`, `backend/scripts/demo-contact-ops.mjs`, `backend/test/contact-ops.test.mjs` |
| Two-axis triage | `docs/CONTACT_TRIAGE_SCORING.md`, `backend/src/contact-triage-scoring.mjs`, `data/schemas/contact-triage-*.schema.json` |
| VWorld/public-release caution | `data/LICENSES.md` |
| Deployment contract | `docs/DEPLOYMENT.md` |
| CI/CD workflow | `.github/workflows/ci-deploy.yml` |
| Backend API contract | `backend/README.md`, `backend/test/api.test.mjs` |
| Voice input contract and stage status | `voice/README.md`, `voice/schema/voice-output.schema.json` |
| Mac mini Codex bridge operations | `docs/MAC_MINI_CODEX_BRIDGE.md`, `macmini-llm-bridge/README.md` |
| Agent rules | `AGENTS.md` |
| UI/UX review contract and preview log | `docs/UI_UX_REVIEW_RUBRIC.md`, `docs/PROGRESS.md` |

## Current Runtime Counts

These values are the current consumer contract for the 65+ relevant runtime layer. The canonical source normalization remains preserved separately.

| Item | Current value |
| --- | ---: |
| Map geometry zones | 156 |
| Current admin dongs represented | 162 |
| Facility points served | 2,816 |
| Canonical facility records preserved | 3,394 |
| 65+ relevant canonical facility records | 3,115 |
| Transit usage points served | 6,231 |
| Transit points with route count | 6,157 |
| Facility coordinate coverage within relevant set | 90.401284% |
| Housing strict assignment coverage | 95.886634% |
| Web data validation status | `pass` |
| Synthetic workers | 162, one per current admin dong |
| Synthetic contact tasks | 5,869, observed 65+ one-person-household distribution; 2-97 per current admin dong |
| Due contact tasks on 2026-08-12 | 3,597 |
| Phone-preferred synthetic tasks | 5,289 |
| Visit-preferred synthetic tasks | 580 |
| Apartment/collective-housing reference tasks | 2,303 |
| Unique public residential PNU references | 5,683 |
| Preapproved synthetic visits | 0 |

## Do Not Say

- Do not say the app finds welfare non-recipients.
- Do not say it identifies isolated people, household risk, or death-by-isolation risk.
- Do not say a composite care-priority score exists.
- Do not say utility data detects current Incheon household anomalies.
- Do not say a specific backend commit is live without matching the successful `main` run, Cloud Run revision label, and image digest.
- Do not use external `/healthz` as Cloud Run proof. The source-level alias is tested locally; the production external proof is `/health`.
- Do not treat VWorld-derived files as cleared for public or commercial redistribution.
- Do not say route optimization is the main product. The current product slice is phone-first contact queueing, follow-up rules, visit recommendation, and explicit manager approval.
- Do not say voice input is fully complete. Consented, PII-masked text stage 3a, mock-verified audio-file stage 3b, the ContactOps Planner–Critic adapter, and mock-verified Realtime call wiring are implemented; actual two-phone microphone behavior, Korean/telephone audio accuracy, live-LLM usefulness, and route optimization are not proven.
- Do not treat `voice` output fields such as `risk_score` or `visit_recommended` as an authoritative score, visit decision, or approval.
- Do not say `max_route_distance_km` exists before approval. It is created by the server-owned routing policy only after explicit manager approval and is not a case-by-case manager form field.

## Deployment Contract

`main` push is the production deploy trigger only after validation passes.

Expected CI path:

1. Commit-pinned `actions/checkout` v6 with `lfs: false`
2. Commit-pinned `actions/setup-node` v6 with Node 24
3. Frontend: `npm ci`, `npm run validate:data`, `npm run validate:synthetic-data`, `npm run test:synthetic-data`, `npm run typecheck`, `npm run build`
4. Backend: `npm --prefix backend ci`, `npm --prefix backend run test:coverage`
5. Voice contract: `npm --prefix voice ci`, `npm --prefix voice test`
6. Mac mini bridge contract: `npm --prefix macmini-llm-bridge ci`, `npm --prefix macmini-llm-bridge test`
7. Backend Docker build
8. For `main` only, Vercel deploys frontend production
9. For `main` only, Cloud Run deploys backend production with WIF

Vercel Git auto-deploy is disabled by `vercel.json`.
Cloud Run deploy uses commit-pinned v3 releases of `google-github-actions/auth`, `setup-gcloud`, and `deploy-cloudrun`, plus Artifact Registry push. CI should not use static GCP keys or mutate public invoker IAM.

## Verification Commands

Run from the repository root.

```sh
npm ci
npm run check:ui-copy
npm run typecheck
npm run build
npm run validate:data
npm run validate:synthetic-data
npm run test:synthetic-data
npm --prefix backend ci
npm --prefix backend run test:coverage
npm --prefix backend run demo:contact-ops
npm --prefix voice ci
npm --prefix voice test
npm --prefix macmini-llm-bridge ci
npm --prefix macmini-llm-bridge test
bash scripts/agent-check.sh
```

Optional when a Docker daemon is available:

```sh
docker build -f backend/Dockerfile -t incheon-care-context-api .
docker run --rm -d --name incheon-care-context-api-smoke -p 127.0.0.1:18080:8080 -e CORS_ORIGINS=http://localhost:5173 incheon-care-context-api
curl -fsS http://127.0.0.1:18080/healthz
docker exec incheon-care-context-api-smoke id -u
docker stop incheon-care-context-api-smoke
```

Read-only live checks, when network is available:

```sh
curl -fsS https://incheon-care-map.vercel.app/ >/tmp/incheon-care-map.html
curl -fsS https://incheon-care-api-vy3v2ludma-du.a.run.app/health
```

Current backend expectation: local tests and Docker pass, production `/health` is live, and every exact deployment claim is tied to a successful `main` run plus its Cloud Run revision/digest. The map build still runs `scripts/verify-map-worker.mjs` through `npm run build`; keep that worker check in regression.

## ContactOps Next Order

1. Treat the 647 mild-signal accumulation cases as a tuning gate. Do not change weights without updating the golden set and rerunning the deterministic distribution report.
2. Keep the implemented 0~50 structural candidate frozen to its four transparent midrank indicators unless a new versioned metric contract and tests are approved. Never feed it into an automatic personal decision.
3. Keep every text/file/Realtime Planner–Critic candidate confirmation-gated. Real two-phone microphone behavior, Korean audio accuracy, and live-LLM usefulness remain human gates.
4. Add route gating only for approved visits. The current 13-visit output is a nearest-order hint, not VRP. Trigger a future planner only when same-day approved volume, accompaniment, time/area/travel-mode conflicts, or reassignment justify it.

## Next Work Procedure

1. Check `git status --short`.
2. Read `AGENTS.md` and this handoff.
3. Read the task-specific source files before editing.
4. Keep public data claims tied to `public/data/manifest.json` and validation files.
5. Keep deployment claims tied to `.github/workflows/ci-deploy.yml` and `docs/DEPLOYMENT.md`.
6. Keep `/health` as the canonical external health endpoint and `/healthz` as compatibility alias unless the backend contract changes.
7. Preserve static fallback as the explicit API-outage and local-development path.
8. Run the relevant verification commands.
9. Report exact pass/fail results and live revision/digest evidence. State precisely that
   only synthetic ContactOps operations routes may use Firestore; static health/map/
   facility/transit/summary routes remain independent.
