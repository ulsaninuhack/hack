import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Claude and Codex share one canonical takeover path', async () => {
  const [claude, agents, handoff, packageText] = await Promise.all([
    read('CLAUDE.md'),
    read('AGENTS.md'),
    read('docs/AGENT_HANDOFF.md'),
    read('package.json'),
  ])
  const packageJson = JSON.parse(packageText)

  assert.match(claude, /Use `AGENTS\.md` as the canonical operating guide/)
  assert.match(claude, /docs\/AGENT_HANDOFF\.md/)
  assert.match(agents, /## Next Agent Bootstrap/)
  assert.match(agents, /GitHub repository is currently public/)
  assert.match(agents, /git worktree add .* origin\/main/)
  assert.match(agents, /npm run agent:check/)
  assert.match(handoff, /## 60-Second Takeover/)
  assert.match(handoff, /npm run agent:check/)
  assert.equal(packageJson.scripts['agent:check'], 'sh scripts/agent-check.sh')
})

test('handoff records the last independently verified production baseline', async () => {
  const [handoff, morning] = await Promise.all([
    read('docs/AGENT_HANDOFF.md'),
    read('MORNING_HANDOFF.md'),
  ])

  for (const text of [handoff, morning]) {
    assert.match(text, /31633711778/)
    assert.match(text, /3c914d76ff5d51f388ae9d46ed61eb805addd9bf/)
    assert.match(text, /incheon-care-api-00020-4bq/)
    assert.match(text, /sha256:56a8db8c56df9f8a640528d0144005b4d3afe90b8abe34ab6553463fc844b7a7/)
  }
})

test('agent check recognizes the production-origin contract used by the workflow', async () => {
  const [agentCheck, workflow] = await Promise.all([
    read('scripts/agent-check.sh'),
    read('.github/workflows/ci-deploy.yml'),
  ])

  assert.match(workflow, /production_origin="https:\/\/incheon-care-map\.vercel\.app"/)
  assert.match(agentCheck, /production_origin="https:\/\/incheon-care-map\.vercel\.app"/)
})

test('production voice AI uses Secret Manager behind a live gate and finite request limit', async () => {
  const workflow = await read('.github/workflows/ci-deploy.yml')

  assert.match(workflow, /OPENAI_API_KEY=openai-api-key:latest/)
  assert.match(workflow, /ENABLE_LIVE_CONTACT_OPS_AI=1/)
  assert.doesNotMatch(workflow, /OPENAI_API_KEY=sk-/)

  const rateLimit = workflow.match(/RATE_LIMIT_PER_MINUTE=([0-9]+)/)
  assert.ok(rateLimit, 'production request limit must be explicit')
  assert.ok(Number(rateLimit[1]) > 0, 'production request limit must not disable throttling')
})
