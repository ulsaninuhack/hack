# UI progress

UI 마일스톤마다 아래 표를 갱신한다. Preview URL과 독립 리뷰가 없으면 완료로 표시하지 않는다.

현재 작업은 모바일 실시간 통화 데모의 고정 입장 주소와 게스트 선입장 흐름을 정리한다.
PR은 배포하지 않으므로 Preview URL은 아직 없으며, 자동 게이트와 로컬 브라우저 확인까지만
기록한다.

| 마일스톤 | 상태 | Vercel Preview URL | 자동 게이트 | Claude 390×844 | Claude 1440×900 | punch-list |
| --- | --- | --- | --- | --- | --- | --- |
| 모바일 실시간 통화 정리 | 리뷰 대기 | 미생성(PR 검증만) | Vitest 115/115 · p9 2/2 · typecheck/build/copy pass | 로컬 Playwright 390×844 확인 · `artifacts/screenshots/p9-mobile-case.png`, `p9-mobile-checklist.png` | 미실행 | 실기기 마이크·주변음 민감도 재확인 필요 |
| 고정 시연 통화 입장 | 리뷰 대기 | 미생성(로컬 브랜치) | Vitest 141/141 · backend 274/274 · fixed-call E2E 1/1 · typecheck/build/copy pass | 로컬 Playwright 390×844 확인 · `artifacts/screenshots/fixed-demo-call-guest-prepared.png`, `fixed-demo-call-host.png` | 미실행 | `main` 병합·생산 배포 후 고정 URL과 실기기 마이크 재확인 필요 |

## 기록 규칙

- 상태는 `구현 중`, `리뷰 대기`, `수정 중`, `검토 완료` 중 하나를 사용한다.
- UI 변경 PR의 Preview URL을 정확히 기록한다.
- Claude가 찍은 두 viewport 스크린샷의 링크나 아티팩트 경로를 남긴다.
- punch-list 항목별 수정 PR 또는 커밋을 연결한다.
- 자동 게이트 통과만으로 `검토 완료`를 쓰지 않는다.
