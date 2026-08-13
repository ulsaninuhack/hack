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
- `POST /api/v1/contact-ops/cases/:caseId/live-calls` — creates the surveyor room token and
  a 32-character guest invite code; `{ "demo_entry": true }` selects the fixed synthetic
  `demo-stage` room, and the guest LiveKit token is never returned in this response
- `POST /api/v1/contact-ops/live-calls/invites/:inviteCode` — bodyless exchange of an active
  invite code for a short-lived resident participant token; responses are always `no-store`
- `POST /api/v1/contact-ops/live-calls/demo` — intentionally public, bodyless fixed-demo entry;
  every request issues a fresh 30-minute resident token for `care-call-demo-stage`, including
  before the surveyor joins, and responses are always `no-store`
- `POST /api/v1/contact-ops/live-calls/realtime-sdp` — exchanges authenticated participant
  SDP for the OpenAI Realtime transcription peer

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
Live-call invite codes use the same backend choice: production stores only a SHA-256 code hash
and non-personal room metadata in `LIVE_CALL_INVITE_COLLECTION` (default
`synthetic_live_call_invites`), while local tests use memory. The public `/call?invite=...` URL
therefore stays short and works across the two configured Cloud Run instances without putting a
LiveKit participant token in browser history, share previews, or Vercel request logs.
The judge-demo page `/call/demo` does not use that one-time invite store: it repeatedly exchanges
the fixed public path for a short-lived token to the synthetic `demo-stage` room. This is an
explicit demo-only availability tradeoff; the token remains in the response body, never the URL.

Operations mutations require `X-Demo-Session-ID` (16–128 opaque alphanumeric, `_`, or
`-` characters) and optimistic `expected_revision`. The AI endpoint first produces a
non-authoritative candidate with Critic arrays and one nullable next-confirmation question;
candidate generation does not mutate state. Luna Planner is the source of semantic observation
values. Deterministic code validates schema/enums, removes server-owned fields, enforces phone-only
observation limits, and keeps the candidate unconfirmed; it does not reinterpret meal or utility
status with local regex rules. Ambiguous or conflicting meal wording is surfaced through the
parallel Luna Critic result. If Critic names exact `low_confidence_fields`, the UI keeps non-null
Planner values and may display `(보류)` beside them; `null` values still display as `미확인`.
Direct select edits clear the marker. That marker does not block submission by itself, because the
field worker reviews and edits before confirming.
Only an explicit confirmation request can feed the validated canonical observations into
the existing deterministic rules. It cannot approve a visit or complete an institution
transfer.

Live Planner/Critic calls are fail-closed unless `ENABLE_LIVE_CONTACT_OPS_AI=1` and
`OPENAI_API_KEY` are configured. Text analysis uses the direct OpenAI Responses API only; stale
`CONTACT_OPS_CODEX_BRIDGE_*` settings are ignored. The production deploy sets
`OPENAI_VOICE_TEXT_MODEL=gpt-5.6-luna`, `OPENAI_CONTACT_OPS_CRITIC_MODEL=gpt-5.6-luna`, and both
reasoning effort variables to `none`. Planner and transcript Critic start concurrently, then the
server merges the structured outputs into the same confirmation-required candidate boundary.
Authentication, rate-limit, model-output, and response-contract failures remain closed.
CI proves the graph and direct OpenAI transport boundary with deterministic clients; it does not
prove live-model quality or telephone-audio accuracy. Secrets belong in Google Secret Manager and
public exposure must stay bounded by the configured request limit.

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
