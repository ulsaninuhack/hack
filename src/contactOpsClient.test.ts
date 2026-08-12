import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyObservations, loadTodayQueue, submitContact, submitDecision } from './contactOpsClient'

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear() })

function response(data: unknown) { return new Response(JSON.stringify({ apiVersion: 'v1', data }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }

describe('ContactOps API client', () => {
  it('uses the real today route and sends a stable demo session header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ synthetic: true, displayMarker: '[합성]', items: [] }))
    await loadTodayQueue()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/contact-ops/today?referenceDate=2026-08-12&workerId=SYN-W-2812551000-01', expect.objectContaining({ headers: expect.objectContaining({ 'X-Demo-Session-ID': expect.stringMatching(/^ui-demo-/) }) }))
  })

  it('posts canonical contact and manager decision bodies only to real operation routes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ synthetic: true, displayMarker: '[합성]', revision: 4, household: {}, observations: {}, triage: null }))
      .mockResolvedValueOnce(response({ synthetic: true, displayMarker: '[합성]', revision: 4, household: {}, observations: {}, triage: null }))
    await submitContact({ caseId: 'SYN-HH-2812551000-0001', revision: 3, resultLabel: '미응답', observations: emptyObservations() })
    await submitDecision({ caseId: 'SYN-HH-2812551000-0001', revision: 4, decision: 'approved', note: '합성 사유', workerIds: ['SYN-W-2812551000-01'], distance: 2 })
    expect(fetchMock.mock.calls[0][0]).toContain('/contact-results')
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('no_answer')
    expect(fetchMock.mock.calls[1][0]).toContain('/visit-decisions')
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('max_route_distance_km')
  })
})
