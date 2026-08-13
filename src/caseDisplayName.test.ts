import { describe, expect, it } from 'vitest'
import { caseDisplayName, demoDisplayCopy, workerDisplayName, workerIdForDong } from './caseDisplayName'

describe('caseDisplayName', () => {
  it('turns the reported case ID into a stable Korean pseudonym', () => {
    expect(caseDisplayName('SYN-HH-2812551000-0003')).toBe('김철수')
    expect(caseDisplayName('SYN-HH-2812551000-0003')).toBe('김철수')
  })

  it('gives nearby cases distinct names without exposing their IDs', () => {
    const names = [
      caseDisplayName('SYN-HH-2812551000-0001'),
      caseDisplayName('SYN-HH-2812551000-0002'),
      caseDisplayName('SYN-HH-2812551000-0003'),
    ]

    expect(new Set(names).size).toBe(names.length)
    expect(names.join(' ')).not.toContain('SYN-HH-')
  })

  it('does not reuse a name for the same sequence in another dong', () => {
    expect(caseDisplayName('SYN-HH-2812551000-0001'))
      .not.toBe(caseDisplayName('SYN-HH-2811051000-0001'))
  })

  it('uses a neutral label for an unrecognized identifier', () => {
    expect(caseDisplayName('')).toBe('대상자')
    expect(caseDisplayName('unexpected-id')).toBe('대상자')
  })

  it('normalizes legacy API markers before server copy reaches the screen', () => {
    expect(demoDisplayCopy('[합성] 결정적 합성 시나리오')).toBe('결정적 데모 시나리오')
    expect(demoDisplayCopy('[합성 시나리오]')).toBe('데모 예시')
  })
})

describe('worker display identity', () => {
  it('keeps the internal worker key separate from the visible label', () => {
    const workerId = workerIdForDong('2812551000')
    expect(workerId).toBe('SYN-W-2812551000-01')
    expect(workerDisplayName(workerId)).toBe('연결단원 001')
  })

  it('falls back safely for malformed identifiers', () => {
    expect(workerIdForDong('bad-code')).toBe('')
    expect(workerDisplayName('bad-worker')).toBe('연결단원')
  })
})
