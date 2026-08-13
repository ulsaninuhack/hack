# Live call compact flow design QA

- Source visual truth:
  - `/var/folders/wc/ssfdn4ws6lg_plhw90574s4r0000gn/T/codex-clipboard-fb4aae47-8845-4640-8709-445e25826169.png` (992×1844 px, prior tall transcript/checklist state)
  - `/var/folders/wc/ssfdn4ws6lg_plhw90574s4r0000gn/T/codex-clipboard-19dab303-f250-49cf-bc6d-a73fa795aa16.png` (858×1020 px, prior meal-missing checklist state)
- Implementation screenshot: `artifacts/screenshots/live-call-compact-final-390x844.png` (390×844 px)
- Viewport: 390×844 CSS px, device scale factor 1
- Density normalization: implementation captured 1:1 at CSS density. Source images are cropped high-density defect references rather than a same-size design mock, so comparison used visible component proportions, ordering, wrapping, and content—not pixel-to-pixel scaling.
- State: connected two-person call, finalized Korean captions, one next-question suggestion, live checklist candidates available.

## Full-view comparison evidence

- The prior view required page scrolling because a tall transcript was followed by six always-visible checklist cells and the next question. The implementation fits status, transcript, next question, populated checklist rows, and both call controls within 390×844 with zero horizontal overflow and document height equal to the viewport.
- Transcript bubbles are materially denser while retaining readable 18 px body text. The contact speaker uses the selected display name (`김영자 어르신`) rather than a generic role.
- The next question now follows the transcript directly. Empty checklist values, the `AI 후보 · 미확정` badge, candidate suffixes, and the evidence ledger are absent.
- Only phone-observable populated rows render. In the captured state these are recent outing, meal status, and support network.

## Focused-region comparison evidence

- Transcript region: compact bubbles preserve speaker hierarchy and wrapping; the scrollable transcript is 286 px high and follows new captions automatically.
- Decision-support region: the next-question card is adjacent to the transcript, and the checklist shows `식사 상태 · 불량` without the broken narrow vertical wrapping visible in the prior screenshot.
- Controls: both persistent call actions measure 52 px high, remain visible, and use Lucide icons with text labels.

## Findings

- No actionable P0/P1/P2 visual differences remain for the requested compact-call state.
- Typography: Korean system sans stack, weight hierarchy, 18 px conversation body, and wrapping are readable at the target viewport.
- Spacing/layout: 10–12 px compact rhythm keeps all primary regions in one viewport without overlap or clipping.
- Colors/tokens: existing violet candidate and red hang-up tokens are retained; state meaning is also expressed by labels and icons.
- Image quality: this flow has no raster product imagery. Existing library icons remain sharp and consistently aligned; no generated or placeholder assets were introduced.
- Copy/content: explanatory badges and internal candidate vocabulary are removed; labels now name the user task or observed item.
- Accessibility/behavior: controls remain at least 48 px, horizontal overflow is zero, reduced-motion handling remains, and the browser console reported zero errors and warnings after reload.

## Comparison history

1. Earlier P1 density issue: transcript, six empty checklist cells, and question forced repeated page scrolling. Fixed with a bounded caption region, populated-only checklist rendering, and compact spacing. Post-fix evidence: `artifacts/screenshots/live-call-compact-final-390x844.png`.
2. Earlier P2 content hierarchy issue: generic `연락 대상`, internal `AI 후보 · 미확정`, and a separate evidence ledger competed with the conversation. Fixed with selected contact name, removal of internal labels/ledger, and question placement directly below captions. Post-fix evidence: the same implementation screenshot.
3. Earlier P1 wrapping issue: long labels collapsed into narrow vertical text. Fixed by omitting empty rows and using a two-column populated-only grid with balanced label/value space. Post-fix evidence: the same implementation screenshot.

## Primary interactions checked

- Live captions append and auto-follow the newest message.
- Microphone toggle and call-end controls remain reachable.
- Call-end pending state remains visible until final transcript analysis resolves.

final result: passed
