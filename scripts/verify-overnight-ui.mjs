import { readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const screenshots = [
  ['artifacts/screenshots/surveyor-queue-mobile.png', 390, 844],
  ['artifacts/screenshots/surveyor-detail-mobile.png', 390, 844],
  ['artifacts/screenshots/surveyor-form-mobile.png', 390, 844],
  ['artifacts/screenshots/manager-review-desktop.png', 1440, 900],
  ['artifacts/screenshots/manager-map-desktop.png', 1440, 900],
]

function pngDimensions(path) {
  const bytes = readFileSync(path)
  if (bytes.length < 24 || bytes.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error(`${path} is not a PNG`)
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

for (const [path, width, height] of screenshots) {
  if (statSync(path).size === 0) throw new Error(`${path} is empty`)
  const actual = pngDimensions(path)
  if (actual[0] !== width || actual[1] !== height) {
    throw new Error(`${path} must be ${width}x${height}; got ${actual.join('x')}`)
  }
}

const index = readFileSync('artifacts/screenshots/README.md', 'utf8')
for (const [path] of screenshots) {
  const name = path.split('/').at(-1)
  if (!index.includes(name)) throw new Error(`Screenshot index does not mention ${name}`)
}

const operationsSource = readFileSync('src/Operations.tsx', 'utf8')
for (const required of ['[합성]', '급성도', '취약도', '담당자 승인 대기', '통화 결과 입력']) {
  if (!operationsSource.includes(required)) throw new Error(`Operations UI is missing ${required}`)
}
for (const forbidden of ['종합점수', '종합 점수', '합산점수', '합산 점수']) {
  if (operationsSource.includes(forbidden)) throw new Error(`Operations UI contains forbidden ${forbidden}`)
}

const frontendFiles = ['package.json', 'src/App.tsx', 'src/MapView.tsx', 'src/Operations.tsx', 'src/contactOpsClient.ts']
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
if (/firebase|firestore/i.test(frontendFiles)) throw new Error('Frontend contains a direct Firestore/Firebase seam')

const coreDiff = spawnSync('git', [
  'diff', '--exit-code', '1fab6889', '--',
  'backend/src/contact-ops.mjs', 'backend/src/contact-triage-scoring.mjs',
], { encoding: 'utf8' })
if (coreDiff.status !== 0) throw new Error(`Frozen core diff failed:\n${coreDiff.stdout}${coreDiff.stderr}`)

process.stdout.write([
  'Overnight UI proof PASS',
  `screenshots=${screenshots.length}`,
  'axes=separate',
  'synthetic-marker=present',
  'frontend-firestore=absent',
  'core-logic=unchanged',
].join(' ') + '\n')
