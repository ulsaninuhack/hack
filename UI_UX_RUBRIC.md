# Frozen UI/UX Rubric — Care Operations Console

- Version: `1.0.0`
- Freeze time: `2026-08-13 01:20 KST`
- Applies to: public map, `/ops/surveyor`, `/ops/manager`, dialogs, empty/loading/error
  states, screenshots, and preview.

This file is frozen by `overnight-freeze.json`. Machine gates protect measurable rules;
final taste, Korean nuance, and judge readability remain a morning human review.
It extends the already-merged `docs/UI_UX_REVIEW_RUBRIC.md`; where the two differ, the
stricter measurable requirement applies to this overnight branch.

## Audience and task language

The mobile audience is an older neighborhood surveyor using one hand while moving. The
desktop audience is a non-specialist municipal manager who needs guardrails against
accidental approval. Headings name the task:

- `오늘 연락할 대상`
- `통화(또는 방문) 결과 입력`
- `방문 권고 승인`
- `행정복지센터 이관`

Preferred domain terms are `연락업무`, `안부 확인`, `후속조치`, `방문 권고`,
`담당자 승인`, and `행정복지센터 이관`. Operations UI always says `[합성]` and explains
`합성 연락업무 데모 · 실제 주민, 실제 업무, 개인 판정이 아닙니다.`

## Forbidden copy gate

The following marketing or overclaim strings fail when they occur in rendered UI source:

```text
누구나 쉽게
쉽고 간단
스마트한
혁신적
한눈에
간편하게
AI가 해결
원스톱
초간단
고위험자
미수혜자
개인예측
개인 예측
개인 위험
```

Raw domain enums fail when visible: `no_answer`, `connected_ok`,
`connected_concern`, `invalid_contact`, `refused`. The rubric and test fixtures are
excluded from the source-string denylist only so the denylist can be defined and tested.

## Layout gate

- Do not use a marketing hero, three-feature-card pitch, decorative gradient, or emoji
  navigation.
- Mobile is a single task column: queue → detail → result form. The primary action remains
  reachable without horizontal scrolling.
- Manager desktop is a two-column workbench: recommendation queue and selected-case
  decision panel. The map is context, never the only way to select a case.
- Public map layout and MapLibre worker behavior remain stable.
- Empty, loading, error, stale-revision, and unavailable-AI states have explicit Korean
  copy and a recovery action where one exists.

## Mobile measurable gate

At `390×844` CSS pixels:

- normal body/input/help text is at least `18px`; legal/source metadata may be `16px` but
  is never an action label;
- every button, link, input, select, checkbox hit area, tab, and disclosure summary is at
  least `48×48px`;
- no required control depends on hover;
- page and selected panel scroll independently without trapping the body;
- focused controls remain visible above the mobile keyboard-sized viewport;
- no content overflows the viewport horizontally.

## Desktop measurable gate

At `1440×900`:

- action labels are complete Korean phrases, not icons alone;
- English acronyms (`AI`, `LLM`, `VRP`, `P1`, `P2`) are absent from the main operations
  UI or immediately expanded in Korean;
- approval and rejection are visually distinct, require a reason, and show the selected
  synthetic case ID;
- distance and route fields are hidden until approval is selected and never appear for a
  pending recommendation;
- the selected synthetic point is also available through a keyboard-accessible list.

## Accessibility gate

- WCAG 2.2 AA contrast: 4.5:1 for normal text, 3:1 for large text and non-text controls.
- `@axe-core/playwright` reports zero serious or critical violations on public map,
  surveyor, manager, detail, modal, empty, loading, and error states.
- Forms use `fieldset`/`legend`, programmatic labels, `aria-describedby` for errors, and
  a polite live region for results.
- Dialogs trap focus, use Escape, make background inert, and return focus to the opener.
- Queue and search listboxes support arrows, Enter, Escape, visible focus, and an announced
  current selection.
- Map interaction has a list/search alternative; completing the workflow never requires
  manipulating the canvas.
- Motion respects `prefers-reduced-motion`.

## Metric and score presentation gate

- Acute and vulnerability appear in two separate labeled regions with separate
  contribution disclosures. There is no total, composite, combined, overall, or sum UI.
- Acute is the primary ordering/color cue. Vulnerability is secondary and never changes
  the acute grade.
- A visit threshold renders `방문 권고 · 담당자 승인 대기`, not an automatic assignment.
- Public-map P2 always renders the full mixed-snapshot disclosure:
  `분자 2026-07-31 · 분모 2026-06-30 · 서로 다른 기준월의 참고 비율이며 동시점 비율이 아닙니다.`
- P2 detail also includes geometry base date, mapping status, and mapping confidence.
- Structural context 0-50 is labeled `[MODEL OUTPUT — UNVALIDATED]` and shows raw values,
  percentile ranks, contributions, available count, and missing values.
- The manager audit panel says the mild-signal count is a synthetic tuning warning, not a
  person count or outcome.

## AI presentation gate

The UI shows the graph boundary, not a magic response:

1. `발화·메모 후보 구조화`
2. `형식 검사`
3. `모순·누락 확인`
4. `규칙·2축 점수 재계산`
5. `담당자 결정`

Planner candidate fields and Critic flags are editable/reviewable before application.
The screen explicitly says `AI 후보 · 자동 승인 아님`. Failure or timeout falls back to
manual structured input without losing typed text.

## Screenshot matrix

All captures come from a fresh production-like build and are indexed in
`artifacts/screenshots/README.md`:

| ID | Viewport | Required state |
| --- | --- | --- |
| `public-map-desktop` | 1440×900 | public map loaded, P2 disclosure visible |
| `surveyor-queue-mobile` | 390×844 | queue and `[합성]` marker |
| `surveyor-detail-mobile` | 390×844 | separated score axes and contributions |
| `surveyor-form-mobile` | 390×844 | concern fields and validation |
| `manager-review-desktop` | 1440×900 | recommendation and decision guardrail |
| `manager-map-desktop` | 1440×900 | selected synthetic point and list alternative |
| `operations-overlay-desktop` | 1440×900 | color/size legend and unvalidated context label |
| `empty-loading-error-mobile` | 390×844 | three explicit state variants |

## Machine review output

`npm run verify:overnight` and Playwright must emit objective results for forbidden
strings, body font, touch targets, horizontal overflow, P2 disclosure, separated axes,
synthetic labels, console errors, axe, and screenshot existence. A missing surface is a
failure, not an implicit pass.

## Morning human review

At `390×844` and desktop, a Korean-speaking human using Claude/browser review records:

- task-first comprehension in 30 seconds;
- whether the copy sounds administrative and humane rather than promotional;
- physical touch comfort and visible keyboard behavior;
- final information density and map legibility;
- actual Korean audio and live LLM usefulness;
- full demo rehearsal and the 664-case tuning judgment.

These cannot be marked passed by the overnight builder.
