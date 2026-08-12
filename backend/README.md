# I5 map API

Node.js 24 API for curated map exports and an isolated synthetic ContactOps demo. Map routes remain read-only and independent of ContactOps state; it never creates or returns inferred beneficiary, non-recipient, unserved-person, risk-score, or priority-score fields.

Facility source normalization preserves 3,394 canonical records. The runtime facility layer conservatively excludes clearly child/youth-only services: 3,115 relevant canonical records, 2,816 served facility points, and 90.401284% coordinate coverage. This is a relevance filter, not a legal eligibility determination.

## Local run

From the repository root:

```bash
node backend/src/server.mjs
curl http://127.0.0.1:8080/health
```

Optional environment variables are documented in `.env.example`. `CORS_ORIGINS` is a comma-separated list of exact origins; wildcard origins are rejected. `localhost`, `127.0.0.1`, and `[::1]` are allowed for local development.

## Routes

- `GET /health` — canonical external health endpoint for Cloud Run
- `GET /healthz` — internal and backward-compatible alias
- `GET /api/v1/summary`
- `GET /api/v1/zones?district=&bbox=&limit=&offset=`
- `GET /api/v1/zones/:geometryZoneId`
- `GET /api/v1/facilities?district=&category=&bbox=&limit=&offset=`
- `GET /api/v1/transit?district=&bbox=&minTotalEvents=&minRouteCount=&limit=&offset=`

Synthetic ContactOps routes:

- `GET /api/v1/contact-ops/today?referenceDate=&workerId=&district=`
- `GET /api/v1/contact-ops/cases/:caseId`
- `POST /api/v1/contact-ops/cases/:caseId/contact-results`
- `POST /api/v1/contact-ops/cases/:caseId/triage/recalculate`
- `GET /api/v1/contact-ops/visit-recommendations?referenceDate=&workerId=&district=`
- `POST /api/v1/contact-ops/cases/:caseId/visit-decisions`
- `POST /api/v1/contact-ops/cases/:caseId/ai-observations` — reserved for P3 and
  returns `501 FEATURE_NOT_AVAILABLE` until the real Planner-Critic adapter is present

`bbox` uses `minLongitude,minLatitude,maxLongitude,maxLatitude` and is limited to a five-degree span. List endpoints cap `limit` at 500 (`zones` at 200) and `offset` at 100,000. Invalid, duplicate, and unknown query parameters return a versioned JSON error.

## Test

```bash
cd backend
npm test
npm run test:coverage
```

## ContactOps Text Demo

The backend package also contains the deterministic contact-first vertical slice. It does not call an LLM, voice API, database, or route optimizer.

P1 operations mutations require `X-Demo-Session-ID` (16–128 opaque alphanumeric, `_`, or `-` characters) and optimistic `expected_revision`. Local/default state is deterministic memory; Cloud Run selects Firestore through `CONTACT_OPS_STATE_BACKEND=firestore`, and stores synthetic records only. `POST /api/v1/contact-ops/cases/:caseId/ai-observations` is deliberately `501 FEATURE_NOT_AVAILABLE` until P3.

From the repository root:

```bash
npm --prefix backend run demo:contact-ops
```

The demo loads `public/data/synthetic-households.json` and prints:

1. today's contact queue
2. a dummy `no_answer` contact result
3. deterministic rule findings
4. separate acute/vulnerability scores and a visit recommendation with no automatic approval
5. an explicit manager approval that creates approved-visit route constraints

The score distribution and mild-signal accumulation audit are reproducible:

```bash
npm --prefix backend run report:contact-triage
```

This report is a fixed synthetic scenario simulation, not an observed-person result. The scoring and queue contract is documented in `docs/CONTACT_TRIAGE_SCORING.md`.

## Container

The Dockerfile intentionally copies the already-curated `public/data` output into the image. Build with the repository root as context:

```bash
docker build -f backend/Dockerfile -t incheon-care-context-api .
docker run --rm -p 8080:8080 \
  -e CORS_ORIGINS=http://localhost:5173 \
  incheon-care-context-api
```

The image runs as the unprivileged `node` user. The repository-root `.dockerignore` retains only `backend/**` and `public/data/**`, keeping this Cloud Build context small.
