import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findUiCopyViolations, runUiCopyGate } from '../scripts/check-ui-copy.mjs';

async function makeProject(files) {
  const root = await mkdtemp(join(tmpdir(), 'ui-copy-gate-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return root;
}

test('rejects promotional and self-congratulatory UI copy', async () => {
  const root = await makeProject({
    'src/App.tsx': '<h1>누구나 쉽게 이용하는 서비스</h1>',
  });
  const violations = await findUiCopyViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'promotional-copy');
});

test('rejects forbidden person-risk terminology in UI source', async () => {
  const root = await makeProject({
    'src/copy.ts': "export const label = '고위험자';",
  });
  const violations = await findUiCopyViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'domain-terminology');
});

test('rejects 위험군 group labeling in UI source (three-tier INV18)', async () => {
  const root = await makeProject({
    'src/copy.ts': "export const label = '방문 위험군';",
  });
  const violations = await findUiCopyViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'domain-terminology');
  assert.equal(violations[0].value, '위험군');
});

test('rejects the bracketed synthetic badge in production UI source', async () => {
  const root = await makeProject({
    'src/App.tsx': '<span>[합성]</span>',
  });
  const violations = await findUiCopyViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'presentation-marker');
});

test('rejects synthetic-data jargon in production UI copy', async () => {
  const root = await makeProject({
    'src/App.tsx': '<span>합성 예시</span>',
  });
  const violations = await findUiCopyViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'presentation-marker');
  assert.equal(violations[0].value, '합성');
});

test('rejects raw operational enum values in renderable files', async () => {
  const root = await makeProject({
    'src/Result.tsx': '<span>no_answer</span>',
  });
  const violations = await findUiCopyViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'raw-enum');
});

test('rejects legacy synthetic markers and internal IDs in renderable UI files', async () => {
  const root = await makeProject({
    'src/App.tsx': '<span>[합성] SYN-HH-2812551000-0003 SYN-W-2812551000-01</span>',
  });
  const violations = await findUiCopyViolations(root);
  assert.deepEqual(violations.map(({ rule, value }) => ({ rule, value })), [
    { rule: 'legacy-ui-identifier', value: 'SYN-HH-' },
    { rule: 'legacy-ui-identifier', value: 'SYN-W-' },
    { rule: 'presentation-marker', value: '합성' },
  ]);
});

test('allows internal IDs in test fixtures that do not ship as UI', async () => {
  const root = await makeProject({
    'src/App.test.tsx': "const caseId = 'SYN-HH-2812551000-0003'; const marker = '[합성]'",
  });
  assert.deepEqual(await findUiCopyViolations(root), []);
});

test('allows raw enum declarations in non-rendering contract files', async () => {
  const root = await makeProject({
    'src/contact-contract.ts': "export type Result = 'no_answer';",
  });
  assert.deepEqual(await findUiCopyViolations(root), []);
});

test('accepts task-oriented, manual-aligned labels', async () => {
  const root = await makeProject({
    'src/App.tsx': '<h1>오늘 연락할 대상</h1><button>통화 결과 입력</button>',
  });
  assert.deepEqual(await findUiCopyViolations(root), []);
});

test('ignores the rubric document that defines prohibited examples', async () => {
  const root = await makeProject({
    'docs/UI_UX_REVIEW_RUBRIC.md': '누구나 쉽게, 고위험자, no_answer',
  });
  assert.deepEqual(await findUiCopyViolations(root), []);
});

test('scans root HTML and reports every occurrence with its line number', async () => {
  const root = await makeProject({
    'index.html': '<h1>Welcome</h1>\n<p>한눈에</p>\n<p>한눈에</p>',
  });
  const violations = await findUiCopyViolations(root);
  assert.deepEqual(violations.map(({ line, value }) => ({ line, value })), [
    { line: 1, value: 'Welcome' },
    { line: 2, value: '한눈에' },
    { line: 3, value: '한눈에' },
  ]);
});

test('ignores generated, dependency, data, hidden, and unsupported files', async () => {
  const root = await makeProject({
    'src/data/generated.json': '고위험자',
    'src/.hidden/Copy.tsx': '<p>고위험자</p>',
    'src/readme.md': '고위험자',
    'node_modules/pkg/App.tsx': '<p>고위험자</p>',
  });
  assert.deepEqual(await findUiCopyViolations(root), []);
});

test('runUiCopyGate returns success without writing errors', async () => {
  const root = await makeProject({ 'src/App.tsx': '<h1>방문 권고 승인</h1>' });
  const output = [];
  const errors = [];
  const code = await runUiCopyGate({
    cwd: root,
    stdout: { write: (value) => output.push(value) },
    stderr: { write: (value) => errors.push(value) },
  });
  assert.equal(code, 0);
  assert.deepEqual(output, ['UI copy invariant passed.\n']);
  assert.deepEqual(errors, []);
});

test('runUiCopyGate returns failure with a location but no source line', async () => {
  const root = await makeProject({ 'src/App.tsx': '<h1>혁신적</h1>' });
  const errors = [];
  const code = await runUiCopyGate({
    cwd: root,
    stdout: { write: () => assert.fail('failure must not write success') },
    stderr: { write: (value) => errors.push(value) },
  });
  assert.equal(code, 1);
  assert.match(errors[0], /src\/App\.tsx:1 \[promotional-copy\] 혁신적/);
  assert.equal(errors[0].includes('<h1>'), false);
});
