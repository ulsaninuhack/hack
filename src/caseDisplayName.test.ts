import { describe, expect, it } from 'vitest'
import { caseDisplayName } from './caseDisplayName'

describe('caseDisplayName', () => {
  it('matches the backend deterministic display-name contract', () => {
    expect(caseDisplayName('SYN-HH-2812551000-0001')).toBe('김영자')
    expect(caseDisplayName('SYN-HH-2812551000-0002')).toBe('이순자')
    expect(caseDisplayName('SYN-HH-2812551000-0050')).toBe('임영철')
  })

  it('does not expose malformed identifiers as names', () => {
    expect(() => caseDisplayName('CASE-0001')).toThrow(/case ID/)
  })
})
