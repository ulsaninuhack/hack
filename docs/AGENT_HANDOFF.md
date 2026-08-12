# Agent Handoff

## Current State

- Project: private hackathon MVP, "I5 도시 돌봄" / Incheon care-context map.
- Frontend: React 19, TypeScript, Vite 8, MapLibre, static assets from `public/data/`.
- Frontend production: `https://incheon-care-map.vercel.app` is live.
- Runtime data boundary: Cloud Run API-first loading is merged while `public/data/` remains the outage/local fallback. Production CI verifies both the built bundle and the public Vercel alias reference the API.
- Deployment owner: GitHub Actions workflow `CI / Production Deploy`.
- Backend local source: Node 24 read-only API for curated `public/data/`, with `src/`, 41 tests, coverage gate, Dockerfile, `.dockerignore`, and README.
- Backend production: `https://incheon-care-api-vy3v2ludma-du.a.run.app/health` is live. Match the successful `main` run, revision commit label, and image digest before claiming an exact commit is deployed.
- Backend health convention: `/health` is canonical externally. `/healthz` exists in source/tests, but Cloud Run's frontend intercepts that path and returns its own 404, so external smoke tests use `/health`.
- Cloud Run CD status: the merged workflow validates pull requests and runs sibling Vercel and Cloud Run deploy jobs after successful `main` validation.
- GCP auth: use Workload Identity Federation only. Do not add JSON service-account keys.
- GCP DB: Firestore Standard Native `(default)` is provisioned in `asia-northeast3`; the runtime service account has `roles/datastore.user`. Current API routes do not use it. Keep static map snapshots in `public/data/` and reserve Firestore for future server-side variable AI reports or notes.

## Evidence Files

| Topic | Source |
| --- | --- |
| Product scope and safe interpretation | `README.md` |
| Data build order and limitations | `data/README.md` |
| Metric contract | `data/metadata/CARE_PRIORITY_METRIC_SPEC.md` |
| Runtime asset manifest | `public/data/manifest.json` |
| Runtime validation status | `public/data/validation.json` |
| VWorld/public-release caution | `data/LICENSES.md` |
| Deployment contract | `docs/DEPLOYMENT.md` |
| CI/CD workflow | `.github/workflows/ci-deploy.yml` |
| Backend API contract | `backend/README.md`, `backend/test/api.test.mjs` |
| Agent rules | `AGENTS.md` |

## Current Runtime Counts

These values are from `public/data/summary.json` and `public/data/validation.json`.

| Item | Current value |
| --- | ---: |
| Map geometry zones | 156 |
| Current admin dongs represented | 162 |
| Facility points served | 3,061 |
| Canonical facility records | 3,394 |
| Transit usage points served | 6,231 |
| Transit points with route count | 6,157 |
| Facility coordinate coverage | 90.188568% |
| Housing strict assignment coverage | 95.886634% |
| Web data validation status | `pass` |

## Do Not Say

- Do not say the app finds welfare non-recipients.
- Do not say it identifies isolated people, household risk, or death-by-isolation risk.
- Do not say a composite care-priority score exists.
- Do not say utility data detects current Incheon household anomalies.
- Do not say a specific backend commit is live without matching the successful `main` run, Cloud Run revision label, and image digest.
- Do not use external `/healthz` as Cloud Run proof. The source-level alias is tested locally; the production external proof is `/health`.
- Do not treat VWorld-derived files as cleared for public or commercial redistribution.

## Deployment Contract

`main` push is the production deploy trigger only after validation passes.

Expected CI path:

1. Commit-pinned `actions/checkout` v6 with `lfs: false`
2. Commit-pinned `actions/setup-node` v6 with Node 24
3. Frontend: `npm ci`, `npm run validate:data`, `npm run typecheck`, `npm run build`
4. Backend: `npm --prefix backend ci`, `npm --prefix backend run test:coverage`, Docker build
5. For `main` only, Vercel deploys frontend production
6. For `main` only, Cloud Run deploys backend production with WIF

Vercel Git auto-deploy is disabled by `vercel.json`.
Cloud Run deploy uses commit-pinned v3 releases of `google-github-actions/auth`, `setup-gcloud`, and `deploy-cloudrun`, plus Artifact Registry push. CI should not use static GCP keys or mutate public invoker IAM.

## Verification Commands

Run from the repository root.

```sh
npm ci
npm run typecheck
npm run build
npm run validate:data
npm --prefix backend ci
npm --prefix backend run test:coverage
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

Current backend expectation: local tests and Docker pass, production `/health` is live, and every exact deployment claim is tied to a successful `main` run plus its Cloud Run revision/digest.

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
