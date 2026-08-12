import { spawnSync } from 'node:child_process';

const minimum = 80;
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
  .filter(([, value]) => !Number.isFinite(value) || value < minimum);

if (belowMinimum.length > 0) {
  process.stderr.write(
    `Coverage gate failed (minimum ${minimum}%): ${belowMinimum.map(([name, value]) => `${name}=${value}%`).join(', ')}\n`,
  );
  process.exit(1);
}

process.stdout.write(`Coverage gate passed: lines=${lines}%, branches=${branches}%, functions=${functions}%\n`);
