# Data Licenses and Repository Boundary

이 문서는 데이터 출처의 소유권을 주장하거나 법률 자문을 제공하지 않는다. 현재 저장소는 **비공개(private)·내부 해커톤 작업용**이라는 전제에서 원본과 재현 가능한 파생 산출물을 함께 보관한다. 저장소를 공개하거나 외부 서비스로 전환하기 전에는 아래 VWorld 항목을 다시 검토하고, 필요한 경우 제공기관의 서면 승인을 받거나 재배포 가능한 대체 데이터로 교체한다.

## VWorld: Private/Internal Only

### 행정동 경계 (`dsId=30017`)

- 공식 페이지: <https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30017>
- 제공기관 표시: 국가데이터처
- 공식 페이지의 이용허락 표시: `CC BY-NC-ND` (`저작자표시-비영리-변경금지`)
- 공식 설명: 원 저작자를 밝히면 이용할 수 있으나 영리 목적 이용이 불가하고 변경 없이 이용해야 한다.
- 로컬 원본: `raw/boundaries/vworld_census_admin_dong_boundary_20260410.zip` 및 해제된 SHP 구성 파일
- 파생 산출물 예: `processed/boundary_incheon_admin_dong_20250630.geojson`, `processed/map_admin_dong_demographics_202607.geojson`, `processed/map_bubbles_age_65_plus_one_person_202607.geojson`, 경계 crosswalk 및 경계 기반 집계

현재 GeoJSON은 원본 SHP를 인천으로 필터링하고 EPSG:4326으로 재투영했으며, 일부 산출물은 형상 단순화·속성 결합을 포함한다. 이러한 처리가 `ND` 조건에서 공개 재배포가 허용되는지는 확인되지 않았다. 따라서 위 원본과 파생 산출물은 private 저장소와 내부 비영리 프로토타입 범위에서만 관리하며, 공개 GitHub, 공개 다운로드, 공개 API, 상용 서비스로 배포하지 않는다.

[공식 VWorld Q&A #26896](https://www.vworld.kr/dtmk/dtmk_qna_s001.do?svcCde=&dsId=30017&qnaPageIndex=3)에는 법정동·행정동 경계를 지오프로세싱해 사용하라는 안내 사례가 있지만, 이는 가공 결과의 공개 재배포나 상업 이용을 허락한 답변은 아니다.

### 건축물연령정보 (`dsId=1`) 및 GIS건물통합정보 (`dsId=18`)

- 건축물연령정보 공식 페이지: <https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=1&svcCde=NA>
- GIS건물통합정보 공식 페이지: <https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=18&svcCde=NA>
- 원천인 건물통합정보_마스터 공식 페이지: <https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30524>
- `dsId=1`과 `dsId=18` 상세 페이지에는 데이터셋별 라이선스 배지가 보이지 않고 `무상공급`만 표시된다. 무료 제공은 가공·재배포 허락과 같지 않다.
- `dsId=30524`에는 `CC BY-NC-ND`가 명시되어 있다.
- [VWorld 공식 Q&A #29285의 2025-03-14 답변](https://www.vworld.kr/dtmk/dtmk_qna_s001.do?svcCde=NA&dsId=18&qnaPageIndex=6)은 GIS건물통합정보가 건물통합정보_마스터를 원본으로 하고 속성을 한글화한 자료라고 확인했지만, 상업 이용·결합·변형 허용 여부에는 답하지 않고 고객센터 문의를 안내했다.
- 로컬 원본: `raw/housing/vworld_incheon_building_integrated_20260809.zip`, `raw/housing/vworld_incheon_building_age_by_district_20260810.zip` 및 내부 ZIP
- 파생 산출물: `processed/housing_building_age_records.csv.gz`, `processed/housing_building_age_district_summary.csv`, `processed/housing_building_age_legal_dong_summary.csv`

`dsId=1`과 `dsId=18`이 원천 데이터의 `CC BY-NC-ND` 조건을 승계하는지 공식 페이지들만으로 확정할 수 없다. 이 파일들도 private/internal only로 관리한다. 공개 전에는 VWorld 고객센터(공식 사이트 표기 `1661-0115`) 또는 제공기관에 재투영, 형식 변환, 필터링, 통계 집계, 다른 데이터와의 결합, 공개 웹 데모와 저장소 배포 허용 범위를 서면으로 확인한다.

## VWorld General Policies

- 저작권정책: <https://www.vworld.kr/v4po_prcint_a006.do>
- 이용약관: <https://www.vworld.kr/v4po_prcint_a001.do>
- 저작권정책은 공공누리 표시 여부를 확인하도록 하고, 표시가 없는 자료를 사용하려면 제공 담당 부서와 사전 협의하도록 안내한다. 자유이용 자료에도 구체적인 출처 표시가 필요하다.
- 같은 정책은 공공데이터의 영리 목적 활용 원칙을 안내하지만 제3자 권리 예외도 명시한다. 개별 데이터셋에 더 구체적인 표시가 있으면 그 조건을 우선적으로 보수 적용한다.
- 이용약관은 OpenAPI를 이용한 웹 서비스·독립 프로그램 배포를 허용하되 VWorld 이용 사실을 표시하도록 한다. 다운로드 원본과 파생 파일의 재배포 허용으로 확대 해석하지 않는다.

## Public-Release Checklist

공개 저장소, 공개 웹 데모 또는 상용 서비스로 전환하기 전에 다음을 모두 수행한다.

1. VWorld에 `dsId=30017`, `dsId=1`, `dsId=18`의 적용 라이선스와 `dsId=30524` 조건 승계 여부를 서면 확인한다.
2. EPSG:4326 재투영, SHP-to-GeoJSON 변환, 단순화, 지역 필터링, 속성 결합, 통계 집계 및 공개 재배포를 각각 명시해 허용 범위를 확인한다.
3. 허용되지 않거나 답변이 불명확하면 VWorld 원본·파생물을 공개 이력에서 제외하고 재배포 가능한 대체 경계·건물 데이터로 다시 빌드한다.
4. 공개 가능한 경우에도 화면, 발표 자료, 데이터 문서에 제공기관, 데이터셋명, 기준일, 공식 URL과 요구된 저작자 표시를 붙인다.
5. VWorld API를 사용한다면 키를 서버 측 비밀로 관리하고 등록 도메인·호출 한도·표시 의무를 다시 확인한다.

## Other Public Data

나머지 원천은 각 공식 제공 페이지의 이용허락 범위를 따른다. `metadata/source_inventory.csv`와 `metadata/api_catalog.csv`는 출처·접근 상태를 추적하기 위한 인벤토리이며, 그 자체가 재배포 허가를 부여하지 않는다. 데이터셋별 공식 페이지의 이용허락 범위, 공공누리 유형, 개인정보·제3자 권리, 기준일을 공개 전 다시 확인한다.

## Attribution Template

화면과 발표 자료에는 최소한 다음 형식으로 레이어별 출처를 표시한다.

> 출처: [제공기관], [데이터셋명], 기준일 [YYYY-MM-DD], [공식 URL]. 가공: 인천 지역 필터링 및 지도/집계용 변환. 법적 효력 없음.
