# Agent Operating Guide

This file is the single source of truth for any agent continuing this repository.
Read it before changing code, data, documentation, or deployment settings.

## Current Architecture

This repository is a private hackathon MVP for an Incheon public aggregate care-context map.

- `src/`: React 19, TypeScript, Vite 8, MapLibre browser application.
- `public/data/`: curated runtime snapshots deployed to Vercel and bundled into the API image. The browser prefers the API when configured and retains these files as its fallback.
- `scripts/prepare_web_data.py`: deterministic exporter from verified `data/processed/` files to `public/data/`.
- `data/raw/`: original public source files, including large archives and geospatial files.
- `data/processed/`: reproducible normalized outputs and validation files.
- `data/metadata/`: source inventory, checksums, API catalog, and metric contract.
- `.github/workflows/ci-deploy.yml`: Node 24 validation for frontend and backend, then parallel `main` production deploy jobs for Vercel and Cloud Run.
- `docs/DEPLOYMENT.md`: deployment contract, Vercel secrets, and operations.
- `backend/`: Node 24 read-only API for curated `public/data/` exports. It has `src/`, tests, `package-lock.json`, a Dockerfile, and README. Local tests and Docker verification pass.

The current frontend production URL is `https://incheon-care-map.vercel.app`. The current bootstrap Cloud Run URL is `https://incheon-care-api-vy3v2ludma-du.a.run.app`; `/health` is the canonical external health endpoint. `/healthz` is a source-level compatibility alias in the backend code and tests. Do not treat the bootstrap service as proof that the latest source has been deployed through the follow-up CI/CD path.

## Data Interpretation Rules

Do not overclaim what the public aggregate data can prove.

- Allowed: "observed public aggregate indicator", "care review candidate area", "regional context for additional field review".
- Not allowed: "unserved welfare recipient count", "confirmed care gap", "individual risk", "death-by-isolation risk", "AI-predicted personal risk".
- `P1` is the observed count of resident-registration age-65-plus one-person households.
- `P2` is `age-65-plus one-person households / age-65-plus population`.
- `P2` combines a 2026-07-31 household numerator with a 2026-06-30 population denominator. Always state that it is a mixed snapshot, not a same-date rate.
- The map uses 2025-06-30 geometry zones and maps 2026-07-01 current admin-dong statistics onto them. Do not invent 162 current polygons from the 156 geometry zones.
- Welfare benefit categories can overlap by person. Do not sum benefit categories into a distinct person count, and do not subtract welfare counts from household counts.
- Utility data is not current Incheon household anomaly data. Jeongeup smart-meter data is model/UX demo only and must be labeled as not Incheon observed data.

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

- Every pull request and push runs frontend validation, backend coverage, and backend Docker build on Node.js 24.
- A push to `main` deploys frontend production to Vercel and backend production to Cloud Run after the shared validation job passes. These jobs are parallel siblings; neither deploy job should depend on the other.
- Pull requests do not receive Vercel or Google Cloud credentials and do not deploy.
- `vercel.json` sets `git.deploymentEnabled=false`; do not re-enable Vercel Git auto-deploy while the Actions deploy job exists.
- Required repository secrets are `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.
- Required Google Cloud repository variables include `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_ARTIFACT_REPOSITORY`, `GCP_CLOUD_RUN_SERVICE`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, and `GCP_RUNTIME_SERVICE_ACCOUNT`.
- Backend deploy uses Workload Identity Federation through a commit-pinned `google-github-actions/auth` action; do not add static service-account keys.
- The deploy service account is intended to be service-scoped for Cloud Run deployment (`run.developer`) plus the minimum Artifact Registry push and runtime service-account impersonation permissions documented in `docs/DEPLOYMENT.md`.
- Firestore Standard Native `(default)` is provisioned in `asia-northeast3`. The runtime service account has `roles/datastore.user`, but the current routes do not depend on Firestore. Keep the curated map snapshots in `public/data/`; reserve Firestore for later server-side variable AI reports or notes, never browser-direct personal data.
- The Firestore demo database is scheduled for a manual keep/delete decision on 2026-08-15 KST. Do not assume it will disappear automatically.

If deployment behavior changes, update both `docs/DEPLOYMENT.md` and this guide in the same change.

## Verification Commands

Run from the repository root.

```sh
npm ci
npm run typecheck
npm run build
npm run validate:data
npm --prefix backend ci
npm --prefix backend run test:coverage
sh scripts/agent-check.sh
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

At this handoff, frontend production and the bootstrap backend `/health` are live. This branch introduces runtime API-first loading with a static fallback, but it is not deployment proof until the branch has merged and the main-branch Vercel and Cloud Run jobs pass. Firestore exists but is intentionally outside the current request path.

## Safety Guardrails

- Preserve user or other-agent edits. Do not revert unrelated changes.
- Keep changes narrowly scoped to the requested files or feature.
- Do not commit secrets, `.vercel/`, `.env*`, build output, or dependency directories.
- Do not add personal data, household-level records, generated personal addresses, or real-looking synthetic residents.
- Do not turn observation layers into a composite risk score without a documented metric version, data basis, backtest, and fairness review.
- Do not treat browser screenshots, draft text, or visible chat notes as deployment proof. Re-run commands or inspect CI/deployment records.

## Next Task Procedure

1. Run `git status --short` and identify files already changed by others.
2. Read `README.md`, this file, `docs/AGENT_HANDOFF.md`, and the specific files you plan to touch.
3. If the task affects labels, metrics, or data claims, read `data/metadata/CARE_PRIORITY_METRIC_SPEC.md` and `public/data/manifest.json`.
4. If the task affects deployment, read `docs/DEPLOYMENT.md`, `.github/workflows/ci-deploy.yml`, `vercel.json`, and `.vercelignore`.
5. If the task affects backend/frontend integration, preserve the current static fallback until the runtime API follow-up PR is complete.
6. Make the smallest coherent change.
7. Run the relevant verification commands and record exactly what passed or failed.
8. Update handoff notes when current state or next steps change.
