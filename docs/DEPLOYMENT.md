# Production deployment

## Deployment contract

GitHub Actions owns both production deployments:

- Every pull request and push validates the curated web data, type-checks and
  builds the frontend, runs the backend coverage gate, and builds the backend
  Docker image.
- Pull requests receive no Vercel or Google Cloud credentials and never deploy.
- A successful push to `main` starts two independent jobs after validation:
  - frontend → Vercel Production
  - backend → Artifact Registry → Cloud Run
- The two production jobs do not depend on each other. A failure in one does not
  cancel or roll back the other.
- [`vercel.json`](../vercel.json) disables Vercel Git auto-deployments, preventing
  a second frontend deployment for the same commit.
- The backend job never creates IAM bindings or changes public invocation. It
  only authenticates, pushes an image, and deploys a Cloud Run revision.

The production jobs run only for a `push` event on `refs/heads/main`.
`workflow_dispatch` is validation-only under this contract.

## Pull-request validation

The `Validate frontend and backend` job runs on Node.js 24:

```bash
npm ci
npm run validate:data
npm run typecheck
npm run build
npm --prefix backend ci
npm --prefix backend run test:coverage
docker build --file backend/Dockerfile --tag incheon-care-api:ci .
```

The backend container uses the repository root as its build context because the
image includes both `backend/**` and the reviewed exports in `public/data/**`.

## Frontend production

Current Vercel configuration:

- Team: `jjh's projects` (`jjhs-projects-4d22a2fd`)
- Project: `incheon-care-map`
- Production URL: `https://incheon-care-map.vercel.app`
- Runtime/build version: Node.js `24.x`
- GitHub environment: `frontend-production`
- Vercel CLI: pinned to `58.9.4` in the workflow

The Vercel project is linked locally through ignored
`.vercel/project.json`. The dedicated project-scoped token expires on
2027-08-13; its value is never stored in the repository.

Required GitHub repository secrets:

| Secret | Purpose |
| --- | --- |
| `VERCEL_TOKEN` | Dedicated Vercel project token |
| `VERCEL_ORG_ID` | Vercel team ID |
| `VERCEL_PROJECT_ID` | `incheon-care-map` project ID |

To re-link or rotate credentials:

```bash
npm install --global vercel@latest
vercel login
vercel link --yes --scope jjhs-projects-4d22a2fd --project incheon-care-map
gh secret set VERCEL_TOKEN --repo ulsaninuhack/hack
gh secret set VERCEL_ORG_ID --repo ulsaninuhack/hack --body "$(jq -r .orgId .vercel/project.json)"
gh secret set VERCEL_PROJECT_ID --repo ulsaninuhack/hack --body "$(jq -r .projectId .vercel/project.json)"
```

After rotating the token, verify a production deployment before revoking the
old token.

The frontend job fails before building if the pulled Vercel production
environment does not contain the exact Cloud Run API origin in
`VITE_API_BASE_URL`. It then checks the built entry bundle before deployment and
the entry bundle served through the public production alias afterward. Vercel's
generated deployment URL is intentionally not used for the public smoke test
because that URL is protected by team SSO; `incheon-care-map.vercel.app` is the
public runtime contract. These checks prevent the static fallback from hiding a
missing production API configuration.

## Backend production

Current Google Cloud targets:

| Setting | Value |
| --- | --- |
| Project | `project-53f7b99e-c306-49a7-a7b` |
| Region | `asia-northeast3` |
| Artifact Registry repository | `incheon-care` |
| Image | `asia-northeast3-docker.pkg.dev/project-53f7b99e-c306-49a7-a7b/incheon-care/api:<git-sha>` |
| Cloud Run service | `incheon-care-api` |
| Deploy service account | `hack-cloud-run-deployer@project-53f7b99e-c306-49a7-a7b.iam.gserviceaccount.com` |
| Runtime service account | `incheon-care-api@project-53f7b99e-c306-49a7-a7b.iam.gserviceaccount.com` |
| WIF provider | `projects/282216427513/locations/global/workloadIdentityPools/github-pool/providers/i5-hack` |
| GitHub environment | `backend-production` |

The backend job requests `id-token: write` only at job scope and exchanges the
GitHub OIDC token through Workload Identity Federation. GitHub and Google
deployment actions are pinned to audited commit SHAs. There is no service
account JSON key or long-lived Google Cloud secret.

Required GitHub repository variables are already configured:

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `project-53f7b99e-c306-49a7-a7b` |
| `GCP_REGION` | `asia-northeast3` |
| `GCP_ARTIFACT_REPOSITORY` | `incheon-care` |
| `GCP_CLOUD_RUN_SERVICE` | `incheon-care-api` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | provider resource above |
| `GCP_SERVICE_ACCOUNT` | deploy service account above |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | runtime service account above |

The workflow builds `linux/amd64`, verifies the local image architecture, and
pushes only a commit-SHA tag. It does not publish `latest`. It then resolves
the tag to Artifact Registry's fully qualified digest and gives Cloud Run the
`api@sha256:...` reference, making the deployed revision content-addressed even
though repository-level immutable-tag enforcement is not currently enabled.
After deployment, the job verifies the canonical `/health` endpoint and
`/api/v1/summary` against the returned Cloud Run URL. The summary check also
requires an exact
`Access-Control-Allow-Origin: https://incheon-care-map.vercel.app` response.

### Cloud Run revision contract

Every backend production revision applies:

| Setting | Value |
| --- | --- |
| CPU / memory | `1` vCPU / `512Mi` |
| Concurrency | `40` requests per instance |
| Revision scaling | minimum `0`, maximum `2` instances |
| Request timeout | `60s` |
| CPU allocation | throttled outside requests |
| Startup CPU boost | enabled |
| Container port | `8080` |
| Ingress | `all` |
| Runtime identity | dedicated runtime service account |
| `CORS_ORIGINS` | `https://incheon-care-map.vercel.app` |
| `RATE_LIMIT_PER_MINUTE` | `0` |

The deployment uses the Cloud Run action's `overwrite` environment-variable
strategy. Each revision therefore receives exactly the application variables
declared by this workflow instead of retaining stale revision-level variables.

`RATE_LIMIT_PER_MINUTE=0` intentionally disables the in-process, per-instance
limiter for this demo contract. The maximum of two instances is a cost ceiling,
not an abuse-control layer. Add an edge-level distributed limit before opening
the API to sustained untrusted traffic.

### Google Cloud prerequisites

The `incheon-care` Docker repository was verified in `asia-northeast3` on
2026-08-12. The workflow deliberately does not provision infrastructure; use
this read-only command to recheck it before a production rollout:

```bash
gcloud artifacts repositories describe incheon-care \
  --project=project-53f7b99e-c306-49a7-a7b \
  --location=asia-northeast3
```

If a replacement environment does not have the repository, a project
administrator creates it outside CI:

```bash
gcloud artifacts repositories create incheon-care \
  --project=project-53f7b99e-c306-49a7-a7b \
  --location=asia-northeast3 \
  --repository-format=docker
```

The administrator must also verify:

- the WIF provider admits only the intended GitHub repository/ref policy;
- the deploy service account can push to this repository and deploy the service;
- the deploy service account may act as the dedicated runtime service account;
- the runtime service account has only application runtime permissions.

The runtime service account currently has `roles/datastore.user` for the
Firestore demo database described below. It does not need project-wide Cloud
Run, Artifact Registry, or owner/editor roles.

`--ingress=all` controls network ingress but does not grant unauthenticated
invocation. If the browser-facing API must be public, an administrator reviews
and applies the Cloud Run Invoker IAM binding separately. CI contains neither
`--allow-unauthenticated` nor an IAM policy mutation, so future deployments
preserve the administrator-controlled invocation policy.

## Data deployment boundary

The complete source-data pack can remain versioned through Git LFS. Deployment
checkouts do not download LFS payloads. `.vercelignore` excludes source-data
directories from Vercel, and the root `.dockerignore` allowlists only backend
code and curated `public/data` exports for the container context.

Application code must not read directly from root `data/`. Regenerate and
validate only reviewed browser/API exports under `public/data/`.

## Firestore demo database

Firestore Standard Native database `(default)` is provisioned in
`asia-northeast3`. Production selects it only for synthetic ContactOps session
overrides. It is intentionally not on the map, facility, transit, summary, or
health request path: curated public snapshots remain bundled in the container,
and a Firestore outage must not take the map down. Do not expose browser-direct
writes or store real personal, household-level, benefit-recipient, or
inferred-risk records.

The hackathon cleanup decision is 2026-08-15 KST. Deletion is manual, not an
automatic TTL. Verify the target before running:

```bash
gcloud firestore databases describe \
  --project=project-53f7b99e-c306-49a7-a7b \
  --database='(default)'

gcloud firestore databases delete \
  --project=project-53f7b99e-c306-49a7-a7b \
  --database='(default)'
```

## Verification and operations

The validation job does more than build the backend image. It starts that exact image with
memory state, verifies non-root UID 1000, and smokes `/health`, manager breadth, and the
156-zone/162-dong operations map. Keep these container-runtime checks when changing report
scripts, `DATA_DIR`, the Dockerfile, or bundled `public/data` paths; source-only tests cannot
prove that the image can resolve its runtime assets.

For review builds, the temporary public frontend alias is
`https://incheon-care-ops-preview.vercel.app` and its isolated backend is
`incheon-care-api-preview` in `asia-northeast3`. The preview backend must use a separate
synthetic Firestore collection, exact preview-origin CORS, min 0 / max 1, and live AI
disabled. Do not broaden production CORS or point preview mutations at the production
collection. Recheck whether to retain or delete this temporary service by 2026-08-15 KST.

Inspect repository configuration before merging:

```bash
gh variable list --repo ulsaninuhack/hack
gh secret list --repo ulsaninuhack/hack
```

Inspect a run after merging to `main`:

```bash
gh run list --repo ulsaninuhack/hack --workflow "CI / Production Deploy" --limit 5
gh workflow view "CI / Production Deploy" --repo ulsaninuhack/hack
gh run watch --repo ulsaninuhack/hack
vercel ls --environment=production
gcloud artifacts docker images list \
  asia-northeast3-docker.pkg.dev/project-53f7b99e-c306-49a7-a7b/incheon-care/api \
  --include-tags
gcloud run services describe incheon-care-api \
  --project=project-53f7b99e-c306-49a7-a7b \
  --region=asia-northeast3
```

Both deploy jobs write their immutable deployment target to the GitHub job
summary and register the deployed URL on their respective GitHub environment.

Recommended `main` branch protection requires pull requests and the
`Validate frontend and backend` job from the `CI / Production Deploy`
workflow as a required check. Select the check after it has completed at least
once in this repository.

## Mac mini Codex text transport

The optional home Mac mini bridge is administered over SSH but serves Cloud Run through a bounded
authenticated HTTPS endpoint. It does not expose a shell or the raw Codex app-server protocol.
Provisioning, Secret Manager wiring, live smoke, rotation, and rollback are documented in
[`MAC_MINI_CODEX_BRIDGE.md`](MAC_MINI_CODEX_BRIDGE.md). Do not add its Cloud Run environment
variables to the production workflow until the Funnel and end-to-end synthetic smoke both pass;
the configured bridge intentionally fails closed.

The `backend-production` environment requires
`CONTACT_OPS_CODEX_BRIDGE_URL=https://macmini.taild33a67.ts.net/incheon-care-codex-bridge`.
The workflow injects `CONTACT_OPS_CODEX_BRIDGE_TOKEN` directly from the
`codex-bridge-token` Secret Manager secret; the bearer token is never stored in GitHub.

## Official references

- [Vercel GitHub Actions deployment](https://vercel.com/docs/git/vercel-for-github#using-github-actions)
- [`git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentEnabled)
- [Google Workload Identity Federation action](https://github.com/google-github-actions/auth)
- [Google Cloud SDK action](https://github.com/google-github-actions/setup-gcloud)
- [Artifact Registry Docker authentication](https://cloud.google.com/artifact-registry/docs/docker/authentication)
- [Artifact Registry Docker images](https://cloud.google.com/artifact-registry/docs/docker/store-docker-container-images)
- [Cloud Run deployment action](https://github.com/google-github-actions/deploy-cloudrun)
- [`gcloud run deploy`](https://cloud.google.com/sdk/gcloud/reference/run/deploy)
