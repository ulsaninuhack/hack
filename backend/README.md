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
- `POST /api/v1/contact-ops/session-reset` — test/E2E only. It exists only when `CONTACT_OPS_ENABLE_TEST_RESET=1`, requires `X-Demo-Session-ID` and exactly `{ "expected_marker": "[합성]" }`, and idempotently removes only that session's synthetic overrides. Production leaves this route unavailable.
- `GET /api/v1/contact-ops/manager-breadth` — session-scoped transfer recommendations, separate score distributions, deterministic tuning warning, and approved-only `VRP 아님` nearest-order hint; no query parameters
- `GET /api/v1/contact-ops/operations-map` — 156-zone overlay. Fresh sessions expose one deterministic `[합성 시나리오]` example per current admin dong and separately count session-recorded, scenario, and unrecorded tasks. Sorted `visit_review_points` carry recommendation-only status, both scores and contribution traces, plus public residential-building addresses and representative coordinates for a future point layer; no query parameters
- `POST /api/v1/contact-ops/cases/:caseId/contact-results`
- `POST /api/v1/contact-ops/cases/:caseId/triage/recalculate`
- `GET /api/v1/contact-ops/visit-recommendations?referenceDate=&workerId=&district=`
- `POST /api/v1/contact-ops/cases/:caseId/visit-decisions`
- `POST /api/v1/contact-ops/cases/:caseId/ai-observations` — returns a Planner/Critic
  candidate for consented masked text or a validated server-side WAV/MP3/M4A reference;
  a separate request with `confirmed: true` is required before deterministic rules run
- `POST /api/v1/contact-ops/cases/:caseId/ai-observations/audio` — accepts one multipart
  M4A/WAV/MP3 file plus `expected_revision`, `contact_date`, `surveyor_id`, and the fixed
  `consent_basis=verbal_in_recording`; the temporary random-named file is deleted after
  candidate generation and the response uses the same confirmation-required candidate

`bbox` uses `minLongitude,minLatitude,maxLongitude,maxLatitude` and is limited to a five-degree span. List endpoints cap `limit` at 500 (`zones` at 200) and `offset` at 100,000. Invalid, duplicate, and unknown query parameters return a versioned JSON error.

## Test

```bash
cd backend
npm test
npm run test:coverage
```

## ContactOps demo and AI boundary

The backend package contains the deterministic contact-first vertical slice. Queue,
scoring, follow-up, and manager decisions do not depend on an LLM or route optimizer.
Local state is memory-backed and production synthetic-session overrides use Firestore.

Operations mutations require `X-Demo-Session-ID` (16–128 opaque alphanumeric, `_`, or
`-` characters) and optimistic `expected_revision`. The AI endpoint first produces a
non-authoritative candidate with Critic arrays; candidate generation does not mutate state.
Only an explicit confirmation request can feed the validated canonical observations into
the existing deterministic rules. It cannot approve a visit or complete an institution
transfer.

Live Planner/Critic calls are fail-closed unless `ENABLE_LIVE_CONTACT_OPS_AI=1` and an
`OPENAI_API_KEY` are configured. CI proves the graph with deterministic injected clients;
it does not prove live-model quality. The demo production deployment injects the key from
Google Secret Manager and uses a finite global request limit; the plaintext key is never a
workflow value. The mobile upload route still requires a live synthetic-audio rehearsal,
and public exposure must stay bounded by the configured request limit and OpenAI project
budget.

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

The operations map reuses the same deterministic scenario generator but projects only one stable example per current admin dong. This prevents zone-maximum saturation, fills all 156 geometry zones, and never mutates workflow state or creates an approval. A session-recorded score replaces the preview for the same synthetic case.

## Container

The Dockerfile intentionally copies the already-curated `public/data` output into the image. Build with the repository root as context:

```bash
docker build -f backend/Dockerfile -t incheon-care-context-api .
docker run --rm -p 8080:8080 \
  -e CORS_ORIGINS=http://localhost:5173 \
  incheon-care-context-api
```

The image runs as the unprivileged `node` user. The repository-root `.dockerignore` retains
only the exact backend, voice runtime/schema, and `public/data/**` inputs needed by the
container, keeping this Cloud Build context small.
