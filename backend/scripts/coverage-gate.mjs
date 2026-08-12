import { spawnSync } from 'node:child_process';

// P0 froze these repository-wide minima. New functionality must add its own
// tests instead of diluting the already-proven baseline.
const minimum = Object.freeze({
  lines: 96.05,
  branches: 90.47,
  functions: 100,
});
const result = spawnSync(process.execPath, ['--test', '--experimental-test-coverage'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  env: process.env,
});

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const report = `${result.stdout || ''}\n${result.stderr || ''}`;
const totals = report.match(/all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/i);
if (!totals) {
  process.stderr.write('Unable to read the Node.js coverage summary.\n');
  process.exit(1);
}

const [lines, branches, functions] = totals.slice(1).map(Number);
const belowMinimum = Object.entries({ lines, branches, functions })
  .filter(([name, value]) => !Number.isFinite(value) || value < minimum[name]);

if (belowMinimum.length > 0) {
  process.stderr.write(
    `Coverage gate failed: ${belowMinimum.map(
      ([name, value]) => `${name}=${value}% (minimum ${minimum[name]}%)`,
    ).join(', ')}\n`,
  );
  process.exit(1);
}

process.stdout.write(`Coverage gate passed: lines=${lines}%, branches=${branches}%, functions=${functions}%\n`);
