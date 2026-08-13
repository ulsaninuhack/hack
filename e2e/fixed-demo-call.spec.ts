import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const CASE_NAME = '김영자 어르신'
const SCREENSHOT_DIR = 'artifacts/screenshots'

test('resident can prepare the fixed demo room before the surveyor without QR or URL credentials', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => {
    sessionStorage.setItem('care-ops-demo-session-id', 'fixed-demo-call-e2e-session')
  })
  const guestPage = await context.newPage()
  const hostPage = await context.newPage()
  let hostOpened = false
  const requestUrls: string[] = []

  await guestPage.route('**/api/v1/contact-ops/live-calls/demo', async (route) => {
    requestUrls.push(route.request().url())
    expect(route.request().method()).toBe('POST')
    expect(route.request().postData()).toBeNull()
    expect(hostOpened).toBe(false)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        apiVersion: 'v1',
        data: {
          provider: 'livekit',
          call_id: 'demo-stage',
          server_url: 'wss://example.livekit.cloud',
          expires_at: '2030-08-13T12:00:00.000Z',
          participant: { role: 'resident', participant_token: 'guest.token.signature' },
        },
      }),
    })
  })

  await hostPage.route('**/api/v1/contact-ops/cases/*/live-calls', async (route) => {
    requestUrls.push(route.request().url())
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ demo_entry: true })
    hostOpened = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        apiVersion: 'v1',
        data: {
          provider: 'livekit',
          call_id: 'demo-stage',
          room_name: 'care-call-demo-stage',
          server_url: 'wss://example.livekit.cloud',
          expires_at: '2030-08-13T12:00:00.000Z',
          transcription: { provider: 'openai', model: 'gpt-live-transcribe', language: 'ko' },
          host: { role: 'surveyor', participant_token: 'host.token.signature' },
          guest: { role: 'resident', invite_code: 'invitecode0123456789abcdef012345' },
        },
      }),
    })
  })

  await guestPage.goto('/call/demo')
  await expect(guestPage).toHaveURL(/\/call\/demo$/)
  await expect(guestPage.getByRole('button', { name: '통화 연결' })).toBeVisible()
  await expect(guestPage.locator('body')).not.toContainText('guest.token.signature')
  await guestPage.screenshot({ path: `${SCREENSHOT_DIR}/fixed-demo-call-guest-prepared.png` })

  await hostPage.goto('/m')
  await hostPage.getByRole('button', { name: new RegExp(CASE_NAME) }).click()
  await hostPage.getByRole('button', { name: '실시간 통화 시작' }).click()
  await expect(hostPage.getByRole('heading', { name: '시연 고정 입장 주소' })).toBeVisible()
  await expect(hostPage.getByText(/\/call\/demo$/)).toBeVisible()
  await expect(hostPage.getByRole('img', { name: /QR 코드/ })).toHaveCount(0)
  await hostPage.screenshot({ path: `${SCREENSHOT_DIR}/fixed-demo-call-host.png` })

  await expect(guestPage.getByRole('button', { name: '통화 연결' })).toBeVisible()
  await expect(guestPage.locator('body')).not.toContainText('guest.token.signature')
  await expect(guestPage).toHaveURL(/\/call\/demo$/)
  await guestPage.screenshot({ path: `${SCREENSHOT_DIR}/fixed-demo-call-ready.png` })

  for (const rawUrl of requestUrls) {
    const url = new URL(rawUrl)
    expect(url.search).toBe('')
    expect(rawUrl).not.toContain('token')
    expect(rawUrl).not.toContain('invite')
  }
  const axe = await new AxeBuilder({ page: guestPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(axe.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  expect(await guestPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)

  await context.close()
})
