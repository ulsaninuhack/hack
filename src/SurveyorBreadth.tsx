import { useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { CaseDetail, QueueItem } from './contactOpsClient'
import {
  buildSurveyorTaskViews,
  summarizeSurveyorDay,
} from './SurveyorBreadthModel'
import './SurveyorBreadth.css'

export { summarizeSurveyorDay } from './SurveyorBreadthModel'

export interface SurveyorBreadthProps {
  /** Ordered result from GET /contact-ops/today. */
  items: readonly QueueItem[]
  /** Case projections already loaded through GET /contact-ops/cases/:caseId. */
  details: readonly CaseDetail[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (caseId: string) => void
  onRetry: () => void
}

const minimumTarget = { minHeight: '48px', minWidth: '48px' }

export function SurveyorBreadth({
  items,
  details,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
}: SurveyorBreadthProps) {
  const taskViews = useMemo(() => buildSurveyorTaskViews(items, details), [details, items])
  const summary = useMemo(() => summarizeSurveyorDay(items, details), [details, items])
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.currentTarget.blur()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? taskViews.length - 1
        : event.key === 'ArrowDown' ? Math.min(index + 1, taskViews.length - 1)
          : Math.max(index - 1, 0)
    const next = taskViews[nextIndex]
    if (!next) return
    onSelect(next.item.household_id)
    optionRefs.current.get(next.item.household_id)?.focus()
  }

  return (
    <section
      className="surveyor-breadth"
      aria-label="[합성] 오늘 연락업무 요약과 목록"
    >
      <header className="surveyor-breadth__header">
        <span className="surveyor-breadth__marker">[합성]</span>
        <div>
          <h2>오늘 연락업무</h2>
          <p>합성 연락업무 데모 · 실제 주민, 실제 업무, 개인 판정이 아닙니다.</p>
        </div>
      </header>

      {error ? (
        <div className="surveyor-breadth__state" role="alert">
          <strong>합성 연락업무를 불러오지 못했습니다.</strong>
          <p>연결 상태를 확인한 뒤 다시 불러와 주세요.</p>
          <button type="button" style={minimumTarget} onClick={onRetry}>다시 불러오기</button>
        </div>
      ) : loading && items.length === 0 ? (
        <p className="surveyor-breadth__state" role="status" aria-live="polite">
          합성 연락업무를 불러오는 중입니다.
        </p>
      ) : items.length === 0 ? (
        <p className="surveyor-breadth__state" role="status">
          오늘 예정된 합성 연락업무가 없습니다.
        </p>
      ) : (
        <>
          <section className="surveyor-breadth__summary" aria-label="오늘 합성 연락업무 요약">
            <strong>오늘 연락업무 {summary.total}건</strong>
            <dl>
              <div><dt>연속 미응답</dt><dd>{summary.repeatedNoAnswer}건</dd></div>
              <div><dt>기한 지남</dt><dd>{summary.overdue}건</dd></div>
              <div><dt>이관 권고</dt><dd>{summary.transferRecommended}건</dd></div>
            </dl>
          </section>

          <div
            className="surveyor-breadth__list"
            role="listbox"
            aria-label="오늘 합성 연락업무 목록"
            aria-busy={loading}
          >
            {taskViews.map((task, index) => {
              const selected = task.item.household_id === selectedId
              return (
                <button
                  key={task.item.household_id}
                  ref={(element) => {
                    if (element) optionRefs.current.set(task.item.household_id, element)
                    else optionRefs.current.delete(task.item.household_id)
                  }}
                  className={selected
                    ? 'surveyor-breadth__task surveyor-breadth__task--selected'
                    : 'surveyor-breadth__task'}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected || (!selectedId && index === 0) ? 0 : -1}
                  style={minimumTarget}
                  onClick={() => onSelect(task.item.household_id)}
                  onKeyDown={(event) => moveSelection(event, index)}
                >
                  <span className="surveyor-breadth__case">[합성] {task.item.household_id}</span>
                  <span className="surveyor-breadth__axes">
                    <b>급성도 {task.item.triage.급성도_점수}</b>
                    <b>취약도 {task.item.triage.취약도_점수}</b>
                  </span>
                  <span className="surveyor-breadth__badges" aria-label="연락업무 상태">
                    {task.repeatedNoAnswerCount !== null && (
                      <span>연속 미응답 {task.repeatedNoAnswerCount}회</span>
                    )}
                    {task.overdue && <span>후속조치 기한 지남</span>}
                    {task.transferRecommended && <span>행정복지센터 이관 권고</span>}
                    {task.repeatedNoAnswerCount === null && !task.overdue && !task.transferRecommended && (
                      <span>예정된 안부 확인</span>
                    )}
                  </span>
                  <small>
                    {task.item.preferred_contact_method === 'phone' ? '전화 안부 확인' : '방문 선호 기록'}
                  </small>
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
