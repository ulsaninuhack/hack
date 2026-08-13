#!/bin/sh
set -eu

npm run verify:overnight-freeze

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$1" >&2
}

ok() {
  printf 'OK: %s\n' "$1"
}

[ -f package.json ] || fail "run from repository root"
[ -f AGENTS.md ] || fail "missing AGENTS.md"
[ -f CLAUDE.md ] || fail "missing CLAUDE.md"
[ -f docs/AGENT_HANDOFF.md ] || fail "missing docs/AGENT_HANDOFF.md"

npm run test:agent-handoff
ok "Claude/Codex handoff contract is current"

grep -q '"name": "incheon-care-context-map"' package.json || fail "unexpected package name"
grep -q '"private": true' package.json || fail "package must stay private"
grep -q '"node": ">=24 <25"' package.json || fail "Node 24 engine contract missing"
ok "package identity and Node 24 engine contract present"

grep -q 'git.deploymentEnabled=false' AGENTS.md || fail "AGENTS.md must mention disabled Vercel Git deploy"
grep -q '"deploymentEnabled": false' vercel.json || fail "vercel.json must disable Vercel Git deploys"
grep -q 'CI / Production Deploy' .github/workflows/ci-deploy.yml || fail "workflow name changed unexpectedly"
grep -q 'Validate frontend and backend' .github/workflows/ci-deploy.yml || fail "workflow must validate frontend and backend"
grep -q 'npm run validate:data' .github/workflows/ci-deploy.yml || fail "workflow must validate curated web data"
grep -q 'npm run typecheck' .github/workflows/ci-deploy.yml || fail "workflow must type-check frontend"
grep -q 'npm run build' .github/workflows/ci-deploy.yml || fail "workflow must build frontend"
grep -q 'npm run check:ui-copy' .github/workflows/ci-deploy.yml || fail "workflow must enforce UI copy invariants"
grep -q 'npm --prefix backend ci' .github/workflows/ci-deploy.yml || fail "workflow must install backend dependencies"
grep -q 'npm --prefix backend run test:coverage' .github/workflows/ci-deploy.yml || fail "workflow must run backend coverage gate"
grep -q 'npm --prefix macmini-llm-bridge ci' .github/workflows/ci-deploy.yml || fail "workflow must install Mac mini bridge dependencies"
grep -q 'npm --prefix macmini-llm-bridge test' .github/workflows/ci-deploy.yml || fail "workflow must test Mac mini bridge boundaries"
grep -q 'docker build --file backend/Dockerfile' .github/workflows/ci-deploy.yml || fail "workflow must build backend container in validation"
grep -q '^  deploy-frontend-production:' .github/workflows/ci-deploy.yml || fail "missing frontend production deploy job"
grep -q '^  deploy-backend-production:' .github/workflows/ci-deploy.yml || fail "missing backend production deploy job"
grep -q 'refs/heads/main' .github/workflows/ci-deploy.yml || fail "workflow must gate production deploy on main"
grep -q 'needs: validate' .github/workflows/ci-deploy.yml || fail "production deploy jobs must depend on validation"
grep -q 'vercel deploy --prebuilt --prod' .github/workflows/ci-deploy.yml || fail "frontend deploy must use Vercel production deploy"
grep -q 'find .vercel/output/static/assets' .github/workflows/ci-deploy.yml || fail "frontend deploy must inspect the built entry asset"
grep -q 'production_origin="https://incheon-care-map.vercel.app"' .github/workflows/ci-deploy.yml || fail "frontend smoke must use the public production alias"
grep -q 'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093' .github/workflows/ci-deploy.yml || fail "backend deploy must use commit-pinned keyless WIF auth"
grep -q 'id-token: write' .github/workflows/ci-deploy.yml || fail "backend deploy must request OIDC id-token permission"
grep -q 'gcloud auth configure-docker' .github/workflows/ci-deploy.yml || fail "backend deploy must configure Artifact Registry auth"
grep -q 'google-github-actions/deploy-cloudrun@2028e2d7d30a78c6910e0632e48dd561b064884d' .github/workflows/ci-deploy.yml || fail "backend deploy must use commit-pinned Cloud Run deploy action"
grep -q -- '--service-account=${{ env.GCP_RUNTIME_SERVICE_ACCOUNT }}' .github/workflows/ci-deploy.yml || fail "Cloud Run deploy must set runtime service account"
grep -q 'CORS_ORIGINS=https://incheon-care-map.vercel.app' .github/workflows/ci-deploy.yml || fail "backend deploy CORS origin must match frontend production"
if grep -q 'credentials_json\|service_account_key\|--allow-unauthenticated' .github/workflows/ci-deploy.yml; then
  fail "workflow must not use static GCP keys or mutate public invoker IAM"
fi
ok "PR validation and main production deploy lanes are configured"

npm run check:ui-copy
ok "UI copy invariants and their unit tests pass"
npm run test:ui
ok "frontend component and operations contracts pass"
npm run typecheck
npm run build
ok "frontend typecheck, production build, and MapLibre worker verification pass"

grep -q 'Firestore Standard Native' AGENTS.md || fail "AGENTS.md must record the provisioned Firestore decision"
grep -q 'Static health/map/facility/transit/summary routes remain independent of Firestore' docs/AGENT_HANDOFF.md \
  || fail "handoff must keep curated map routes outside Firestore"
grep -q '"@google-cloud/firestore"' backend/package.json \
  || fail "synthetic ContactOps Firestore dependency is missing"
grep -q "await import('@google-cloud/firestore')" backend/src/server.mjs \
  || fail "Firestore must be loaded server-side only for the selected ContactOps state backend"
if grep -Eq "@google-cloud/firestore|firebase-admin" backend/src/app.mjs backend/src/data-store.mjs; then
  fail "curated map request handlers must not depend on Firestore"
fi
grep -q 'CONTACT_OPS_STATE_BACKEND=firestore' .github/workflows/ci-deploy.yml \
  || fail "production must select the Firestore ContactOps state adapter"
ok "Firestore is scoped to synthetic ContactOps state and excluded from curated map request handlers"

grep -q '^/data/' .vercelignore || fail ".vercelignore must exclude root data directory"
grep -q '^\*.zip filter=lfs' data/.gitattributes || fail "ZIP files must remain declared for Git LFS"
grep -q '^\*.gz filter=lfs' data/.gitattributes || fail "GZ files must remain declared for Git LFS"
ok "large data deployment and LFS boundaries present"

node <<'NODE'
const fs = require('node:fs');
const validation = JSON.parse(fs.readFileSync('public/data/validation.json', 'utf8'));
if (validation.status !== 'pass') throw new Error('public data validation status is not pass');
if (validation.counts.adminDongs !== 156) throw new Error('admin-dong validation count changed');
if (validation.counts.facilitiesSource !== 3061) throw new Error('facility source count changed');
if (validation.counts.facilitiesExcluded !== 245) throw new Error('facility exclusion count changed');
if (validation.counts.facilities !== 2816) throw new Error('facility runtime count changed');
if (validation.counts.facilitiesCanonicalSource !== 3394) throw new Error('canonical facility source count changed');
if (validation.counts.facilitiesCanonicalExcluded !== 279) throw new Error('canonical facility exclusion count changed');
if (validation.counts.facilitiesCanonicalRelevant !== 3115) throw new Error('relevant canonical facility count changed');
if (validation.counts.transitStops !== 6231) throw new Error('transit validation count changed');
const manifest = JSON.parse(fs.readFileSync('public/data/manifest.json', 'utf8'));
const caveats = (manifest.caveats || []).join('\n');
if (!caveats.includes('복지 미수혜자 수')) throw new Error('non-recipient caveat missing');
if (!caveats.includes('스냅샷')) throw new Error('mixed-snapshot caveat missing');
if (manifest.snapshotDates?.household !== '2026-07-31') throw new Error('household snapshot date changed');
if (manifest.snapshotDates?.population !== '2026-06-30') throw new Error('population snapshot date changed');
NODE
ok "public runtime validation snapshot is pass with expected counts"
ok "data interpretation caveats are present in runtime manifest"

npm run test:facility-data
ok "65+ relevant facility filtering contract is current"

npm run validate:synthetic-data
ok "synthetic CareOps fixtures are deterministic and current"
npm run test:contact-triage-schema
ok "contact triage schemas match the two-axis scorer and queue output"

if [ -d backend ]; then
  if [ -f backend/src/app.mjs ] && [ -f backend/src/data-store.mjs ] && [ -f backend/src/server.mjs ]; then
    ok "backend source files are present locally"
  else
    fail "backend source files are incomplete"
  fi
  grep -q '^!backend/' .dockerignore || fail "root .dockerignore must include backend for Docker context"
  grep -q '^!backend/package-lock.json' .dockerignore || fail "Docker context must include backend lockfile"
  grep -q '^!public/data/' .dockerignore || fail "root .dockerignore must include public/data for Docker context"
  ok "backend Docker context boundary is present"
  grep -q "url.pathname === '/health' || url.pathname === '/healthz'" backend/src/app.mjs || fail "backend must keep /health canonical and /healthz alias routing"
  grep -q "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health')" backend/Dockerfile || fail "Docker healthcheck must use canonical /health"
  grep -q 'GET /health.*canonical external health' backend/README.md || fail "backend README must document /health as canonical"
  grep -q 'GET /healthz.*alias' backend/README.md || fail "backend README must document /healthz alias"
  ok "backend health endpoint convention is documented and implemented"
  npm --prefix backend run test:coverage
  ok "backend coverage-gated test suite passes locally"
fi

if [ -d voice ]; then
  npm --prefix voice test
  ok "voice text/file and Planner-Critic contracts pass"
fi

if [ -d macmini-llm-bridge ]; then
  [ -f macmini-llm-bridge/package-lock.json ] || fail "Mac mini bridge lockfile is missing"
  npm --prefix macmini-llm-bridge test
  ok "Mac mini Codex bridge authentication, schema, queue, and sandbox contracts pass"
fi

large_files=$(find data/raw data/processed -type f \( -size +50M \) -print 2>/dev/null | sed -n '1,20p' || true)
if [ -n "$large_files" ]; then
  warn "large data files exist; keep them out of public/ and deployment inputs"
  printf '%s\n' "$large_files"
fi

ok "read-only agent checks completed"
