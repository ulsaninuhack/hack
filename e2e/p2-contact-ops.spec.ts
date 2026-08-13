import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const CASE_ID = 'SYN-HH-2812551000-0001'
const CASE_NAME = '김영자 어르신'
const API_ORIGIN = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:18082'
const SCREENSHOT_DIR = 'artifacts/screenshots'

async function expectNoSeriousAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blockers = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
  expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([])
}

async function expectMobileMeasurements(page: Page) {
  const measurements = await page.evaluate(() => {
    const textSelector = [
      '.ops-page p', '.ops-page label', '.ops-page button', '.ops-page select',
      '.ops-page textarea', '.ops-page a', '.ops-page span', '.ops-page small',
      '.ops-page b', '.ops-page details',
    ].join(',')
    const fontSizes = [...document.querySelectorAll<HTMLElement>(textSelector)]
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      .filter(Number.isFinite)
    const targetFailures = [...document.querySelectorAll<HTMLElement>(
      '.ops-page button,.ops-page input,.ops-page select,.ops-page textarea,.ops-page a',
    )].flatMap((element) => {
      const bounds = element.getBoundingClientRect()
      const labelBounds = element.closest('label')?.getBoundingClientRect()
      const elementPasses = bounds.width >= 48 && bounds.height >= 48
      const labelPasses = Boolean(labelBounds && labelBounds.width >= 48 && labelBounds.height >= 48)
      return elementPasses || labelPasses ? [] : [{
        tag: element.tagName,
        width: bounds.width,
        height: bounds.height,
      }]
    })
    return {
      minFont: Math.min(...fontSizes),
      targetFailures,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      gridColumns: getComputedStyle(document.querySelector<HTMLElement>('.ops-mobile-flow')!).gridTemplateColumns,
    }
  })
  expect(measurements.minFont).toBeGreaterThanOrEqual(18)
  expect(measurements.targetFailures).toEqual([])
  expect(measurements.horizontalOverflow).toBe(0)
  expect(measurements.gridColumns.split(' ')).toHaveLength(1)
}

test('surveyor contact raises a recommendation and only a manager can approve it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const isolatedSessionId = `p2-playwright-${process.pid}-${Date.now()}`
  await context.addInitScript((sessionId) => {
    sessionStorage.setItem('care-ops-demo-session-id', sessionId)
  }, isolatedSessionId)
  const page = await context.newPage()
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const mutationPaths: string[] = []
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
    consoleErrors.push(text)
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    if (request.method() === 'POST') mutationPaths.push(new URL(request.url()).pathname)
  })

  await page.goto('/ops/surveyor')
  const queue = page.getByRole('listbox', { name: '오늘 연락업무 목록' })
  await page.screenshot({ path: `${SCREENSHOT_DIR}/surveyor-queue-mobile.png` })

  const target = queue.getByRole('option', { name: new RegExp(CASE_NAME) })
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await page.getByLabel('통화(또는 방문) 결과').selectOption({ label: '미응답' })
  await page.getByLabel('우편물·고지서 적체').check()
  await page.getByLabel('식사 상태').selectOption({ label: '심각' })
  await page.getByRole('button', { name: '통화(또는 방문) 결과 저장' }).click()

  await expect(page.getByText('통화(또는 방문) 결과를 저장하고 연락업무 순서를 다시 계산했습니다.')).toBeVisible()
  await expect(page.locator('.ops-detail')).toContainText('급성도')
  await expect(page.locator('.ops-detail')).toContainText('62')
  await expect(page.locator('.ops-detail')).toContainText('취약도')
  await expect(page.locator('.ops-detail')).toContainText('방문 권고 · 담당자 승인 대기')
  await expect(target).toContainText('급성도 62')
  expect(mutationPaths).toContain(`/api/v1/contact-ops/cases/${CASE_ID}/contact-results`)
  expect(mutationPaths.some((path) => path.endsWith('/visit-decisions'))).toBe(false)

  await page.locator('.ops-detail').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SCREENSHOT_DIR}/surveyor-detail-mobile.png` })
  await page.locator('.ops-form').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SCREENSHOT_DIR}/surveyor-form-mobile.png` })
  await expectMobileMeasurements(page)
  await expectNoSeriousAxeViolations(page)

  await page.reload()
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await expect(page.locator('.ops-detail')).toContainText('62')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/ops/manager')
  const managerTarget = page.getByRole('listbox', { name: '방문 권고 목록' }).getByRole('option')
    .filter({ hasText: CASE_NAME }).filter({ hasText: '급성도 62' }).filter({ hasText: '취약도 37.602737968418836' })
  await expect(managerTarget).toBeVisible()
  await managerTarget.click()
  await expect(page.getByRole('region', { name: '연락업무 위치와 공개 동단위 맥락 지도' }))
    .toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 })
  await page.screenshot({ path: `${SCREENSHOT_DIR}/manager-review-desktop.png` })
  await page.locator('.ops-map-context').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SCREENSHOT_DIR}/manager-map-desktop.png` })
  await expectNoSeriousAxeViolations(page)

  await expect(page.getByLabel('승인된 방문 거리 제한 (km)')).toHaveCount(0)
  await page.getByLabel('방문 권고 승인').check()
  await expect(page.getByLabel('연결단원 배정')).toHaveValue('SYN-W-2812551000-01')
  await page.getByLabel('결정 사유').fill('Playwright 수직 흐름 승인')
  await page.getByRole('button', { name: '방문 권고 승인 기록' }).click()
  await expect(page.getByText('담당자 승인을 기록했습니다.')).toBeVisible()
  await expect(managerTarget).toHaveCount(0)

  expect(mutationPaths.filter((path) => path.endsWith('/visit-decisions'))).toEqual([
    `/api/v1/contact-ops/cases/${CASE_ID}/visit-decisions`,
  ])
  const sessionId = await page.evaluate(() => sessionStorage.getItem('care-ops-demo-session-id'))
  const response = await context.request.get(`${API_ORIGIN}/api/v1/contact-ops/cases/${CASE_ID}`, {
    headers: { 'X-Demo-Session-ID': sessionId! },
  })
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.data.household.workflow.visit_approval_status).toBe('approved')
  expect(body.data.household.approved_visit_constraints).toEqual({
    max_route_distance_km: 2,
    assigned_worker_ids: ['SYN-W-2812551000-01'],
    routing_interpretation: 'approved_visit_only_not_person_risk',
  })
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
  await context.close()
})
