import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const CASE_ID = 'SYN-HH-2812551000-0001'
const WORKER_ID = 'SYN-W-2812551000-01'
const API_ORIGIN = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:18082'
const SCREENSHOT_DIR = 'artifacts/screenshots'
const REAL_PHONE_PATTERN = /01[16789][-.\s]?\d{3,4}[-.\s]?\d{4}|010[-.\s]?(?!0000)\d{4}[-.\s]?\d{4}/

async function expectNoSeriousAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blockers = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
  expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([])
}

async function expectTierMobileMeasurements(page: Page) {
  const measurements = await page.evaluate(() => {
    const textSelector = [
      '.tier-page p', '.tier-page label', '.tier-page button', '.tier-page select',
      '.tier-page textarea', '.tier-page a', '.tier-page span', '.tier-page small',
      '.tier-page b', '.tier-page summary', '.tier-page li', '.tier-page dt', '.tier-page dd',
    ].join(',')
    const fontSizes = [...document.querySelectorAll<HTMLElement>(textSelector)]
      .filter((element) => element.offsetParent !== null)
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      .filter(Number.isFinite)
    const targetFailures = [...document.querySelectorAll<HTMLElement>(
      '.tier-page button,.tier-page input,.tier-page select,.tier-page textarea,.tier-page a',
    )].filter((element) => element.offsetParent !== null).flatMap((element) => {
      const bounds = element.getBoundingClientRect()
      const labelBounds = element.closest('label')?.getBoundingClientRect()
      const elementPasses = bounds.width >= 48 && bounds.height >= 48
      const labelPasses = Boolean(labelBounds && labelBounds.width >= 48 && labelBounds.height >= 48)
      return elementPasses || labelPasses ? [] : [{
        tag: element.tagName,
        className: element.className,
        width: bounds.width,
        height: bounds.height,
      }]
    })
    return {
      minFont: Math.min(...fontSizes),
      measuredTextCount: fontSizes.length,
      targetFailures,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(measurements.measuredTextCount).toBeGreaterThan(0)
  expect(measurements.minFont).toBeGreaterThanOrEqual(18)
  expect(measurements.targetFailures).toEqual([])
  expect(measurements.horizontalOverflow).toBe(0)
}

test('three-tier golden spine: city → center batch confirm → mobile submit → report → approval → city reflection', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const isolatedSessionId = `p9-three-tier-${process.pid}-${Date.now()}`
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
    if (!externalNoise.some((marker) => text.includes(marker))) consoleErrors.push(text)
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    if (request.method() === 'POST') mutationPaths.push(new URL(request.url()).pathname)
  })

  await test.step('시·구 지도에서 출발한다 (동 단위 롤업만)', async () => {
    await page.goto('/city')
    await expect(page.getByRole('heading', { name: /시·구 배치 브리핑/ })).toBeVisible()
    await page.getByLabel('브리핑할 구 선택').selectOption('제물포구')
    await expect(page.getByLabel('제물포구 구 단위 브리핑')).toBeVisible()
    await expect(page.getByRole('table')).toContainText('부하 순위')
    await expect(page.getByRole('table')).toContainText('구조 순위')
    await page.getByRole('button', { name: '구 단위 요약 읽기' }).click()
    await expect(page.getByText('[AI 생성 · 관측 집계 해석 · 개인 예측 아님]')).toBeVisible()
    await expect(page.getByLabel('제물포구 AI 요약')).toContainText('관측 집계에서')
    const cityHtml = await page.content()
    expect(cityHtml).not.toMatch(/SYN-HH-/)
    expect(cityHtml).not.toContain(['위험', '군'].join(''))
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-city-before-desktop.png` })
  })

  await test.step('동 센터가 오늘 배치안을 명시적으로 확인한다 (INV14)', async () => {
    await page.goto('/center')
    await expect(page.getByRole('heading', { name: /신포동 행정복지센터/ })).toBeVisible()
    await expect(page.getByLabel('전화 레인 할당 제안')).toContainText(CASE_ID)
    expect(mutationPaths.filter((path) => path.endsWith('/assignment-confirmations'))).toEqual([])
    await page.getByRole('tab', { name: /^방문 \d+$/ }).click()
    await expect(page.getByLabel('방문 레인 할당 제안')).not.toContainText(CASE_ID)
    await page.getByRole('tab', { name: /^전화 \d+$/ }).click()
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-center-assignment-desktop.png` })
    await page.getByRole('button', { name: '오늘 배치 일괄 확인' }).click()
    await expect(page.getByText('오늘 배치안을 일괄 확인했습니다.')).toBeVisible()
    await expect(page.getByText('오늘 배치안이 모두 확인되었습니다.')).toBeVisible()
    expect(mutationPaths.filter((path) => path.endsWith('/assignment-confirmations'))).toEqual([
      '/api/v1/contact-ops/three-tier/assignment-confirmations',
    ])
  })

  await test.step('조사원이 모바일에서 가상 전화·수동 체크리스트로 제출한다 (INV14/15/16)', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/m')
    await expect(page.getByRole('heading', { name: /조사원 화면/ })).toBeVisible()
    await expect(page.getByLabel('오늘 전화 목록')).toContainText(CASE_ID)
    await page.getByRole('tab', { name: /방문 \d+건/ }).click()
    await expect(page.getByLabel('오늘 방문 목록')).not.toContainText(CASE_ID)
    await page.getByRole('tab', { name: /전화 \d+건/ }).click()
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-list.png` })

    await page.getByRole('button', { name: new RegExp(CASE_ID) }).click()
    await expect(page.getByRole('heading', { name: '대상 정보' })).toBeVisible()
    const dialButton = page.getByRole('button', { name: /\[가상\] 010-0000-\d{4}/ })
    await expect(dialButton).toBeVisible()
    await dialButton.click()
    const dialOverlay = page.getByRole('dialog', { name: '가상 발신 화면' })
    await expect(dialOverlay).toContainText('실제 전화는 걸리지 않습니다')
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-dial.png` })
    await dialOverlay.getByRole('button', { name: '가상 발신 화면 닫기' }).click()
    expect(await page.locator('body').innerText()).not.toMatch(REAL_PHONE_PATTERN)
    await expect(page.getByText('공공 주거용 건물 주소 참조 · 실제 거주자와 연결되지 않음')).toBeVisible()
    await expect(page.getByText(/인천광역시 제물포구/)).toBeVisible()

    await page.getByRole('button', { name: '직접 체크하기' }).click()
    await expectTierMobileMeasurements(page)
    await expectNoSeriousAxeViolations(page)
    await page.getByLabel('통화 결과').selectOption({ label: '미응답' })
    await page.getByRole('checkbox', { name: '우편물·고지서 적체' }).check()
    await page.getByLabel('식사 상태').selectOption({ label: '심각' })
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-checklist.png` })
    await page.getByRole('button', { name: '확인하고 제출' }).click()

    await expect(page.getByRole('heading', { name: '동 행정복지센터에 보고됨' })).toBeVisible()
    await expect(page.getByText('방문권고', { exact: true })).toBeVisible()
    await expect(page.locator('.mobile-done-summary')).toContainText('62')
    await expect(page.getByLabel('권고 기관 미리보기')).toContainText('보건소·의료 연계')
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-done.png` })
    expect(mutationPaths).toContain(`/api/v1/contact-ops/cases/${CASE_ID}/contact-results`)
  })

  await test.step('동 센터가 보고 카드를 확인하고 방문을 승인한다 (INV6/INV18)', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/center')
    const card = page.getByLabel(`${CASE_ID} 보고 카드`)
    await expect(card).toBeVisible()
    await expect(card).toContainText('방문권고')
    await expect(card).toContainText('연락 안 됨')
    await expect(card).toContainText('보건소·의료 연계')
    await expect(card).toContainText('현장 확인')
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-center-report-desktop.png` })
    await card.getByRole('button', { name: '보고 확인' }).click()
    await expect(card.getByText(/확인함 · 동센터 담당자/)).toBeVisible()

    const reviewList = page.getByLabel('방문 권고 대기 목록')
    await reviewList.getByRole('button', { name: new RegExp(CASE_ID) }).click()
    await page.getByRole('radio', { name: '방문 권고 승인' }).check()
    await page.getByLabel('결정 사유').fill('3계층 골든 데모 승인')
    await page.getByRole('button', { name: '방문 권고 승인 기록' }).click()
    await expect(page.getByText('방문 권고를 승인했습니다.')).toBeVisible()
    expect(mutationPaths.filter((path) => path.endsWith('/visit-decisions'))).toEqual([
      `/api/v1/contact-ops/cases/${CASE_ID}/visit-decisions`,
    ])

    const response = await context.request.get(`${API_ORIGIN}/api/v1/contact-ops/cases/${CASE_ID}`, {
      headers: { 'X-Demo-Session-ID': isolatedSessionId },
    })
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.data.household.workflow.visit_approval_status).toBe('approved')
    expect(body.data.household.approved_visit_constraints).toEqual({
      max_route_distance_km: 2,
      assigned_worker_ids: [WORKER_ID],
      routing_interpretation: 'approved_visit_only_not_person_risk',
    })
  })

  await test.step('시·구 화면과 집계가 승인 결과를 반영한다 (INV17 유지)', async () => {
    const aggregates = await context.request.get(
      `${API_ORIGIN}/api/v1/contact-ops/three-tier/district-aggregates?referenceDate=2026-08-12`,
      { headers: { 'X-Demo-Session-ID': isolatedSessionId } },
    )
    expect(aggregates.ok()).toBe(true)
    const aggregatesBody = await aggregates.json()
    expect(JSON.stringify(aggregatesBody)).not.toMatch(/SYN-HH-/)
    const jemulpo = aggregatesBody.data.districts.find(
      (district: { district: string }) => district.district === '제물포구',
    )
    expect(jemulpo.operations.approved_visit_count).toBe(1)

    const operationsMap = await context.request.get(`${API_ORIGIN}/api/v1/contact-ops/operations-map`, {
      headers: { 'X-Demo-Session-ID': isolatedSessionId },
    })
    expect(operationsMap.ok()).toBe(true)
    const operationsBody = await operationsMap.json()
    const zone = operationsBody.data.zones.find(
      (candidate: { geometry_zone_id: string }) => candidate.geometry_zone_id === 'vworld_sgis_20250630:23010530',
    )
    expect(zone.operations.acute_color_metric).toBe(62)
    expect(zone.operations.acute_metric_source).toBe('session_recorded')

    await page.goto('/city')
    await expect(page.getByRole('heading', { name: /시·구 배치 브리핑/ })).toBeVisible()
    await page.getByLabel('브리핑할 구 선택').selectOption('제물포구')
    await expect(page.getByLabel('제물포구 구 단위 브리핑')).toBeVisible()
    expect(await page.content()).not.toMatch(/SYN-HH-/)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-city-after-desktop.png` })
    await expectNoSeriousAxeViolations(page)
  })

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
  await context.close()
})

test('three-tier screenshot matrix and axe sweep (390×844 · 1440×900)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript((sessionId) => {
    sessionStorage.setItem('care-ops-demo-session-id', sessionId)
  }, `p9-matrix-${process.pid}-${Date.now()}`)
  const page = await context.newPage()
  const surfaces: Array<{ route: string; name: string; ready: RegExp }> = [
    { route: '/city', name: 'city', ready: /시·구 배치 브리핑/ },
    { route: '/center', name: 'center', ready: /행정복지센터/ },
    { route: '/m', name: 'mobile', ready: /조사원 화면/ },
  ]
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const surface of surfaces) {
      await page.goto(surface.route)
      await expect(page.getByRole('heading', { name: surface.ready })).toBeVisible()
      await page.waitForTimeout(400)
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/p9-${surface.name}-${viewport.width}x${viewport.height}.png`,
        fullPage: viewport.width >= 1440,
      })
      await expectNoSeriousAxeViolations(page)
    }
  }
  await context.close()
})
