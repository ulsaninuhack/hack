import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
} from 'livekit-client'

import { exchangeRealtimeSdp } from './liveCallClient'
import {
  captionRoleFromIdentity,
  type LiveCallRole,
  type LiveCaption,
} from './liveCallTranscript'

const CAPTION_TOPIC = 'care-live-caption-v1'
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/
const MAX_CAPTION_TEXT = 4_000
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const SERVER_VAD_DRAIN_GRACE_MS = 900

interface CaptionPacket {
  version: 1
  item_id: string
  text: string
  final: boolean
  sent_at: number
}

export interface RealtimeTurnState {
  speechActive: boolean
  awaitingCommit: boolean
  pendingItemIds: Set<string>
}

export function updateRealtimeTurnState(
  state: RealtimeTurnState,
  event: { type?: unknown; item_id?: unknown; [key: string]: unknown },
): RealtimeTurnState {
  if (event.type === 'input_audio_buffer.speech_started') {
    return { ...state, speechActive: true }
  }
  if (event.type === 'input_audio_buffer.speech_stopped') {
    return { ...state, speechActive: false, awaitingCommit: true }
  }
  if (event.type === 'input_audio_buffer.committed'
      && typeof event.item_id === 'string' && ITEM_ID_PATTERN.test(event.item_id)) {
    const pendingItemIds = new Set(state.pendingItemIds)
    pendingItemIds.add(event.item_id)
    return { speechActive: false, awaitingCommit: false, pendingItemIds }
  }
  if ((event.type === 'conversation.item.input_audio_transcription.completed'
      || event.type === 'conversation.item.input_audio_transcription.failed')
      && typeof event.item_id === 'string' && ITEM_ID_PATTERN.test(event.item_id)) {
    const pendingItemIds = new Set(state.pendingItemIds)
    pendingItemIds.delete(event.item_id)
    return { ...state, pendingItemIds }
  }
  return state
}

export interface LiveCallSessionInput {
  serverUrl: string
  participantToken: string
  expectedRole: LiveCallRole
  onCaption: (caption: LiveCaption) => void
  onParticipantCount?: (count: number) => void
  audioContainer?: HTMLElement | null
}

export interface LiveCallSession {
  roomName: string
  localRole: LiveCallRole
  setMuted: (muted: boolean) => Promise<void>
  finish: () => Promise<void>
  disconnect: () => Promise<void>
}

function realtimeEventText(value: Record<string, unknown>): { text: string; final: boolean } | null {
  if (value.type === 'conversation.item.input_audio_transcription.delta') {
    return typeof value.delta === 'string' ? { text: value.delta, final: false } : null
  }
  if (value.type === 'conversation.item.input_audio_transcription.completed') {
    return typeof value.transcript === 'string' ? { text: value.transcript, final: true } : null
  }
  return null
}

export function coalesceRealtimeCaption(previous: string, caption: LiveCaption): {
  caption: LiveCaption
  accumulated: string
} {
  if (caption.final) return { caption: { ...caption, text: caption.text.trim() }, accumulated: '' }
  const accumulated = `${previous}${caption.text}`.slice(0, MAX_CAPTION_TEXT)
  return { caption: { ...caption, text: accumulated.trim() }, accumulated }
}

export function parseRealtimeTranscriptEvent(
  raw: string,
  role: LiveCallRole,
  receivedAt: number = Date.now(),
): LiveCaption | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const content = realtimeEventText(value)
    const itemId = value.item_id
    const rawText = content?.text ?? ''
    const text = content?.final ? rawText.trim() : rawText
    if (!content || typeof itemId !== 'string' || !ITEM_ID_PATTERN.test(itemId)
        || text.trim().length === 0 || text.length > MAX_CAPTION_TEXT) return null
    return { itemId, role, text, final: content.final, receivedAt }
  } catch {
    return null
  }
}

export function parseRemoteCaptionPacket(
  payload: Uint8Array,
  participantIdentity: string,
  receivedAt: number = Date.now(),
): LiveCaption | null {
  const role = captionRoleFromIdentity(participantIdentity)
  if (!role || payload.byteLength > 8_192) return null
  try {
    const value = JSON.parse(decoder.decode(payload)) as Partial<CaptionPacket>
    const text = typeof value.text === 'string' ? value.text.trim() : ''
    if (value.version !== 1 || typeof value.item_id !== 'string' || !ITEM_ID_PATTERN.test(value.item_id)
        || typeof value.final !== 'boolean' || text.length === 0 || text.length > MAX_CAPTION_TEXT) return null
    const sentAt = typeof value.sent_at === 'number' && Number.isFinite(value.sent_at)
      ? value.sent_at
      : receivedAt
    return { itemId: value.item_id, role, text, final: value.final, receivedAt: sentAt }
  } catch {
    return null
  }
}

function packetFor(caption: LiveCaption) {
  const packet: CaptionPacket = {
    version: 1,
    item_id: caption.itemId,
    text: caption.text,
    final: caption.final,
    sent_at: caption.receivedAt,
  }
  return encoder.encode(JSON.stringify(packet))
}

function attachRemoteAudio(track: RemoteTrack, container?: HTMLElement | null): HTMLMediaElement | null {
  if (track.kind !== Track.Kind.Audio) return null
  const element = track.attach() as HTMLMediaElement
  element.autoplay = true
  element.setAttribute('playsinline', '')
  element.dataset.liveCallAudio = 'true'
  element.hidden = true
  ;(container ?? document.body).append(element)
  return element
}

async function startOpenAiTranscription({
  publication,
  participantToken,
  localRole,
  onCaption,
  room,
}: {
  publication: LocalTrackPublication
  participantToken: string
  localRole: LiveCallRole
  onCaption: (caption: LiveCaption) => void
  room: Room
}) {
  const sourceTrack = publication.track?.mediaStreamTrack
  if (!sourceTrack) throw new Error('마이크 입력을 시작하지 못했습니다.')
  const transcriptionTrack = sourceTrack.clone()
  const peer = new RTCPeerConnection()
  peer.addTrack(transcriptionTrack, new MediaStream([transcriptionTrack]))
  const dataChannel = peer.createDataChannel('oai-events')
  const interimByItem = new Map<string, string>()
  let turnState: RealtimeTurnState = {
    speechActive: false,
    awaitingCommit: false,
    pendingItemIds: new Set(),
  }
  let transcriptionError: Error | null = null
  const drainWaiters: Array<{ resolve: () => void; reject: (cause: Error) => void; timer: number }> = []
  const isDrained = () => !turnState.speechActive
    && !turnState.awaitingCommit
    && turnState.pendingItemIds.size === 0
  const settleDrainWaiters = () => {
    if (!transcriptionError && !isDrained()) return
    for (const waiter of drainWaiters.splice(0)) {
      window.clearTimeout(waiter.timer)
      if (transcriptionError) waiter.reject(transcriptionError)
      else waiter.resolve()
    }
  }
  dataChannel.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    try {
      const value = JSON.parse(event.data) as { type?: string; item_id?: string }
      turnState = updateRealtimeTurnState(turnState, value)
      if (value.type === 'error' || value.type === 'conversation.item.input_audio_transcription.failed') {
        transcriptionError = new Error('실시간 자막의 발화를 확정하지 못했습니다.')
      }
      settleDrainWaiters()
    } catch {
      return
    }
    const parsed = parseRealtimeTranscriptEvent(event.data, localRole)
    if (!parsed) return
    const merged = coalesceRealtimeCaption(interimByItem.get(parsed.itemId) ?? '', parsed)
    if (parsed.final) interimByItem.delete(parsed.itemId)
    else interimByItem.set(parsed.itemId, merged.accumulated)
    onCaption(merged.caption)
    void room.localParticipant.publishData(packetFor(merged.caption), {
      reliable: merged.caption.final,
      topic: CAPTION_TOPIC,
    }).catch(() => {
      // 자막 전달 실패는 통화 오디오를 끊지 않는다. 로컬 자막은 계속 표시한다.
    })
  }
  try {
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    if (!offer.sdp) throw new Error('실시간 자막 연결 정보를 만들지 못했습니다.')
    const answerSdp = await exchangeRealtimeSdp({ participantToken, sdp: offer.sdp })
    await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp })

    if (dataChannel.readyState !== 'open') {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('실시간 자막 채널 연결 시간이 초과되었습니다.')), 8_000)
        dataChannel.addEventListener('open', () => {
          window.clearTimeout(timer)
          resolve()
        }, { once: true })
      })
    }
  } catch (cause) {
    dataChannel.close()
    peer.close()
    transcriptionTrack.stop()
    throw cause
  }

  const waitUntilDrained = () => {
    if (transcriptionError) return Promise.reject(transcriptionError)
    if (isDrained()) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const index = drainWaiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) drainWaiters.splice(index, 1)
        reject(new Error('실시간 자막 확정 시간이 초과되었습니다.'))
      }, 12_000)
      drainWaiters.push({ resolve, reject, timer })
    })
  }

  return {
    async setMuted(muted: boolean) {
      sourceTrack.enabled = !muted
      transcriptionTrack.enabled = !muted
      if (muted) await publication.mute()
      else await publication.unmute()
    },
    async finish() {
      sourceTrack.enabled = false
      transcriptionTrack.enabled = false
      await publication.mute().catch(() => {
        // 통화방 음소거 실패로 이미 확정된 자막을 잃지 않는다.
      })
      await new Promise((resolve) => window.setTimeout(resolve, SERVER_VAD_DRAIN_GRACE_MS))
      await waitUntilDrained()
    },
    close() {
      transcriptionError = new Error('실시간 자막 연결이 종료되었습니다.')
      for (const waiter of drainWaiters.splice(0)) {
        window.clearTimeout(waiter.timer)
        waiter.reject(transcriptionError)
      }
      dataChannel.close()
      peer.close()
      transcriptionTrack.stop()
    },
  }
}

export async function connectLiveCallSession(input: LiveCallSessionInput): Promise<LiveCallSession> {
  const room = new Room({ adaptiveStream: true, dynacast: true })
  const attachedAudio = new Set<HTMLMediaElement>()
  const participantCount = () => input.onParticipantCount?.(1 + room.remoteParticipants.size)
  room.on(RoomEvent.TrackSubscribed, (track) => {
    const element = attachRemoteAudio(track, input.audioContainer)
    if (element) attachedAudio.add(element)
  })
  room.on(RoomEvent.DataReceived, (payload, participant: RemoteParticipant | undefined, _kind, topic) => {
    if (topic !== CAPTION_TOPIC || !participant) return
    const caption = parseRemoteCaptionPacket(payload, participant.identity)
    if (caption) input.onCaption(caption)
  })
  room.on(RoomEvent.ParticipantConnected, participantCount)
  room.on(RoomEvent.ParticipantDisconnected, participantCount)

  await room.connect(input.serverUrl, input.participantToken, { autoSubscribe: true })
  const localRole = captionRoleFromIdentity(room.localParticipant.identity)
  if (!localRole || localRole !== input.expectedRole) {
    await room.disconnect()
    throw new Error('통화 참여 역할을 확인하지 못했습니다.')
  }
  let transcription: Awaited<ReturnType<typeof startOpenAiTranscription>>
  try {
    await room.startAudio()
    const publication = await room.localParticipant.setMicrophoneEnabled(true, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
    if (!publication) throw new Error('마이크 권한을 확인해 주세요.')
    transcription = await startOpenAiTranscription({
      publication,
      participantToken: input.participantToken,
      localRole,
      onCaption: input.onCaption,
      room,
    })
  } catch (cause) {
    for (const element of attachedAudio) element.remove()
    attachedAudio.clear()
    await room.disconnect()
    throw cause
  }
  participantCount()

  let closed = false
  return {
    roomName: room.name,
    localRole,
    async setMuted(muted) {
      if (closed) return
      await transcription.setMuted(muted)
    },
    async finish() {
      if (closed) return
      await transcription.finish()
    },
    async disconnect() {
      if (closed) return
      closed = true
      transcription.close()
      for (const element of attachedAudio) element.remove()
      attachedAudio.clear()
      await room.disconnect()
    },
  }
}

export { CAPTION_TOPIC }
