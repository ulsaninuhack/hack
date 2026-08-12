# I5 돌봄 공백 지도 API·데이터 카탈로그

- 조사 기준: 2026-08-12 KST
- 범위: 인천 행정동별 잠재 돌봄 공백, 복지시설·대중교통 접근성, 노후주택 보조지표
- 원칙: API 키는 이 저장소에 기록하지 않는다. 파일 데이터가 이미 있으면 MVP는 그 스냅샷으로 재현하고, API는 갱신 자동화 단계에서 붙인다.

## 상태 표기

| 상태 | 의미 |
|---|---|
| `DOWNLOADED` | 원본 파일이 `raw/`에 있고 로컬 분석에 바로 쓸 수 있음 |
| `SPEC CAPTURED` | 공식 명세/OAS만 `raw/api_specs/`에 저장됨 |
| `KEY REQUIRED` | 서비스 키 또는 토큰 발급 후 호출 가능 |
| `APPROVAL REQUIRED` | 포털 활용 신청·심의가 필요함 |
| `LOGIN/REVIEW REQUIRED` | 로그인, 본인확인 또는 제공기관 승인 후 수동 다운로드 |
| `OPTIONAL` | MVP 필수는 아니며 검증·고도화용 |

## 지금 구현할 때의 선택

| 레이어 | MVP 주 데이터 | 현재 상태 | API를 붙였을 때 얻는 것 |
|---|---|---|---|
| 행정동 인구·고령인구·1인세대 | 행정안전부 월별 CSV 3종 | `DOWNLOADED` | 월별 자동 갱신 |
| 기초생활수급자 | 인천 읍면동·연령별 2020~2024 CSV | `DOWNLOADED` | 새 기준연도 자동 갱신 |
| 응급안전안심 서비스 현황 | 응급안전안심 대상자 2024 파일 | `DOWNLOADED`, 시군구까지만 가능 | 최신 API는 읍면동·운영기관별 **맥락 정보**로 집계 가능 |
| 복지 공급 | 인천 사회복지시설·노인·장애인·장기요양 시설 파일 | `DOWNLOADED` | 새 시설 자동 갱신 |
| 교통 공급 | 인천 버스정류소 7,237건·지하철역 101건 | `DOWNLOADED` | 시설 반경 500m 정류소, 경유 노선, 배차 간격 보강 |
| 행정동 경계 | VWorld 센서스 행정동 SHP + 2026-07-01 MOIS 코드/개편표 | `DOWNLOADED` | SGIS로 연도별 경계·집계구를 선택 호출 |
| 노후주택 | VWorld 인천 GIS건물통합 SHP + 현 11개 군구 건축물연령 CSV | `DOWNLOADED` | API 키 없이 건축물연령을 2025-06-30 기준 156개 지도 구역으로 엄격 집계 가능. 2026 현행 162개 행정동 직접값은 아님 |

> **중요:** 공개 데이터만으로 “복지를 받아야 하지만 실제로 못 받는 개인”을 식별할 수 없다. 지도에는 개인 빨간 점이 아니라 행정동별 **잠재 돌봄 공백 추정치/위험도**를 표시해야 한다. 응급안전안심 대상자는 특정 사업의 등록 현황일 뿐 전체 복지 수혜자나 미수혜자의 명단이 아니다. 잠재수요에서 이 값을 빼서 “미수혜자 수”를 만들면 안 된다.

---

## 1. 보건복지부 응급안전안심 서비스

### 1.1 대상자 기본정보 API

| 항목 | 내용 |
|---|---|
| 공식 페이지 | [공공데이터포털 15098762](https://www.data.go.kr/data/15098762/openapi.do) |
| 정확한 요청 주소 | `GET https://apis.data.go.kr/1352000/ODMS_EMG_01/callEmg01Api` |
| 필수 파라미터 | `serviceKey`, `pageNo`, `numOfRows` (`numOfRows` 최대 500) |
| 선택 파라미터 | `apiType=JSON\|XML`, `sido`, `sigungu` |
| 인증·승인 | 공공데이터포털 서비스키 + 활용 신청. 개발계정은 심의 승인, 운영계정은 포털 안내상 자동 승인 |
| 호출 한도 | 개발계정 신청가능 트래픽 `10,000` 표기. 초기화 주기·운영계정 증량은 실제 활용신청 화면에서 확인 |
| 공간·시간 단위 | 대상자 레코드, 주소는 시도·시군구·읍면동 수준. 좌표 없음. 나이는 구간값 |
| 주요 응답 필드 | `recSex`, `recBirth`, `sido`, `sigungu`, `upmyundong`, `organNm`; 응답 봉투 `resultCode`, `resultMsg`, `numOfRows`, `pageNo`, `totalCount` |
| 추가 민감 필드 | 명세상 `highRisk`, `jbhntPartcHopeYn`, `moneyActYn`, `perExstYn`, `dissStatDesc`, `lsrActItem`, `grpPartcItem` 등이 포함될 수 있음 |
| MVP 역할 | 행정동별 **특정 안전서비스 등록 현황**을 별도 맥락 레이어로 집계. 잠재수요에서 차감하지 않고 개인 마커도 만들지 않음 |
| 현재 상태 | `SPEC CAPTURED` + `KEY REQUIRED` + `APPROVAL REQUIRED`; 라이브 호출 안 함 |

로컬 명세: `raw/api_specs/data_go_kr_15098762.json`

이미 내려받은 과거 파일은 `raw/welfare/emergency_safety_service_targets_20240520.csv`이다. 310,920행이며 `시도`, `시군구`, `성별`, `나이`만 있어 인천 시군구 기준선에는 쓸 수 있지만 행정동별 공백 산출에는 직접 쓸 수 없다.

### 1.2 운영기관정보 API

| 항목 | 내용 |
|---|---|
| 공식 페이지 | [공공데이터포털 15098764](https://www.data.go.kr/data/15098764/openapi.do) |
| 정확한 요청 주소 | `GET https://apis.data.go.kr/1352000/ODMS_EMG_02/callEmg02Api` |
| 필수 파라미터 | `serviceKey`, `pageNo`, `numOfRows` (`numOfRows` 최대 500) |
| 선택 파라미터 | `apiType=JSON\|XML`, `sido`, `sigungu` |
| 인증·승인·한도 | 대상자 API와 동일: 서비스키, 개발계정 심의, 개발 트래픽 `10,000` 표기, 운영 증량 신청 |
| 공간 단위 | 운영기관 1개 레코드, 시도·시군구·주소 수준 |
| 주요 응답 필드 | `sido`, `sigungu`, `organNm`, `chrNm`, `organTel`, `organFax`, `organZip`, `organAddr`, `organHomepage`, `organEmail`, `estbDt`, `qobnDt`, `upperOrgan`, `bzType`, `organType`, `organCenterYn`, `bsnsRegNo`, `fcltyAuthNo`, `careOrgNo`, `corpNm` |
| MVP 역할 | 행정동/시군구별 응급안전 운영 공급점과 담당기관을 설명하는 맥락 레이어. 미수혜 규모 계산에는 사용하지 않음 |
| 현재 상태 | `SPEC CAPTURED` + `KEY REQUIRED` + `APPROVAL REQUIRED`; 라이브 호출 안 함 |

로컬 명세: `raw/api_specs/data_go_kr_15098764.json`

선택 확장으로 장비정보 API도 있다: `GET https://apis.data.go.kr/1352000/ODMS_EMG_03/callEmg03Api` ([공공데이터포털 15098768](https://www.data.go.kr/data/15098768/openapi.do)). MVP 필수는 아니다.

### 개인정보 처리 원칙

- 대상자 API를 받더라도 수집 직후 `행정동 × 연령구간 × 성별`로 집계하고 원시 레코드는 서비스 UI에 내보내지 않는다.
- 질병·상태 설명과 참여희망 여부 등은 위험점수 입력에서 제외한다.
- 소수 집단은 재식별 위험이 있으므로 5명 미만 숨김 또는 상위 행정구역 합산을 적용한다.

---

## 2. 공공데이터포털 ODCloud 자동변환 API

### 공통 호출 규칙

| 항목 | 내용 |
|---|---|
| 호스트·기본 경로 | `https://api.odcloud.kr/api` |
| 요청 형태 | `GET /{datasetId}/v1/uddi:{resourceUuid}` |
| 파라미터 | `page` (기본 1), `perPage` (기본 10), `returnType=JSON\|XML` |
| 인증 | 쿼리 `serviceKey={KEY}` 또는 헤더 `Authorization: {KEY}` |
| 응답 봉투 | `currentCount`, `data`, `matchCount`, `page`, `perPage`, `totalCount` |
| OAS 조회 | `https://infuser.odcloud.kr/oas/docs?namespace={datasetId}/v1` |
| 승인·한도 | 공공데이터포털 활용 신청 및 서비스키가 필요하다. 수치 한도는 캡처한 OAS에 고정값이 없고 신청 계정/데이터셋별 포털 화면을 따라야 함 |
| 현재 전략 | 모든 핵심 데이터는 CSV가 있으므로 MVP는 키 없이 파일로 재현. API는 갱신 배치용 |

### 정확한 리소스 엔드포인트

아래 UUID는 2026-08-12에 캡처한 OAS에서 확인한 최신 리소스다. ODCloud는 새 파일이 등록될 때 UUID가 바뀔 수 있으므로, 자동화 시 OAS를 먼저 조회해야 한다.

| 데이터 | 정확한 GET 주소 | 단위·주요 필드 | MVP 역할 | 현재 상태 |
|---|---|---|---|---|
| 행정동 성별·연령별 주민등록 인구 2026-06 | `https://api.odcloud.kr/api/15097972/v1/uddi:5702ac2f-e6b6-4db4-ba6e-8744c4bc364b` | 행정동·월; `행정기관코드`, `기준연월`, 시도/시군구/읍면동명, `계`, `남자`, `여자`, 0~110세 이상 성·연령 열 | 총인구, 65세 이상 인구, 고령화율 | CSV `DOWNLOADED`; API `KEY REQUIRED` |
| 행정동 성별·연령별 1인세대 2026-06 | `https://api.odcloud.kr/api/15097973/v1/uddi:d4661a1a-c878-4a6f-b218-cd3011006538` | 행정동·월; 행정기관코드와 0~110세 이상 성·연령 열 | 65세 이상 1인세대, 고립 위험 수요 | 더 최신 2026-07 CSV `DOWNLOADED`; API `KEY REQUIRED` |
| 행정동 세대원수별 세대수 2026-06 | `https://api.odcloud.kr/api/15097974/v1/uddi:4b4f0012-af54-4c17-818b-b22d56dcb1bc` | 행정동·월; `전체세대수`, `1인세대` … `10인이상세대` | 1인세대율 및 일관성 검증 | 더 최신 2026-07 CSV `DOWNLOADED`; API `KEY REQUIRED` |
| 인천 기초생활수급자 2024 | `https://api.odcloud.kr/api/15128192/v1/uddi:b3bbd9ba-6942-42d8-9466-83642e3b5266` | 읍면동·연령 5세 구간·자격; `시군구`, `읍면동`, `자격`, `연령구간(5세단위)`, `수급권자수` | 취약계층 규모와 65세 이상 수급자 | 2020~2024 CSV `DOWNLOADED`; API `KEY REQUIRED` |
| 응급안전안심 대상자 2024-05 | `https://api.odcloud.kr/api/15128127/v1/uddi:20fcd1d4-1718-4aa4-a5ec-a688f3844f63` | 시군구·나이·성별; `시도`, `시군구`, `성별`, `나이` | 시군구 단위 특정 서비스 등록 현황. 잠재수요에서 차감 금지 | CSV `DOWNLOADED`; API `KEY REQUIRED` |
| 인천 사회복지시설 2025-01 | `https://api.odcloud.kr/api/15045181/v1/uddi:5b1bd0d5-18cc-4edc-a87b-d5349ac47cd6` | 시설; `연번`, `관련 근거법`, `시설종류`, `시설형태`, `시설명`, `군구명`, `주소`, `연락처` | 시설 주소 지오코딩, 행정동별 공급 | CSV `DOWNLOADED`; API `KEY REQUIRED` |
| 인천 시내버스 정류소 2026-02 | `https://api.odcloud.kr/api/15074309/v1/uddi:960620ea-ab97-47a7-ae65-86449debd303` | 정류소; `기준 일자`, `정류소 명/번호/ID`, `권역`, `행정동 명`, `X/Y 좌표`, `위도/경도` | 정류소 공급과 시설 접근성 | CSV `DOWNLOADED`; API `KEY REQUIRED` |
| 미추홀구 노인복지시설 2025-06 | `https://api.odcloud.kr/api/15070559/v1/uddi:87c459df-a487-498e-8bc1-b377c765da10` | 시설; 시설명/종류, 지정일자, 주소, 위도/경도, 전화번호, 정원 | 좌표 포함 시설 파이프라인 표본·검증 | CSV `DOWNLOADED`; API `KEY REQUIRED` |
| 인천 지하철 역정보 2025-09 | `https://api.odcloud.kr/api/15120612/v1/uddi:1f1ea52b-f28e-4e67-a872-f77a6a441425` | 역; 역명, 법정동/행정동 코드·명, `X좌표`, `Y좌표` | 지하철 접근성 | CSV `DOWNLOADED`; API `KEY REQUIRED` |

캡처 OAS는 `raw/api_specs/odcloud_*_oas.json` 9개 파일에 있다. 최신 2026-07 CSV와 OAS의 최신 UUID가 한 달 어긋나는 항목이 있으므로, “파일 날짜”와 “API 리소스 날짜”를 별도 컬럼으로 관리한다.

### 2.1 행정안전부 주민등록 인구통계 직접 CSV 다운로드

[주민등록 인구통계](https://jumin.mois.go.kr/)가 브라우저에서 사용하는 공개 POST 다운로드 경로다. 서비스키는 없지만 정식 버전 고정 API가 아니라 웹 폼 엔드포인트이므로, 호출 전 HTML의 폼 필드를 다시 확인해야 한다.

| 데이터 | 정확한 POST 주소 | 핵심 쿼리·폼 필드 | 단위·필드 | 현재 상태 |
|---|---|---|---|---|
| 연령별 주민등록 인구 | `POST https://jumin.mois.go.kr/downloadCsvAge.do?searchYearMonth=month&xlsStats=3` | `sltOrgType=1`, `sltOrgLvl1=A`, `sltOrgLvl2=`, `searchYearStart`, `searchMonthStart`, `searchYearEnd`, `searchMonthEnd`, `gender=gender`, `sum=sum`, `sltOrderType=1`, `sltOrderValue=ASC`, `sltArgTypes=10`, `sltArgTypeA=0`, `sltArgTypeB=100`, `category=month` | 전체 읍면동 × 월 × 성·10세 연령대; 행정구역/행정기관코드와 인구 열 | 2021~2025년 12월 CSV `DOWNLOADED` |
| 세대원수별 세대수 | `POST https://jumin.mois.go.kr/downloadCsvEtc.do?searchYearMonth=month&xlsStats=3` | `sltOrgType=1`, `sltOrgLvl1=A`, `sltOrgLvl2=`, 시작/종료 연월, `sltOrderType=1`, `sltOrderValue=ASC`, `category=households` | 전체 읍면동 × 월; 전체세대, 1인~10인 이상 세대 | 2021~2025년 12월 CSV `DOWNLOADED` |
| 성·연령별 1인세대 | `POST https://jumin.mois.go.kr/sexdAge1HshdDown.do?searchYearMonth=month&xlsStats=3&downType=Csv` | 전체 읍면동 선택 시 `sltOrgLvl1=1000000000`, `sltOrgLvl2=1000000000`; 시작/종료 연월, `sltArgTypes=10`, `sltArgTypeA=0`, `sltArgTypeB=100`, `sttsGbn=admm`, `sum=sum`, `gender=gender`, `category=month` | 전체 행정동 × 월 × 성·10세 연령대; 총세대수, 연령구간세대수 | 2023~2025년 12월 CSV `DOWNLOADED` |

- `xlsStats=3`은 전체 읍면동 현황, `2`는 전체 시군구, `1`은 현재 화면이다.
- 반환 CSV 인코딩은 현재 파일에서 CP949로 확인됐다.
- 인증·승인·한도: 로그인/키 없이 다운로드됐으나 호출 한도는 공개 폼에 명시되지 않았다. 자동화하면 저빈도 배치와 로컬 캐시를 사용한다.
- `jumin_one_person_age_2021*.csv`가 없는 이유는 과거 구간에서 값 품질이 충분하지 않았기 때문이다. 현재 파이프라인은 확인된 2023년 이후만 추세에 쓴다.

---

## 3. 인천 버스·정류장 API

### 3.1 좌표 주변 정류소와 정류소 경유 노선

| 항목 | 주변 정류소 조회 | 정류소 경유 노선 조회 |
|---|---|---|
| 공식 페이지 | [인천광역시 정류소 조회 15056529](https://www.data.go.kr/data/15056529/openapi.do) | 동일 서비스 |
| 정확한 요청 주소 | `GET https://apis.data.go.kr/6280000/busStationService/getBusStationAroundList` | `GET https://apis.data.go.kr/6280000/busStationService/getBusStationViaRouteList` |
| 필수/핵심 파라미터 | `ServiceKey`, `pageNo`, `numOfRows`, `LAT`, `LNG` | `ServiceKey`, `pageNo`, `numOfRows`, `bstopId` |
| 공간 단위 | 입력 좌표 반경 500m 정류소 | 정류소 1개를 지나는 노선 |
| 주요 필드 | `BSTOPID`, `BSTOPNM`, `LAT`, `LNG`, `DISTANCE` | `BSTOPID`, `BSTOPNM`, `ROUTEID`, `ROUTENO`, `PATHSEQ`, `BSTOPSEQ`, `DIRCD`, `ROUTETPCD`, `DEST_BSTOPID`, `DESTINATION` |
| MVP 역할 | 시설별 500m 내 정류소 유무와 최근접 거리 | 정류소별 노선 수·노선 유형·방향성 |

- 형식: REST/XML.
- 승인·한도: 개발·운영계정 자동 승인, 개발계정 1,000 표기. 운영 증량은 활용사례 등록 후 신청.
- 상태: `KEY REQUIRED`; 라이브 호출 안 함. 정류소 좌표는 이미 내려받은 CSV로 1차 계산 가능.

### 3.2 버스 노선 상세와 노선-정류소 순서

| 항목 | 내용 |
|---|---|
| 공식 페이지 | [인천광역시 버스노선 조회 15058487](https://www.data.go.kr/data/15058487/openapi.do) |
| 서비스 기본 주소 | `https://apis.data.go.kr/6280000/busRouteService` |
| 노선번호 검색 | `GET /getBusRouteNo` — `ServiceKey`, `pageNo`, `numOfRows`, `routeNo` |
| 노선 상세 | `GET /getBusRouteId` — `ServiceKey`, `pageNo`, `numOfRows`, `routeId` |
| 경유 정류소 | `GET /getBusRouteSectionList` — `ServiceKey`, `pageNo`, `numOfRows`, `routeId` |
| 노선 주요 필드 | `ROUTEID`, `ROUTENO`, `ROUTETPCD`, `ADMINNM`, `ROUTELEN`, `FBUS_DEPHMS`, `LBUS_DEPHMS`, `MIN_ALLOCGAP`, `MAX_ALLOCGAP`, 기점/종점/회차지 ID·명칭 |
| 구간 주요 필드 | `ROUTEID`, `BSTOPID`, `SHORT_BSTOPID`, `BSTOPNM`, `ADMINNM`, `PATHSEQ`, `BSTOPSEQ`, `DIRCD`, `POSX`, `POSY` |
| MVP 역할 | 정류소 수보다 실제 서비스 강도를 잘 나타내는 첫차·막차·배차간격, 노선-정류소 그래프 |
| 인증·한도 | `ServiceKey`; 개발·운영 자동 승인, 개발계정 1,000 표기. REST/XML |
| 현재 상태 | `SPEC CAPTURED` + `KEY REQUIRED`; 라이브 호출 안 함 |

로컬 명세: `raw/api_specs/data_go_kr_15058487.json`

좌표 주의: 주변 정류소 API의 `LAT/LNG`는 WGS84지만 노선 구간의 `POSX/POSY`는 문서상 Bessel TM127 중부원점이다. 하나의 공간조인에서 섞지 말고 EPSG/원점을 확인한 뒤 WGS84로 변환한다.

### 3.3 정적 대안 파일

| 데이터 | 공식 페이지 | 규모·필드 | 상태·역할 |
|---|---|---|---|
| 인천 시내버스 정류소 현황 | [15074309](https://www.data.go.kr/data/15074309/fileData.do) | 7,237행; 정류소 ID/번호/명, 행정동, 위경도, X/Y | `DOWNLOADED`; 최근접 정류소와 행정동별 정류소 수 |
| 인천 버스노선별 정류장 현황 | [15048265](https://www.data.go.kr/data/15048265/fileData.do) | 33,029행; 회사, 노선번호/ID, 순번, 정류소, 구간·누적거리, 상하행 | `DOWNLOADED`; 정류소 마스터 엄격 조인 32,868행(99.51%), 정류소별 노선 공급 요약 생성 |
| 인천 정류장별 이용승객 현황 | [15048264](https://www.data.go.kr/data/15048264/fileData.do) | 6,760행; 승차/하차, 카드/현금, 일평균 승하차 | `DOWNLOADED`; 엄격 조인 6,667행(98.62%), 인천 지도용 6,231 포인트 생성. 승하차 건수는 고유 이용자 수가 아님 |

정류소 파일은 위치값이 `0`인 레코드가 있을 수 있고 상·하행 구분이 별도 필드로 없다는 공식 주의사항이 있다. 공간 계산 전에 좌표 범위 검증이 필요하다.

### 3.4 국토교통부 정류장 공급도

| 항목 | 내용 |
|---|---|
| 공식 페이지 | [공공데이터포털 15142078](https://www.data.go.kr/data/15142078/openapi.do) |
| 정확한 요청 주소 | `GET https://apis.data.go.kr/1613000/TransportationStopSupplyLevel/getTransportationStopSupplyLevel` |
| 필수 파라미터 | `serviceKey`, `pageNo`, `numOfRows`, `opr_ymd=YYYYMMDD`, `dataType=JSON\|XML` |
| 선택 파라미터 | `ctpv_cd` |
| 공간·시간 단위 | 시군구 × 운영일자 × 요일. 행정동이나 정류소 점 단위가 아님 |
| 주요 필드 | `dgsply`, `opr_ymd`, `dow_nm`, `ctpv_cd`, `ctpv_nm`, `sgg_cd`, `sgg_nm`, `blup_area`, `sttn_cnt` |
| 인증·한도 | 공공데이터포털 `serviceKey`; 개발·운영 자동 승인, 개발계정 1,000 표기, 운영 증량은 활용사례 등록 후 신청 |
| MVP 역할 | 자체 계산한 인천 시군구별 접근성 결과를 공식 공급도와 비교하는 QA 기준. 행정동 메인 지도에는 너무 거침 |
| 현재 상태 | `SPEC CAPTURED` + `KEY REQUIRED`; 라이브 호출 안 함 |

로컬 명세: `raw/api_specs/data_go_kr_15142078.json`

---

## 4. SGIS 경계·인구·가구·주택 API

공식 문서: [SGIS Open API 기본](https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/basics.html), [인증](https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/authAndUseApi.html), [주소·경계](https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/addressBoundary.html), [센서스 통계](https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/census.html)

### 4.1 인증

```text
GET https://sgisapi.mods.go.kr/OpenAPI3/auth/authentication.json
    ?consumer_key={SERVICE_ID}
    &consumer_secret={SERVICE_SECRET}
```

- 응답의 `accessToken`을 후속 요청에 보낸다. 토큰 유효시간은 4시간이다.
- SGIS 회원가입과 서비스 등록/키 발급이 필요하다.
- 현재 개별 엔드포인트 문서에는 수치 한도가 명시되지 않는다. 이전 공식 소개에는 일반적으로 일 50,000회 이내라고 안내됐으므로 운영 전 서비스 관리 화면에서 현행 한도를 다시 확인한다.
- 현재 상태: `KEY REQUIRED`; 키 발급·호출 안 함.

### 4.2 경계 API

| 데이터 | 정확한 요청 주소와 파라미터 | 단위·주요 필드 | MVP 역할 |
|---|---|---|---|
| 행정구역 경계 | `GET https://sgisapi.mods.go.kr/OpenAPI3/boundary/hadmarea.geojson` — `accessToken`, `year`(문서상 2000~2025), `adm_cd`, `low_search=0\|1\|2` | GeoJSON; `adm_cd`, `adm_nm`, `addr_en`, 중심 `x/y`, geometry. 코드 없음=전국 시도, 2자리=시도, 5자리=시군구, 8자리=행정동 | 연도 일치 행정동 폴리곤 |
| 집계구 경계 | `GET https://sgisapi.mods.go.kr/OpenAPI3/boundary/statsarea.geojson` — `accessToken`, 8자리 행정동 `adm_cd` | 집계구 GeoJSON과 집계구 코드 | 더 세밀한 위험도 시각화. 통계 소수값 억제에 유의 |
| 임의 영역 경계 | `GET https://sgisapi.mods.go.kr/OpenAPI3/boundary/userarea.geojson` — `accessToken`, `minx`, `miny`, `maxx`, `maxy`, `cd=1\|2\|3\|4` | 입력 bbox와 선택 단계(시도/시군구/동/집계구)에 교차하는 경계 | 현재 지도 화면 범위만 요청 |

### 4.3 인구·가구·주택 통계 API

| 데이터 | 정확한 요청 주소와 파라미터 | 단위·필드 | MVP 역할 |
|---|---|---|---|
| 인구 | `GET https://sgisapi.mods.go.kr/OpenAPI3/stats/population.json` — `accessToken`, `year`, `adm_cd`, `low_search`, 선택 분류 필터 | 선택 행정단계; 총인구, 평균연령, 인구밀도 등 | MOIS 인구 집계 교차검증 |
| 가구 | `GET https://sgisapi.mods.go.kr/OpenAPI3/stats/household.json` — `accessToken`, `year`(2015~2024), `adm_cd`, `low_search`, 선택 `household_type`, `ocptn_type` | 행정동/하위단계; `household_cnt`, `adm_cd` 등 | 1인가구·점유형태 보조지표 |
| 주택 | `GET https://sgisapi.mods.go.kr/OpenAPI3/stats/house.json` — `accessToken`, `year`(2015~2024), `adm_cd`, `low_search`, 선택 `house_type`, `const_year`, `house_area_cd`, `house_use_prid_cd` | 행정동/하위단계; `house_cnt`, `adm_cd`; 주택유형·건축연도·면적·사용기간 필터 | 행정동별 노후주택 비중 보조지표 |

SGIS는 인구가 5명 미만인 소지역 통계를 보호 처리할 수 있고 KOSIS/MOIS와 집계 기준이 다르다. 결측을 0으로 바꾸지 않는다.

현재 로컬에는 SGIS API 원문 HTML만 있다: `raw/api_specs/sgis_*.html`. 경계·통계 응답은 아직 내려받지 않았다.

---

## 5. VWorld 건물 WMS/WFS·데이터 API

공식 문서: [WMS 가이드](https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do), [공공데이터포털 GIS건물통합정보 15123970](https://www.data.go.kr/data/15123970/openapi.do)

### 5.1 WMS: 화면용 건물 오버레이

```text
GET https://api.vworld.kr/req/wms
    ?service=WMS
    &version=1.3.0
    &request=GetMap
    &key={VWORLD_KEY}
    &layers=lt_c_bldginfo
    &styles={STYLE}
    &bbox={MINX,MINY,MAXX,MAXY}
    &width={PX}&height={PX}
    &format=image/png
    &transparent=true
    &crs=EPSG:4326
    &domain={REGISTERED_DOMAIN}
```

- 주요 파라미터: `service`, `version`, `request=GetMap\|GetCapabilities\|GetFeatureInfo`, `key`, `layers`(최대 4개), `styles`, `bbox`, `width`, `height`, `format`, `transparent`, `crs`, `domain`.
- 레이어: GIS건물통합정보 `lt_c_bldginfo`; 도로명주소 건물 레이어로 `lt_c_spbd`가 있으나 WFS 제공 여부는 버전별 Capabilities로 재확인한다.
- 반환 필드: GetMap은 이미지라 분석 필드가 없다. GetFeatureInfo를 사용할 때만 해당 레이어 속성을 조회할 수 있다.
- MVP 역할: 지도 확대 시 건물 윤곽을 시각적으로 보여주는 용도. 위험지수 계산에는 WMS 이미지를 쓰지 않는다.

### 5.2 WFS: 건물 피처·속성 조회

```text
GET https://api.vworld.kr/req/wfs
    ?service=WFS
    &version=1.1.0
    &request=GetFeature
    &key={VWORLD_KEY}
    &typename=lt_c_bldginfo
    &bbox={MINX,MINY,MAXX,MAXY}
    &srsname=EPSG:4326
    &output=application/json
    &maxfeatures=1000
    &domain={REGISTERED_DOMAIN}
```

- 주요 파라미터: `typename`(최대 4개), `bbox`, `propertyname`, `srsname`, `output`, `maxfeatures`, `filter`, `domain`.
- 반환 단위: bbox에 포함되는 건물 폴리곤 1개당 피처.
- 속성: geometry와 건물/필지 식별자, 건축물대장 결합 속성. 정확한 영문 속성명은 현재 `DescribeFeatureType`/`GetCapabilities` 응답으로 고정해야 하며, 공식 데이터 설명만 보고 임의 키를 하드코딩하지 않는다.
- 응답 상한: 문서상 `maxfeatures` 최대 1,000. 큰 영역은 격자 bbox로 나눈다.
- MVP 역할: 건물 분포·노후건물 공간집계. WMS보다 분석에 적합하다.

### 5.3 VWorld 2D 데이터 API 대안

```text
GET https://api.vworld.kr/req/data
    ?service=data
    &request=GetFeature
    &data=LT_C_BLDGINFO
    &key={VWORLD_KEY}
    &domain={REGISTERED_DOMAIN}
    &geomFilter={SPATIAL_FILTER}
    &page=1&size=1000
    &geometry=true&attribute=true
    &crs=EPSG:4326
    &format=json
```

- `geomFilter` 또는 `attrFilter`로 범위를 제한한다.
- 반환은 피처 geometry + 요청 속성이다. 건물 연령은 사용승인일 또는 별도 건축물연령정보 데이터로 산출/결합한다.
- 정확한 속성 스키마는 최초 키 발급 뒤 샘플 호출 결과를 명세 파일로 저장해야 한다.

### 5.4 인증·한도·현재 확보한 벌크 원본

| 항목 | 내용 |
|---|---|
| 인증 | VWorld Open API 키 + 호출 도메인 등록. 키는 프런트 번들에 넣지 않고 서버 프록시에서 사용 |
| 승인 | 데이터포털 페이지는 개발 자동 승인, 운영 심의로 안내. VWorld 계정 정책도 함께 적용 |
| 한도 | 공개 가이드에서 고정 수치가 확인되지 않았고 초과 시 `OVER_REQUEST_LIMIT` 오류가 정의됨. 발급 화면의 현행 한도를 기준으로 bbox 캐시 필요 |
| API 현재 상태 | 명세 `SPEC CAPTURED`; `KEY REQUIRED`; API 호출 안 함. MVP는 아래 벌크 원본으로 구현 가능 |
| GIS건물통합정보 벌크 | [VWorld dsId=18](https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18). `DOWNLOADED`: `raw/housing/vworld_incheon_building_integrated_20260809.zip`; 인천 폴리곤 309,851개, EPSG:5186, SHP/DBF/SHX/PRJ/FIX. ZIP 무결성 확인 완료 |
| 건축물연령정보 벌크 | [VWorld dsId=1](https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=1). `DOWNLOADED`: `raw/housing/vworld_incheon_building_age_by_district_20260810.zip`; 현 11개 군구 CSV ZIP, 합계 175,549행. ZIP 무결성 확인 완료 |

로컬 명세: `raw/api_specs/data_go_kr_15123970.json`, `raw/api_specs/vworld_building_integrated.html`, `raw/api_specs/vworld_building_age.html`

건축물연령 CSV의 주요 필드는 `GIS건물통합식별번호`, `고유번호`, `법정동코드/명`, `지번`, `건물식별번호`, `집합건물구분`, `대장종류`, `건물명/동명`, `건물연면적`, `건축물구조`, `주요용도`, `건물높이`, `지상/지하층수`, `허가일자`, `사용승인일자`, `건물연령`, `연령대구분`, `연령대5계급`, `데이터기준일자`, `원천시도시군구코드`다. 법정동 건물을 행정동 경계에 공간조인한 뒤 20년/30년 이상 비중 등을 산출할 수 있다.

GIS건물통합 SHP의 DBF 속성명은 `A0`~`A28` 코드형이므로 공식 필드정의서 없이 의미를 추정하지 않는다. 분석은 별도 건축물연령 CSV의 명시적 컬럼을 우선하고, 통합 SHP는 폴리곤·공간조인에 사용한다. 향후 재다운로드는 VWorld 로그인/다운로드 매니저 절차가 필요할 수 있다.

---

## 6. 행정동·주소 경계와 코드 다운로드

### 6.1 현재 로컬에서 바로 쓰는 경계·코드

| 데이터 | 공식 위치 | 단위·필드 | 상태·주의 |
|---|---|---|---|
| VWorld 센서스 행정동 경계 | [VWorld dsId=30017](https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30017) | 전국 행정동 폴리곤; 압축파일 실측 `BASE_DATE`, 8자리 `ADM_CD`, `ADM_NM`; EPSG:5186 | `DOWNLOADED`: `raw/boundaries/vworld_census_admin_dong_boundary_20260410.zip`. ZIP 검증 완료, 3,559개 폴리곤. 파일 내부 기준일은 **2025-06-30**. 신규 재다운로드는 VWorld 로그인/다운로드 절차 확인 필요 |
| MOIS 행정기관·법정동 코드/매핑 | [행정안전부 행정기관코드 변경내역](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000052) | 행정동코드, 법정동코드, 시도/시군구/읍면동/동리명, 생성·말소일 | `DOWNLOADED`: `raw/boundaries/mois_admin_codes_20260701.zip`과 파생 XLSX |
| 인천 2026 행정체제 개편표 | [인천광역시 공식 안내](https://www.incheon.go.kr/IC01070101) | 개편 전·후 기관/행정동 매핑 | `DOWNLOADED`: 제물포구·영종구·서해구·검단구 전환표 |
| 미추홀구 행정동 경계 샘플 | [공공데이터포털 15128317](https://www.data.go.kr/data/15128317/fileData.do) | 미추홀구 행정동 SHP, 2024-05-31 | `DOWNLOADED`; 렌더링 파이프라인 검증용이지 인천 전체 최신 경계가 아님 |

VWorld 경계 파일은 게시일이 2026-04-10이어도 내부 `BASE_DATE=20250630`이다. 2026-07-01 인천 개편 이전이므로 최신 통계와 직접 이름 조인하지 말고 MOIS 개편표로 코드/행정구역을 변환하거나, 발표 시 “경계는 개편 전 기준”임을 명시한다.

### 6.2 도로명주소 전자지도 다운로드

| 항목 | 내용 |
|---|---|
| 공식 파일데이터 페이지 | [도로명주소 전자지도 15050413](https://www.data.go.kr/data/15050413/fileData.do) |
| 제공 안내 | [도로명주소 개발자센터 전자지도](https://eng.juso.go.kr/addrlink/adresInfoProvd/guidance/provdAdresInfo.do) |
| 접근 방식 | API가 아니라 웹 신청 후 전국/지역 파일 다운로드. 로그인, 본인확인, 이용목적 작성, 제공기관 심의가 필요할 수 있음 |
| 단위·주요 레이어 | 건물, 도로구간, 출입구, 기초구역, 시도/시군구/읍면동/법정리 경계 등 11종. 좌표계는 ITRF2000/GRS80 UTM 계열로 제공 안내 |
| MVP 역할 | 주소 지오코딩·건물 출입구·행정/법정 경계 보강. 이미 VWorld 행정동 경계가 있어 필수는 아님 |
| 현재 상태 | `LOGIN/REVIEW REQUIRED`; 신청·다운로드 안 함 |

### 6.3 도로명주소 검색 API(선택)

```text
GET https://business.juso.go.kr/addrlink/addrLinkApi.do
    ?confmKey={JUSO_KEY}
    &currentPage=1
    &countPerPage=10
    &keyword={URL_ENCODED_ADDRESS}
    &resultType=json
```

- 주요 반환 필드: 도로명주소, 지번주소, 영문주소, 우편번호, 건물관리번호, 행정구역 관련 코드.
- 인증·한도: 승인키 발급 필요. 조사한 공식 안내에서 고정 호출 한도를 확인하지 못했으므로 발급 화면의 현행 정책을 적용한다.
- MVP 역할: 좌표 없는 복지시설 주소 정규화 전처리. 통계 집계 데이터가 아니므로 핵심 위험지수에는 직접 사용하지 않는다.
- 현재 상태: `OPTIONAL` + `KEY REQUIRED`; 호출 안 함.

---

## 7. KOSIS 통계 API

공식 개발 가이드: [통계자료 API](https://kosis.kr/openapi/devGuide/devGuide_0201List.do), [메타 API](https://kosis.kr/openapi/devGuide/devGuide_060101List.do), [통합검색 API](https://kosis.kr/openapi/devGuide/devGuide_0701List.do), [인증·제한 안내](https://kosis.kr/openapi/introduce/introduce_01List.do)

### 7.1 정확한 엔드포인트

| 용도 | 주소 | 핵심 파라미터 |
|---|---|---|
| 파라미터형 통계자료 | `GET https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList` | `apiKey`, `orgId`, `tblId`, `itmId`, `objL1`~`objL8`, `prdSe`, 기간, `format`, `outputFields` |
| 통계자료 일반 | `GET https://kosis.kr/openapi/statisticsData.do?method=getList` | 위와 같은 표·항목·분류·기간 파라미터 |
| 표 메타데이터 | `GET https://kosis.kr/openapi/statisticsData.do?method=getMeta&type=TBL` | `apiKey`, `orgId`, `tblId`, `format` |
| 통계표 검색 | `GET https://kosis.kr/openapi/statisticsSearch.do?method=getList` | `apiKey`, `searchNm`, 선택 `orgId`, `sort`, `startCount`, `resultCount`, `format` |
| 통계목록 | `GET https://kosis.kr/openapi/statisticsList.do?method=getList` | `apiKey`, `vwCd`, `parentId`, `format` |

### 7.2 MVP 후보 표

| 통계표 | 확정 식별자·필드 | 단위 | MVP 역할 |
|---|---|---|---|
| 행정구역(읍면동)별/5세별 주민등록인구 | `orgId=101`, `tblId=DT_1B04005N`; `itmId`는 `T2=총인구`, `T3=남자`, `T4=여자`; `objL1=행정구역`, `objL2=5세 연령` | 읍면동 × 월/연 × 5세 구간 | 65세 이상 인구·추세 검증 |
| 가구원수별 일반가구 | `orgId=101`, `tblId=DT_1JC1502`; `T0=일반가구 계`, `T1=1인` | 읍면동 × 연도 | 1인가구 비중의 센서스 기준 검증 |
| 연령·성별 인구총조사 | `orgId=101`, `tblId=DT_1IN1503`; `T00=총인구`, `T01/T02=남/여` | 읍면동 × 연도 × 연령 | 주민등록 인구와 센서스 인구 차이 검증 |

예시 호출 골격:

```text
GET https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList
    &apiKey={KOSIS_KEY}
    &orgId=101
    &tblId=DT_1B04005N
    &itmId=T2
    &objL1={AREA_CODE_OR_ALL}
    &objL2={AGE_CODE_OR_ALL}
    &prdSe=M
    &startPrdDe=202501
    &endPrdDe=202512
    &format=json
```

- 인증: KOSIS 로그인 후 무료 API 키 신청.
- 한도: 공식 안내 기준 **분당 200회**, 일반 API **요청당 40,000셀**. 큰 표는 기간·지역을 나누고 결과를 캐시한다.
- 분류·항목 코드는 표마다 다르므로 메타 API로 먼저 확인한다.
- 코드체계 주의: 주민등록 통계의 행정기관코드, 인구총조사/KOSIS 분류코드, SGIS 8자리 코드는 길이와 기준이 다를 수 있다. 이름만으로 조인하지 않고 MOIS/SGIS 매핑을 둔다.
- 현재 상태: `KEY REQUIRED`; 키 발급·호출 안 함. 같은 목적의 최신 MOIS CSV가 이미 있어 KOSIS는 MVP 필수가 아니라 추세·교차검증용이다.

---

## 8. 키 발급 우선순위와 구현 순서

1. **키 없이 MVP 완성:** 내려받은 인구·1인세대·수급자·시설·정류소·경계로 행정동 choropleth와 시설/정류소 점을 구현한다.
2. **응급안전안심 대상자/운영기관:** 특정 사업의 읍면동별 등록 현황과 운영기관 공급을 별도 맥락 레이어로 붙인다. 잠재수요에서 빼지 않고 민감 필드는 저장하지 않는다.
3. **인천 버스 API:** 시설 반경 500m, 경유 노선 수, 첫차·막차·배차간격을 붙여 단순 정류소 개수보다 나은 접근성 지표를 만든다.
4. **VWorld 확보 벌크 파일:** 이미 받은 건축물연령 CSV와 건물 폴리곤을 엄격 연결해 정규화 대장 157,049건 중 150,589건(95.89%)을 2025-06-30 기준 156개 지도 구역에 배정했다. 2026 현행 162개 행정동 직접 집계가 아니며, 6,460건의 제외 사유와 결측 커버리지를 `processed/housing_admin_geometry_validation_20260805.json`과 함께 표시한다. API는 자동 갱신이 필요할 때만 붙인다.
5. **SGIS·KOSIS:** 경계연도 보강과 통계 교차검증에 사용한다. 이미 있는 MOIS 자료를 대체할 필요는 없다.
6. **도로명주소 전자지도:** 건물 출입구나 정밀 주소 검색이 실제 데모 요구가 될 때만 신청한다.

## 9. 운영 체크리스트

- 모든 키는 서버 환경변수로 주입하고 브라우저 번들·Git·문서에 넣지 않는다.
- 응답 원문에는 `source_id`, 기준일, 호출일, 페이지, SHA-256을 기록한다.
- ODCloud UUID, 행정구역 코드, VWorld 레이어 스키마는 변경 가능하므로 정기 갱신 전에 OAS/메타를 다시 조회한다.
- 모든 좌표에는 CRS 컬럼을 둔다. WGS84, Bessel TM127, EPSG:5186을 암묵적으로 섞지 않는다.
- 2026-07-01 인천 행정체제 개편 전후 데이터를 하나의 시계열로 보여줄 때는 개편 매핑 버전을 명시한다.
- 응급안전안심 등록자 수를 잠재수요에서 단순 차감해 “미수혜자 수”를 만들지 않는다. 공개 데이터 단계의 UI·발표·API 필드명은 인원수가 아니라 `potential_care_gap_score`, `care_risk_index`처럼 **위험도/우선순위 지수**임을 드러낸다.
