#!/usr/bin/env python3
"""Build a lightweight inventory for the I5 public-data bundle."""

from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path
from typing import Iterable

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
METADATA = ROOT / "metadata"

CSV_ENCODINGS = ("utf-8-sig", "cp949", "euc-kr")

VWORLD_BOUNDARY_URL = (
    "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=MK&dsId=30017"
)
VWORLD_BUILDING_INTEGRATED_URL = (
    "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18"
)
VWORLD_BUILDING_AGE_URL = (
    "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=1"
)
VWORLD_COLUMN_DICTIONARY_URL = (
    "https://www.vworld.kr/contents/"
    "%EA%B5%AD%EA%B0%80%EC%A4%91%EC%A0%90%EB%8D%B0%EC%9D%B4%ED%84%B0_"
    "%EC%BB%AC%EB%9F%BC%EC%A0%95%EC%9D%98%EC%84%9C(26.01.02)_"
    "%EB%B0%B0%ED%8F%AC%EC%9A%A9.xlsx"
)
INCHOEN_PROGRAM_BASE = "https://www.incheon.go.kr/1in/OHH020108"

DEFAULT_PUBLIC_TERMS = "See the official source page for current license and reuse terms."
VWORLD_BOUNDARY_TERMS = (
    "CC BY-NC-ND on the VWorld dataset page; attribution, noncommercial, "
    "and no-derivatives restrictions apply."
)
VWORLD_HOUSING_TERMS = (
    "Exact license confirmation pending; do not redistribute the housing bulk files until verified."
)

SOURCE_CATALOG = {
    "korea_population_by_sex_age_admin_dong_20260630.csv": {
        "source_name": "행정안전부_지역별(행정동) 성별 연령별 주민등록 인구수_20260630",
        "source_url": "https://www.data.go.kr/data/15097972/fileData.do",
        "use": "행정동별 총인구, 65세 이상 인구, 고령화율",
        "join_key": "행정기관코드, 시도명, 시군구명, 읍면동명",
        "access": "downloaded",
    },
    "korea_one_person_households_by_sex_age_admin_dong_20260731.csv": {
        "source_name": "행정안전부_지역별(행정동) 성별 연령별 주민등록 1인세대수_20260731",
        "source_url": "https://www.data.go.kr/data/15097973/fileData.do",
        "use": "행정동별 1인세대, 65세 이상 1인세대 추정",
        "join_key": "행정기관코드, 시도명, 시군구명, 읍면동명",
        "access": "downloaded",
    },
    "korea_households_by_size_admin_dong_20260731.csv": {
        "source_name": "행정안전부_지역별(행정동) 세대원수별 주민등록 세대수_20260731",
        "source_url": "https://www.data.go.kr/data/15097974/fileData.do",
        "use": "행정동별 전체세대수, 1인세대 비율",
        "join_key": "행정기관코드, 시도명, 시군구명, 읍면동명",
        "access": "downloaded",
    },
    "incheon_basic_livelihood_recipients_by_age_dong_20241231.csv": {
        "source_name": "인천광역시_국민기초생활수급자 연령별 읍면동 단위 현황_20241231",
        "source_url": "https://www.data.go.kr/data/15128192/fileData.do",
        "use": "읍면동별 취약계층 규모, 65세 이상 수급자",
        "join_key": "시군구, 읍면동",
        "access": "downloaded",
    },
    "incheon_basic_livelihood_recipients_by_age_dong_20231231.csv": {
        "source_name": "인천광역시_국민기초생활수급자 연령별 읍면동 단위 현황_20231231",
        "source_url": "https://www.data.go.kr/data/15128192/fileData.do",
        "use": "읍면동별 취약계층 추세",
        "join_key": "시도, 시군구, 읍면동",
        "access": "downloaded",
    },
    "incheon_basic_livelihood_recipients_by_age_dong_20221231.csv": {
        "source_name": "인천광역시_국민기초생활수급자 연령별 읍면동 단위 현황_20221231",
        "source_url": "https://www.data.go.kr/data/15128192/fileData.do",
        "use": "읍면동별 취약계층 추세",
        "join_key": "시도, 시군구, 읍면동",
        "access": "downloaded",
    },
    "incheon_basic_livelihood_recipients_by_age_dong_20211231.csv": {
        "source_name": "인천광역시_국민기초생활수급자 연령별 읍면동 단위 현황_20211231",
        "source_url": "https://www.data.go.kr/data/15128192/fileData.do",
        "use": "읍면동별 취약계층 추세",
        "join_key": "시도, 시군구, 읍면동",
        "access": "downloaded",
    },
    "incheon_basic_livelihood_recipients_by_age_dong_20201231.csv": {
        "source_name": "인천광역시_국민기초생활수급자 연령별 읍면동 단위 현황_20201231",
        "source_url": "https://www.data.go.kr/data/15128192/fileData.do",
        "use": "읍면동별 취약계층 추세",
        "join_key": "시도, 시군구, 읍면동",
        "access": "downloaded",
    },
    "emergency_safety_service_targets_20240520.csv": {
        "source_name": "보건복지부_응급안전안심_서비스 대상자 기본정보_20240520",
        "source_url": "https://www.data.go.kr/data/15128127/fileData.do",
        "use": "시군구 단위 기존 응급안전안심서비스 대상자 기준선",
        "join_key": "시도, 시군구",
        "access": "downloaded",
    },
    "incheon_welfare_facilities_20250131.csv": {
        "source_name": "인천광역시_사회복지시설 현황_20250131",
        "source_url": "https://www.data.go.kr/data/15045181/fileData.do",
        "use": "군구별 복지시설 공급, 주소 기반 지오코딩 후보",
        "join_key": "군구명, 주소",
        "access": "downloaded",
    },
    "incheon_elderly_welfare_facilities_20260630.xlsx": {
        "source_name": "인천광역시_노인복지시설 현황_20260630",
        "source_url": "https://www.incheon.go.kr/welfare/WE010216",
        "use": "노인복지시설 유형별 시설수, 정원, 현원",
        "join_key": "군구/시설명/주소",
        "access": "downloaded",
    },
    "nhis_long_term_care_facilities_20260610.xlsx": {
        "source_name": "국민건강보험공단_장기요양기관 시설별 현황_20260610",
        "source_url": "https://www.data.go.kr/data/15124763/fileData.do",
        "use": "장기요양기관 전국 원장, 인천 필터 후 정원/인력 공급",
        "join_key": "법정동코드, 시도 시군구 법정동명",
        "access": "downloaded",
    },
    "incheon_bus_stops_20260228.csv": {
        "source_name": "인천광역시_시내버스 정류소 현황_20260228",
        "source_url": "https://www.data.go.kr/data/15074309/fileData.do",
        "use": "행정동별 버스정류장 공급, 접근성 지표",
        "join_key": "권역, 행정동 명, 위도, 경도",
        "access": "downloaded",
    },
    "incheon_subway_stations_20250919.csv": {
        "source_name": "인천광역시_행정정보클라우드GIS포털 지하철 역정보_20250918",
        "source_url": "https://www.data.go.kr/data/15120612/fileData.do",
        "use": "지하철 접근성 지표",
        "join_key": "행정동_코드, X좌표, Y좌표",
        "access": "downloaded",
    },
    "mois_admin_codes_20260701.zip": {
        "source_name": "행정안전부 행정기관 및 관할구역 변경내역 / 행정기관코드 20260701",
        "source_url": "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000052",
        "use": "2026-07-01 인천 행정구역 개편 후 행정기관코드/법정동 매핑",
        "join_key": "행정기관코드, 법정동코드",
        "access": "downloaded",
    },
    "michuhol_admin_dong_20240531.zip": {
        "source_name": "인천광역시 미추홀구_행정동 경계_20240531",
        "source_url": "https://www.data.go.kr/data/15128317/fileData.do",
        "use": "SHP 경계 샘플 및 지도 렌더링 파이프라인 검증",
        "join_key": "행정동명",
        "access": "downloaded",
    },
    "jemulpo_solitary_elderly.csv": {
        "source_name": "인천광역시 동구_동별독거노인현황_20251119 (2026 개편 전 스냅샷)",
        "source_url": "https://www.data.go.kr/data/15098033/fileData.do",
        "use": "구 동구 관할의 2025 독거노인 보조 검증; 현 제물포구 전체로 해석 금지",
        "join_key": "행정동명",
        "access": "downloaded",
    },
    "yeonsu_solitary_elderly.csv": {
        "source_name": "인천광역시 연수구_동별 독거노인 현황_20251231",
        "source_url": "https://www.data.go.kr/data/15064935/fileData.do",
        "use": "연수구 동별 독거노인 보조 검증",
        "join_key": "행정동명",
        "access": "downloaded",
    },
    "michuhol_elderly_welfare_facilities.csv": {
        "source_name": "인천광역시 미추홀구_노인복지시설_20250620",
        "source_url": "https://www.data.go.kr/data/15070559/fileData.do",
        "use": "좌표 포함 노인복지시설 샘플 및 시설 접근성 검증",
        "join_key": "주소, 위도, 경도",
        "access": "downloaded",
    },
    "incheon_disabled_day_facilities_20250630.csv": {
        "source_name": "인천광역시_장애인주간 이용시설 현황_20250630",
        "source_url": "https://www.data.go.kr/data/15103286/fileData.do",
        "use": "장애인 돌봄/주간 이용시설 공급",
        "join_key": "군구명, 소재지",
        "access": "downloaded",
    },
    "incheon_disabled_residential_facilities_20260228.csv": {
        "source_name": "인천광역시_장애인거주시설현황_20260228",
        "source_url": "https://www.data.go.kr/data/15104066/fileData.do",
        "use": "장애인 거주시설 공급",
        "join_key": "시설명, 소재지",
        "access": "downloaded",
    },
    "yeonsu_disabled_facilities_20260316.csv": {
        "source_name": "인천광역시 연수구_장애인 복지시설 현황_20260309",
        "source_url": "https://www.data.go.kr/data/15085414/fileData.do",
        "use": "좌표 포함 장애인 복지시설 샘플",
        "join_key": "시설명, 위도, 경도",
        "access": "downloaded",
    },
    "mois_incheon_change_detail_20260701_1.xlsx": {
        "source_name": "인천광역시 행정체제 개편 행정동 변경내역 20260701",
        "source_url": "https://www.incheon.go.kr/IC01070101",
        "use": "제물포구/영종구 전환 매핑",
        "join_key": "변경 전 행정동, 변경 후 행정동",
        "access": "downloaded",
    },
    "mois_incheon_change_detail_20260701_2.xlsx": {
        "source_name": "인천광역시 행정체제 개편 행정동 변경내역 20260701",
        "source_url": "https://www.incheon.go.kr/IC01070101",
        "use": "서해구/검단구 전환 매핑",
        "join_key": "변경 전 행정동, 변경 후 행정동",
        "access": "downloaded",
    },
    "admin_reform.html": {
        "source_name": "인천 행정체제 개편에 따른 고시공고 조회 일시 중단 안내",
        "source_url": "https://www.incheon.go.kr/IC010101/view?nttNo=2045945",
        "use": "행정체제 개편 관련 운영 공지 원문",
        "join_key": "",
        "access": "downloaded",
    },
    "elderly_customized_care.html": {
        "source_name": "보건복지부 노인맞춤돌봄서비스",
        "source_url": "https://www.mohw.go.kr/menu.es?mid=a10712010400",
        "use": "공식 대상자 조건 및 서비스 내용 근거",
        "join_key": "",
        "access": "downloaded",
    },
    "incheon_integrated_care_plan_2026.pdf": {
        "source_name": "인천광역시 2026 통합돌봄 시행계획",
        "source_url": "https://www.incheon.go.kr/1in/OHH010104",
        "use": "인천 돌봄 정책 맥락 및 사업명 근거",
        "join_key": "",
        "access": "downloaded",
    },
    "one_person_programs.html": {
        "source_name": "인천광역시 1인가구 정서 분야 지원사업 목록",
        "source_url": (
            "https://www.incheon.go.kr/1in/OHH020108?icnMnDvsnCd=OHH020101"
        ),
        "use": "정서 분야 현행 지원사업 목록",
        "join_key": "",
        "access": "downloaded",
    },
    "one_person_care.html": {
        "source_name": "인천광역시 1인가구 프로그램 일정",
        "source_url": "https://www.incheon.go.kr/1in/OHH020109",
        "use": "1인가구 프로그램 일정 원문",
        "join_key": "",
        "access": "downloaded",
    },
    "one_person_plan.html": {
        "source_name": "인천광역시 1인가구 2026년 시행계획",
        "source_url": "https://www.incheon.go.kr/1in/OHH010104",
        "use": "2026년 1인가구 시행계획 원문",
        "join_key": "",
        "access": "downloaded",
    },
    "route_bus_route_stop_sequence_20251231.csv": {
        "source_name": "인천광역시_버스노선별 정류장 현황_20251231",
        "source_url": "https://www.data.go.kr/data/15048265/fileData.do",
        "use": "노선-정류소 순서와 오프라인 대중교통 그래프",
        "join_key": "노선ID, 정류소ID, 순번",
        "access": "downloaded",
    },
    "ridership_bus_stop_usage_20260630.csv": {
        "source_name": "인천광역시_정류장별 이용승객 현황_20260630",
        "source_url": "https://www.data.go.kr/data/15048264/fileData.do",
        "use": "정류소별 승하차 수요와 교통 접근성 보조지표",
        "join_key": "정류소ID/정류소번호",
        "access": "downloaded",
    },
    "data_go_kr_15098762.json": {
        "source_name": "보건복지부_응급안전안심 서비스 대상자 기본정보 API 메타",
        "source_url": "https://www.data.go.kr/data/15098762/openapi.do",
        "use": "최신 응급안전안심 대상자 API 명세",
        "join_key": "시도, 시군구, 읍면동",
        "access": "approval_required",
    },
    "data_go_kr_15098764.json": {
        "source_name": "보건복지부_응급안전안심 서비스 운영기관정보 API 메타",
        "source_url": "https://www.data.go.kr/data/15098764/openapi.do",
        "use": "응급안전안심 운영기관 API 명세",
        "join_key": "시도, 시군구, 운영기관",
        "access": "approval_required",
    },
    "data_go_kr_15123970.json": {
        "source_name": "국토교통부_GIS건물통합정보(WMS/WFS) API 메타",
        "source_url": "https://www.data.go.kr/data/15123970/openapi.do",
        "use": "건물 노후도/공간정보 API 명세",
        "join_key": "건물/법정동/좌표",
        "access": "approval_required",
    },
    "data_go_kr_15142078.json": {
        "source_name": "국토교통부_정류장 공급도 API 메타",
        "source_url": "https://www.data.go.kr/data/15142078/openapi.do",
        "use": "대중교통 접근성 공식 공급도 API 명세",
        "join_key": "지역/좌표",
        "access": "approval_required",
    },
    "data_go_kr_15058487.json": {
        "source_name": "인천광역시_버스노선 조회 API 메타",
        "source_url": "https://www.data.go.kr/data/15058487/openapi.do",
        "use": "노선-정류장 연결 API 명세",
        "join_key": "노선번호, 정류소ID",
        "access": "approval_required",
    },
}

API_CATALOG_FIELDS = [
    "id",
    "provider",
    "name",
    "interface",
    "source_url",
    "request_url",
    "spec_status",
    "local_status",
    "access_status",
    "optional",
    "live_call_status",
    "local_paths",
    "why",
]


def api_row(
    id: str,
    provider: str,
    name: str,
    interface: str,
    source_url: str,
    request_url: str = "",
    spec_status: str = "",
    local_status: str = "",
    access_status: str = "",
    optional: str = "FALSE",
    live_call_status: str = "NOT CALLED",
    local_paths: str = "",
    why: str = "",
) -> dict[str, str]:
    return {field: value for field, value in locals().items() if field in API_CATALOG_FIELDS}


API_CATALOG = [
    api_row(
        "emergency_target_api", "보건복지부", "응급안전안심 서비스 대상자 기본정보", "REST API",
        "https://www.data.go.kr/data/15098762/openapi.do",
        "https://apis.data.go.kr/1352000/ODMS_EMG_01/callEmg01Api",
        "SPEC CAPTURED", "", "KEY REQUIRED; APPROVAL REQUIRED", local_paths="raw/api_specs/data_go_kr_15098762.json",
        why="특정 서비스의 최신 읍면동별 등록 현황을 별도 맥락으로 집계",
    ),
    api_row(
        "emergency_operator_api", "보건복지부", "응급안전안심 서비스 운영기관정보", "REST API",
        "https://www.data.go.kr/data/15098764/openapi.do",
        "https://apis.data.go.kr/1352000/ODMS_EMG_02/callEmg02Api",
        "SPEC CAPTURED", "", "KEY REQUIRED; APPROVAL REQUIRED", local_paths="raw/api_specs/data_go_kr_15098764.json",
        why="운영기관 위치와 담당권역 갱신",
    ),
    api_row(
        "odcloud_file_data", "공공데이터포털", "핵심 파일데이터 ODCloud 자동변환", "ODCloud REST API",
        "https://www.data.go.kr/", "https://api.odcloud.kr/api/{datasetId}/v1/uddi:{resourceUuid}",
        "SPEC CAPTURED", "DOWNLOADED", "KEY REQUIRED",
        local_paths="raw/api_specs/odcloud_*_oas.json; raw/demographics/*; raw/welfare/*; raw/facilities/*; raw/transit/*",
        why="MVP 스냅샷은 이미 다운로드됨; 키는 정기 갱신에만 필요",
    ),
    api_row(
        "mois_jumin_csv", "행정안전부", "주민등록 인구통계 직접 CSV", "Web-form CSV download",
        "https://jumin.mois.go.kr/", "https://jumin.mois.go.kr/downloadCsvAge.do",
        "", "DOWNLOADED", "", live_call_status="DOWNLOADED",
        local_paths="raw/demographics/jumin_*.csv", why="2021~2025 추세 스냅샷; 키 없는 저빈도 다운로드",
    ),
    api_row(
        "incheon_bus_station_api", "인천광역시", "좌표 주변 정류소·경유 노선", "REST API",
        "https://www.data.go.kr/data/15056529/openapi.do",
        "https://apis.data.go.kr/6280000/busStationService/getBusStationAroundList",
        "", "", "KEY REQUIRED", optional="TRUE", why="시설 반경 500m 정류소·경유 노선 보강",
    ),
    api_row(
        "incheon_bus_route_api", "인천광역시", "버스노선 조회", "REST API",
        "https://www.data.go.kr/data/15058487/openapi.do",
        "https://apis.data.go.kr/6280000/busRouteService",
        "SPEC CAPTURED", "", "KEY REQUIRED", local_paths="raw/api_specs/data_go_kr_15058487.json",
        why="첫차·막차·배차간격 자동 갱신",
    ),
    api_row(
        "incheon_bus_route_stop_bulk", "인천광역시", "버스노선별 정류장 현황", "File data",
        "https://www.data.go.kr/data/15048265/fileData.do", local_status="DOWNLOADED",
        live_call_status="DOWNLOADED", local_paths="raw/transit/route_bus_route_stop_sequence_20251231.csv",
        why="키 없이 오프라인 노선-정류소 그래프 구축",
    ),
    api_row(
        "incheon_bus_ridership_bulk", "인천광역시", "정류장별 이용승객 현황", "File data",
        "https://www.data.go.kr/data/15048264/fileData.do", local_status="DOWNLOADED", optional="TRUE",
        live_call_status="DOWNLOADED", local_paths="raw/transit/ridership_bus_stop_usage_20260630.csv",
        why="정류소 수요 가중치 보강",
    ),
    api_row(
        "transport_stop_supply_api", "국토교통부", "정류장 공급도", "REST API",
        "https://www.data.go.kr/data/15142078/openapi.do",
        "https://apis.data.go.kr/1613000/TransportationStopSupplyLevel/getTransportationStopSupplyLevel",
        "SPEC CAPTURED", "", "KEY REQUIRED", optional="TRUE",
        local_paths="raw/api_specs/data_go_kr_15142078.json", why="시군구 공식 공급도 교차검증",
    ),
    api_row(
        "sgis_open_api", "통계청 SGIS", "경계·인구·가구·주택", "REST/GeoJSON API",
        "https://sgis.mods.go.kr/developer/", "https://sgisapi.mods.go.kr/OpenAPI3/",
        "SPEC CAPTURED", "", "KEY REQUIRED", optional="TRUE", local_paths="raw/api_specs/sgis_*.html",
        why="연도별 경계·집계구와 센서스 교차검증",
    ),
    api_row(
        "kwater_realtime_flow_api", "한국수자원공사", "실시간 수도정보 유량(시간)", "REST API",
        "https://www.data.go.kr/data/15056653/openapi.do", spec_status="SPEC CAPTURED",
        access_status="KEY REQUIRED", optional="TRUE",
        local_paths="raw/api_specs/data_go_kr_15056653.json; raw/api_specs/kwater_realtime_water_flow_15056653_api_guide_v1.1.docx",
        why="실시간 공급 이상 검증 후보; 자동승인 API이나 서비스키 필요",
    ),
    api_row(
        "kwater_realtime_level_api", "한국수자원공사", "실시간 수도정보 수위(시간)", "REST API",
        "https://www.data.go.kr/data/15057371/openapi.do", spec_status="SPEC CAPTURED",
        access_status="KEY REQUIRED", optional="TRUE",
        local_paths="raw/api_specs/data_go_kr_15057371.json; raw/api_specs/kwater_realtime_water_level_15057371_api_guide_v1.2.docx",
        why="실시간 공급 이상 검증 후보; 자동승인 API이나 서비스키 필요",
    ),
    api_row(
        "kwater_realtime_quality_api", "한국수자원공사", "실시간 수도정보 수질(시간)", "REST API",
        "https://www.data.go.kr/data/15057290/openapi.do", spec_status="SPEC CAPTURED",
        access_status="KEY REQUIRED", optional="TRUE",
        local_paths="raw/api_specs/data_go_kr_15057290.json; raw/api_specs/kwater_realtime_water_quality_15057290_api_guide_v1.2.docx",
        why="실시간 공급 이상 검증 후보; 자동승인 API이나 서비스키 필요",
    ),
    api_row(
        "kwater_realtime_pressure_api", "한국수자원공사", "실시간 수도정보 압력(시간)", "REST API",
        "https://www.data.go.kr/data/15058037/openapi.do", spec_status="SPEC CAPTURED",
        access_status="KEY REQUIRED", optional="TRUE",
        local_paths="raw/api_specs/data_go_kr_15058037.json; raw/api_specs/kwater_realtime_water_pressure_15058037_oas.json",
        why="실시간 공급 이상 검증 후보; 자동승인 API이나 서비스키 필요",
    ),
    api_row(
        "kepco_household_average_power_api", "한국전력공사", "가구 평균 전력사용량", "Open API",
        "https://www.data.go.kr/data/15101404/openapi.do", spec_status="SPEC CAPTURED",
        access_status="KEY REQUIRED", optional="TRUE", local_paths="raw/api_specs/data_go_kr_15101404.json",
        why="전력 취약성 교차검증 후보; 라이브 호출은 하지 않음",
    ),
    api_row(
        "vworld_building_api", "국토교통부 VWorld", "GIS건물통합정보 WMS/WFS/Data", "WMS/WFS/Data API",
        "https://www.data.go.kr/data/15123970/openapi.do", "https://api.vworld.kr/req/{wms|wfs|data}",
        "SPEC CAPTURED", "", "KEY REQUIRED", optional="TRUE",
        local_paths="raw/api_specs/data_go_kr_15123970.json", why="키는 자동 갱신·대화형 조회에만 필요; MVP 벌크는 확보됨",
    ),
    api_row(
        "vworld_building_integrated_bulk", "국토교통부 VWorld", "GIS건물통합정보 벌크", "Bulk download",
        VWORLD_BUILDING_INTEGRATED_URL, local_status="DOWNLOADED", live_call_status="DOWNLOADED",
        local_paths="raw/housing/vworld_incheon_building_integrated_20260809.zip",
        why="인천 건물 폴리곤 309,851개; 기존 스냅샷 사용에 API 키 불필요",
    ),
    api_row(
        "vworld_building_age_bulk", "국토교통부 VWorld", "건축물연령정보 벌크", "Bulk download",
        VWORLD_BUILDING_AGE_URL, local_status="DOWNLOADED", live_call_status="DOWNLOADED",
        local_paths="raw/housing/vworld_incheon_building_age_by_district_20260810.zip",
        why="현 11개 군구 CSV 175,549행; 기존 스냅샷 사용에 API 키 불필요",
    ),
    api_row(
        "vworld_admin_boundary_bulk", "국토교통부 VWorld", "센서스 행정동 경계 벌크", "Bulk download",
        VWORLD_BOUNDARY_URL, local_status="DOWNLOADED", live_call_status="DOWNLOADED",
        local_paths="raw/boundaries/vworld_census_admin_dong_boundary_20260410.zip",
        why="전국 3,559개 폴리곤, 내부 기준일 2025-06-30; 기존 스냅샷 사용에 API 키 불필요",
    ),
    api_row(
        "juso_electronic_map_bulk", "행정안전부", "도로명주소 전자지도", "Bulk download",
        "https://www.data.go.kr/data/15050413/fileData.do", local_status="", access_status="LOGIN/REVIEW REQUIRED",
        optional="TRUE", why="정밀 건물 출입구가 실제 데모 요구가 될 때만 신청",
    ),
    api_row(
        "juso_building_db_bulk", "행정안전부 주소기반산업지원서비스", "건물DB 월전체", "Public bulk download",
        "https://business.juso.go.kr/", local_status="DOWNLOADED", live_call_status="DOWNLOADED",
        local_paths="raw/address/juso_building_db_202607.zip",
        why="2026-07 공개 월전체 건물DB; 기존 스냅샷과 공식 다운로드 모두 키 불필요",
    ),
    api_row(
        "juso_search_api", "행정안전부", "도로명주소 검색", "REST API",
        "https://business.juso.go.kr/addrlink/openApi/apiExprn.do",
        "https://business.juso.go.kr/addrlink/addrLinkApi.do", access_status="KEY REQUIRED",
        optional="TRUE", why="주소 정규화 선택 보강",
    ),
    api_row(
        "kosis_api", "통계청 KOSIS", "통계자료·메타 API", "REST API",
        "https://kosis.kr/openapi/", "https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList",
        access_status="KEY REQUIRED", optional="TRUE", why="추세 및 통계 교차검증; MVP 필수 아님",
    ),
]


def detect_csv(path: Path) -> tuple[str, int, int, list[str]]:
    errors = []
    for encoding in CSV_ENCODINGS:
        try:
            df = pd.read_csv(path, encoding=encoding, low_memory=False)
            return encoding, len(df), len(df.columns), [str(c).strip() for c in df.columns[:12]]
        except Exception as exc:  # noqa: BLE001 - inventory should record any parser issue
            errors.append(f"{encoding}: {exc}")
    return "unreadable: " + " | ".join(errors), -1, -1, []


def inspect_excel(path: Path) -> tuple[str, int, int, list[str]]:
    xl = pd.ExcelFile(path)
    sheet = xl.sheet_names[0]
    df = pd.read_excel(path, sheet_name=sheet)
    return f"xlsx:{sheet}", len(df), len(df.columns), [str(c).strip() for c in df.columns[:12]]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def reference_date_from_name(path: Path) -> str:
    """Return only dates explicitly encoded in observed-data filenames."""
    match = re.search(r"(20\d{2})(\d{2})(\d{2})(?!\d)", path.name)
    if match:
        return "-".join(match.groups())
    match = re.search(r"(20\d{2})(\d{2})(?!\d)", path.name)
    if match:
        return "-".join(match.groups())
    return ""


def source_institution(catalog: dict[str, str]) -> str:
    url = catalog.get("source_url", "")
    name = catalog.get("source_name", "")
    if "vworld.kr" in url:
        return "국토교통부 VWorld"
    if "sgis." in url:
        return "통계청 SGIS"
    if "incheon.go.kr" in url or name.startswith("인천광역시"):
        return "인천광역시"
    if "mois.go.kr" in url or "jumin.mois.go.kr" in url or name.startswith("행정안전부"):
        return "행정안전부"
    if "mohw.go.kr" in url or name.startswith("보건복지부"):
        return "보건복지부"
    if name.startswith("국민건강보험공단"):
        return "국민건강보험공단"
    if "data.go.kr" in url:
        return name.split("_")[0] if "_" in name else "공공데이터포털 제공기관"
    return ""


def add_disclosure(path: Path, catalog: dict[str, str]) -> dict[str, str]:
    rel = path.relative_to(RAW).as_posix()
    suffix = path.suffix.lower()
    official_document = (
        rel.startswith("api_specs/")
        or rel.startswith("policies/")
        or rel.startswith("reference/")
        or path.name == "vworld_national_key_data_column_dictionary_20260102.xlsx"
    )
    catalog.setdefault("data_nature", "official_document" if official_document else "observed_public")
    catalog.setdefault("is_synthetic", "false")
    catalog.setdefault("source_institution", source_institution(catalog))
    if catalog["data_nature"] == "observed_public":
        catalog.setdefault("reference_date_or_period", reference_date_from_name(path))
    else:
        catalog.setdefault("reference_date_or_period", "")
    catalog.setdefault("local_acquisition_date", "")
    catalog.setdefault("upstream_access", "")
    catalog.setdefault("license_or_terms_note", DEFAULT_PUBLIC_TERMS)
    if suffix == ".json" and rel.startswith("api_specs/data_go_kr_"):
        try:
            import json

            license_note = json.loads(path.read_text(encoding="utf-8")).get("license", "")
            if license_note:
                catalog["license_or_terms_note"] = license_note
        except (OSError, ValueError):
            pass
    return catalog


def catalog_for(path: Path) -> dict[str, str]:
    rel = path.relative_to(RAW).as_posix()
    detail = re.fullmatch(r"policies/program_details/(A\d{25})\.html", rel)
    if detail:
        program_id = detail.group(1)
        return add_disclosure(
            path,
            {
                "source_name": f"인천광역시 1인가구 지원사업 상세 {program_id}",
                "source_url": f"{INCHOEN_PROGRAM_BASE}/view?oneHouseHoldId={program_id}",
                "use": "공식 지원사업 대상·내용·신청방법 원문",
                "join_key": "oneHouseHoldId",
                "access": "downloaded",
            },
        )

    program_list = re.fullmatch(r"policies/program_list_(OHH02010[1-6])\.html", rel)
    if program_list:
        category = program_list.group(1)
        return add_disclosure(
            path,
            {
                "source_name": f"인천광역시 1인가구 지원사업 분야 목록 {category}",
                "source_url": f"{INCHOEN_PROGRAM_BASE}?icnMnDvsnCd={category}",
                "use": "지원사업 발견 목록과 상세 ID 연결",
                "join_key": "oneHouseHoldId",
                "access": "downloaded",
            },
        )

    policy_aliases = {
        "policies/ai_wellbeing_call.html": "A2023121300300200400000074",
        "policies/care_plug.html": "A2023121300300200400000073",
        "policies/daily_care.html": "A2026061600300200400000390",
        "policies/elderly_custom_care_program.html": "A2026022400300200400000339",
        "policies/integrated_care.html": "A2026061600300200400000391",
        "policies/safe_phone.html": "A2023121300300200400000078",
    }
    if rel in policy_aliases:
        program_id = policy_aliases[rel]
        return add_disclosure(
            path,
            {
                "source_name": f"인천광역시 1인가구 지원사업 상세 별칭 {program_id}",
                "source_url": f"{INCHOEN_PROGRAM_BASE}/view?oneHouseHoldId={program_id}",
                "use": "공식 지원사업 상세 원문 별칭 스냅샷",
                "join_key": "oneHouseHoldId",
                "access": "downloaded",
            },
        )

    if rel.startswith("boundaries/vworld_census_admin_dong_boundary_20260410"):
        return add_disclosure(
            path,
            {
                "source_name": "VWorld 센서스 행정동 경계 및 추출 구성파일",
                "source_url": VWORLD_BOUNDARY_URL,
                "use": "전국 행정동 폴리곤과 인천 경계 추출",
                "join_key": "ADM_CD",
                "access": "downloaded",
                "upstream_access": "login/review may be required for refresh",
                "reference_date_or_period": "2025-06-30",
                "license_or_terms_note": VWORLD_BOUNDARY_TERMS,
            },
        )

    if rel.startswith("housing/vworld_incheon_building_age_by_district_20260810"):
        return add_disclosure(
            path,
            {
                "source_name": "VWorld 건축물연령정보 인천 11개 군구 벌크 및 추출 파일",
                "source_url": VWORLD_BUILDING_AGE_URL,
                "use": "법정동·건물별 사용승인일과 공식 건물연령",
                "join_key": "고유번호, 건물식별번호, GIS건물통합식별번호",
                "access": "downloaded",
                "upstream_access": "login/review may be required for refresh",
                "reference_date_or_period": "2026-08-05",
                "license_or_terms_note": VWORLD_HOUSING_TERMS,
            },
        )

    if rel == "housing/vworld_incheon_building_integrated_20260809.zip":
        return add_disclosure(
            path,
            {
                "source_name": "VWorld GIS건물통합정보 인천 벌크",
                "source_url": VWORLD_BUILDING_INTEGRATED_URL,
                "use": "인천 건물 폴리곤 공간조인",
                "join_key": "GIS건물통합식별번호",
                "access": "downloaded",
                "upstream_access": "login/review may be required for refresh",
                "reference_date_or_period": "2026-08-09",
                "license_or_terms_note": VWORLD_HOUSING_TERMS,
            },
        )

    if rel == "housing/vworld_national_key_data_column_dictionary_20260102.xlsx":
        return add_disclosure(
            path,
            {
                "source_name": "VWorld 국가중점데이터 컬럼정의서",
                "source_url": VWORLD_COLUMN_DICTIONARY_URL,
                "use": "GIS건물통합정보·건축물연령정보 필드 정의",
                "join_key": "데이터셋명, 파일명, 항목순번",
                "access": "downloaded",
                "upstream_access": "public document link captured",
                "reference_date_or_period": "2026-01-02",
                "license_or_terms_note": VWORLD_HOUSING_TERMS,
            },
        )

    if rel == "reference/hackathon_participant_guide_0810.pdf":
        return add_disclosure(
            path,
            {
                "source_name": "공식 해커톤 참가자 안내자료 0810",
                "source_url": "",
                "source_institution": "해커톤 주최기관 (사용자 제공; 정확한 기관명 미기록)",
                "use": "공식 참가·과제 안내 참고문서",
                "join_key": "",
                "access": "USER_PROVIDED",
                "upstream_access": "USER_PROVIDED",
                "local_acquisition_date": "2026-08-12",
                "license_or_terms_note": "User-provided official document; external URL and reuse terms are not recorded.",
            },
        )

    if rel in {
        "address/juso_building_db_202607.zip",
        "address/juso_building_db_202607.source.json",
    }:
        return add_disclosure(
            path,
            {
                "source_name": (
                    "행정안전부 주소기반산업지원서비스 2026년 7월 건물DB(월전체)"
                ),
                "source_url": "https://business.juso.go.kr/",
                "source_institution": "행정안전부 주소기반산업지원서비스",
                "use": "도로명·건물번호·행정동 코드와 PNU 연결",
                "join_key": "건물관리번호, 법정동코드, 행정동코드",
                "access": "downloaded",
                "upstream_access": "public no-key bulk download",
                "data_nature": (
                    "local_provenance_record" if rel.endswith(".source.json") else "observed_public"
                ),
                "reference_date_or_period": "2026-07",
                "local_acquisition_date": "2026-08-12",
                "license_or_terms_note": (
                    "Official public bulk download; verify the provider's current reuse terms before redistribution."
                ),
            },
        )

    if rel == "address/residential_coordinate_overrides.json":
        return add_disclosure(
            path,
            {
                "source_name": "OpenStreetMap Nominatim 송도 SK VIEW 주거건물 좌표 보완",
                "source_url": (
                    "https://nominatim.openstreetmap.org/search?"
                    "q=%EC%86%A1%EB%8F%84+SK+VIEW+%EC%9D%B8%EC%B2%9C&"
                    "format=jsonv2&limit=1&countrycodes=kr"
                ),
                "source_institution": "OpenStreetMap contributors",
                "use": "공식 주소DB에는 있으나 보유 VWorld 건물도형과 결합되지 않은 송도5동 주거건물 대표좌표 보완",
                "join_key": "PNU, 도로명주소, OSM way ID",
                "access": "downloaded",
                "upstream_access": "public no-key query",
                "data_nature": "observed_public",
                "reference_date_or_period": "2026-08-13",
                "local_acquisition_date": "2026-08-13",
                "license_or_terms_note": "Open Database License (ODbL) 1.0; attribution required.",
            },
        )

    utility_data_ids = {
        "utilities/incheon_water_billed_usage_by_district_20231231.csv": "15052871",
        "utilities/incheon_water_revenue_rate_2014_2024.csv": "15102131",
        "utilities/kepco_distribution_outage_stats_20241231.csv": "3068741",
        "utilities/kepco_eds_common_codes_20260708.csv": "15131469",
        "utilities/kepco_eds_openapi_fields_20260708.csv": "15131515",
        "utilities/kepco_eds_openapi_services_20260708.csv": "15131481",
        "utilities/kepco_hourly_power_by_region_hq_20241231.csv": "15151157",
        "utilities/kepco_legal_dong_power_20251231_dataid15104908.csv": "15104908",
        "utilities/kepco_low_voltage_outage_branch_sample_20241231.csv": "15150670",
        "utilities/kpx_admin_area_energy_use_20241231.csv": "15156136",
        "utilities/kwater_jeongeup_anonymized_hourly_smart_meter_2023h1.csv": "15121792",
        "utilities/kwater_national_water_meter_status_dataid15118028.csv": "15118028",
    }
    if rel in utility_data_ids:
        data_id = utility_data_ids[rel]
        metadata_path = RAW / "api_specs" / f"data_go_kr_{data_id}.json"
        metadata = {}
        try:
            import json

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        creator = metadata.get("creator", {})
        return add_disclosure(
            path,
            {
                "source_name": metadata.get("name", f"공공데이터포털 파일데이터 {data_id}"),
                "source_url": metadata.get(
                    "url", f"https://www.data.go.kr/data/{data_id}/fileData.do"
                ),
                "source_institution": creator.get("name", "공공데이터포털 제공기관"),
                "use": "전기·상수도 공급/사용/중단 현황의 지역 취약성 보조지표",
                "join_key": "공식 원본의 지역·기간 식별자",
                "access": "downloaded",
                "upstream_access": "no key required for the downloaded file snapshot",
                "reference_date_or_period": {
                    "utilities/incheon_water_revenue_rate_2014_2024.csv": "2014-2024",
                    "utilities/kwater_jeongeup_anonymized_hourly_smart_meter_2023h1.csv": "2023-H1",
                }.get(rel, reference_date_from_name(path)),
                "license_or_terms_note": metadata.get("license", DEFAULT_PUBLIC_TERMS),
            },
        )

    kwater_guide = re.fullmatch(
        r"api_specs/kwater_realtime_[a-z_]+_(\d{8})_(?:api_guide_v\d+(?:\.\d+)?\.docx|oas\.json)",
        rel,
    )
    if kwater_guide:
        data_id = kwater_guide.group(1)
        metadata_path = RAW / "api_specs" / f"data_go_kr_{data_id}.json"
        metadata = {}
        try:
            import json

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        return add_disclosure(
            path,
            {
                "source_name": metadata.get("name", f"한국수자원공사 OpenAPI 공식 명세 {data_id}"),
                "source_url": metadata.get(
                    "url", f"https://www.data.go.kr/data/{data_id}/openapi.do"
                ),
                "source_institution": "한국수자원공사",
                "use": "실시간 수도 유량·수위·수질·압력 API 명세",
                "join_key": "",
                "access": "spec_captured",
                "upstream_access": "key required for API calls",
                "local_acquisition_date": "2026-08-12",
                "license_or_terms_note": metadata.get("license", DEFAULT_PUBLIC_TERMS),
            },
        )

    data_go = re.fullmatch(r"api_specs/data_go_kr_(\d+)\.json", rel)
    if data_go:
        data_id = data_go.group(1)
        metadata = {}
        try:
            import json

            metadata = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        source_url = metadata.get("url", "")
        upstream = {
            "15098762": "key and approval required",
            "15098764": "key and approval required",
        }.get(
            data_id,
            "key required for API calls" if source_url.endswith("openapi.do") else "none recorded for file metadata",
        )
        creator = metadata.get("creator", {})
        return add_disclosure(
            path,
            {
                "source_name": metadata.get("name", f"공공데이터포털 공식 메타데이터 {data_id}"),
                "source_url": source_url or f"https://www.data.go.kr/data/{data_id}/openapi.do",
                "source_institution": creator.get("name", "공공데이터포털 제공기관"),
                "use": "공식 데이터/API 설명·허가범위 명세",
                "join_key": "",
                "access": "spec_captured",
                "upstream_access": upstream,
                "local_acquisition_date": "2026-08-12",
            },
        )

    odcloud = re.fullmatch(r"api_specs/odcloud_(\d+)_oas\.json", rel)
    if odcloud:
        data_id = odcloud.group(1)
        return add_disclosure(
            path,
            {
                "source_name": f"공공데이터포털 ODCloud OpenAPI 명세 {data_id}",
                "source_url": f"https://www.data.go.kr/data/{data_id}/fileData.do",
                "use": "파일데이터 자동변환 API 명세",
                "join_key": "",
                "access": "spec_captured",
                "upstream_access": "key required for API calls",
                "local_acquisition_date": "2026-08-12",
            },
        )

    sgis_urls = {
        "api_specs/sgis_census_house_api.html": "https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/census.html",
        "api_specs/sgis_data_provision_process.html": "https://sgis.kostat.go.kr/view/pss/dataProvdIntrcn",
        "api_specs/sgis_open_data.html": "https://sgis.kostat.go.kr/view/pss/openDataIntrcn",
    }
    if rel in sgis_urls:
        return add_disclosure(
            path,
            {
                "source_name": "통계청 SGIS 자료제공/API 공식 문서",
                "source_url": sgis_urls[rel],
                "use": "센서스 주택 API 또는 자료제공 절차 명세",
                "join_key": "",
                "access": "spec_captured",
                "upstream_access": "key required for API; login/review may be required for downloads",
                "local_acquisition_date": "2026-08-12",
            },
        )

    vworld_specs = {
        "api_specs/vworld_admin_boundary.html": ("VWorld 센서스 행정동 경계 공식 페이지", VWORLD_BOUNDARY_URL),
        "api_specs/vworld_building_age.html": ("VWorld 건축물연령정보 공식 페이지", VWORLD_BUILDING_AGE_URL),
        "api_specs/vworld_building_integrated.html": ("VWorld GIS건물통합정보 공식 페이지", VWORLD_BUILDING_INTEGRATED_URL),
    }
    if rel in vworld_specs:
        name, url = vworld_specs[rel]
        return add_disclosure(
            path,
            {
                "source_name": name,
                "source_url": url,
                "use": "VWorld 벌크 데이터 설명·다운로드 명세",
                "join_key": "",
                "access": "spec_captured",
                "upstream_access": "login/review may be required for refresh",
                "local_acquisition_date": "2026-08-12",
                "license_or_terms_note": (
                    VWORLD_BOUNDARY_TERMS if "boundary" in rel else VWORLD_HOUSING_TERMS
                ),
            },
        )

    exact = SOURCE_CATALOG.get(path.name)
    if exact:
        return add_disclosure(path, dict(exact))

    if path.name.startswith("jumin_"):
        return add_disclosure(
            path,
            {
                "source_name": "행정안전부 주민등록 인구통계 과거 추세 원문",
                "source_url": "https://jumin.mois.go.kr/",
                "use": "2021~2025 인구/1인세대/세대수 추세",
                "join_key": "행정구역",
                "access": "downloaded",
            },
        )
    if path.name.startswith("mois_") and path.suffix.lower() == ".xlsx":
        return add_disclosure(
            path,
            {
                "source_name": "행정안전부 행정기관코드 20260701 ZIP 파생 XLSX",
                "source_url": "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000052",
                "use": "2026-07-01 행정동/법정동/관할구역 매핑",
                "join_key": "행정기관코드, 법정동코드",
                "access": "downloaded",
            },
        )
    return add_disclosure(path, {})


def iter_raw_files() -> Iterable[Path]:
    for path in sorted(RAW.rglob("*")):
        if path.is_file():
            yield path


def main() -> None:
    METADATA.mkdir(parents=True, exist_ok=True)
    rows = []
    checksums = []
    for path in iter_raw_files():
        suffix = path.suffix.lower()
        rel = path.relative_to(ROOT)
        if suffix == ".csv":
            fmt, nrows, ncols, cols = detect_csv(path)
        elif suffix in {".xlsx", ".xls"}:
            fmt, nrows, ncols, cols = inspect_excel(path)
        else:
            fmt, nrows, ncols, cols = suffix.lstrip(".") or "unknown", "", "", []
        catalog = catalog_for(path)
        rows.append(
            {
                "path": str(rel),
                "bytes": path.stat().st_size,
                "format_or_encoding": fmt,
                "rows": nrows,
                "columns": ncols,
                "sample_columns": " | ".join(cols),
                "source_name": catalog.get("source_name", ""),
                "source_url": catalog.get("source_url", ""),
                "source_institution": catalog.get("source_institution", ""),
                "data_nature": catalog.get("data_nature", ""),
                "is_synthetic": catalog.get("is_synthetic", ""),
                "reference_date_or_period": catalog.get("reference_date_or_period", ""),
                "local_acquisition_date": catalog.get("local_acquisition_date", ""),
                "use": catalog.get("use", ""),
                "join_key": catalog.get("join_key", ""),
                "access": catalog.get("access", ""),
                "upstream_access": catalog.get("upstream_access", ""),
                "license_or_terms_note": catalog.get("license_or_terms_note", ""),
            }
        )
        checksums.append({"sha256": sha256(path), "path": str(rel)})

    unresolved = [row for row in rows if not row["source_name"] or not row["data_nature"]]
    if unresolved:
        missing = ", ".join(row["path"] for row in unresolved[:10])
        raise RuntimeError(f"Raw files need source annotations ({len(unresolved)}): {missing}")
    if any(row["is_synthetic"] != "false" for row in rows):
        raise RuntimeError("Raw inventory must explicitly identify current files as non-synthetic")

    with (METADATA / "source_inventory.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    with (METADATA / "checksums.sha256").open("w", encoding="utf-8") as fh:
        for item in checksums:
            fh.write(f"{item['sha256']}  {item['path']}\n")

    with (METADATA / "api_catalog.csv").open("w", encoding="utf-8", newline="") as fh:
        ids = [row["id"] for row in API_CATALOG]
        if len(ids) != len(set(ids)):
            raise RuntimeError("API catalog contains duplicate ids")
        writer = csv.DictWriter(fh, fieldnames=API_CATALOG_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(API_CATALOG)

    raw_count = len(rows)
    url_cataloged = sum(1 for row in rows if row["source_url"])
    user_provided = sum(1 for row in rows if row["access"] == "USER_PROVIDED")
    encodings = sorted(
        {row["format_or_encoding"] for row in rows if row["path"].endswith(".csv")}
    )
    nature_counts = {
        nature: sum(1 for row in rows if row["data_nature"] == nature)
        for nature in sorted({row["data_nature"] for row in rows})
    }
    nature_text = ", ".join(f"{nature}={count}" for nature, count in nature_counts.items())
    summary = [
        "# I5 Data Bundle Inventory",
        "",
        f"- Raw files: {raw_count}",
        f"- Files with authoritative source URL cataloged: {url_cataloged}",
        f"- User-provided official files with no recorded external URL: {user_provided}",
        "- Files needing source annotation: 0",
        f"- Data nature: {nature_text}; synthetic raw files=0.",
        f"- CSV encodings observed: {', '.join(encodings)}.",
        "- API credentials were not generated. Items needing keys are listed in metadata/api_catalog.csv.",
        "- API access status and already-downloaded local bulk status are recorded separately.",
        "",
        "## Modeling Guardrail",
        "",
        "Do not label map marks as confirmed unserved people, individual risk cases, or service-missing "
        "households. Public data supports observed aggregate indicators and separately documented "
        "demo/model signals only. The current utility bundle has no public Incheon household/person-level "
        "anomaly data; Jeongeup smart-meter data is model-demo-only, and future priority scores must stay "
        "separate from observed counts.",
        "",
        "## Demo Layer Guardrail",
        "",
        "`processed/demo_full_facility_points.geojson` is the internal hackathon default facility layer "
        "and includes official sensitive facility types when coordinates exist. Use "
        "`processed/public_demo_facility_points.geojson` and the other `public_demo_*` files as the "
        "conservative fallback for public sharing.",
        "",
        "## Source Disclosure and License Guardrail",
        "",
        "Every MVP layer should disclose its source and reference date. VWorld administrative boundary "
        "material is shown in the saved local spec as `CC BY-NC-ND`; derived GeoJSON redistribution or "
        "public-service use is not legally cleared by this inventory and needs a separate terms check or "
        "a redistributable replacement boundary source. See `LICENSES.md`.",
    ]
    (METADATA / "inventory_summary.md").write_text("\n".join(summary) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
