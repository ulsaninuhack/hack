import { describe, expect, it } from 'vitest'

import {
  coalesceRealtimeCaption,
  parseRemoteCaptionPacket,
  parseRealtimeTranscriptEvent,
  updateRealtimeTurnState,
} from './liveCallSession'

const encoder = new TextEncoder()

describe('live call transcription events', () => {
  it('maps current OpenAI delta and completion events to one speaker caption item', () => {
    expect(parseRealtimeTranscriptEvent(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'item-1',
      delta: '밥을',
    }), 'resident', 10)).toEqual({
      itemId: 'item-1', role: 'resident', text: '밥을', final: false, receivedAt: 10,
    })
    expect(parseRealtimeTranscriptEvent(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-1',
      transcript: '밥을 안 먹었어요.',
    }), 'resident', 20)).toEqual({
      itemId: 'item-1', role: 'resident', text: '밥을 안 먹었어요.', final: true, receivedAt: 20,
    })
  })

  it('coalesces streamed delta chunks before publishing the interim caption', () => {
    const first = parseRealtimeTranscriptEvent(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta', item_id: 'item-1', delta: '밥을 ',
    }), 'resident', 10)!
    const second = parseRealtimeTranscriptEvent(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta', item_id: 'item-1', delta: '안 먹었어요.',
    }), 'resident', 20)!

    const firstMerged = coalesceRealtimeCaption('', first)
    const secondMerged = coalesceRealtimeCaption(firstMerged.accumulated, second)
    expect(firstMerged.caption.text).toBe('밥을')
    expect(secondMerged.caption.text).toBe('밥을 안 먹었어요.')
  })

  it('tracks server VAD until every committed transcription item completes', () => {
    let state = { speechActive: false, awaitingCommit: false, pendingItemIds: new Set<string>() }
    state = updateRealtimeTurnState(state, { type: 'input_audio_buffer.speech_started' })
    expect(state).toMatchObject({ speechActive: true, awaitingCommit: false })

    state = updateRealtimeTurnState(state, { type: 'input_audio_buffer.speech_stopped' })
    expect(state).toMatchObject({ speechActive: false, awaitingCommit: true })

    state = updateRealtimeTurnState(state, { type: 'input_audio_buffer.committed', item_id: 'item-1' })
    expect(state.awaitingCommit).toBe(false)
    expect([...state.pendingItemIds]).toEqual(['item-1'])

    state = updateRealtimeTurnState(state, {
      type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', transcript: '문장',
    })
    expect(state).toEqual({ speechActive: false, awaitingCommit: false, pendingItemIds: new Set() })
  })

  it('ignores assistant events, errors, blank content, and oversized text', () => {
    for (const event of [
      '{',
      JSON.stringify({ type: 'response.audio_transcript.delta', item_id: 'x', delta: '무시' }),
      JSON.stringify({ type: 'error', error: { message: 'provider detail' } }),
      JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'x', delta: ' ' }),
      JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'x', delta: 'x'.repeat(4_001) }),
    ]) {
      expect(parseRealtimeTranscriptEvent(event, 'surveyor', 1)).toBeNull()
    }
  })

  it('derives the remote speaker role from the signed LiveKit identity, not packet data', () => {
    const payload = encoder.encode(JSON.stringify({
      version: 1,
      item_id: 'turn-2',
      text: '사람을 안 만나요.',
      final: true,
      role: 'surveyor',
      sent_at: 30,
    }))

    expect(parseRemoteCaptionPacket(payload, 'resident-call123', 40)).toEqual({
      itemId: 'turn-2', role: 'resident', text: '사람을 안 만나요.', final: true, receivedAt: 30,
    })
    expect(parseRemoteCaptionPacket(payload, 'unknown-call123', 40)).toBeNull()
  })

  it('rejects malformed remote caption packets', () => {
    for (const payload of [
      encoder.encode('{'),
      encoder.encode(JSON.stringify({ version: 2, item_id: 'x', text: '문장', final: true })),
      encoder.encode(JSON.stringify({ version: 1, item_id: '../x', text: '문장', final: true })),
      encoder.encode(JSON.stringify({ version: 1, item_id: 'x', text: ' ', final: true })),
    ]) {
      expect(parseRemoteCaptionPacket(payload, 'resident-call123', 1)).toBeNull()
    }
  })
})
