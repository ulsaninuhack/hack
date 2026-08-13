import { describe, expect, it } from 'vitest'

import {
  appendCaption,
  captionRoleFromIdentity,
  residentTranscript,
  type LiveCaption,
} from './liveCallTranscript'

describe('live call speaker and transcript contract', () => {
  it('derives roles only from server-issued participant identities', () => {
    expect(captionRoleFromIdentity('surveyor-call-123')).toBe('surveyor')
    expect(captionRoleFromIdentity('resident-call-123')).toBe('resident')
    expect(captionRoleFromIdentity('agent-call-123')).toBeNull()
    expect(captionRoleFromIdentity('resident')).toBeNull()
  })

  it('replaces interim deltas with one final caption per item', () => {
    const first: LiveCaption = {
      itemId: 'turn-1', role: 'resident', text: '밥을', final: false, receivedAt: 1,
    }
    const interim = appendCaption([], first)
    const final = appendCaption(interim, { ...first, text: '밥을 안 먹었어요.', final: true, receivedAt: 2 })

    expect(final).toEqual([
      { itemId: 'turn-1', role: 'resident', text: '밥을 안 먹었어요.', final: true, receivedAt: 2 },
    ])
  })

  it('builds the AI candidate transcript from finalized resident turns only', () => {
    const captions: LiveCaption[] = [
      { itemId: 's1', role: 'surveyor', text: '오늘 식사는 하셨어요?', final: true, receivedAt: 1 },
      { itemId: 'r1', role: 'resident', text: '이틀째 밥을 안 먹었어요.', final: true, receivedAt: 2 },
      { itemId: 'r2', role: 'resident', text: '사람도 안 만나고 누워만 있어요.', final: true, receivedAt: 3 },
      { itemId: 'r3', role: 'resident', text: '아직 말하는 중', final: false, receivedAt: 4 },
    ]

    expect(residentTranscript(captions)).toBe('이틀째 밥을 안 먹었어요. 사람도 안 만나고 누워만 있어요.')
  })

  it('drops blank captions and caps the in-memory window', () => {
    const many = Array.from({ length: 205 }, (_, index): LiveCaption => ({
      itemId: `turn-${index}`,
      role: index % 2 === 0 ? 'surveyor' : 'resident',
      text: `문장 ${index}`,
      final: true,
      receivedAt: index,
    }))
    const capped = many.reduce(appendCaption, [])
    expect(capped).toHaveLength(200)
    expect(capped[0].itemId).toBe('turn-5')
    expect(appendCaption(capped, { ...many[0], itemId: 'blank', text: '  ' })).toBe(capped)
  })
})
