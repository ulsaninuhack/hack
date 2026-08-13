import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadVoiceObservationAudio } from './threeTierClient'

// /m 음성 경로 ①이 백엔드 3b multipart 계약(voice-audio-upload.mjs의
// FIELD_NAMES)과 필드명 수준에서 일치하는지 클라이언트 조립을 직접 검증한다.
describe('uploadVoiceObservationAudio multipart contract', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    sessionStorage.setItem('care-ops-demo-session-id', 'ui-demo-threetierclienttest01')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { synthetic: true, displayMarker: '[합성]', revision: 0, candidate: {} } }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    sessionStorage.clear()
  })

  it('posts the exact 3b field names with the audio file and session header', async () => {
    const file = new File(['RIFFxxxxWAVE'], 'memo.wav', { type: 'audio/wav' })
    await uploadVoiceObservationAudio({ caseId: 'SYN-HH-2812551000-0001', revision: 3, file })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/v1/contact-ops/cases/SYN-HH-2812551000-0001/ai-observations/audio')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Demo-Session-ID']).toBe('ui-demo-threetierclienttest01')

    const body = init.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect([...body.keys()].sort()).toEqual(['audio', 'consent_basis', 'contact_date', 'expected_revision', 'surveyor_id'])
    expect(body.get('expected_revision')).toBe('3')
    expect(body.get('contact_date')).toBe('2026-08-12')
    expect(body.get('surveyor_id')).toBe('연결단원 001')
    expect(body.get('consent_basis')).toBe('verbal_in_recording')
    expect(body.get('audio')).toBeInstanceOf(File)
    expect((body.get('audio') as File).name).toBe('memo.wav')
  })

  it('encodes the case ID into the route path', async () => {
    const file = new File(['ID3xx'], 'memo.mp3', { type: 'audio/mpeg' })
    await uploadVoiceObservationAudio({ caseId: 'SYN-HH-2826051000-0002', revision: 0, file })
    expect(String(fetchMock.mock.calls[0][0])).toContain('SYN-HH-2826051000-0002')
  })
})
