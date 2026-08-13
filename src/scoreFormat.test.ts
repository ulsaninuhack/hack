import { describe, expect, it } from 'vitest'
import { formatScore } from './scoreFormat'

describe('formatScore', () => {
  it('keeps integers compact and rounds calculated scores to one decimal place', () => {
    expect(formatScore(62)).toBe('62')
    expect(formatScore(37.602737968418836)).toBe('37.6')
  })

  it('uses a caller-provided fallback for unavailable scores', () => {
    expect(formatScore(null)).toBe('–')
    expect(formatScore(undefined, '기록 없음')).toBe('기록 없음')
  })
})
