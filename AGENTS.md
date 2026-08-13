# Agent Operating Guide

This file is the single source of truth for any agent continuing this repository.
Read it before changing code, data, documentation, or deployment settings.

## Current Architecture

This GitHub repository is currently public. It contains a hackathon MVP for an Incheon public
aggregate care-context map; `package.json` remains `private: true` only to prevent accidental npm
publication. Do not confuse package publication protection with repository visibility.

- `src/`: React 19, TypeScript, Vite 8, MapLibre browser application.
- `public/data/`: curated runtime snapshots plus clearly labeled synthetic CareOps fixtures deployed to Vercel and bundled into the API image. The current map browser prefers the API for observed layers and retains the existing static files as fallback; the synthetic fixtures are a separate contact-queue, rule-graph, and conditional-routing development contract.
- `scripts/prepare_web_data.py`: deterministic exporter from verified `data/processed/` files to `public/data/`.
- `data/raw/`: original public source files, including large archives and geospatial files.
- `data/processed/`: reproducible normalized outputs and validation files.
- `data/metadata/`: source inventory, checksums, API catalog, and metric contract.
- `.github/workflows/ci-deploy.yml`: Node 24 validation for frontend, backend, synthetic ContactOps data, and the voice contract, plus the backend Docker build; successful `main` validation is followed by parallel Vercel and Cloud Run production deploy jobs.
- `docs/DEPLOYMENT.md`: deployment contract, Vercel secrets, and operations.
- `backend/`: Node 24 API. Curated map routes remain read-only and independent of state; synthetic ContactOps routes use a server-side state adapter. Local/test defaults to isolated memory state and production selects Firestore.
- `data/scripts/build_synthetic_residential_address_anchors.py`, `scripts/generate_synthetic_care_ops.py`, `data/schemas/synthetic-*.schema.json`, `backend/src/contact-ops.mjs`, `backend/scripts/demo-contact-ops.mjs`, and `docs/SYNTHETIC_CARE_OPS_DATA.md`: deterministic contact-first fixtures and rule-graph slice for 162 current dongs. The task locations use public residential-building address references and representative coordinates; the records remain synthetic operational tasks, not resident records.
- `backend/src/contact-triage-scoring.mjs`, `data/schemas/contact-triage-*.schema.json`, and `docs/CONTACT_TRIAGE_SCORING.md`: separate acute/vulnerability operational scores, contribution traces, queue ordering, recommendation-only handoff, and a deterministic mild-signal accumulation audit. A composite score is prohibited.
- `backend/src/contact-triage-synthetic-scenario.mjs`: fresh-session map preview selects one deterministic scenario example per current admin dong (162 examples covering 156 geometry zones). The UI labels it `데모 예시`; it is display-only and never observed resident data. The same module also builds one `demo_precontact_record` baseline per dong for center review; those 162 records are recommendation-only and must never create approval decisions or route constraints.
- `voice/`: isolated Node 24 voice-input module. Stage 3a converts consented, PII-masked text to a fixed JSON contract with OpenAI Structured Outputs. Stage 3b adds validated WAV/MP3/M4A file transcription and immediately reuses 3a. The P3 adapter maps that output into a Critic-reviewed, confirmation-required ContactOps candidate. Stage 3c now has an env-gated LiveKit browser call and OpenAI Realtime transcription adapter; only the contact target's finalized turns enter the existing candidate path, and explicit surveyor confirmation remains required.

The frontend production URL is `https://incheon-care-map.vercel.app`. The Cloud Run production URL is `https://incheon-care-api-vy3v2ludma-du.a.run.app`; `/health` is the canonical external health endpoint. `/healthz` remains a source-level compatibility alias, but the Cloud Run frontend intercepts that path before it reaches the container, so deployment smoke tests must use `/health`. Match the latest successful `main` run, Cloud Run revision label, and deployed digest before claiming that a specific commit is live.

## UI/UX Review Contract

- Every manager-web UI change must follow `docs/UI_UX_REVIEW_RUBRIC.md`.
- Run `npm run check:ui-copy` before committing UI copy. A hard-ban match fails the change.
- UI milestones require automated font-size, touch-target, horizontal-overflow, contrast, axe, icon-label, and non-color-status gates before completion.
- Record the Vercel Preview URL in `docs/PROGRESS.md` and `docs/AGENT_HANDOFF.md` for every UI milestone.
- After automated gates pass, Claude independently reviews 390×844 mobile and 1440×900 desktop screenshots and returns a punch-list. Codex fixes it; only the re-review can close the milestone.

## Data Interpretation Rules

Do not overclaim what the public aggregate data can prove.

- Allowed: "observed public aggregate indicator", "care review candidate area", "regional context for additional field review".
- Not allowed: "unserved welfare recipient count", "confirmed care gap", "individual risk", "death-by-isolation risk", "AI-predicted personal risk".
- `P1` is the observed count of resident-registration age-65-plus one-person households.
- `P2` is `age-65-plus one-person households / age-65-plus population`.
- `P2` combines a 2026-07-31 household numerator with a 2026-06-30 population denominator: it is a mixed snapshot, not a same-date rate. This remains true of the underlying data. As of 2026-08-13, by explicit repo-owner decision reviewed via pull request (not a silent removal), the root public map (`/`) and `/city` no longer render this caveat as inline UI copy, to keep the public/hackathon-facing screens uncluttered. `data/metadata/CARE_PRIORITY_METRIC_SPEC.md` and `public/data/manifest.json` remain the canonical, always-accurate record of this date mismatch. Any other surface (`Operations.tsx`, `CenterPage.tsx`, `MobilePage.tsx`, and any future manager/surveyor screen) must keep stating the mixed-snapshot caveat inline — this exception is scoped to the two public-facing pages named above, not a blanket license to drop the disclosure elsewhere.
- Facility source normalization preserves 3,394 canonical records. The current 65+ relevant runtime layer consumes 3,115 relevant canonical records, serves 2,816 facility points, and has 90.401284% coordinate coverage within that set. This is not a legal eligibility determination.
- The map uses 2025-06-30 geometry zones and maps 2026-07-01 current admin-dong statistics onto them. Do not invent 162 current polygons from the 156 geometry zones.
- Welfare benefit categories can overlap by person. Do not sum benefit categories into a distinct person count, and do not subtract welfare counts from household counts.
- Utility data is not current Incheon household anomaly data. Jeongeup smart-meter data is model/UX demo only and must be labeled as not Incheon observed data.
- Synthetic ContactOps fixtures model phone-first work management. They do not estimate real care demand, personal risk, welfare eligibility, non-recipient counts, or actual 이웃연결단 workload.
- The synthetic workflow begins with `visit_approval_status=null`. Deterministic rules may set `recommended`, but only an explicit manager decision may set `approved` or `rejected`.
- `max_route_distance_km` and route constraints exist only after explicit human approval. Do not add maximum-distance or routing fields to unapproved generated tasks.

Use `data/metadata/CARE_PRIORITY_METRIC_SPEC.md`, `data/README.md`, and `public/data/manifest.json` as the evidence chain before changing UI labels, metric names, or presentation claims.

## Large Data and LFS

Large raw and processed source files are part of the private reproducibility pack.

- `data/.gitattributes` declares `*.shp`, `*.dbf`, `*.shx`, `*.zip`, and `*.gz` for Git LFS.
- `.vercelignore` excludes root `data/` from the web deployment.
- Root `.dockerignore` keeps Docker build context to `backend/**` and `public/data/**`.
- Do not import `data/raw/` or `data/processed/` from application code.
- Do not move large files into `public/`.
- Do not rewrite or normalize source data line endings or encodings; `data/.gitattributes` sets `* -text` to preserve source bytes.
- Before public release, recheck `data/LICENSES.md`, especially VWorld `CC BY-NC-ND` uncertainty.

## Deployment Contract

GitHub Actions owns deployment.

- Every pull request and push runs frontend and synthetic-data validation, backend coverage,
  the voice-contract golden tests, and the backend Docker build on Node.js 24. CI also runs
  the built image as a non-root user and smokes health, manager breadth, and the
  156-zone/162-dong operations map so container-only data-path regressions fail before merge.
- To keep pull-request feedback near one minute, the Playwright browser E2E suite runs in CI
  on `main` pushes only, and commits touching only Markdown or `artifacts/**` skip the
  pipeline entirely. UI or cross-layer changes must still run `npm run test:e2e:ops`
  locally before merge, exactly as the takeover gate prescribes.
- A push to `main` deploys frontend production to Vercel and backend production to Cloud Run after the shared validation job passes. These jobs are parallel siblings; neither deploy job should depend on the other.
- Pull requests do not receive Vercel or Google Cloud credentials and do not deploy.
- `vercel.json` sets `git.deploymentEnabled=false`; do not re-enable Vercel Git auto-deploy while the Actions deploy job exists.
- Required repository secrets are `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.
- Required Google Cloud repository variables include `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_ARTIFACT_REPOSITORY`, `GCP_CLOUD_RUN_SERVICE`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, and `GCP_RUNTIME_SERVICE_ACCOUNT`.
- Backend deploy uses Workload Identity Federation through a commit-pinned `google-github-actions/auth` action; do not add static service-account keys.
- The deploy service account is intended to be service-scoped for Cloud Run deployment (`run.developer`) plus the minimum Artifact Registry push and runtime service-account impersonation permissions documented in `docs/DEPLOYMENT.md`.
- Firestore Standard Native `(default)` is provisioned in `asia-northeast3`. The runtime service account has `roles/datastore.user`. Only synthetic ContactOps session overrides may use it; health, summary, map, facility, and transit routes remain independent of Firestore. Never add browser-direct Firestore access or real personal data.
- The Firestore demo database is scheduled for a manual keep/delete decision on 2026-08-15 KST. Do not assume it will disappear automatically.

If deployment behavior changes, update both `docs/DEPLOYMENT.md` and this guide in the same change.

## Next Agent Bootstrap

Claude, Codex, and any other coding agent use this file as the canonical ruleset. `CLAUDE.md`
is only a pointer into this guide. Do not continue from a merged feature branch or overwrite a
dirty checkout. Start from current `origin/main` in a clean worktree and replace `next-task` with
a short task name:

```sh
git fetch origin main
git worktree add ../hack-next-agent -b agent/next-task origin/main
cd ../hack-next-agent
git status --short --branch
```

Then read `README.md`, `AGENTS.md`, `docs/AGENT_HANDOFF.md`, and the task-specific sources.
Use Node 24, install the three locked dependency trees, and run the shared takeover gate:

```sh
npm ci
npm --prefix backend ci
npm --prefix voice ci
npm run agent:check
```

`npm run agent:check` is the common Claude/Codex baseline. It verifies the handoff contract,
deployment invariants, curated and synthetic data, frontend tests/typecheck/build, backend
coverage, and voice contracts. UI or end-to-end workflow changes must additionally run
`npm run test:e2e:ops`. If the baseline fails, preserve the first failure as evidence and fix the
contract rather than bypassing the guardrail.

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
npm run test:contact-triage-schema
npm --prefix backend ci
npm --prefix backend run test:coverage
npm --prefix backend run demo:contact-ops
npm --prefix backend run report:contact-triage
npm --prefix voice ci
npm --prefix voice test
npm run agent:check
```

When a Docker daemon is available, backend container verification is also useful:

```sh
docker build -f backend/Dockerfile -t incheon-care-context-api .
docker run --rm -d --name incheon-care-context-api-smoke -p 127.0.0.1:18080:8080 -e CORS_ORIGINS=http://localhost:5173 incheon-care-context-api
curl -fsS http://127.0.0.1:18080/healthz
docker exec incheon-care-context-api-smoke id -u
docker stop incheon-care-context-api-smoke
```

Read-only live checks, when network access is available:

```sh
curl -fsS https://incheon-care-map.vercel.app/ >/tmp/incheon-care-map.html
curl -fsS https://incheon-care-api-vy3v2ludma-du.a.run.app/health
```

Frontend production and the Cloud Run backend `/health` are live. API-first loading is merged and the Vercel production environment points at Cloud Run; `public/data/` remains the intentional outage and local-development fallback. Synthetic ContactOps operations routes use the server-side state adapter and select Firestore in production; static map routes remain independent of it.

The ContactOps schema conversion, deterministic rules, two-axis triage slice, synthetic operations API/state, surveyor/manager UI, P3 Planner–Critic adapter, P5/P6 breadth, and P7 operations map are complete locally. Generated fixtures cover 162 current dongs, 5,869 contact tasks allocated from the observed 65+ one-person-household distribution, 3,597 due tasks, 5,289 phone-preferred tasks, 580 visit-preferred tasks, 2,303 apartment/collective-housing references, and 0 preapproved visits. Every task carries a public residential-building address reference and representative point. A fresh operations map additionally uses 162 clearly labeled deterministic scenario examples—one per current dong—to fill all 156 zones without mutating workflow; session-recorded scores remain distinct. The API exposes recommendation-only `visit_review_points` with the two separate scores and address columns for future point rendering. The structural-context candidate covers 156 geometry zones with four transparent midrank indicators; it is always labeled `[MODEL OUTPUT — UNVALIDATED]`. `npm --prefix backend run demo:contact-ops` demonstrates queue -> dummy contact result -> follow-up rules -> separate acute/vulnerability scores -> visit recommendation -> manager approval. `npm --prefix backend run report:contact-triage` runs the deterministic 5,869-case distribution and mild-signal accumulation audit. `ai-observations` produces a non-authoritative candidate and only applies canonical observations after explicit confirmation; it never approves a visit. `CONTACT_OPS_ENABLE_TEST_RESET=1` is permitted only for isolated E2E reset and must not be set in production. Realtime call/token/SDP/caption wiring is mock-verified, while two-phone microphone behavior, Korean elderly-speech transcription accuracy, live-LLM usefulness, and full route optimization remain unverified.

## Safety Guardrails

- Preserve user or other-agent edits. Do not revert unrelated changes.
- Keep changes narrowly scoped to the requested files or feature.
- Do not commit secrets, `.vercel/`, `.env*`, build output, or dependency directories.
- Do not add real or source-linked names, phone numbers, unit numbers, resident attributes, or any other personal or household-level source record. The UI may derive a deterministic pseudonym from an internal case ID, but it must never persist that name in fixtures or imply a link to a resident.
- Public residential-building addresses and representative points may anchor synthetic ContactOps tasks. Keep internal IDs (`SYN-HH-*`), `synthetic=true`, `not_real_resident=true`, and source lineage, but render deterministic pseudonyms instead of case IDs in the UI; never claim that an address is linked to an actual resident or observed personal state.
- ContactOps records must use safe Korean terms such as `연락업무`, `안부 확인`, `후속조치`, `방문 권고`, `담당자 승인`, and `행정복지센터 이관`. Avoid terms that imply confirmed personal status, such as `고위험자`, `미수혜자`, `위험도`, or `개인 예측`.
- The standalone voice LLM may structure consented, masked text. `contact_result.risk_score` copies only a number explicitly spoken by the surveyor and otherwise stays `0`; `visit_recommended` mirrors only an explicit request. Neither is a computed triage score nor authority to mutate `workflow.visit_approval_status`.
- Any future ContactOps adapter may flag contradictions or missing fields and propose visit/transfer candidates with reasons, but it must not approve visits, confirm transfers, or override deterministic no-answer/deadline rules.
- Today-lane routing is strict: `approved` is visit, `recommended` is center-review only, and due `null`/`rejected` is phone regardless of contact preference. Do not reintroduce visit preference as authority for a visit assignment.
- Triage keeps `급성도_점수` and `취약도_점수` separate, always returns contribution traces, and never emits a composite score. Thresholds may create `recommended` only; only explicit manager action creates `approved` or `rejected`.
- Route planning is conditional only. Use it after approved same-day visit volume, two-person/public-official accompaniment, time/area/travel-mode conflicts, or reassignment needs justify it. For one to three approved visits, show a simple nearest-order suggestion instead of VRP.
- Do not turn observation layers into a composite risk score without a documented metric version, data basis, backtest, and fairness review.
- Do not treat browser screenshots, draft text, or visible chat notes as deployment proof. Re-run commands or inspect CI/deployment records.

## Next Task Procedure

1. Run `git status --short` and identify files already changed by others.
2. Read `README.md`, this file, `docs/AGENT_HANDOFF.md`, and the specific files you plan to touch.
3. If the task affects labels, metrics, or data claims, read `data/metadata/CARE_PRIORITY_METRIC_SPEC.md` and `public/data/manifest.json`.
4. If the task affects deployment, read `docs/DEPLOYMENT.md`, `.github/workflows/ci-deploy.yml`, `vercel.json`, and `.vercelignore`.
5. If the task affects backend/frontend integration, preserve the current static fallback as the explicit outage and local-development path.
6. Make the smallest coherent change.
7. Run the relevant verification commands and record exactly what passed or failed.
8. After ContactOps step 1-2 changes, run regression before integrating voice/LLM output or routing: keep 162 current dongs mapped to 156 2025 geometry zones, preserve map/API fallback behavior, and verify the map worker step in `npm run build`.
9. Update handoff notes when current state or next steps change.
