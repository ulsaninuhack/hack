# Design.md — 관리자 웹 리스트 행 디자인 규칙

이 문서는 `/center` 배치 확인 행 개선(브랜치 `claude/center-detail-layout-lyqxgv`,
커밋 `beacedd`)에서 확정한 리스트 행 정보 배치 규칙을 기록한다.
`docs/UI_UX_REVIEW_RUBRIC.md`의 게이트를 대체하지 않으며, 그 위에 얹는 레이아웃 규칙이다.

## 문제

기존 `/center` 오늘 배치 확인 행은 성격이 다른 세 정보를 `·`로 이어 한 줄에 넣었다.

```
인천광역시 제물포구 인중로164번길 52-14 · 마지막 연락 2026-08-11 (연락 안 됨) · 예정 2026-08-10
```

- 장소(주소), 이력(마지막 연락), 할 일(예정일)이 같은 회색 본문으로 섞여 위계가 없다.
- 담당자가 가장 먼저 봐야 할 "연락 안 됨"이 괄호 안에 묻힌다.
- 긴 주소가 앞에 오면 좁은 화면에서 줄바꿈 위치가 매번 달라져 훑어읽기가 어렵다.

## 참고한 패턴 — 토스 TDS ListRow

토스 디자인 시스템(TDS)의 ListRow 관례를 따른다.

1. **한 줄에 하나의 메시지.** 제목(굵게) 아래 보조 설명(작고 연하게)을 쌓는 2줄 구조가
   기본이며, 성격이 다른 정보를 구분점으로 이어붙이지 않는다.
2. **상태는 괄호가 아니라 시각적 위계로.** 주의가 필요한 상태는 색이 있는 뱃지로
   표시하되, 색만으로 구분하지 않고 텍스트 라벨을 함께 둔다(비색상 상태 규칙).
3. **날짜·수치는 라벨-값 쌍으로.** 값이 무엇인지 라벨을 붙이고 숫자는
   `font-variant-numeric: tabular-nums`로 정렬한다.

## 확정한 행 구조 (`/center` 배치 확인)

```
1줄  이름 + 등급 칩                         (우측) 담당 연결단원
2줄  도로명 주소 — 단독 설명 줄, --t-faint 14px
3줄  마지막 연락  2026-08-11 [연락 안 됨]   다음 예정  2026-08-10
     └ 라벨 --t-faint 14px / 값 --t-sub 600 14px / 상태는 뱃지
```

- 마크업: 주소는 `p.assignment-address`, 사실 목록은 `dl.assignment-facts` 안의
  `div.assignment-fact`(`dt` 라벨 + `dd` 값). 좁은 화면에서는 flex-wrap으로 세로로 쌓인다.
- 상태 뱃지: `span.fact-status`. 기본은 `--t-track`/`--t-sub`, 주의 상태는
  `data-attention` 속성으로 `--t-red-soft` 배경 + 진한 빨강 텍스트.
- 주의 상태 집합(`src/CenterPage.tsx`의 `ATTENTION_CONTACT_LABELS`):
  `연락 안 됨`, `연락 거부`, `연락처 확인 필요`, `우려 사항 있음`.
  라벨 원천은 `backend/src/three-tier-ops.mjs`의 연락 결과 라벨 맵이다.

## 적용 파일

- `src/CenterPage.tsx` — `ProposalRow`의 단일 `assignment-meta` 줄을 위 구조로 분해.
- `src/styles.css` — `/center v5` 블록의 `.assignment-address`, `.assignment-facts`,
  `.assignment-fact`, `.fact-status` 규칙.

## 검증 (2026-08-13)

- `npm run check:ui-copy` 통과 (13/13)
- `npm run typecheck`, `npm run build` 통과
- `npm run test:e2e:ops` 5개 전부 통과 — 갱신된 증적은 `artifacts/screenshots/`의
  p9 센터 스크린샷과 `artifacts/axe/p8-axe-results.json` (커밋 `02944ec`)

## 남은 적용 대상

같은 `·` 이어붙이기 패턴이 남아 있어, 다음 UI 작업에서 이 규칙으로 정리한다.

- `/center` 보고 확인 카드 헤더의 `report-meta` (`마지막 연락 결과 · 일자`)
- `/center` 방문 검토 목록의 `급성도 · 취약도` 줄
