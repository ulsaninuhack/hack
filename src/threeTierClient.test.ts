import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { displaySeverity, uploadVoiceObservationAudio } from './threeTierClient'

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

describe('displaySeverity (표시용 심각도)', () => {
  it('takes the higher of the two engine scores and traces the lift', () => {
    const result = displaySeverity({ 급성도_점수: 36, 취약도_점수: 87.6 })
    expect(result.점수).toBe(87.6)
    expect(result.등급).toBe('방문권고-우선')
    expect(result.상승_근거).toEqual([{ 근거: '생활 기반 취약', 가산점: 51.6 }])
  })

  it('mirrors the engine grade bands at 75 / 55 / 30', () => {
    expect(displaySeverity({ 급성도_점수: 75 }).등급).toBe('방문권고-우선')
    expect(displaySeverity({ 급성도_점수: 74.9 }).등급).toBe('방문권고')
    expect(displaySeverity({ 급성도_점수: 55 }).등급).toBe('방문권고')
    expect(displaySeverity({ 급성도_점수: 54.9 }).등급).toBe('주시')
    expect(displaySeverity({ 급성도_점수: 30 }).등급).toBe('주시')
    expect(displaySeverity({ 급성도_점수: 29.9 }).등급).toBe('정상')
  })

  it('adds contact-failure points and caps the total at 100', () => {
    expect(displaySeverity({ 급성도_점수: 40, 결과_라벨: '연락(또는 방문) 거부' }).점수).toBe(52)
    expect(displaySeverity({ 급성도_점수: 40, 결과_라벨: '연락처 확인 필요' }).점수).toBe(48)
    expect(displaySeverity({ 급성도_점수: 40, 결과_라벨: '미응답', 연속_미응답: 2 }).점수).toBe(52)
    // 미응답 가산은 3회에서 멈춘다
    expect(displaySeverity({ 급성도_점수: 40, 결과_라벨: '연락 안 됨', 연속_미응답: 9 }).점수).toBe(58)
    expect(displaySeverity({ 급성도_점수: 98, 결과_라벨: '연락 거부' }).점수).toBe(100)
  })

  it('adds nothing for a successful contact and reports no score when unrecorded', () => {
    const ok = displaySeverity({ 급성도_점수: 40, 결과_라벨: '안부 확인 완료' })
    expect(ok.점수).toBe(40)
    expect(ok.상승_근거).toEqual([])
    expect(displaySeverity({ 급성도_점수: null, 취약도_점수: null })).toEqual({ 점수: null, 등급: null, 상승_근거: [] })
  })
})
