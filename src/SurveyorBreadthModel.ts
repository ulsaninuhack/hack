import type { CaseDetail, QueueItem } from './contactOpsClient'

export interface SurveyorTaskView {
  item: QueueItem
  repeatedNoAnswerCount: number | null
  overdue: boolean
  transferRecommended: boolean
}

export interface SurveyorDaySummary {
  total: number
  repeatedNoAnswer: number
  overdue: number
  transferRecommended: number
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function repeatedNoAnswerCount(detail: CaseDetail | undefined, item: QueueItem) {
  const rawCount = record(detail?.household.contact)?.consecutive_no_answer_count
  if (Number.isInteger(rawCount) && Number(rawCount) >= 2) return Number(rawCount)

  const contribution = item.triage.점수_기여내역.find((entry) => entry.코드 === '연속_미응답')
  const count = contribution?.근거.match(/연속 미응답 (\d+)회/)?.[1]
  return count && Number(count) >= 2 ? Number(count) : null
}

export function buildSurveyorTaskViews(
  items: readonly QueueItem[],
  details: readonly CaseDetail[],
): SurveyorTaskView[] {
  const detailById = new Map(details.map((detail) => [detail.household.id, detail]))
  return items.map((item) => {
    const detail = detailById.get(item.household_id)
    const workflow = record(detail?.household.workflow)
    return {
      item,
      repeatedNoAnswerCount: repeatedNoAnswerCount(detail, item),
      overdue: workflow?.follow_up_status === 'overdue',
      transferRecommended: workflow?.transfer_status === 'recommended',
    }
  })
}

export function summarizeSurveyorDay(
  items: readonly QueueItem[],
  details: readonly CaseDetail[],
): SurveyorDaySummary {
  const taskViews = buildSurveyorTaskViews(items, details)
  return {
    total: taskViews.length,
    repeatedNoAnswer: taskViews.filter((task) => task.repeatedNoAnswerCount !== null).length,
    overdue: taskViews.filter((task) => task.overdue).length,
    transferRecommended: taskViews.filter((task) => task.transferRecommended).length,
  }
}
