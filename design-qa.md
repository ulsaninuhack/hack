# Live call compact flow design QA

- Source visual truth:
  - `/var/folders/wc/ssfdn4ws6lg_plhw90574s4r0000gn/T/codex-clipboard-fb4aae47-8845-4640-8709-445e25826169.png` (992×1844 px, prior tall transcript/checklist state)
  - `/var/folders/wc/ssfdn4ws6lg_plhw90574s4r0000gn/T/codex-clipboard-19dab303-f250-49cf-bc6d-a73fa795aa16.png` (858×1020 px, prior meal-missing checklist state)
  - `/Users/coldmans/Downloads/스크린샷, 2026-08-13 오후 9.44.03.png` (prior narrow vertical checklist labels)
  - `/var/folders/wc/ssfdn4ws6lg_plhw90574s4r0000gn/T/codex-clipboard-cabe2909-00bc-4157-9c4b-ce5f83a49723.png` (prior mobile role/navigation header)
- Implementation screenshots:
  - `artifacts/screenshots/p9-mobile-live-checklist-390x844.png` (390×844 px)
  - `artifacts/screenshots/p9-mobile-390x844.png` (390×844 px)
- Viewport: 390×844 CSS px, device scale factor 1
- Density normalization: implementation captured 1:1 at CSS density. Source images are cropped high-density defect references rather than a same-size design mock, so comparison used visible component proportions, ordering, wrapping, and content—not pixel-to-pixel scaling.
- State: live checklist with three confirmed and three unconfirmed fields; mobile today-task list without a role-switching header.

## Full-view comparison evidence

- The six live-call fields stay visible so the investigator can see what still needs asking. Confirmed and `미확인` states fit in a compact 2×3 grid at 390 px with zero horizontal overflow.
- Transcript bubbles are materially denser while retaining readable 18 px body text. The contact speaker uses the selected display name (`김영자 어르신`) rather than a generic role.
- The next question follows the transcript directly. Empty fields remain visible as `미확인`; the `AI 후보 · 미확정` badge, candidate suffixes, and evidence ledger are absent.
- The mobile list begins directly with `오늘 할당된 연락 대상`; the old role label, dong/live line, center/map links, and explanatory sentence are absent.

## Focused-region comparison evidence

- Transcript region: compact bubbles preserve speaker hierarchy and wrapping; the scrollable transcript is 286 px high and follows new captions automatically.
- Decision-support region: two-row card internals give labels the full content column. `공과금 체납`, `건강·마음 어려움`, and all other labels wrap by phrase rather than one Hangul character per line.
- Controls: both persistent call actions measure 52 px high, remain visible, and use Lucide icons with text labels.

## Findings

- No actionable P0/P1/P2 visual differences remain for the requested checklist and mobile-header changes.
- Typography: Korean system sans stack, weight hierarchy, 18 px conversation body, and wrapping are readable at the target viewport.
- Spacing/layout: 10–12 px compact rhythm keeps all primary regions in one viewport without overlap or clipping.
- Colors/tokens: existing violet candidate and red hang-up tokens are retained; state meaning is also expressed by labels and icons.
- Image quality: this flow has no raster product imagery. Existing library icons remain sharp and consistently aligned; no generated or placeholder assets were introduced.
- Copy/content: explanatory badges and internal candidate vocabulary are removed; labels now name the user task or observed item.
- Accessibility/behavior: checklist states use text plus shape, horizontal overflow is zero, each measured card is below 90 px tall with label width above 80 px, and all six labels remain readable at 390 px.

## Comparison history

1. Earlier P1 density issue: transcript, checklist cells, and question forced repeated page scrolling. Fixed with a bounded caption region and compact 2×3 checklist spacing. Post-fix evidence: `artifacts/screenshots/p9-mobile-live-checklist-390x844.png`.
2. Earlier P2 content hierarchy issue: generic `연락 대상`, internal `AI 후보 · 미확정`, and a separate evidence ledger competed with the conversation. Fixed with selected contact name, removal of internal labels/ledger, and question placement directly below captions. Post-fix evidence: the same implementation screenshot.
3. Earlier P1 wrapping issue: long labels collapsed into narrow vertical text. Fixed with a two-row `icon + content` card grid and `word-break: keep-all`; all six rows, including unconfirmed ones, remain visible. Post-fix evidence: the same implementation screenshot.
4. Earlier P2 navigation clutter: the mobile page led with a role/dong header and links unrelated to the field task. Fixed by starting directly at the today-task heading. Post-fix evidence: `artifacts/screenshots/p9-mobile-390x844.png`.

## Primary interactions checked

- Live captions append and auto-follow the newest message.
- Microphone toggle and call-end controls remain reachable.
- Call-end pending state remains visible until final transcript analysis resolves.

final result: passed
