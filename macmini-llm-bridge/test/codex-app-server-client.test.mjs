import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import { CodexAppServerClient } from '../src/codex-app-server-client.mjs';

function fakeCodexProcess(captured) {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.exitCode = null;
  process.kill = () => { process.exitCode = 0; process.emit('exit', 0); };
  process.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const payload = JSON.parse(String(chunk).trim());
      captured.push(payload);
      const respond = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
      if (payload.method === 'initialize') {
        respond({ jsonrpc: '2.0', id: payload.id, result: {} });
      } else if (payload.method === 'thread/start') {
        respond({ jsonrpc: '2.0', id: payload.id, result: { thread: { id: 'thread-1' } } });
      } else if (payload.method === 'turn/start') {
        respond({ jsonrpc: '2.0', id: payload.id, result: { turn: { id: 'turn-1' } } });
        queueMicrotask(() => {
          respond({ jsonrpc: '2.0', id: 999, method: 'item/commandExecution/requestApproval', params: {} });
          respond({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', delta: '{"ok":true}' } });
          respond({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
        });
      }
      callback();
    },
  });
  return process;
}

test('persistent app-server uses an isolated read-only ephemeral thread and denies command approvals', async () => {
  const previousToken = process.env.CODEX_BRIDGE_TOKEN;
  process.env.CODEX_BRIDGE_TOKEN = 'must-not-reach-the-codex-child';
  const messages = [];
  const spawns = [];
  const client = new CodexAppServerClient({
    codexBin: '/opt/homebrew/bin/codex',
    model: 'gpt-5.5',
    timeoutMs: 1_000,
    spawnImpl(command, args, options) {
      spawns.push({ command, args, options });
      return fakeCodexProcess(messages);
    },
  });

  const result = await client.analyzeStructured({
    messages: [
      { role: 'system', content: 'Return JSON.' },
      { role: 'user', content: '{"message":"hello"}' },
    ],
    schemaName: 'neighbor_connector_voice_record',
    schema: { type: 'object' },
  });

  assert.equal(result, '{"ok":true}');
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].args.slice(0, 4), ['app-server', '--listen', 'stdio://', '--disable']);
  assert.equal(spawns[0].options.env.CODEX_BRIDGE_TOKEN, undefined);
  const threadStart = messages.find((message) => message.method === 'thread/start');
  assert.equal(threadStart.params.approvalPolicy, 'never');
  assert.equal(threadStart.params.sandbox, 'read-only');
  assert.equal(threadStart.params.ephemeral, true);
  const turnStart = messages.find((message) => message.method === 'turn/start');
  assert.deepEqual(turnStart.params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.ok(messages.some((message) => message.id === 999 && message.result?.decision === 'decline'));
  client.close();
  await once(client, 'closed');
  if (previousToken === undefined) delete process.env.CODEX_BRIDGE_TOKEN;
  else process.env.CODEX_BRIDGE_TOKEN = previousToken;
});
