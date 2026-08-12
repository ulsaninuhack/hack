# I5 도시 돌봄

> 개인을 추정하지 않고, 공개 집계 데이터로 인천의 돌봄 현장 검토 순서를 좁히는 지도

**Live demo:** `__LIVE_URL_TO_BE_REPLACED__`

<!-- SCREENSHOT: 실제 배포 화면을 검증한 뒤 스크린샷과 대체 텍스트를 추가합니다. -->

## 문제와 가치

공개 데이터로는 누가 복지를 받아야 하는데 받지 못하고 있는지 확정할 수 없다. 대신 행정동별 고령·1인세대 규모와 비율, 복지시설, 대중교통, 노후 주거 맥락을 같이 보면 **어느 지역을 먼저 현장 확인할지**를 데이터와 함께 논의할 수 있다.

이 프로젝트는 자동 판정·자원 배치 시스템이 아니다. 개인정보 없이 지역 단위의 관찰 지표를 비교하고, 담당자가 실제 사례·적격성·공급 여력을 추가 확인하도록 돕는 **의사결정 보조 도구**다.

## 현재 데이터 범위

| 레이어 | 검증된 범위 | 해석 |
| --- | ---: | --- |
| 행정동 지도 | 2025 경계 156개 구역에 2026 현행 행정동 162개를 정합 | 분리된 최신 동 경계를 임의로 만들지 않음 |
| 수요 맥락 | 총인구 3,061,002명, 65세 이상 598,793명, 1인세대 559,691세대, 65세 이상 1인세대 172,426세대 | 주민등록 집계 관찰값이며 실제 독거·고립·서비스 적격성을 뜻하지 않음 |
| 복지시설 | 정규화 3,394개 중 지도 포인트 3,061개, 좌표 커버리지 90.188568% | 주민 위치가 아닌 공식 시설 위치; 일부는 주소 기반 대표점 |
| 대중교통 | 승·하차 지도 포인트 6,231개, 노선 정보 결합 6,157개 | 승·하차 건수이며 고유 이용자 수가 아님 |
| 주거 노후도 | 정규화 건축물대장 157,049건 중 150,589건 배정, strict 커버리지 95.886634% | 대장 레코드 수이며 고유 건물·주택 호수·가구 수가 아님 |

실행 중인 웹앱은 대용량 원천을 직접 읽지 않고, 검증된 정적 자산만 `public/data/`에서 불러온다.

프론트엔드는 React 19·TypeScript·Vite 8로 구성했고, MapLibre GL JS에 OpenStreetMap 베이스맵을 사용한다. 현재 실행 경로에는 백엔드, 개인 데이터, AI 추론 모델이 없다.

## 지표 해석 원칙

기본 표현은 다음 두 관찰 지표를 독립적으로 보여 준다.

- `P1` 주민등록상 65세 이상 1인세대 **관찰 규모**: 버블 크기
- `P2` 65세 이상 인구 대비 65세 이상 1인세대 **관찰 비율**: 구역 채색

`P2`는 2026-07-31 세대 수를 2026-06-30 인구로 나눈 **혼합 snapshot**이다. 동시점 비율이 아니므로 날짜·분자·분모를 함께 보여 줘야 한다. 두 지표를 임의 가중치로 합쳐 `종합 위험점수`를 만들지 않는다.

다음 표현은 사용하지 않는다.

- `복지 미수혜자 수`
- `고독사 고위험자`
- `AI가 예측한 개인별 위험 확률`
- `확정된 돌봄 공백`

실제 미수혜 규모를 계산하려면 같은 기준기간의 자격·필요 판정, 신청·수급·이용 기록, 중복 제거 키와 적법한 결합 근거가 필요하다. 세부 규칙은 [`data/metadata/CARE_PRIORITY_METRIC_SPEC.md`](data/metadata/CARE_PRIORITY_METRIC_SPEC.md)를 따른다.

## 구조

```mermaid
flowchart LR
    A["공식 공개 원천"] --> B["data/scripts<br/>정규화·정합·검증"]
    B --> C["data/processed<br/>분석 기준 산출물"]
    C --> D["scripts/prepare_web_data.py<br/>웹 허용 필드·해시 검증"]
    D --> E["public/data<br/>정적 GeoJSON·JSON"]
    E --> F["브라우저 지도 UI"]
    F --> G["Vercel"]
```

| 경로 | 역할 |
| --- | --- |
| `src/` | 지도, 레이어, 필터, 정보 패널 UI |
| `public/data/` | 배포에 포함되는 브라우저용 GeoJSON·JSON |
| `scripts/prepare_web_data.py` | 검증된 산출물을 결정적으로 웹 자산으로 변환 |
| `data/raw/` | 다시 받은 공식 원천 보관 |
| `data/processed/` | 정규화·공간조인·검증 산출물 |
| `data/metadata/` | 출처, API, 체크섬, 지표 계약 |
| `.github/workflows/ci-deploy.yml` | Node 24 검증과 Vercel 생산 배포 |
| `docs/DEPLOYMENT.md` | 일회성 연동·secret·운영 절차 |

## 로컬 실행

Node.js 24와 npm을 사용한다.

```bash
npm ci
npm run dev
```

배포 전 같은 검증을 로컬에서 실행한다.

```bash
npm run typecheck
npm run build
```

## 웹 데이터 재생성

`data/processed/`가 바뀌었을 때만 웹용 자산을 다시 만든다.

```bash
python3 scripts/prepare_web_data.py
python3 scripts/prepare_web_data.py --check
```

`--check`는 임시 디렉터리에서 재생성한 6개 자산을 커밋된 `public/data/`와 바이트 단위로 비교한다. 원천부터 전체 데이터팩을 재생성하는 순서와 Python 의존성은 [`data/README.md`](data/README.md)와 [`data/requirements.txt`](data/requirements.txt)에 있다.

## CI/CD

- Pull request와 모든 push에서 Node.js 24, `npm ci`, `npm run typecheck`, `npm run build`를 실행한다.
- `main` push는 검증 성공 후 Vercel Production으로 배포한다.
- GitHub Actions가 배포의 단일 소유자다. `vercel.json`의 `git.deploymentEnabled=false`로 Vercel Git 자동 배포와의 중복을 막는다.
- 생산 배포에는 GitHub repository secret `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`가 필요하다.
- 대용량 `data/`는 Vercel 배포에서 제외하고 `public/data/`만 웹 자산으로 보낸다.

설정·secret 등록·장애 대응은 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)에 정리되어 있다.

## 공식 출처

- 행정안전부: [행정동별 성별·연령별 주민등록 인구](https://www.data.go.kr/data/15097972/fileData.do), [1인세대수](https://www.data.go.kr/data/15097973/fileData.do)
- 인천광역시: [국민기초생활수급자 연령별 읍면동 현황](https://www.data.go.kr/data/15128192/fileData.do), [사회복지시설 현황](https://www.data.go.kr/data/15045181/fileData.do), [노인복지시설 현황](https://www.incheon.go.kr/welfare/WE010216)
- 인천광역시 교통: [시내버스 정류소](https://www.data.go.kr/data/15074309/fileData.do), [버스노선별 정류장](https://www.data.go.kr/data/15048265/fileData.do), [정류장별 이용승객](https://www.data.go.kr/data/15048264/fileData.do)
- 인천 1인가구 포털: [돌봄·안전 프로그램](https://www.incheon.go.kr/1in/OHH020108)
- VWorld: [센서스 행정동 경계](https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=MK&dsId=30017), [건축물연령정보](https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=1), [GIS건물통합정보](https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18)

전체 원천 목록과 기준일은 [`data/metadata/source_inventory.csv`](data/metadata/source_inventory.csv), API 접근 조건은 [`data/metadata/API_CATALOG.md`](data/metadata/API_CATALOG.md), 파일 무결성은 [`data/metadata/checksums.sha256`](data/metadata/checksums.sha256)에서 확인할 수 있다.

## VWorld 라이선스 주의

VWorld 행정경계 페이지에는 `CC BY-NC-ND`가 표시되어 있고, 이 저장소의 GeoJSON은 지역 필터링·재투영·형식 변환·속성 결합을 거친 파생물이다. `ND` 조건에서 이 가공과 공개 재배포가 허용되는지는 확인되지 않았다. 공개 데모가 열려 있는 사실은 재배포 권리를 확정하지 않는다.

따라서 공식 서비스·상용 전환·지속적 공개 전에 VWorld의 서면 확인을 받거나 재배포 가능한 경계·건물 데이터로 교체해야 한다. 현재 근거와 공개 전 체크리스트는 [`data/LICENSES.md`](data/LICENSES.md)를 따른다.

## 저장소

- GitHub: <https://github.com/ulsaninuhack/hack>
- 배포 절차: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
