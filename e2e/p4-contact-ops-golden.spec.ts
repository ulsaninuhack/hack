import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

const CASE_ID = 'SYN-HH-2812551000-0001'
const API_ORIGIN = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:18082'
const SESSION_STORAGE_KEY = 'care-ops-demo-session-id'
const PUBLIC_STRUCTURAL_VULNERABILITY = 37.602737968418836

type ContactMutation = {
  path: string
  sourcePath: string
  body: {
    expected_revision: number
    contact_result: string
    observations: {
      관찰_6징후: Record<string, boolean>
      식사상태: string | null
      위생상태: string | null
      공과금_2개월_이상_체납: boolean | null
      최근_건강_정신_괴로움: boolean | null
      관계망_유무: string | null
      연락_빈도: string | null
    }
  }
}

async function readCase(context: BrowserContext, sessionId: string) {
  const response = await context.request.get(
    `${API_ORIGIN}/api/v1/contact-ops/cases/${CASE_ID}`,
    { headers: { 'X-Demo-Session-ID': sessionId } },
  )
  expect(response.ok()).toBe(true)
  const body = await response.json()
  return body.data
}

function trueObservationCount(mutation: ContactMutation) {
  return Object.values(mutation.body.observations.관찰_6징후).filter(Boolean).length
}

async function selectGoldenCase(page: Page) {
  const option = page.getByRole('option', { name: new RegExp(CASE_ID) })
  await option.scrollIntoViewIfNeeded()
  await option.click()
  await expect(page.locator('.ops-detail .case-id')).toContainText(`[합성] ${CASE_ID}`)
}

async function expectSeparatedAxes(page: Page, acute: string) {
  const axes = page.getByRole('region', { name: '분리된 점수 축' }).locator('article')
  await expect(axes).toHaveCount(2)
  await expect(axes.nth(0)).toContainText('급성도')
  await expect(axes.nth(0).locator('strong')).toHaveText(acute)
  await expect(axes.nth(1)).toContainText('취약도')
  await expect(axes.nth(1).locator('strong')).toHaveText(String(PUBLIC_STRUCTURAL_VULNERABILITY))
}

test('P4 golden: two real contact mutations raise acute score before manager-only approval', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const sessionId = `p4-golden-${process.pid}-${Date.now()}`
  await context.addInitScript(({ key, value }) => sessionStorage.setItem(key, value), {
    key: SESSION_STORAGE_KEY,
    value: sessionId,
  })

  const page = await context.newPage()
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const contactMutations: ContactMutation[] = []
  const approvalSources: string[] = []

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
    if (request.method() !== 'POST') return
    const path = new URL(request.url()).pathname
    if (path.endsWith('/contact-results')) {
      contactMutations.push({
        path,
        sourcePath: new URL(page.url()).pathname,
        body: request.postDataJSON(),
      })
    }
    if (path.endsWith('/visit-decisions')) approvalSources.push(new URL(page.url()).pathname)
  })

  await test.step('오늘 연락에서 관찰 없이 첫 미응답을 기록한다', async () => {
    await page.goto('/ops/surveyor')
    await expect(page.locator('main.ops-page')).toContainText('[합성]')
    await selectGoldenCase(page)
    await expect(page.getByRole('button', { name: /방문 권고 (승인|반려) 기록/ })).toHaveCount(0)

    await page.getByLabel('통화 결과').selectOption({ label: '미응답' })
    await page.getByRole('button', { name: '통화 결과 저장' }).click()

    await expect(page.getByText('통화 결과를 저장하고 연락업무 순서를 다시 계산했습니다.')).toBeVisible()
    await expectSeparatedAxes(page, '25')
    await expect(page.locator('.ops-detail')).not.toContainText('방문 권고 · 담당자 승인 대기')

    expect(contactMutations).toHaveLength(1)
    expect(contactMutations[0]).toMatchObject({
      path: `/api/v1/contact-ops/cases/${CASE_ID}/contact-results`,
      sourcePath: '/ops/surveyor',
      body: { expected_revision: 0, contact_result: 'no_answer' },
    })
    expect(trueObservationCount(contactMutations[0])).toBe(0)
    expect(contactMutations[0].body.observations).toMatchObject({
      식사상태: null,
      위생상태: null,
      공과금_2개월_이상_체납: null,
      최근_건강_정신_괴로움: null,
      관계망_유무: null,
      연락_빈도: null,
    })

    const afterFirstNoAnswer = await readCase(context, sessionId)
    expect(afterFirstNoAnswer.revision).toBe(1)
    expect(afterFirstNoAnswer.household.contact.consecutive_no_answer_count).toBe(2)
    expect(afterFirstNoAnswer.triage.급성도_점수).toBe(25)
    expect(afterFirstNoAnswer.household.workflow.visit_approval_status).toBeNull()
  })

  await test.step('후속 실제 mutation에서 관찰 한 개만 추가해 방문 권고로 올린다', async () => {
    await page.getByLabel('통화 결과').selectOption({ label: '미응답' })
    await page.getByLabel('우편물·고지서 적체').check()
    await page.getByRole('button', { name: '통화 결과 저장' }).click()

    await expectSeparatedAxes(page, '57')
    await expect(page.locator('.ops-detail')).toContainText('방문 권고 · 담당자 승인 대기')
    await expect(page.locator('.ops-detail details').first()).toContainText('연속 미응답 3회')
    await expect(page.locator('.ops-detail details').first()).toContainText('관찰 6징후 중 1개 확인')

    expect(contactMutations).toHaveLength(2)
    expect(contactMutations[1]).toMatchObject({
      path: `/api/v1/contact-ops/cases/${CASE_ID}/contact-results`,
      sourcePath: '/ops/surveyor',
      body: { expected_revision: 1, contact_result: 'no_answer' },
    })
    expect(trueObservationCount(contactMutations[1])).toBe(1)
    expect(contactMutations[1].body.observations.관찰_6징후.우편물_고지서_적체).toBe(true)

    const recommended = await readCase(context, sessionId)
    expect(recommended.revision).toBe(2)
    expect(recommended.household.contact.consecutive_no_answer_count).toBe(3)
    expect(recommended.triage.급성도_점수).toBe(57)
    expect(recommended.triage.취약도_점수).toBe(PUBLIC_STRUCTURAL_VULNERABILITY)
    expect(recommended.household.workflow.visit_approval_status).toBe('recommended')
    expect(approvalSources).toEqual([])
  })

  await test.step('브라우저 reload 뒤에도 권고와 분리된 축이 유지된다', async () => {
    await page.reload()
    await expect(page.locator('main.ops-page')).toContainText('[합성]')
    await selectGoldenCase(page)
    await expectSeparatedAxes(page, '57')
    await expect(page.locator('.ops-detail')).toContainText('방문 권고 · 담당자 승인 대기')
    await expect(page.getByRole('button', { name: /방문 권고 (승인|반려) 기록/ })).toHaveCount(0)
    expect(approvalSources).toEqual([])
  })

  await test.step('담당자 화면에서만 승인 transition을 기록한다', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ops/manager')
    await expect(page.locator('main.ops-page')).toContainText('[합성]')
    await expect(page.getByRole('option', { name: new RegExp(`\\[합성\\].*${CASE_ID}`) })).toBeVisible()
    await expectSeparatedAxes(page, '57')

    await page.getByLabel('방문 권고 승인').check()
    await page.getByLabel('결정 사유').fill('P4 합성 골든 경로 담당자 승인')
    await page.getByRole('button', { name: '방문 권고 승인 기록' }).click()

    await expect(page.getByText('담당자 승인을 기록했습니다.')).toBeVisible()
    expect(approvalSources).toEqual(['/ops/manager'])

    const approved = await readCase(context, sessionId)
    expect(approved.revision).toBe(3)
    expect(approved.household.workflow.visit_approval_status).toBe('approved')
    expect(approved.household.workflow.visit_decision.decided_by).toBe('synthetic-manager')
  })

  await test.step('승인 상태도 reload 후 같은 격리 세션에 남는다', async () => {
    await page.reload()
    await expect(page.locator('main.ops-page')).toContainText('[합성]')
    await expect(page.getByText('현재 검토할 방문 권고가 없습니다.')).toBeVisible()
    const approvedAfterReload = await readCase(context, sessionId)
    expect(approvedAfterReload.household.workflow.visit_approval_status).toBe('approved')
  })

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
  await context.close()
})
