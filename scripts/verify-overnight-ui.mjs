import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'

const frozenScreenshots = [
  ['artifacts/screenshots/public-map-desktop.png', 1440, 900],
  ['artifacts/screenshots/public-operations-scenario-desktop.png', 1440, 900],
  ['artifacts/screenshots/surveyor-queue-mobile.png', 390, 844],
  ['artifacts/screenshots/surveyor-detail-mobile.png', 390, 844],
  ['artifacts/screenshots/surveyor-form-mobile.png', 390, 844],
  ['artifacts/screenshots/manager-review-desktop.png', 1440, 900],
  ['artifacts/screenshots/manager-map-desktop.png', 1440, 900],
  ['artifacts/screenshots/operations-overlay-desktop.png', 1440, 900],
  ['artifacts/screenshots/empty-loading-error-mobile.png', 390, 844],
]

// P8 additionally requires each state to remain independently inspectable. The
// combined image above is the frozen rubric row; these are supplemental proof.
const supplementalScreenshots = [
  ['artifacts/screenshots/operations-scenario-desktop.png', 1440, 900],
  ['artifacts/screenshots/empty-mobile.png', 390, 844],
  ['artifacts/screenshots/loading-mobile.png', 390, 844],
  ['artifacts/screenshots/error-mobile.png', 390, 844],
]

const screenshots = [...frozenScreenshots, ...supplementalScreenshots]

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
  const name = basename(path)
  if (!index.includes(name)) throw new Error(`Screenshot index does not mention ${name}`)
}

const operationsSource = readFileSync('src/Operations.tsx', 'utf8')
for (const required of ['caseDisplayName', '급성도', '취약도', '담당자 승인 대기', '통화(또는 방문) 결과 입력']) {
  if (!operationsSource.includes(required)) throw new Error(`Operations UI is missing ${required}`)
}
if (operationsSource.includes('[합성]')) throw new Error('Operations UI must not render the legacy synthetic marker')
const renderedUiSource = ['src/App.tsx', 'src/Operations.tsx', 'src/SurveyorBreadth.tsx']
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
const normalizedRenderedUiSource = renderedUiSource.toLowerCase()
for (const forbidden of [
  '종합점수', '종합 점수', '합산점수', '합산 점수', '합계 점수', '통합 점수', '전체 점수',
  'composite score', 'combined score', 'overall score', 'total score',
]) {
  if (normalizedRenderedUiSource.includes(forbidden)) throw new Error(`Rendered UI source contains forbidden ${forbidden}`)
}

const mixedSnapshotWarning = '분자 2026-07-31 · 분모 2026-06-30 · 서로 다른 기준월의 참고 비율이며 동시점 비율이 아닙니다.'
if (!renderedUiSource.includes(mixedSnapshotWarning)) {
  throw new Error('Rendered UI source is missing the exact P2 mixed-snapshot warning')
}
if (!renderedUiSource.includes('[MODEL OUTPUT — UNVALIDATED]')) {
  throw new Error('Rendered UI source is missing the unvalidated structural-context label')
}

const evidence = JSON.parse(readFileSync('artifacts/p8-evidence.json', 'utf8'))
if (evidence.schemaVersion !== 1
    || evidence.generatedBy !== 'e2e/p8-demo-hardening.spec.ts'
    || evidence.productionLike !== true) {
  throw new Error('P8 evidence header does not identify the production-like golden spec')
}
if (!Array.isArray(evidence.screenshots)) throw new Error('P8 evidence screenshots must be an array')
const evidenceScreenshots = new Map(evidence.screenshots.map((entry) => [basename(entry.file || ''), entry]))
for (const [path, width, height] of screenshots) {
  const name = basename(path)
  const entry = evidenceScreenshots.get(name)
  if (!entry || entry.width !== width || entry.height !== height || typeof entry.state !== 'string' || entry.state.trim() === '') {
    throw new Error(`P8 evidence does not objectively describe ${name} at ${width}x${height}`)
  }
}

const checks = evidence.checks || {}
const exactChecks = {
  consoleErrors: 0,
  pageErrors: 0,
  axeSeriousCritical: 0,
  horizontalOverflowPx: 0,
  syntheticMarker: true,
  separateAxes: true,
  mixedSnapshotWarning: true,
  modelOutputLabel: true,
  compositeScoreAbsent: true,
}
for (const [key, expected] of Object.entries(exactChecks)) {
  if (checks[key] !== expected) throw new Error(`P8 objective check ${key} must equal ${expected}`)
}
for (const [key, minimum] of Object.entries({ minBodyFontPx: 18, minTargetWidthPx: 48, minTargetHeightPx: 48 })) {
  if (typeof checks[key] !== 'number' || checks[key] < minimum) {
    throw new Error(`P8 objective check ${key} must be at least ${minimum}`)
  }
}

const axeEvidence = JSON.parse(readFileSync('artifacts/axe/p8-axe-results.json', 'utf8'))
if (axeEvidence.schemaVersion !== 1
    || axeEvidence.generatedBy !== 'e2e/p8-demo-hardening.spec.ts'
    || !Array.isArray(axeEvidence.results)
    || axeEvidence.results.length === 0) {
  throw new Error('P8 axe evidence is missing its stable per-surface contract')
}
const axeBlockers = axeEvidence.results.flatMap((result) => {
  if (typeof result.surface !== 'string' || result.surface.trim() === '' || !Array.isArray(result.violations)) {
    throw new Error('P8 axe evidence contains an invalid surface result')
  }
  return result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
})
if (axeBlockers.length !== 0 || checks.axeSeriousCritical !== axeBlockers.length) {
  throw new Error(`P8 axe evidence contains ${axeBlockers.length} serious or critical violations`)
}

const frontendFiles = ['package.json', 'src/App.tsx', 'src/MapView.tsx', 'src/Operations.tsx', 'src/contactOpsClient.ts']
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
if (/firebase|firestore/i.test(frontendFiles)) throw new Error('Frontend contains a direct Firestore/Firebase seam')

const frozenCoreFiles = new Map([
  ['backend/src/contact-ops.mjs', '3036cf29afe4aa0151386596673d46e585a49b19d42d7a500c3216df88fd570c'],
  ['backend/src/contact-triage-scoring.mjs', '51ea5e9f04c09f5f0849adacc1438c23ef9982905f0afbf347d0759cd5141dd7'],
])
for (const [path, expectedHash] of frozenCoreFiles) {
  const actualHash = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (actualHash !== expectedHash) throw new Error(`Frozen core hash changed for ${path}`)
}

process.stdout.write([
  'Overnight UI proof PASS',
  `screenshots=${screenshots.length}`,
  `frozen-matrix=${frozenScreenshots.length}`,
  'console-errors=0',
  'axe-serious-critical=0',
  'body-font>=18px',
  'targets>=48px',
  'horizontal-overflow=0',
  'axes=separate',
  'synthetic-marker=present',
  'p2-warning=present',
  'model-label=present',
  'composite-score=absent',
  'frontend-firestore=absent',
  'core-logic=unchanged',
].join(' ') + '\n')
