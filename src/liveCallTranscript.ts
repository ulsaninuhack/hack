export type LiveCallRole = 'surveyor' | 'resident'

export interface LiveCaption {
  itemId: string
  role: LiveCallRole
  text: string
  final: boolean
  receivedAt: number
}

const MAX_CAPTIONS = 200

export function captionRoleFromIdentity(identity: string): LiveCallRole | null {
  if (/^surveyor-[A-Za-z0-9_-]{3,80}$/.test(identity)) return 'surveyor'
  if (/^resident-[A-Za-z0-9_-]{3,80}$/.test(identity)) return 'resident'
  return null
}

export function appendCaption(captions: LiveCaption[], next: LiveCaption): LiveCaption[] {
  const text = next.text.trim()
  if (!text) return captions
  const normalized = { ...next, text }
  const existingIndex = captions.findIndex((caption) => (
    caption.itemId === normalized.itemId && caption.role === normalized.role
  ))
  if (existingIndex >= 0 && captions[existingIndex].final && !normalized.final) return captions
  const updated = existingIndex >= 0
    ? captions.map((caption, index) => index === existingIndex ? normalized : caption)
    : [...captions, normalized]
  return updated.slice(-MAX_CAPTIONS)
}

export function residentTranscript(captions: LiveCaption[]): string {
  return captions
    .filter((caption) => caption.role === 'resident' && caption.final)
    .sort((left, right) => left.receivedAt - right.receivedAt)
    .map((caption) => caption.text.trim())
    .filter(Boolean)
    .join(' ')
}
