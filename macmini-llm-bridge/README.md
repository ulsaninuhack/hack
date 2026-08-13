# Mac mini Codex LLM bridge

This package turns a locally logged-in Codex CLI session into one narrow HTTP transport for the
ContactOps text Planner and Critic. It is not a general prompt proxy and it does not replace the
OpenAI file-transcription client.

## Boundary

- listens only on `127.0.0.1`; Tailscale Funnel terminates public HTTPS
- requires a 32–512 character bearer token on every model request
- accepts only the two fixed ContactOps Structured Outputs schema names
- starts a fresh ephemeral Codex thread per request
- forces `approvalPolicy=never`, a read-only sandbox, and network access off
- denies tool, command, file-change, permission, and user-input requests
- validates Codex JSON against the caller's schema before returning it
- serializes turns through one persistent `codex app-server` process and bounds the pending queue
- enforces a small global per-minute model-call limit in addition to the application rate limit
- does not log request bodies, model text, bearer tokens, or transcripts

The existing backend still masks PII before the call, validates the domain contract afterward,
and requires explicit human confirmation before deterministic scoring. The model cannot approve a
visit or complete an institution transfer.

## Test locally

Node.js 24 and a logged-in Codex CLI are required.

```bash
npm ci
npm test
codex login status
CODEX_BRIDGE_TOKEN='replace-with-a-random-32-plus-character-test-token' npm start
curl http://127.0.0.1:8765/health
```

## Install on the Mac mini

After cloning this repository on the Mac mini, log Codex in interactively and install the user
LaunchAgent. The script creates a random token file with mode `0600`, runs the package tests,
starts the localhost service, and optionally enables persistent Funnel HTTPS.

```bash
codex login --device-auth
cd hack/macmini-llm-bridge
./scripts/install-macos.sh --enable-funnel
```

The script never prints the bearer token. Read it locally only when copying it into Google Secret
Manager. Do not put the token in GitHub, shell history, chat, or a committed `.env` file.

See [`../docs/MAC_MINI_CODEX_BRIDGE.md`](../docs/MAC_MINI_CODEX_BRIDGE.md) for SSH bootstrap,
Cloud Run wiring, smoke tests, rotation, and rollback.
