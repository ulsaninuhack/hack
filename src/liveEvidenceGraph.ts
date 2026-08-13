import type { LiveCaption } from './liveCallTranscript'
import type { VoiceCandidate } from './threeTierClient'

export type LiveEvidenceState = 'proposed' | 'clarification_needed'

export interface LiveEvidenceTurn {
  itemId: string
  sequence: number
  text: string
  receivedAt: number
}

export interface LiveEvidenceFact {
  field: string
  label: string
  value: string
  state: LiveEvidenceState
  evidenceItemIds: string[]
}

export interface LiveEvidenceContradiction {
  field: string
  label: string
  evidenceItemIds: string[]
  nextQuestion: string | null
}

export interface LiveEvidenceGraph {
  graphRevision: number
  turns: LiveEvidenceTurn[]
  facts: LiveEvidenceFact[]
  contradictions: LiveEvidenceContradiction[]
}

type CandidateProjection = Pick<VoiceCandidate, 'transcript' | 'observations' | 'critic'>

const MEAL_CUE = /(?:밥|식사|끼니|죽|입맛)/
const MEAL_NONE = /(?:아무\s*것도|한\s*끼도|전혀|아예).{0,16}(?:못\s*먹|안\s*먹|먹지\s*못)/
const MEAL_SOME = /(?:죽|밥|식사|끼니|빵|과일|국|반찬).{0,16}(?:먹|드셨|들었)/
const EXPLICIT_DIFFERENT_DAY_SCOPE = /(?:어제|그제|지난\s*날).{0,80}(?:오늘|오늘\s*아침)/

const FIELD_CUES: Record<string, RegExp> = {
  '관찰_6징후.우편물_고지서_적체': /(?:우편|고지서)/,
  '관찰_6징후.악취_벌레': /(?:악취|냄새|벌레|파리|바퀴)/,
  '관찰_6징후.쓰레기_술병': /(?:쓰레기|술병|빈병)/,
  '관찰_6징후.인기척_없이_TV_불': /(?:인기척|TV|티비|전등|불이\s*켜|불을\s*켜)/,
  '관찰_6징후.외출_없음': /(?:외출|밖에|나가|집에만|누워만)/,
  '관찰_6징후.연락_두절': /(?:연락|전화|통화)/,
  식사상태: MEAL_CUE,
  위생상태: /(?:위생|씻|목욕|세수|빨래)/,
  공과금_2개월_이상_체납: /(?:공과금|전기세|수도세|가스비|체납)/,
  최근_건강_정신_괴로움: /(?:아프|통증|괴롭|힘들|우울|불안|잠을|숨이|가슴|넘어)/,
  관계망_유무: /(?:가족|자녀|이웃|사람|도움|만나)/,
  연락_빈도: /(?:매주|주에|연락|전화|통화)/,
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function analyzedResidentTurns(captions: LiveCaption[], transcript: string): LiveEvidenceTurn[] {
  const analyzedTranscript = normalize(transcript)
  return captions
    .filter((caption) => caption.role === 'resident' && caption.final)
    .sort((left, right) => left.receivedAt - right.receivedAt)
    .filter((caption) => analyzedTranscript.includes(normalize(caption.text)))
    .map((caption, index) => ({
      itemId: caption.itemId,
      sequence: index + 1,
      text: normalize(caption.text),
      receivedAt: caption.receivedAt,
    }))
}

function needsClarification(candidate: CandidateProjection, field: string, label: string): boolean {
  const fieldNames = [field, field.split('.').at(-1) ?? field, label.replaceAll(' ', '')]
  return [...candidate.critic.low_confidence_fields, ...candidate.critic.contradictions]
    .some((entry) => {
      const normalizedEntry = entry.replaceAll(' ', '')
      return fieldNames.some((name) => normalizedEntry.includes(name.replaceAll(' ', '')))
    })
}

function evidenceIds(turns: LiveEvidenceTurn[], field: string): string[] {
  const cue = FIELD_CUES[field]
  if (!cue) return []
  return turns.filter((turn) => cue.test(turn.text)).map((turn) => turn.itemId)
}

function addFact(
  facts: LiveEvidenceFact[],
  turns: LiveEvidenceTurn[],
  candidate: CandidateProjection,
  field: string,
  label: string,
  value: string | null,
) {
  if (value === null) return
  const linked = evidenceIds(turns, field)
  if (linked.length === 0) return
  facts.push({
    field,
    label,
    value,
    state: needsClarification(candidate, field, label) ? 'clarification_needed' : 'proposed',
    evidenceItemIds: linked,
  })
}

function buildFacts(turns: LiveEvidenceTurn[], candidate: CandidateProjection): LiveEvidenceFact[] {
  const facts: LiveEvidenceFact[] = []
  const observations = candidate.observations
  const signFacts: Array<[keyof typeof observations.관찰_6징후, string]> = [
    ['외출_없음', '최근 외출 없음'],
  ]
  for (const [key, label] of signFacts) {
    if (!observations.관찰_6징후[key]) continue
    addFact(facts, turns, candidate, `관찰_6징후.${key}`, label, '후보')
  }
  addFact(facts, turns, candidate, '식사상태', '식사 상태', observations.식사상태)
  addFact(facts, turns, candidate, '위생상태', '위생 상태', observations.위생상태)
  addFact(
    facts,
    turns,
    candidate,
    '공과금_2개월_이상_체납',
    '공과금 체납',
    observations.공과금_2개월_이상_체납 === null
      ? null
      : observations.공과금_2개월_이상_체납 ? '체납 있음' : '체납 없음',
  )
  addFact(
    facts,
    turns,
    candidate,
    '최근_건강_정신_괴로움',
    '건강·마음 어려움',
    observations.최근_건강_정신_괴로움 === null
      ? null
      : observations.최근_건강_정신_괴로움 ? '어려움 있음' : '어려움 없음',
  )
  addFact(facts, turns, candidate, '관계망_유무', '도움 관계망', observations.관계망_유무)
  addFact(facts, turns, candidate, '연락_빈도', '연락 빈도', observations.연락_빈도)
  return facts
}

function buildContradictions(
  turns: LiveEvidenceTurn[],
  candidate: CandidateProjection,
): LiveEvidenceContradiction[] {
  if (!candidate.critic.contradictions.some((entry) => /식사|밥|끼니/.test(entry))) return []
  if (EXPLICIT_DIFFERENT_DAY_SCOPE.test(candidate.transcript)) return []
  const none = turns.find((turn) => MEAL_NONE.test(turn.text))
  const some = turns.find((turn) => turn.itemId !== none?.itemId && MEAL_SOME.test(turn.text))
  if (!none || !some) return []
  return [{
    field: '식사상태',
    label: '식사 정보가 서로 다릅니다',
    evidenceItemIds: [none.itemId, some.itemId],
    nextQuestion: candidate.critic.next_question,
  }]
}

/**
 * Produces a session-local, read-only evidence projection. It never confirms a
 * checklist value and deliberately omits an edge when the analyzed transcript
 * cannot be matched back to a finalized resident turn.
 */
export function buildLiveEvidenceGraph(
  captions: LiveCaption[],
  candidate: CandidateProjection,
): LiveEvidenceGraph {
  const turns = analyzedResidentTurns(captions, candidate.transcript)
  return {
    graphRevision: turns.length,
    turns,
    facts: buildFacts(turns, candidate),
    contradictions: buildContradictions(turns, candidate),
  }
}
