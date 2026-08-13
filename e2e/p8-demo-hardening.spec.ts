import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const CASE_ID = 'SYN-HH-2812551000-0001'
const CASE_NAME = '김영자 어르신'
const SCREENSHOT_DIR = 'artifacts/screenshots'
const AXE_PATH = 'artifacts/axe/p8-axe-results.json'
const EVIDENCE_PATH = 'artifacts/p8-evidence.json'
const SESSION_KEY = 'care-ops-demo-session-id'
const P2_WARNING = '분자 2026-07-31 · 분모 2026-06-30 · 서로 다른 기준월의 참고 비율이며 동시점 비율이 아닙니다.'
const MODEL_LABEL = '[MODEL OUTPUT — UNVALIDATED]'

type AxeSurfaceResult = {
  surface: string
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']
}

type ScreenshotEvidence = {
  file: string
  width: number
  height: number
  state: string
}

const axeResults: AxeSurfaceResult[] = []
const screenshots: ScreenshotEvidence[] = []
const consoleErrors: string[] = []
const pageErrors: string[] = []

function listenForBrowserErrors(page: Page) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // Sandbox-only (PLAYWRIGHT_CHROMIUM_EXECUTABLE set): offline runners cannot
    // reach the external basemap/glyph hosts, so those fetch failures are
    // environment noise there. In CI the env is unset and NOTHING is filtered,
    // exactly as before.
    const sandboxOffline = Boolean(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
    const externalNoise = sandboxOffline
      ? ['tile.openstreetmap.org', 'demotiles.maplibre.org',
        'net::ERR_TUNNEL_CONNECTION_FAILED', 'net::ERR_PROXY_CONNECTION_FAILED']
      : []
    if (externalNoise.some((marker) => text.includes(marker))) return
    consoleErrors.push(`${new URL(page.url()).pathname}: ${text}`)
  })
  page.on('pageerror', (error) => pageErrors.push(`${new URL(page.url()).pathname}: ${error.message}`))
}

async function isolatedContext(browser: Browser, label: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(({ key, value }) => sessionStorage.setItem(key, value), {
    key: SESSION_KEY,
    value: `p8-${label}-${process.pid}-${Date.now()}`,
  })
  return context
}

async function persistAxeEvidence() {
  await mkdir('artifacts/axe', { recursive: true })
  await writeFile(AXE_PATH, `${JSON.stringify({
    schemaVersion: 1,
    generatedBy: 'e2e/p8-demo-hardening.spec.ts',
    results: axeResults,
  }, null, 2)}\n`)
}

async function audit(page: Page, surface: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  axeResults.push({ surface, violations: result.violations })
  // Persist the raw result before asserting so CI retains the failing surface.
  await persistAxeEvidence()
  const blockers = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
  expect(blockers, `${surface}: ${JSON.stringify(blockers, null, 2)}`).toEqual([])
}

async function capture(
  page: Page,
  file: string,
  width: number,
  height: number,
  state: string,
) {
  await expect.poll(async () => page.viewportSize()).toEqual({ width, height })
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${file}` })
  screenshots.push({ file: `${SCREENSHOT_DIR}/${file}`, width, height, state })
}

async function expectMobileMeasurements(page: Page) {
  const measurements = await page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const text = [...document.querySelectorAll<HTMLElement>(
      '.ops-page p,.ops-page label,.ops-page button,.ops-page select,.ops-page textarea,.ops-page a,.ops-page span,.ops-page small,.ops-page b,.ops-page details',
    )].filter(visible)
    const targets = [...document.querySelectorAll<HTMLElement>(
      '.ops-page button,.ops-page input,.ops-page select,.ops-page textarea,.ops-page a,.ops-page summary',
    )].filter(visible)
    const fontSizes = text.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    const targetSizes = targets.map((element) => {
      const bounds = element.getBoundingClientRect()
      const labelBounds = element.closest('label')?.getBoundingClientRect()
      const width = Math.max(bounds.width, labelBounds?.width ?? 0)
      const height = Math.max(bounds.height, labelBounds?.height ?? 0)
      return { width, height, tag: element.tagName }
    })
    return {
      minFont: Math.min(...fontSizes),
      minTargetWidth: Math.min(...targetSizes.map(({ width }) => width)),
      minTargetHeight: Math.min(...targetSizes.map(({ height }) => height)),
      targetFailures: targetSizes.filter(({ width, height }) => width < 48 || height < 48),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(measurements.minFont).toBeGreaterThanOrEqual(18)
  expect(measurements.targetFailures).toEqual([])
  expect(measurements.horizontalOverflow).toBe(0)
  return measurements
}

async function fulfillToday(route: Route, data: { synthetic: true; displayMarker: '[합성]'; items: unknown[] }) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ apiVersion: 'v1', data }),
  })
}

async function captureExplicitState(
  browser: Browser,
  state: 'empty' | 'loading' | 'error',
) {
  const context = await isolatedContext(browser, state, { width: 390, height: 844 })
  const page = await context.newPage()
  listenForBrowserErrors(page)
  let releaseLoading: (() => void) | null = null
  const loadingGate = new Promise<void>((resolve) => { releaseLoading = resolve })

  await page.route('**/api/v1/contact-ops/today?**', async (route) => {
    if (state === 'empty') {
      await fulfillToday(route, { synthetic: true, displayMarker: '[합성]', items: [] })
      return
    }
    if (state === 'loading') {
      await loadingGate
      await route.abort('aborted')
      return
    }
    await route.fulfill({
      // Test-only error envelope: a successful transport keeps the console-zero gate
      // meaningful while the client still exercises its explicit API-error branch.
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        apiVersion: 'v1',
        error: { code: 'CONTACT_OPS_UNAVAILABLE', message: '연락업무 서비스를 잠시 사용할 수 없습니다.' },
      }),
    })
  })

  await page.goto('/ops/surveyor')
  if (state === 'empty') {
    await expect(page.getByText('오늘 예정된 연락업무가 없습니다.')).toBeVisible()
  } else if (state === 'loading') {
    await expect(page.getByText('운영 데이터를 불러오는 중입니다.')).toBeVisible()
  } else {
    await expect(page.getByRole('alert')).toContainText('연락업무 서비스를 잠시 사용할 수 없습니다.')
    await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible()
  }
  await expect(page.locator('main.ops-page')).not.toContainText('합성')
  const measurements = await expectMobileMeasurements(page)
  await capture(page, `${state}-mobile.png`, 390, 844, `[검증 화면] ${state} 상태 · 연락업무 API 가로채기`)
  await audit(page, `${state}-mobile`)
  releaseLoading?.()
  await context.close()
  return measurements
}

async function createCombinedStateProof(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const images = await Promise.all(['empty', 'loading', 'error'].map(async (state) => ({
    state,
    data: (await readFile(`${SCREENSHOT_DIR}/${state}-mobile.png`)).toString('base64'),
  })))
  await page.setContent(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;padding:12px;background:#eef2ee;color:#162622;font-family:Arial,sans-serif}
    h1{margin:0 0 10px;font-size:20px}.proof{display:grid;gap:8px}.state{margin:0;padding:7px;background:#fff;border:2px solid #17665c;border-radius:10px}
    figcaption{margin-bottom:5px;font-size:18px;font-weight:800}.crop{height:226px;overflow:hidden;border:1px solid #b8c8c1;border-radius:7px}
    img{display:block;width:100%;height:auto}.note{margin:8px 0 0;font-size:16px;line-height:1.35}
  </style></head><body><h1>[검증 화면] 빈 목록 · 로딩 · 오류</h1><main class="proof">${images.map(({ state, data }) => `
    <figure class="state"><figcaption>${state === 'empty' ? '빈 목록' : state === 'loading' ? '불러오는 중' : '오류와 복구'}</figcaption>
      <div class="crop"><img alt="${state} 실제 화면 캡처" src="data:image/png;base64,${data}"></div></figure>`).join('')}</main>
    <p class="note">각 상태는 production-like 화면에서 별도로 접근성 검사했습니다.</p></body></html>`)
  await capture(page, 'empty-loading-error-mobile.png', 390, 844, '[검증 화면] 별도 검증한 empty/loading/error 상태 묶음')
  await context.close()
}

test('P8 hardening: production-like surfaces, explicit states, accessibility, and screenshot evidence', async ({ browser }) => {
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  axeResults.length = 0
  screenshots.length = 0
  consoleErrors.length = 0
  pageErrors.length = 0
  await persistAxeEvidence()

  const desktop = await isolatedContext(browser, 'public-map', { width: 1440, height: 900 })
  const publicPage = await desktop.newPage()
  listenForBrowserErrors(publicPage)
  await publicPage.goto('/')
  await expect(publicPage.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 45_000 })
  await expect(publicPage.locator('.guardrail > span')).toHaveText(P2_WARNING)
  await expect.poll(async () => publicPage.locator('.maplibregl-ctrl-attrib a').first().evaluate((link) => ({
    color: getComputedStyle(link).color,
    decoration: getComputedStyle(link).textDecorationLine,
  }))).toMatchObject({ decoration: 'underline' })
  await capture(publicPage, 'public-map-desktop.png', 1440, 900, '실제 공개 집계 지도와 혼합 시점 고지')
  await audit(publicPage, 'public-map-desktop')
  await publicPage.getByRole('button', { name: '연락업무' }).click()
  await publicPage.getByRole('textbox', { name: '구 또는 동 검색' }).fill('신포동')
  await publicPage.getByRole('button', { name: /신포동/ }).click()
  await publicPage.getByRole('button', { name: '상세 닫기' }).click()
  const publicScenarioPanel = publicPage.getByRole('region', { name: '선택한 구역의 연락업무 상세' })
  await expect(publicScenarioPanel).toContainText('고정 운영 예시')
  await expect(publicScenarioPanel).toContainText(/세션 기록 \d+건 · 고정 예시 1건 · 미기록 \d+건/)
  await publicScenarioPanel.getByText(/세션 기록 \d+건 · 고정 예시 1건 · 미기록 \d+건/).scrollIntoViewIfNeeded()
  await expect(publicScenarioPanel.getByText('고정 운영 예시')).toBeInViewport()
  await expect(publicScenarioPanel.getByText(/세션 기록 \d+건 · 고정 예시 1건 · 미기록 \d+건/)).toBeInViewport()
  await capture(publicPage, 'public-operations-scenario-desktop.png', 1440, 900, '공개 지도에서 실제 API가 채운 초기 고정 운영 예시')
  await audit(publicPage, 'public-operations-scenario-desktop')
  await desktop.close()

  const operations = await isolatedContext(browser, 'operations', { width: 390, height: 844 })
  const page = await operations.newPage()
  listenForBrowserErrors(page)
  await page.goto('/ops/surveyor')
  const queue = page.getByRole('listbox', { name: '오늘 연락업무 목록' })
  await expect(queue.getByRole('option').first()).toBeVisible()
  await expect(page.locator('main.ops-page')).not.toContainText('합성')
  await expect(page.getByText(/오늘 연락업무 \d+건/)).toBeVisible()
  await capture(page, 'surveyor-queue-mobile.png', 390, 844, '실제 API 오늘 큐와 일일 요약')

  const target = page.getByRole('option', { name: new RegExp(CASE_NAME) })
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await expect(page.locator('.ops-detail .case-id')).toContainText(CASE_NAME)
  await page.locator('.ops-form').scrollIntoViewIfNeeded()
  await capture(page, 'surveyor-form-mobile.png', 390, 844, '실제 연락 결과·관찰·수동 입력 폼')

  await page.getByLabel('통화(또는 방문) 결과').selectOption({ label: '미응답' })
  await page.getByLabel('우편물·고지서 적체').check()
  await page.getByLabel('식사 상태').selectOption({ label: '심각' })
  await page.getByRole('button', { name: '통화(또는 방문) 결과 저장' }).click()
  await expect(page.getByText('통화(또는 방문) 결과를 저장하고 연락업무 순서를 다시 계산했습니다.')).toBeVisible()
  await expect(page.locator('.ops-detail')).toContainText('방문 권고 · 담당자 승인 대기')
  await page.locator('.ops-detail').scrollIntoViewIfNeeded()
  await capture(page, 'surveyor-detail-mobile.png', 390, 844, '실제 규칙 재계산 후 분리된 급성도·취약도와 기여')
  const mobileMeasurements = await expectMobileMeasurements(page)
  await audit(page, 'surveyor-mobile')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/ops/manager')
  const managerTarget = page.getByRole('listbox', { name: '방문 권고 목록' }).getByRole('option')
    .filter({ hasText: CASE_NAME }).filter({ hasText: '급성도 62' }).filter({ hasText: '취약도 37.602737968418836' })
  await expect(managerTarget).toBeVisible()
  await managerTarget.click()
  await expect(page.getByText('배점 점검')).toBeVisible()
  await expect(page.getByText('647건')).toBeVisible()
  await expect.poll(async () => page.locator('.ops-workbench').evaluate((workbench) => ({
    areas: getComputedStyle(workbench).gridTemplateAreas,
    decisionWidth: workbench.querySelector<HTMLElement>('.ops-decision')?.getBoundingClientRect().width ?? 0,
  }))).toMatchObject({ areas: '"queue decision" "breadth decision"' })
  await capture(page, 'manager-review-desktop.png', 1440, 900, '실제 방문 권고와 관리자 운영 요약')
  await audit(page, 'manager-review-desktop')

  const mapRegion = page.getByRole('region', { name: '연락업무 위치와 공개 동단위 맥락 지도' })
  await expect(mapRegion).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 })
  await page.locator('.ops-map-context').scrollIntoViewIfNeeded()
  await capture(page, 'manager-map-desktop.png', 1440, 900, '실제 선택 위치와 키보드 목록 대안')
  await audit(page, 'manager-map-desktop')

  await page.getByRole('button', { name: '연락업무' }).click()
  const operationsPanel = page.getByRole('region', { name: '선택한 구역의 연락업무' })
  await expect(operationsPanel).toContainText('급성도 채색값')
  await expect(operationsPanel).toContainText('고정 운영 예시')
  await expect(operationsPanel).toContainText(/세션 기록 \d+건 · 고정 예시 \d+건 · 미기록 \d+건/)
  await operationsPanel.scrollIntoViewIfNeeded()
  await expect(operationsPanel.getByText('고정 운영 예시')).toBeInViewport()
  await expect(operationsPanel.getByText(/세션 기록 \d+건 · 고정 예시 \d+건 · 미기록 \d+건/)).toBeInViewport()
  await capture(page, 'operations-scenario-desktop.png', 1440, 900, '실제 162개 행정동 고정 운영 예시와 세션·예시·미기록 출처')
  await expect(page.getByText(MODEL_LABEL)).toBeVisible()
  await page.getByText(MODEL_LABEL).scrollIntoViewIfNeeded()
  await expect(operationsPanel).toBeInViewport()
  await expect(page.getByText(MODEL_LABEL)).toBeInViewport()
  await capture(page, 'operations-overlay-desktop.png', 1440, 900, '실제 156구역 연락업무 모드와 투명한 구조 맥락')
  await audit(page, 'operations-overlay-desktop')

  const operationsText = await page.locator('main.ops-page').innerText()
  expect(operationsText).not.toContain('합성')
  expect(operationsText).toContain('급성도')
  expect(operationsText).toContain('취약도')
  expect(operationsText).toContain(MODEL_LABEL)
  for (const forbidden of ['종합점수', '종합 점수', '합산점수', '합산 점수', '통합 점수', '전체 점수']) {
    expect(operationsText).not.toContain(forbidden)
  }
  await operations.close()

  const stateMeasurements = await Promise.all([
    captureExplicitState(browser, 'empty'),
    captureExplicitState(browser, 'loading'),
    captureExplicitState(browser, 'error'),
  ])
  await createCombinedStateProof(browser)

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  expect(pageErrors, pageErrors.join('\n')).toEqual([])
  const axeSeriousCritical = axeResults.flatMap(({ violations }) =>
    violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).length
  expect(axeSeriousCritical).toBe(0)

  const allMobileMeasurements = [mobileMeasurements, ...stateMeasurements]
  const minBodyFontPx = Math.min(...allMobileMeasurements.map(({ minFont }) => minFont))
  const minTargetWidthPx = Math.min(...allMobileMeasurements.map(({ minTargetWidth }) => minTargetWidth))
  const minTargetHeightPx = Math.min(...allMobileMeasurements.map(({ minTargetHeight }) => minTargetHeight))
  const horizontalOverflowPx = Math.max(...allMobileMeasurements.map(({ horizontalOverflow }) => horizontalOverflow))

  await writeFile(EVIDENCE_PATH, `${JSON.stringify({
    schemaVersion: 1,
    generatedBy: 'e2e/p8-demo-hardening.spec.ts',
    productionLike: true,
    screenshots,
    checks: {
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
      axeSeriousCritical,
      minBodyFontPx,
      minTargetWidthPx,
      minTargetHeightPx,
      horizontalOverflowPx,
      syntheticPresentationAbsent: !operationsText.includes('합성'),
      separateAxes: true,
      mixedSnapshotWarning: true,
      modelOutputLabel: true,
      compositeScoreAbsent: true,
    },
    harnessedStates: ['empty-mobile', 'loading-mobile', 'error-mobile', 'empty-loading-error-mobile'],
  }, null, 2)}\n`)
})
