# Care Operations Console screenshot index

All captures below are produced by `e2e/p8-demo-hardening.spec.ts` from a production Vite
build served by `vite preview`. Public, worker, manager, and operations-map surfaces use
the real local API. Only the explicit empty/loading/error variants use bounded route
interception; the combined state image is a clearly labeled test-proof contact sheet of
those three independently audited captures.

| Surface | Viewport | File | Verified state |
| --- | --- | --- | --- |
| Surveyor queue | 390×844 | `surveyor-queue-mobile.png` | Worker-filtered queue and `[합성]` marker |
| Surveyor detail | 390×844 | `surveyor-detail-mobile.png` | Acute `62`, vulnerability `0`, separate disclosures, approval-pending copy |
| Surveyor form | 390×844 | `surveyor-form-mobile.png` | Safe Korean result input and complete observation form |
| Manager review | 1440×900 | `manager-review-desktop.png` | Recommendation list, separated axes, guarded decision form |
| Manager map | 1440×900 | `manager-map-desktop.png` | Selected synthetic point and keyboard-list alternative |
| Public map | 1440×900 | `public-map-desktop.png` | Public aggregate map and exact mixed-snapshot warning |
| Public initial scenario | 1440×900 | `public-operations-scenario-desktop.png` | Fresh session, `[합성 시나리오]`, one deterministic example for the selected current dong, and explicit source counts |
| Operations scenario evidence | 1440×900 | `operations-scenario-desktop.png` | Panel-top proof of `[합성 시나리오]`, reference date, and session/scenario/unrecorded counts |
| Operations overlay | 1440×900 | `operations-overlay-desktop.png` | `[합성]` operations mode, separate map encodings, and unvalidated structural context |
| Explicit state matrix | 390×844 | `empty-loading-error-mobile.png` | Clearly labeled proof sheet from the three independently audited state captures |
| Empty state | 390×844 | `empty-mobile.png` | Route-intercepted empty queue with explicit Korean status |
| Loading state | 390×844 | `loading-mobile.png` | Route-intercepted pending queue request with explicit Korean status |
| Error state | 390×844 | `error-mobile.png` | Route-intercepted unavailable response with recovery action |

`artifacts/p8-evidence.json` records the dimensions and objective checks, while
`artifacts/axe/p8-axe-results.json` preserves the raw per-surface accessibility results.
`p2-surveyor-mobile.png` and `p2-manager-desktop.png` remain earlier full-page audit captures.
