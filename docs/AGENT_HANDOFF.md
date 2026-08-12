# Agent Handoff

## Current State

- Project: private hackathon MVP, "I5 도시 돌봄" / Incheon care-context map.
- Frontend: React 19, TypeScript, Vite 8, MapLibre, static assets from `public/data/`.
- Frontend production: `https://incheon-care-map.vercel.app` is live.
- Runtime data boundary: Cloud Run API-first loading is merged while `public/data/` remains the outage/local fallback. Production CI verifies both the built bundle and the public Vercel alias reference the API.
- Deployment owner: GitHub Actions workflow `CI / Production Deploy`.
- Backend local source: Node 24 read-only API for curated `public/data/`, with `src/`, tests, coverage gate, Dockerfile, `.dockerignore`, and README.
- Backend production: `https://incheon-care-api-vy3v2ludma-du.a.run.app/health` is live. Match the successful `main` run, revision commit label, and image digest before claiming an exact commit is deployed.
- Backend health convention: `/health` is canonical externally. `/healthz` exists in source/tests, but Cloud Run's frontend intercepts that path and returns its own 404, so external smoke tests use `/health`.
- Voice input: `voice/` stage 3a converts consented, PII-masked text into the fixed JSON contract. Stage 3b validates WAV/MP3 files, calls an injectable OpenAI transcription adapter, masks the raw transcript immediately, and reuses 3a. Its deterministic goldens mock transcription; actual-device audio accuracy and Realtime/WebRTC remain unverified or unimplemented.
- Cloud Run CD status: the merged workflow validates pull requests and runs sibling Vercel and Cloud Run deploy jobs after successful `main` validation.
- GCP auth: use Workload Identity Federation only. Do not add JSON service-account keys.
- GCP DB: Firestore Standard Native `(default)` is provisioned in `asia-northeast3`; the runtime service account has `roles/datastore.user`. Current API routes do not use it. Keep static map snapshots in `public/data/` and reserve Firestore for future server-side variable AI reports or notes.
- Synthetic ContactOps contract: deterministic fixtures now exist in `public/data/synthetic-workers.json` and `public/data/synthetic-households.json`, with JSON Schemas, TypeScript types, tests, and a manifest. They cover 162 current dongs with 162 generic workers and 5,869 synthetic contact tasks; 3,616 are due on the reference date, 5,291 prefer phone, 578 prefer visit, and 0 are preapproved visits. See `docs/SYNTHETIC_CARE_OPS_DATA.md` before wiring voice output, scoring, UI, or routing.
- ContactOps vertical slice: `backend/src/contact-ops.mjs`, `backend/src/contact-triage-scoring.mjs`, and `backend/scripts/demo-contact-ops.mjs` provide queue -> dummy contact result -> follow-up rules -> separate acute/vulnerability scores -> recommendation-only handoff -> manager approval. The standalone voice contract exists, but its output is not yet connected to ContactOps; ContactOps adaptation, route optimization, Realtime input, and UI wiring remain unimplemented.
- Triage evidence: all scores carry contribution traces, no composite score exists, and the deterministic 5,869-case simulation reports 664 mild-signal accumulation cases among 1,941 priority recommendations. This is a tuning warning from synthetic profiles, not an observed-person result. See `docs/CONTACT_TRIAGE_SCORING.md`.
- Voice file input: the standalone `voice/` contract now supports both consented masked text and mock-verified WAV/MP3 transcription, but neither output mutates ContactOps without a future adapter.

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
| Agent rules | `AGENTS.md` |

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
| Synthetic contact tasks | 5,869, 20-50 per current admin dong |
| Due contact tasks on 2026-08-12 | 3,616 |
| Phone-preferred synthetic tasks | 5,291 |
| Visit-preferred synthetic tasks | 578 |
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
- Do not say voice input is complete or integrated with ContactOps. Consented, PII-masked text stage 3a and mock-verified audio-file stage 3b are implemented; actual Korean/telephone audio accuracy, Realtime input, ContactOps adaptation, and route optimization are not.
- Do not treat `voice` output fields such as `risk_score` or `visit_recommended` as an authoritative score, visit decision, or approval.
- Do not say `max_route_distance_km` exists before approval. It is created only by explicit manager approval.

## Deployment Contract

`main` push is the production deploy trigger only after validation passes.

Expected CI path:

1. Commit-pinned `actions/checkout` v6 with `lfs: false`
2. Commit-pinned `actions/setup-node` v6 with Node 24
3. Frontend: `npm ci`, `npm run validate:data`, `npm run validate:synthetic-data`, `npm run test:synthetic-data`, `npm run typecheck`, `npm run build`
4. Backend: `npm --prefix backend ci`, `npm --prefix backend run test:coverage`
5. Voice contract: `npm --prefix voice ci`, `npm --prefix voice test`
6. Backend Docker build
7. For `main` only, Vercel deploys frontend production
8. For `main` only, Cloud Run deploys backend production with WIF

Vercel Git auto-deploy is disabled by `vercel.json`.
Cloud Run deploy uses commit-pinned v3 releases of `google-github-actions/auth`, `setup-gcloud`, and `deploy-cloudrun`, plus Artifact Registry push. CI should not use static GCP keys or mutate public invoker IAM.

## Verification Commands

Run from the repository root.

```sh
npm ci
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

1. Treat the 664 mild-signal accumulation cases as a tuning gate. Do not change weights without updating the golden set and rerunning the deterministic distribution report.
2. Define and validate the upstream 0~50 dong-context normalization before injecting nonzero structural vulnerability scores. Do not invent weights in the runtime scorer.
3. Integrate the existing text/file-to-JSON voice contract only after deterministic rules stay green. The adapter may map voice/text observations into a structured contact result, flag contradictions/missing fields, and provide candidate visit/transfer reasons. Voice-provided `risk_score` or `visit_recommended` is non-authoritative; final visit approval and transfer remain deterministic rule plus manager action.
4. Add route gating only for approved visits. Trigger route planning only when same-day approved visits are numerous, two-person/public-official accompaniment is needed, time/area/travel-mode constraints conflict, or reassignment is required. For one to three approved visits, show nearest-order guidance.

## Next Work Procedure

1. Check `git status --short`.
2. Read `AGENTS.md` and this handoff.
3. Read the task-specific source files before editing.
4. Keep public data claims tied to `public/data/manifest.json` and validation files.
5. Keep deployment claims tied to `.github/workflows/ci-deploy.yml` and `docs/DEPLOYMENT.md`.
6. Keep `/health` as the canonical external health endpoint and `/healthz` as compatibility alias unless the backend contract changes.
7. Preserve static fallback as the explicit API-outage and local-development path.
8. Run the relevant verification commands.
9. Report exact pass/fail results, live revision/digest evidence, and that Firestore is provisioned but intentionally unused by current routes.
