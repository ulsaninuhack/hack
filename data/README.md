# I5 Public Care-Priority Map Data Pack

인천 돌봄 우선순위 지도 MVP를 위한 공개 데이터 묶음이다. 원본은 `raw/`에 보존하고, 지도나 분석에 바로 연결할 수 있는 검증 산출물은 `processed/`에 둔다.

이 데이터팩은 동네 단위의 관찰 지표를 보여준다. 공개 집계 데이터만으로 개인의 복지 신청 자격, 실제 미수급 여부, 서비스 필요 여부를 확정하지 않는다.

현재 범위는 care-priority map-first다. 전기·수도 이상징후는 공개 인천 가구 실측이 아니라 `INCHON_CONTEXT`, `MODEL_DEMO_ONLY`, `ACCESS_PATH_ONLY`, `REJECT_MAIN_METRIC`로 분리해 다룬다. 실제 인천 가구/개인 이상징후 데이터는 확보하지 않았고, 정읍 익명 스마트미터 표본은 모델·UX 데모 전용이다.

## Safe MVP Inputs

| Use | File | Safe interpretation |
| --- | --- | --- |
| First polygon layer | `processed/map_admin_dong_demographics_202607.geojson` | 156개 실제 경계 구역에 162개 현행 행정동 통계를 합산한 지도용 choropleth |
| First bubble layer | `processed/map_bubbles_age_65_plus_one_person_202607.geojson` | 65세 이상 1인 가구 수 관찰값을 대표점에 둔 버블 레이어 |
| First map table | `processed/map_demographics_by_geometry_zone_202607.csv` | 지도 구역별 합산 통계와 대표점 좌표 |
| Current administrative stats | `processed/demographics_admin_dong_202607.csv` | 2026-07-01 기준 162개 행정동의 인구, 65세 이상 인구, 1인세대, 65세 이상 1인세대 관찰값 |
| District summary | `processed/demographics_district_summary_202607.csv` | 11개 현행 군구 단위 요약값 |
| Truthful map geometry | `processed/boundary_incheon_admin_dong_20250630.geojson` | 2025-06-30 VWorld 센서스 행정동 경계 156개 구역 |
| Current-to-geometry join | `processed/boundary_current_to_geometry_crosswalk_20260701.csv` | 162개 현행 행정동 통계를 156개 실제 경계 구역에 연결하는 표 |
| Geometry-to-current join | `processed/boundary_geometry_to_current_crosswalk_20260701.csv` | 지도 구역마다 어떤 현행 행정동 통계를 합산해야 하는지 확인하는 표 |
| Welfare context | `processed/welfare_basic_livelihood_2024_current_dong_mapping.csv` | 2024년 기초생활보장 급여별, 연령대별 수급권자 관찰값과 2026 행정동 매핑 상태 |
| Welfare quality issues | `processed/welfare_basic_livelihood_2024_mapping_issues.csv` | 현행 동 단위로 배분하지 않은 원천 지리 단위와 사유 |
| Facilities inventory | `processed/facilities_canonical.csv` | 인천 복지/노인/장애인/장기요양 시설 3,394개 정규화 엔티티 |
| Internal full facility layer | `processed/demo_full_facility_points.geojson` | 내부 해커톤 데모 기본 시설 포인트 3,061개; 공식 시설명·주소·유형 포함, 공개 배포용 아님 |
| Conservative public facility fallback | `processed/public_demo_facility_points.geojson` | 공개 데모용 보수 레이어 151개; 민감 시설 exact point와 운영 필드 제거 |
| Facility map points lineage | `processed/facilities_map_points.csv` | 원천 좌표가 있던 시설 225개 포인트; full layer의 기존 좌표 lineage |
| Transit points | `processed/transit_points.csv` | 인천 범위 안의 버스정류소 6,482개와 지하철역 101개 좌표 |
| Transit enrichment validation | `processed/transit_enrichment_validation.json` | 버스 노선-정류장 순서와 정류장별 승하차 원천의 품질, 조인율, 식별자 주의사항 |
| Transit route supply | `processed/transit_route_stops_supply.csv` | 정류소 번호+정규화 이름의 엄격 조인으로 만든 정류소별 노선 공급 요약 |
| Transit usage points | `processed/transit_stop_usage_points.csv` | 인천 지도용 정류소 승하차 6,231개 포인트; 승하차 건수이며 고유 이용자 수가 아님 |
| Building-age records | `processed/housing_building_age_records.csv.gz` | VWorld 건축물연령정보 157,049개 정규화 건물 레코드 |
| Building-age summaries | `processed/housing_building_age_district_summary.csv`, `processed/housing_building_age_legal_dong_summary.csv` | 11개 군구, 257개 법정동 단위 건물 노후도 참고 요약 |
| Building-age map-zone summary | `processed/housing_admin_geometry_summary_20260805.csv` | 엄격한 GIS ID·공간조인으로 156개 2025 경계 구역에 배정된 건물연령 요약; 현재 162개 행정동 직접값이 아님 |
| Utility data options | `metadata/UTILITY_DATA_OPTIONS.md`, `processed/utilities_validation.json` | 전기·수도 후보의 실제 인천 집계, 타지역 표본, 접근경로, 제외 대상을 분리한 판단 근거 |
| Relevant programs | `processed/programs_relevant.csv` | 고립, 돌봄, 발굴, 안전, 응급 관련 인천 1인가구 사업 86개 |

모든 MVP 화면과 발표 자료는 레이어별 출처와 기준일을 공개한다. 출처가 없는 값, 합성 데이터, 모델 추정값은 관찰값처럼 표시하지 않는다.

## Map-Ready Geometry

- 현재 통계 행은 162개다. `demographics_admin_dong_202607.csv`와 `welfare_basic_livelihood_2024_current_dong_mapping.csv`는 현행 행정동 코드 기준이다.
- 실제 지도 경계는 156개다. `boundary_incheon_admin_dong_20250630.geojson`는 VWorld 2025-06-30 경계라서 2026-07-01 이후 분리된 일부 동의 새 폴리곤을 만들지 않는다.
- 162개 현행 행정동은 모두 경계 구역에 매핑된다. `boundary_validation.json` 기준 `mapped_current_row_count=162`, `mapped_unique_geometry_zone_count=156`, `unmatched_current_row_count=0`이다.
- 한 경계 구역에 여러 현행 동이 붙는 경우는 6개다. 운서동은 운서1동/운서2동, 아라동은 아라1동/아라2동으로 묶고, 4개 출장소 포함 면은 본 면과 같은 경계 구역으로 묶는다.
- 지도에서 색을 칠할 때는 같은 `geometry_zone_id`를 공유하는 행의 분자와 분모를 먼저 합산한 뒤 비율을 다시 계산한다. 비율 컬럼을 평균내지 않는다.
- 바로 화면에 올릴 첫 지도 레이어는 `map_admin_dong_demographics_202607.geojson`와 `map_bubbles_age_65_plus_one_person_202607.geojson`다. `map_layers_validation_202607.json` 기준 162개 현행 행정동 합계와 156개 지도 구역 합계가 일치한다.

## Observed Indicators vs Estimates

현재 산출물은 관찰 지표다.

- 관찰 지표: 주민등록 인구, 주민등록 1인세대, 급여 자격별 수급권자 집계, 시설 목록, 좌표가 있는 시설, 교통 포인트, 공식 사업 목록, 인천 단위 전력·수도 집계.
- 모델 추정값: 아직 없다. 우선순위 점수 산식도 아직 확정하지 않았다. 향후 점수를 만들 경우 별도 파일명과 산식으로 분리하고, 관찰값과 같은 표에 섞지 않는다.
- 모델/UX 데모 전용: `raw/utilities/kwater_jeongeup_anonymized_hourly_smart_meter_2023h1.csv`는 정읍 익명 스마트미터 표본이다. 인천 실측이 아니며 화면에 `정읍 공개표본 기반 시뮬레이션 · 인천 실측 아님`을 표시한다.
- 접근경로 전용: KEPCO EDS, K-water 실시간 시설 API, 인천 원격검침 보도자료는 향후 협약·키·고객동의 경로 근거다. 현재 MVP의 인천 가구 이상징후 입력이 아니다.
- 합성/시뮬레이션 후보: 실제 인천 수용가 데이터가 없을 때 지도상의 가구 점이나 이상징후 이벤트는 합성 좌표·합성 이벤트로만 표기한다.
- 제외: `kepco_legal_dong_power_20251231_dataid15104908.csv`는 스키마/메타데이터 불일치 때문에 법정동 전체 전력 사용량으로 쓰지 않는다.
- 금지된 해석: 공개 집계값을 빼거나 더해서 개인 수급 누락자, 미지원 확정 인원, 개인별 위험자를 만들었다고 설명하지 않는다.

`scripts/build_incheon_base_metrics.py`는 감사용으로 남은 deprecated 스크립트다. 기본 실행은 실패하도록 막혀 있으며, 그 출력과 이전 파생 랭킹은 MVP 입력으로 쓰지 않는다. 자세한 사유는 `processed/welfare_metric_recommendations.json`에 있다.

## Welfare Mapping Status

- `welfare_basic_livelihood_2024_current_dong_mapping.csv`는 162개 현행 행정동 행을 가진다.
- 158개 행은 2024 원천 지리 단위와 1:1로 매핑된다.
- 4개 행은 split unresolved 상태다: 영종구 운서1동, 영종구 운서2동, 검단구 아라1동, 검단구 아라2동.
- 2024 운서동과 아라동 원천값은 사전 분리 단위로 보존하지만, 비공개 배분 키 없이 2026 하위 동으로 나누지 않는다.
- 급여별 수급권자 수는 중복 가능한 자격 수다. 생계, 의료, 주거, 교육 급여를 합산해 distinct person count로 쓰지 않는다.

## Facilities Coverage

- `facilities_canonical.csv`: 3,394개 정규화 시설 엔티티, 주소 커버리지 100.0%, 전화번호 79.46%, 정원/용량 27.75%, 좌표 6.63%.
- `facilities_geocoded_private.csv`: 주소 DB와 VWorld 건물 대표점을 이용해 3,394개 canonical 시설과 1:1로 맞춘 private geocoding 산출물이다. 3,061개 시설에 좌표가 있고 좌표 커버리지는 90.1886%다.
- `demo_full_facility_points.geojson`: 내부 해커톤 데모 기본 시설 레이어다. 3,061개 포인트 중 2,836개는 새로 채운 Juso PNU + VWorld 대표점이고 225개는 원천 좌표다. 좌표가 있는 민감 공식 시설 820개도 포함하지만, 개인/가구/수급자 레코드는 결합하지 않았고 전화번호·정원·현원·운영자·원천 시설코드는 제외했다.
- `public_demo_facility_points.geojson`: 공개 공유가 필요할 때 쓰는 보수 fallback이다. 151개 비민감 공공서비스 포인트만 공개하고 민감 시설 exact point는 군구 집계로만 둔다.
- `facilities_map_points.csv`: 원천 좌표가 있던 225개 시설만 포함하며 모든 행에 `latitude`와 `longitude`가 있다.
- `facilities_all_observations.csv`: 원천 관찰 7,260행을 보존한다. 좌표 커버리지는 3.10%다.
- 좌표가 없는 333개 시설을 지도에 임의 배치하지 않는다. 내부 데모는 `demo_full_facility_points.geojson`, 공개/외부 공유는 `public_demo_facility_points.geojson`를 사용한다.

## Housing Data Status

- VWorld 건물통합정보 bulk zip은 `raw/housing/vworld_incheon_building_integrated_20260809.zip`에 있다.
- VWorld 건축물연령정보는 `raw/housing/vworld_incheon_building_age_by_district_20260810.zip`와 11개 군구 CSV 묶음으로 내려받았다.
- `housing_building_age_records.csv.gz`는 175,549개 원천 행을 157,049개 건물 레코드로 정규화한다.
- `housing_building_age_district_summary.csv`는 11개 군구 요약이고, `housing_building_age_legal_dong_summary.csv`는 257개 법정동 요약이다.
- `housing_admin_geometry_summary_20260805.csv`는 정규화 대장 157,049건 중 150,589건을 156개 2025 경계 구역에 집계한다. strict assignment coverage는 95.886634%다.
- 이 공간 요약은 GIS ID가 단일 경계 구역으로 검증된 레코드만 포함한다. 2026 현행 162개 행정동을 직접 구분하는 자료가 아니며, 정확한 배정률과 제외 사유는 `housing_admin_geometry_validation_20260805.json`을 함께 본다.
- `housing_building_age_validation.json` 기준 공식 건물연령 열의 관측 범위 밖 값 `2028`과 공백은 유효 연령에서 제외한다. 공식 사전이 `2028`의 의미를 정의하지 않으므로 placeholder라고 단정하지 않는다.
- 건축물연령 CSV는 법정동 코드와 군구 단위 입력이며 좌표와 162개 행정동 코드가 없다. 주거 노후도는 군구/법정동 참고 레이어이며, 행정동 polygon 색상으로 바로 쓰지 않는다.
- 건물통합 SHP의 공식 필드 사전에서 공간조인에 사용한 `A1=GIS건물통합식별번호`와 시설 지오코딩에 사용한 `A2=PNU`를 검증했다. 확인하지 않은 나머지 `A0`~`A28` 필드 의미는 추정하지 않는다.

## Transit Enrichment Status

- 기본 지도 포인트는 `transit_points.csv`다. 이 파일은 인천 범위 안의 좌표 있는 버스정류소 6,482개와 지하철역 101개를 포함한다.
- 추가 원천으로 `raw/transit/route_bus_route_stop_sequence_20251231.csv`와 `raw/transit/ridership_bus_stop_usage_20260630.csv`를 받았다.
- `transit_enrichment_validation.json` 기준 노선-정류장 원천은 33,029행, 정류장 승하차 원천은 6,760행이다.
- 노선/승하차 원천에는 좌표가 없다. 지도 좌표는 버스정류소 마스터와 정규화 정류소 번호+이름으로 조인해야 하며, 정류소 번호 단독 조인은 안전하지 않다.
- 엄격 조인으로 노선 33,029행 중 32,868행(99.51%), 승하차 6,760행 중 6,667행(98.62%)을 연결했고, 좌표·인천 범위를 통과한 지도용 승하차 포인트는 6,231개다. 불일치와 모호 조인은 별도 `*_issues.csv`에 보존한다.
- 승하차량은 관찰된 대중교통 이용량이지 복지 미충족이나 돌봄 필요 라벨이 아니다.

## Utility Data Status

- `metadata/UTILITY_DATA_OPTIONS.md`와 `processed/utilities_validation.json`이 전기·수도 후보의 사용 등급을 정의한다.
- 인천 실측 맥락(`INCHON_CONTEXT`)은 6개다. KEPCO 인천본부 시간별 전력, KEPCO 인천본부 연간 정전, KPX 인천 월별 에너지, 인천 군구 상수도 부과량, 인천 유수율, K-water 인천 계량기 현황은 지역 배경 카드나 설명 지표로만 쓴다.
- 모델 데모 전용(`MODEL_DEMO_ONLY`)은 정읍 익명 스마트미터 표본 1개다. 누적 검침값을 차분하고 결측/리셋 후보를 보존해 `생활패턴 확인 필요` 신호를 보여줄 수 있지만, 인천 실측으로 말하지 않는다.
- 접근경로 전용(`ACCESS_PATH_ONLY`)은 KEPCO EDS 카탈로그·필드·코드, 저압 정전 샘플, K-water 시설 실시간 API 같은 향후 협약/키/안심구역 근거다.
- 핵심 입력 제외(`REJECT_MAIN_METRIC`)는 법정동 전력 파일 1개다. 15104908 메타데이터와 실제 스키마가 맞지 않고 상계거래 비식별 파일 의미와 유사하므로 전체 가구 전력으로 쓰지 않는다.
- 검증 기준으로 공개 인천 가구 또는 개인 수준 이상징후 데이터는 없고, 계정 생성·API 키 발급·인증 고객데이터 호출·인천 주민 meter row 확보도 하지 않았다.

## VWorld License Caution

- `raw/api_specs/vworld_admin_boundary.html`에는 VWorld 행정경계 자료의 이용허락이 `CC BY-NC-ND`로 표시되어 있다.
- 현재 GeoJSON은 원천 SHP를 필터링, 좌표변환, 단순화, 속성 결합한 파생물이며, 이러한 가공과 공개 재배포가 `ND` 조건에서 허용되는지는 확인되지 않았다.
- VWorld 건축물연령정보(`dsId=1`)와 GIS건물통합정보(`dsId=18`) 상세 페이지에는 데이터셋별 라이선스 배지가 보이지 않지만, 원천인 건물통합정보_마스터(`dsId=30524`)에는 `CC BY-NC-ND`가 명시되어 있다. 원천 조건의 승계 여부는 VWorld 공식 Q&A에서도 확정되지 않았다.
- 이 데이터팩은 **private/internal 해커톤 작업용**으로 원본과 파생물을 함께 보관한다. 공개 GitHub, 공개 다운로드, 공개 API 또는 상용 서비스로 전환하기 전에 VWorld의 서면 확인을 받거나 재배포 가능한 대체 자료로 교체한다.
- 전체 근거, 적용 범위, 공개 전 체크리스트는 `LICENSES.md`를 따른다. 큰 SHP/DBF/ZIP/GZ는 `.gitattributes`에 Git LFS 대상으로 선언했으며 실제 LFS 설치나 push는 별도 작업이다.

## Raw Data Groups

- `raw/boundaries/`: 행정기관코드, 행정체제 개편 자료, VWorld 센서스 행정동 경계.
- `raw/demographics/`: 주민등록 인구, 1인세대, 세대원수별 세대수, 연도별 추세 후보.
- `raw/welfare/`: 기초생활보장 수급권자 연령별 읍면동 집계, 응급안전안심 대상자 파일.
- `raw/facilities/`: 사회복지시설, 노인복지시설, 장기요양기관, 장애인 복지시설.
- `raw/transit/`: 버스정류소, 지하철역.
- `raw/policies/`: 인천 1인가구/돌봄 사업 페이지와 2026 통합돌봄 계획.
- `raw/housing/`: VWorld 건물통합정보와 건축물연령정보 bulk 파일.
- `raw/utilities/`: KEPCO, KPX, K-water, 인천 상수도 전기·수도 후보 파일. 실제 인천 가구 이상징후 원천이 아니라 사용 등급별 후보로 관리한다.
- `raw/reference/`: `hackathon_participant_guide_0810.pdf` 공식 참가 가이드. 과제 요구와 제출 맥락 확인용이며 데이터 지표가 아니다.
- `raw/api_specs/`: API 명세 HTML/JSON. 키, 활용신청, 로그인 필요 항목은 명세만 저장했다.

출처 공개는 필수다. 원천 목록은 `metadata/source_inventory.csv`, API 후보와 접근 제한은 `metadata/api_catalog.csv`, 파일 해시는 `metadata/checksums.sha256`에서 확인한다.

## Build Order

아래 명령은 `work/i5-data`에서 실행한다. 순서는 현재 validation 산출물과 스크립트 존재를 기준으로 검토했다.

```bash
python3 scripts/build_admin_crosswalk.py
python3 scripts/build_boundaries.py
python3 scripts/build_demographics.py
python3 scripts/build_map_layers.py
python3 scripts/build_welfare.py
python3 scripts/build_facilities.py
PYTHONPATH=.deps python3 scripts/build_facility_geocoding.py
python3 scripts/build_transit.py
python3 scripts/build_transit_enrichment.py
python3 scripts/build_housing.py
python3 scripts/build_housing_spatial.py
python3 scripts/build_trends.py
python3 scripts/build_programs.py --offline --throttle 0
python3 scripts/build_public_demo_exports.py
python3 scripts/build_inventory.py
shasum -a 256 -c metadata/checksums.sha256
```

`build_inventory.py`는 모든 raw 수집·캐시 생성이 끝난 뒤 마지막에 실행해 `metadata/source_inventory.csv`, `metadata/checksums.sha256`, `metadata/api_catalog.csv`, `metadata/inventory_summary.md`를 다시 쓴다. `build_incheon_base_metrics.py`는 정상 빌드 순서에서 제외한다.

## Validation Files

- `processed/admin_crosswalk_validation.json`: 현행 162개 행정동 코드와 11개 군구 구성 확인.
- `processed/boundary_validation.json`: 156개 경계 구역, 162개 현행 동 매핑, 6개 집계 그룹, GeoJSON 유효성 확인.
- `processed/map_layers_validation_202607.json`: 162개 현행 행정동 관찰값을 156개 지도 구역으로 합산한 첫 polygon/bubble 레이어 확인.
- `processed/demographics_validation_202607.json`: 주민등록 인구/세대/1인세대 원천 합계와 키 정합성 확인.
- `processed/welfare_basic_livelihood_2024_validation.json`: 158개 exact mapping, 4개 split unresolved, 자격별 수급권자 중복 해석 제한 확인.
- `processed/transit_validation.json`: 버스 위경도 헤더 교정, 지하철 EPSG:3857 변환, 인천 범위 포인트 확인.
- `processed/transit_enrichment_validation.json`: 노선-정류장 순서, 정류장 승하차 원천, 버스정류소 마스터 조인율과 식별자 충돌 주의사항 확인.
- `processed/housing_building_age_validation.json`: 157,049개 건물 레코드, 11개 군구 요약, 257개 법정동 요약, 유효 건물연령 정책 확인.
- `processed/housing_admin_geometry_validation_20260805.json`: 150,589개 건물연령 레코드의 156개 경계 구역 배정, 95.886634% strict assignment coverage, 제외 사유 확인.
- `processed/facilities_geocoding_validation.json`: 3,061/3,394 시설 좌표, 2,836개 신규 Juso PNU + VWorld 대표점, private geocoding 범위 확인.
- `processed/demo_full_facility_points_validation.json`: 내부 데모 기본 시설 포인트 3,061개, 민감 시설 820개 포함, 운영/개인 필드 제외 확인.
- `processed/public_demo_validation.json`: 공개 fallback 시설·인구 레이어의 민감 exact point 제거와 작은 셀 억제 확인.
- `processed/utilities_validation.json`: 전기·수도 후보의 인천 집계, 타지역 모델 표본, 접근경로, 제외 대상 분리 확인.
- `processed/trends_validation.json`: 2021-2025 연말 추세 원천 합계와 65세 이상 미산출 정책 확인.
- `processed/programs_validation.json`: 173개 공식 사업 상세 캐시 파싱과 86개 관련 사업 선별 확인.
- 시설 검증은 `processed/facilities_coverage_summary.csv`, `processed/facilities_quality_issues.csv`, `processed/facilities_dedup_groups.csv`로 확인한다.

## Naming Guardrail

사용 가능:

- `돌봄 우선순위 후보`
- `취약성 관찰 지표`
- `안전망 검토 우선 지역`
- `행정동 단위 위험 신호`

피해야 함:

- `복지를 받아야 하는데 못 받는 사람`
- `미수급자 확정`
- `개인별 고독사 위험자`
- `공개 데이터로 확인한 서비스 누락 인원`

이 프로젝트의 가치는 개인정보 없이 집계 데이터로 먼저 검토할 지역을 좁히는 데 있다. 지도 문구와 발표 문구도 이 한계를 유지한다.
