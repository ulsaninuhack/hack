import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_ROOTS = ['src', 'app', 'components', 'screens', 'public'];
const ROOT_FILES = ['index.html'];
const SOURCE_EXTENSIONS = new Set([
  '.css', '.html', '.js', '.jsx', '.json', '.svelte', '.ts', '.tsx', '.vue',
]);
const RENDERABLE_EXTENSIONS = new Set(['.html', '.jsx', '.svelte', '.tsx', '.vue']);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.expo', 'coverage', 'data', 'dist', 'node_modules', 'web-build',
]);

const RULES = [
  {
    rule: 'promotional-copy',
    values: [
      '누구나 쉽게',
      '쉽고 간단',
      'AI가 도와주는',
      '스마트한',
      '혁신적',
      '한눈에',
      'Welcome',
      '간편하게',
      '사용하기 쉬운 대시보드',
    ],
  },
  {
    rule: 'domain-terminology',
    values: ['위험도', '위험군', '고위험자', '미수혜자', '개인예측'],
  },
];

const RAW_ENUM_VALUES = [
  'not_attempted',
  'connected_ok',
  'connected_concern',
  'no_answer',
  'invalid_contact',
];
const LEGACY_UI_IDENTIFIERS = ['[합성]', 'SYN-HH-', 'SYN-W-'];

function isTestFile(file) {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/.test(file);
}

async function collectFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }
  return files;
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

function addMatches(violations, content, file, rule, values) {
  for (const value of values) {
    let index = content.indexOf(value);
    while (index !== -1) {
      violations.push({
        file,
        line: lineNumberAt(content, index),
        rule,
        value,
      });
      index = content.indexOf(value, index + value.length);
    }
  }
}

export async function findUiCopyViolations(cwd = process.cwd()) {
  const candidates = [];
  for (const root of SOURCE_ROOTS) {
    candidates.push(...await collectFiles(join(cwd, root)));
  }
  for (const rootFile of ROOT_FILES) {
    const absolutePath = join(cwd, rootFile);
    try {
      await readFile(absolutePath);
      candidates.push(absolutePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const violations = [];
  for (const absolutePath of [...new Set(candidates)].sort()) {
    const content = await readFile(absolutePath, 'utf8');
    const file = relative(cwd, absolutePath);
    for (const { rule, values } of RULES) {
      addMatches(violations, content, file, rule, values);
    }
    if (RENDERABLE_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
      addMatches(violations, content, file, 'raw-enum', RAW_ENUM_VALUES);
      if (!isTestFile(file)) {
        addMatches(violations, content, file, 'legacy-ui-identifier', LEGACY_UI_IDENTIFIERS);
      }
    }
  }
  return violations.sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.rule.localeCompare(right.rule)
    || left.value.localeCompare(right.value)
  ));
}

export async function runUiCopyGate({
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const violations = await findUiCopyViolations(cwd);
  if (violations.length === 0) {
    stdout.write('UI copy invariant passed.\n');
    return 0;
  }

  for (const violation of violations) {
    stderr.write(
      `UI copy violation: ${violation.file}:${violation.line} [${violation.rule}] ${violation.value}\n`,
    );
  }
  return 1;
}

/* node:coverage ignore next 8 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runUiCopyGate()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write('UI copy invariant failed to run.\n');
      process.exitCode = 1;
    });
}
