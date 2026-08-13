import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyObservations, loadManagerBreadth, loadOperationsMap, loadTodayQueue, submitContact, submitDecision } from './contactOpsClient'

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

  it('maps the combined refusal label to the canonical refused result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({ synthetic: true, displayMarker: '[합성]', revision: 4, household: {}, observations: {}, triage: null }),
    )
    await submitContact({
      caseId: 'SYN-HH-2812551000-0001',
      revision: 3,
      resultLabel: '연락(또는 방문) 거부',
      observations: emptyObservations(),
    })
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('"contact_result":"refused"')
  })

  it('loads the server-owned manager breadth projection through the operation API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      synthetic: true, displayMarker: '[합성]', transfer_recommendations: [], grade_distribution: {}, tuning_warning: {}, approved_visit_hint: {},
    }))
    await loadManagerBreadth()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/contact-ops/manager-breadth', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Demo-Session-ID': expect.stringMatching(/^ui-demo-/) }),
    }))
  })

  it('loads the 156-zone operations overlay only from the server-owned operations-map API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      synthetic: true, displayMarker: '[합성]', geometry_zone_count: 156, current_admin_dong_count: 162, public_context_label: '[MODEL OUTPUT — UNVALIDATED]', zones: [],
    }))
    await loadOperationsMap()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/contact-ops/operations-map', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Demo-Session-ID': expect.stringMatching(/^ui-demo-/) }),
    }))
  })
})
