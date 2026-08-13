import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const CASE_ID = 'SYN-HH-2812551000-0001'
const CASE_NAME = '김영자 어르신'
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
    const districtBrief = page.getByLabel('제물포구 구 단위 브리핑')
    await expect(districtBrief).toBeVisible()
    await expect(districtBrief.getByLabel('구 단위 관측 수치')).toContainText('오늘 예정')
    await expect(districtBrief.getByLabel('구조 맥락 비율 지표')).toContainText('노인 인구 비율')
    await expect(page.getByRole('heading', { name: '증원 검토' })).toHaveCount(0)
    await expect(page.getByRole('table')).toHaveCount(0)
    await page.getByRole('button', { name: '구 단위 요약 읽기' }).click()
    // #46이 라벨 칩을 제거했다 — 요약 카드 내용만 검증한다.
    const citySummary = page.getByLabel('제물포구 AI 요약')
    await expect(citySummary).toContainText('관측 집계에서')
    await expect(citySummary).toContainText('운영 부하')
    await expect(citySummary).toContainText('현재 연결단원이 적절하게 배치되어 있습니다')
    await expect(citySummary).not.toContainText('남동구는')
    await expect(citySummary).not.toContainText('부평구는')
    const cityHtml = await page.content()
    expect(cityHtml).not.toMatch(/SYN-HH-/)
    expect(cityHtml).not.toContain('합성')
    expect(cityHtml).not.toContain(['위험', '군'].join(''))
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-city-before-desktop.png` })
  })

  await test.step('동 센터: 전화는 자동 배정, 방문은 명시적 확인으로 처리한다 (INV14)', async () => {
    await page.goto('/center')
    await expect(page.getByRole('heading', { name: /신포동 행정복지센터/ })).toBeVisible()
    const phoneLane = page.getByLabel('전화 레인 할당 제안')
    await expect(phoneLane).toContainText('자동 배정됨')
    // 전화 레인은 5명 단위 페이지네이션 — 골든 케이스가 보일 때까지 넘긴다.
    for (let hop = 0; hop < 10 && (await phoneLane.getByText(CASE_NAME).count()) === 0; hop += 1) {
      await page.getByRole('button', { name: '다음' }).click()
    }
    await expect(phoneLane).toContainText(CASE_NAME)
    expect(mutationPaths.filter((path) => path.endsWith('/assignment-confirmations'))).toEqual([])
    await page.getByRole('tab', { name: /^방문 \d+$/ }).click()
    await expect(page.getByLabel('방문 레인 할당 제안')).not.toContainText(CASE_NAME)
    await expect(page.getByLabel('방문 레인 할당 제안')).toContainText('이 레인에는 오늘 제안이 없습니다.')
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-center-assignment-desktop.png` })
    expect(mutationPaths.filter((path) => path.endsWith('/assignment-confirmations'))).toEqual([])
    await page.getByRole('tab', { name: /^전화 \d+$/ }).click()
  })

  await test.step('조사원이 모바일에서 실시간 통화·수동 체크리스트로 제출한다 (INV14/16)', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/m')
    await expect(page.getByRole('heading', { name: '오늘 할당된 연락 대상' })).toBeVisible()
    await expect(page.getByLabel('오늘 전화 목록')).toContainText(CASE_NAME)
    await page.getByRole('tab', { name: /방문 \d+건/ }).click()
    await expect(page.getByLabel('오늘 방문 목록')).not.toContainText(CASE_NAME)
    await page.getByRole('tab', { name: /전화 \d+건/ }).click()
    // 목록 화면도 폭·터치 타깃을 측정한다(탭이 3개로 늘며 넘친 적이 있다).
    await expectTierMobileMeasurements(page)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-list.png` })

    await page.getByRole('button', { name: new RegExp(CASE_NAME) }).click()
    await expect(page.getByRole('heading', { name: '대상 정보' })).toBeVisible()
    await expect(page.getByRole('button', { name: '실시간 통화 시작' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('[가상]')
    await expect(page.locator('body')).not.toContainText('가상 발신')
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-case.png` })
    expect(await page.locator('body').innerText()).not.toMatch(REAL_PHONE_PATTERN)
    await expect(page.getByText(/인천광역시 제물포구/)).toBeVisible()
    expect(await page.locator('body').innerText()).not.toMatch(/SYN-HH-|합성/)

    await page.getByRole('button', { name: '문답 또는 직접 체크하기' }).click()
    await page.getByRole('button', { name: '직접 체크하기' }).click()
    await expectTierMobileMeasurements(page)
    await expectNoSeriousAxeViolations(page)
    await page.getByLabel('통화(또는 방문) 결과').selectOption({ label: '미응답' })
    await page.getByRole('checkbox', { name: '우편물·고지서 적체' }).check()
    await page.getByLabel('식사 상태').selectOption({ label: '심각' })
    await page.getByLabel('기타사항').fill('문 앞에 우유가 쌓여 있었어요')
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-checklist.png` })
    await page.getByRole('button', { name: '확인하고 제출' }).click()

    await expect(page.getByRole('heading', { name: '동 행정복지센터에 보고됨' })).toBeVisible()
    await expect(page.getByText('방문권고', { exact: true })).toBeVisible()
    await expect(page.locator('.mobile-done-summary')).toContainText('심각도')
    await expect(page.getByLabel('권고 기관 미리보기')).toContainText('보건소·의료 연계')
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-done.png` })
    expect(mutationPaths).toContain(`/api/v1/contact-ops/cases/${CASE_ID}/contact-results`)
  })

  await test.step('동 센터가 보고 카드를 확인하고 방문을 승인한다 (INV6/INV18)', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/center')
    const accordion = page.locator('.report-accordion').filter({ hasText: CASE_NAME })
    await expect(accordion).toBeVisible()
    await accordion.locator(':scope > summary').click()
    const card = page.getByLabel(`${CASE_NAME} 보고 카드`)
    await expect(card).toBeVisible()
    await expect(accordion).toContainText('방문권고')
    await expect(accordion).toContainText('연락 안 됨')
    await expect(card).toContainText('보건소·의료 연계')
    await expect(card).toContainText('현장 확인')
    await expect(card).toContainText('문 앞에 우유가 쌓여 있었어요')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-center-report-desktop.png` })
    await card.getByRole('button', { name: '보고 확인' }).click()
    await expect(card.getByText(/확인함 · 동센터 담당자/)).toBeVisible()

    await card.getByRole('link', { name: '방문 승격 검토' }).click()
    await expect(page).toHaveURL(new RegExp(`/center/visit-review/${CASE_ID}$`))
    await expect(page.getByRole('heading', { name: '방문 승격 검토' })).toBeVisible()
    await expect(page.getByLabel(`${CASE_NAME} 방문 승격 근거`)).toContainText('연속 미응답 2회')
    await expect(page.getByLabel('승인된 방문 거리 제한 (km)')).toHaveCount(0)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-center-visit-review-desktop.png`, fullPage: true })
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

    await page.goto('/center')
    await page.getByRole('tab', { name: /^방문 \d+$/ }).click()
    const approvedVisit = page.getByLabel('방문 레인 할당 제안').locator('li').filter({ hasText: CASE_NAME })
    await expect(approvedVisit).toContainText('심각도 74점 · 방문권고')
    await expect(approvedVisit).toContainText('연속 미응답 2회')
    await expect(approvedVisit).toContainText('+25점')
    await approvedVisit.getByRole('button', { name: '확인' }).click()
    await expect(page.getByText('방문 1건을 확인했습니다. 조사원 방문 목록에 반영됩니다.')).toBeVisible()
    expect(mutationPaths.filter((path) => path.endsWith('/assignment-confirmations'))).toEqual([
      '/api/v1/contact-ops/three-tier/assignment-confirmations',
    ])

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/m')
    await page.getByRole('tab', { name: /방문 \d+건/ }).click()
    await expect(page.getByLabel('오늘 방문 목록')).toContainText(CASE_NAME)
    await expect(page.getByLabel('오늘 방문 목록')).toContainText('심각도 74점 · 방문권고')
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
    const cityHtml = await page.content()
    expect(cityHtml).not.toMatch(/SYN-HH-/)
    expect(cityHtml).not.toContain('합성')
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
    { route: '/m', name: 'mobile', ready: /오늘 할당된 연락 대상/ },
  ]
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const surface of surfaces) {
      await page.goto(surface.route)
      await expect(page.getByRole('heading', { name: surface.ready })).toBeVisible()
      // 카드 등장 애니메이션(최대 0.6s)이 끝난 뒤에 캡처·axe 스캔을 돌려야
      // 반투명 중간 상태가 대비 계산에 섞이지 않는다.
      await page.waitForTimeout(800)
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/p9-${surface.name}-${viewport.width}x${viewport.height}.png`,
        fullPage: viewport.width >= 1440,
      })
      await expectNoSeriousAxeViolations(page)
    }
  }
  await context.close()
})

test('live checklist remains readable in a 390px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setContent(`
    <main class="tier-page mobile-page">
      <section class="live-checklist-preview" aria-label="통화 중 확인할 항목">
        <header><h3>통화 중 확인할 항목</h3></header>
        <ul class="live-candidate-grid">
          <li data-candidate="false"><span aria-hidden="true">—</span><strong>최근 외출</strong><em>미확인</em></li>
          <li data-candidate="true"><span aria-hidden="true">✓</span><strong>식사 상태</strong><em>불량</em></li>
          <li data-candidate="true"><span aria-hidden="true">✓</span><strong>위생 상태</strong><em>불량</em></li>
          <li data-candidate="false"><span aria-hidden="true">—</span><strong>도움 관계망</strong><em>미확인</em></li>
          <li data-candidate="false"><span aria-hidden="true">—</span><strong>건강·마음 어려움</strong><em>미확인</em></li>
          <li data-candidate="true"><span aria-hidden="true">✓</span><strong>공과금 체납</strong><em>체납 있음</em></li>
        </ul>
      </section>
    </main>
  `)
  await page.addStyleTag({ path: 'src/styles.css' })

  const layout = await page.locator('.live-candidate-grid').evaluate((grid) => {
    const gridBounds = grid.getBoundingClientRect()
    return {
      viewportOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cards: [...grid.querySelectorAll('li')].map((card) => {
        const cardBounds = card.getBoundingClientRect()
        const labelBounds = card.querySelector('strong')?.getBoundingClientRect()
        return {
          rightOverflow: cardBounds.right - gridBounds.right,
          height: cardBounds.height,
          labelWidth: labelBounds?.width ?? 0,
          labelHeight: labelBounds?.height ?? 0,
        }
      }),
    }
  })
  expect(layout.viewportOverflow).toBeLessThanOrEqual(0)
  expect(layout.cards).toHaveLength(6)
  for (const card of layout.cards) {
    expect(card.rightOverflow).toBeLessThanOrEqual(1)
    expect(card.height).toBeLessThan(90)
    expect(card.labelWidth).toBeGreaterThan(80)
    expect(card.labelHeight).toBeLessThan(50)
  }
  await page.screenshot({ path: `${SCREENSHOT_DIR}/p9-mobile-live-checklist-390x844.png` })
})
