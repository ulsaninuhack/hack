const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '전'] as const
const GIVEN_NAME_FIRST = ['철', '영', '민', '정', '성', '미', '동', '은', '준', '선', '상', '지', '현', '태', '경', '재', '수', '혜', '진', '하', '윤', '서', '주', '원', '명', '기', '용', '순', '호', '연'] as const
const GIVEN_NAME_LAST = ['수', '희', '호', '숙', '영', '현', '주', '민', '진', '훈', '미', '태', '경', '은', '재', '선', '준', '혜', '동', '연', '윤', '서', '원', '명', '기', '용', '순', '하', '정', '성'] as const

const CASE_ID_PATTERN = /^.+-(\d{10})-(\d{4})$/
const WORKER_ID_PATTERN = /^SYN-W-\d{10}-(\d{2})$/
const FIXED_PSEUDONYMS: Readonly<Record<string, string>> = {
  '2812551000-0001': '박영희',
  '2812551000-0002': '이민수',
  '2812551000-0003': '김철수',
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Returns a deterministic pseudonym for display while internal requests keep
 * using the stable case ID. The full ID contributes to a large Korean-name
 * combination space so equal local sequence numbers in different dongs do not
 * collapse to the same visible label.
 */
export function caseDisplayName(caseId: string): string {
  const match = CASE_ID_PATTERN.exec(caseId)
  if (!match) return '대상자'

  const fixed = FIXED_PSEUDONYMS[`${match[1]}-${match[2]}`]
  if (fixed) return fixed

  const sequence = Number.parseInt(match[2], 10)
  if (!Number.isInteger(sequence) || sequence < 1) return '대상자'

  const hash = stableHash(caseId)
  const surname = SURNAMES[hash % SURNAMES.length]
  const first = GIVEN_NAME_FIRST[Math.floor(hash / SURNAMES.length) % GIVEN_NAME_FIRST.length]
  const last = GIVEN_NAME_LAST[Math.floor(hash / (SURNAMES.length * GIVEN_NAME_FIRST.length)) % GIVEN_NAME_LAST.length]
  return `${surname}${first}${last}`
}

export function workerIdForDong(dongCode: string): string {
  if (!/^\d{10}$/.test(dongCode)) return ''
  return `SYN-W-${dongCode}-01`
}

export function workerDisplayName(workerId: string): string {
  const match = WORKER_ID_PATTERN.exec(workerId)
  if (!match) return '연결단원'
  return `연결단원 ${String(Number.parseInt(match[1], 10)).padStart(3, '0')}`
}

export function demoDisplayCopy(value: string): string {
  return value
    .replace(/\[[^\]]+\]/g, (marker) => marker.includes('합성')
      ? marker.includes('시나리오') ? '데모 예시' : ''
      : marker)
    .replaceAll('합성', '데모')
    .replace(/\s+/g, ' ')
    .trim()
}
