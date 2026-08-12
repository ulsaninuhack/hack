#!/usr/bin/env python3
"""Normalize the downloaded Incheon welfare-facility source files.

The outputs deliberately keep one row per source observation/service first and
build a separate, conservatively deduplicated facility-entity table.  Entity
matching is exact after harmless normalization of whitespace, punctuation,
the Incheon/district prefix, and a trailing ``(휴업)`` status marker.  No fuzzy
name or address matching is used.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "facilities"
OUT = ROOT / "processed"

OUTPUT_ENCODING = "utf-8-sig"

STANDARD_COLUMNS = [
    "observation_id",
    "source_dataset",
    "source_name",
    "source_file",
    "source_url",
    "source_as_of_date",
    "source_sheet",
    "source_row",
    "source_facility_code",
    "source_service_code",
    "facility_name",
    "category_major",
    "category_detail",
    "facility_form",
    "legal_basis",
    "operator_name",
    "district_source",
    "district",
    "legal_dong",
    "address",
    "postal_code",
    "phone",
    "capacity",
    "current_occupancy",
    "staff_count",
    "latitude",
    "longitude",
    "designation_date",
    "installation_date",
    "status",
    "source_note",
]

NUMERIC_COLUMNS = [
    "capacity",
    "current_occupancy",
    "staff_count",
    "latitude",
    "longitude",
]

SOURCE_INFO = {
    "incheon_welfare": {
        "source_name": "인천광역시_사회복지시설 현황_20250131",
        "source_file": "incheon_welfare_facilities_20250131.csv",
        "source_url": "https://www.data.go.kr/data/15045181/fileData.do",
        "source_as_of_date": "2025-01-31",
    },
    "incheon_elderly": {
        "source_name": "인천광역시_노인복지시설 현황_20260630",
        "source_file": "incheon_elderly_welfare_facilities_20260630.xlsx",
        "source_url": "https://www.incheon.go.kr/welfare/WE010216",
        "source_as_of_date": "2026-06-30",
    },
    "incheon_disabled_day": {
        "source_name": "인천광역시_장애인주간 이용시설 현황_20250630",
        "source_file": "incheon_disabled_day_facilities_20250630.csv",
        "source_url": "https://www.data.go.kr/data/15103286/fileData.do",
        "source_as_of_date": "2025-06-30",
    },
    "incheon_disabled_residential": {
        "source_name": "인천광역시_장애인거주시설현황_20260228",
        "source_file": "incheon_disabled_residential_facilities_20260228.csv",
        "source_url": "https://www.data.go.kr/data/15104066/fileData.do",
        "source_as_of_date": "2026-02-28",
    },
    "yeonsu_disabled": {
        "source_name": "인천광역시 연수구_장애인 복지시설 현황_20260309",
        "source_file": "yeonsu_disabled_facilities_20260316.csv",
        "source_url": "https://www.data.go.kr/data/15085414/fileData.do",
        "source_as_of_date": "2026-03-09",
    },
    "michuhol_elderly": {
        "source_name": "인천광역시 미추홀구_노인복지시설_20250620",
        "source_file": "michuhol_elderly_welfare_facilities.csv",
        "source_url": "https://www.data.go.kr/data/15070559/fileData.do",
        "source_as_of_date": "2025-06-20",
    },
    "nhis_ltc": {
        "source_name": "국민건강보험공단_장기요양기관 시설별 현황_20260610",
        "source_file": "nhis_long_term_care_facilities_20260610.xlsx",
        "source_url": "https://www.data.go.kr/data/15124763/fileData.do",
        "source_as_of_date": "2026-06-10",
    },
}

# City-managed rows may say only "시" in the district column.  This exact
# public-facility address was verified on the official Incheon welfare page
# (updated 2026-03-20): https://www.incheon.go.kr/welfare/WE010318/3018290
DISTRICT_OVERRIDES = {
    ("인천광역시노인인력개발센터", "석정로 229"): "미추홀구",
}


def clean_text(value: object) -> str:
    if pd.isna(value):
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    return re.sub(r"\s+", " ", text).strip()


def compact_header(value: object) -> str:
    return re.sub(r"\s+", "", clean_text(value)).replace("군·구", "군구명")


def normalize_district(value: object) -> str:
    district = re.sub(r"\s+", "", clean_text(value))
    if district in {"시", "인천광역시"}:
        return ""
    # The single remaining NHIS legacy '남구' record belongs to 미추홀구.
    if district == "남구":
        return "미추홀구"
    return district


def full_incheon_address(address: object, district: object) -> str:
    text = clean_text(address)
    district_text = normalize_district(district)
    if not text:
        return ""
    if text.startswith("인천광역시"):
        return text
    if district_text and re.match(rf"^{re.escape(district_text)}(?:\s|$)", text):
        return f"인천광역시 {text}"
    if district_text:
        return f"인천광역시 {district_text} {text}"
    return f"인천광역시 {text}"


def infer_district_from_address(address: object) -> str:
    text = clean_text(address)
    text = re.sub(r"^인천광역시\s*", "", text)
    match = re.match(r"([^\s]+(?:구|군))(?:\s|$)", text)
    return normalize_district(match.group(1)) if match else ""


def infer_legal_dong(address: object) -> str:
    text = clean_text(address)
    parenthetical = re.findall(r"\(([^)]*)\)", text)
    for part in reversed(parenthetical):
        match = re.search(r"([가-힣0-9]+(?:동|읍|면|리))(?:\s|,|$)", part)
        if match:
            return match.group(1)
    tokens = re.findall(r"(?<![가-힣0-9])([가-힣0-9]+(?:동|읍|면|리))(?![가-힣0-9])", text)
    return tokens[-1] if tokens else ""


def normalize_name_key(value: object) -> str:
    text = clean_text(value)
    text = re.sub(r"\(\s*휴업\s*\)", "", text)
    return re.sub(r"[^0-9A-Za-z가-힣]", "", text).lower()


def normalize_address_key(value: object, district: object) -> str:
    text = clean_text(value)
    text = re.sub(r"^인천광역시\s*", "", text)
    district_text = normalize_district(district)
    if district_text:
        text = re.sub(rf"^{re.escape(district_text)}\s*", "", text)
    return re.sub(r"[^0-9A-Za-z가-힣]", "", text).lower()


def infer_status(name: object) -> str:
    text = clean_text(name)
    for status in ("휴업", "폐업", "운영중단"):
        if status in text:
            return status
    return ""


def normalize_date(value: object) -> str:
    text = clean_text(value)
    if not text:
        return ""
    digits = re.sub(r"[^0-9]", "", text)
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    try:
        parsed = pd.to_datetime(value, errors="raise")
        return parsed.strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return text


def as_number(value: object) -> Optional[float]:
    if pd.isna(value):
        return None
    text = clean_text(value).replace(",", "")
    if not text or text.lower() in {"nan", "none", "-"}:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def as_capacity(value: object) -> Optional[float]:
    """Return usable seat capacity; portal zeroes mean unavailable/not applicable."""
    number = as_number(value)
    return number if number is not None and number > 0 else None


def valid_coordinate(value: object, low: float, high: float) -> Optional[float]:
    number = as_number(value)
    if number is None or not low <= number <= high:
        return None
    return number


def major_category(detail: object, legal_basis: object = "") -> str:
    text = f"{clean_text(detail)} {clean_text(legal_basis)}"
    if any(token in text for token in ("노인", "요양", "방문요양", "방문목욕", "주야간", "복지용구")):
        return "노인복지"
    if "장애" in text:
        return "장애인복지"
    if any(token in text for token in ("아동", "다함께돌봄", "보육")):
        return "아동·돌봄"
    if "청소년" in text:
        return "청소년복지"
    if any(token in text for token in ("가족", "한부모", "여성", "성폭력", "성매매", "가정폭력")):
        return "가족·여성복지"
    if "정신" in text:
        return "정신건강복지"
    if any(token in text for token in ("사회복지관", "자활", "노숙", "지역사회")):
        return "지역복지"
    return "기타복지"


def empty_standard_frame(rows: Iterable[Dict[str, object]]) -> pd.DataFrame:
    frame = pd.DataFrame(list(rows))
    for column in STANDARD_COLUMNS:
        if column not in frame:
            frame[column] = ""
    return frame[STANDARD_COLUMNS]


def source_fields(dataset: str) -> Dict[str, str]:
    info = dict(SOURCE_INFO[dataset])
    info["source_dataset"] = dataset
    return info


def make_observation_id(row: pd.Series) -> str:
    payload = "|".join(
        clean_text(row.get(column, ""))
        for column in (
            "source_dataset",
            "source_sheet",
            "source_row",
            "source_facility_code",
            "source_service_code",
            "facility_name",
            "category_detail",
            "address",
        )
    )
    return "obs_" + hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def exact_observation_key(row: pd.Series) -> str:
    """Identify byte-level-equivalent source facts while ignoring row position."""
    payload = "|".join(
        clean_text(row.get(column, ""))
        for column in (
            "source_dataset",
            "source_sheet",
            "source_facility_code",
            "source_service_code",
            "facility_name",
            "category_detail",
            "facility_form",
            "district_source",
            "address",
            "phone",
            "capacity",
            "current_occupancy",
            "staff_count",
            "latitude",
            "longitude",
            "designation_date",
            "installation_date",
        )
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def finalize_observations(frame: pd.DataFrame) -> Tuple[pd.DataFrame, int]:
    frame = frame.copy()
    for column in STANDARD_COLUMNS:
        if column not in frame:
            frame[column] = ""
    frame = frame[STANDARD_COLUMNS]

    text_columns = [column for column in STANDARD_COLUMNS if column not in NUMERIC_COLUMNS]
    for column in text_columns:
        frame[column] = frame[column].map(clean_text)

    for column in ("capacity", "current_occupancy", "staff_count"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce").round().astype("Int64")
    frame["latitude"] = pd.to_numeric(frame["latitude"], errors="coerce").astype("Float64")
    frame["longitude"] = pd.to_numeric(frame["longitude"], errors="coerce").astype("Float64")

    frame["district_source"] = frame["district_source"].map(lambda value: re.sub(r"\s+", "", clean_text(value)))
    frame["district"] = frame["district"].map(normalize_district)
    frame["address"] = [
        full_incheon_address(address, district)
        for address, district in zip(frame["address"], frame["district"])
    ]
    missing_dong = frame["legal_dong"].eq("")
    frame.loc[missing_dong, "legal_dong"] = frame.loc[missing_dong, "address"].map(infer_legal_dong)
    missing_status = frame["status"].eq("")
    frame.loc[missing_status, "status"] = frame.loc[missing_status, "facility_name"].map(infer_status)

    before = len(frame)
    frame["_exact_observation_key"] = frame.apply(exact_observation_key, axis=1)
    frame = frame.drop_duplicates("_exact_observation_key", keep="first").copy()
    frame = frame.drop(columns="_exact_observation_key")
    removed = before - len(frame)

    frame["observation_id"] = frame.apply(make_observation_id, axis=1)

    if frame["observation_id"].duplicated().any():
        raise ValueError("observation_id must be unique after exact deduplication")
    invalid_coordinates = (
        frame["latitude"].notna()
        & (~frame["latitude"].between(36.0, 39.5) | ~frame["longitude"].between(124.0, 128.5))
    )
    if invalid_coordinates.any():
        raise ValueError(f"invalid Incheon coordinates remain: {int(invalid_coordinates.sum())}")
    return frame.reset_index(drop=True), removed


def read_cp949_csv(filename: str) -> pd.DataFrame:
    return pd.read_csv(RAW / filename, encoding="cp949")


def load_incheon_welfare() -> Tuple[pd.DataFrame, Dict[str, int]]:
    dataset = "incheon_welfare"
    df = read_cp949_csv(SOURCE_INFO[dataset]["source_file"])
    df.columns = [compact_header(column) for column in df.columns]
    rows: List[Dict[str, object]] = []
    base = source_fields(dataset)
    for index, row in df.iterrows():
        district_source = clean_text(row["군구명"])
        district = normalize_district(district_source)
        override_key = (clean_text(row["시설명"]), clean_text(row["주소"]))
        override_district = DISTRICT_OVERRIDES.get(override_key, "")
        district = override_district or district
        detail = clean_text(row["시설종류"])
        rows.append(
            {
                **base,
                "source_sheet": "CSV",
                "source_row": index + 2,
                "facility_name": row["시설명"],
                "category_major": major_category(detail, row["관련근거법"]),
                "category_detail": detail,
                "facility_form": row["시설형태"],
                "legal_basis": row["관련근거법"],
                "district_source": district_source,
                "district": district,
                "address": row["주소"],
                "phone": row["연락처"],
                "source_note": (
                    "군구명=시; 공식 인천시 시설 페이지 주소로 미추홀구 보정"
                    if override_district
                    else ""
                ),
            }
        )
    result, removed = finalize_observations(empty_standard_frame(rows))
    return result, {"input_rows": len(df), "scope_rows": len(rows), "duplicates_removed": removed}


def load_incheon_elderly() -> Tuple[pd.DataFrame, Dict[str, int]]:
    dataset = "incheon_elderly"
    filename = SOURCE_INFO[dataset]["source_file"]
    sheet_config = [
        ("주거복지", 3, "주거복지"),
        ("의료복지", 2, "의료복지"),
        ("재가복지", 2, "재가복지"),
    ]
    rows: List[Dict[str, object]] = []
    base = source_fields(dataset)
    source_count = 0
    for sheet, header_row_zero_based, form in sheet_config:
        df = pd.read_excel(
            RAW / filename,
            sheet_name=sheet,
            header=header_row_zero_based,
            usecols="B:G",
        )
        df.columns = [compact_header(column) for column in df.columns]
        if "군구명" not in df.columns:
            raise ValueError(f"{sheet}: expected 군구명 column, got {df.columns.tolist()}")
        selected = df[
            df["군구명"].notna()
            & df["시설명"].notna()
            & df["시설유형"].notna()
        ]
        source_count += len(selected)
        for index, row in selected.iterrows():
            district_source = clean_text(row["군구명"])
            detail = clean_text(row["시설유형"])
            rows.append(
                {
                    **base,
                    "source_sheet": sheet,
                    # Header is Excel row header_row_zero_based + 1; first data row is +2.
                    "source_row": index + header_row_zero_based + 2,
                    "facility_name": row["시설명"],
                    "category_major": "노인복지",
                    "category_detail": detail,
                    "facility_form": form,
                    "district_source": district_source,
                    "district": normalize_district(district_source),
                    "address": row["소재지"],
                    "phone": row["연락처"],
                }
            )
    result, removed = finalize_observations(empty_standard_frame(rows))
    return result, {
        "input_rows": source_count,
        "scope_rows": len(rows),
        "duplicates_removed": removed,
    }


def load_disabled_day() -> Tuple[pd.DataFrame, Dict[str, int]]:
    dataset = "incheon_disabled_day"
    df = read_cp949_csv(SOURCE_INFO[dataset]["source_file"])
    df.columns = [compact_header(column) for column in df.columns]
    rows: List[Dict[str, object]] = []
    base = source_fields(dataset)
    for index, row in df.iterrows():
        district_source = clean_text(row["군구명"])
        rows.append(
            {
                **base,
                "source_sheet": "CSV",
                "source_row": index + 2,
                "facility_name": row["기관명"],
                "category_major": "장애인복지",
                "category_detail": "장애인 주간이용시설",
                "facility_form": "주간이용",
                "district_source": district_source,
                "district": normalize_district(district_source),
                "address": row["소재지"],
                "capacity": as_capacity(row["정원"]),
                "current_occupancy": as_number(row["현원"]),
                "staff_count": as_number(row["종사자"]),
            }
        )
    result, removed = finalize_observations(empty_standard_frame(rows))
    return result, {"input_rows": len(df), "scope_rows": len(rows), "duplicates_removed": removed}


def load_disabled_residential() -> Tuple[pd.DataFrame, Dict[str, int]]:
    dataset = "incheon_disabled_residential"
    df = read_cp949_csv(SOURCE_INFO[dataset]["source_file"])
    df.columns = [compact_header(column) for column in df.columns]
    rows: List[Dict[str, object]] = []
    base = source_fields(dataset)
    for index, row in df.iterrows():
        address = clean_text(row["소재지"])
        district_source = infer_district_from_address(address)
        detail_parts = [clean_text(row["구분"]), clean_text(row["시설유형"])]
        detail = " / ".join(part for part in detail_parts if part)
        rows.append(
            {
                **base,
                "source_sheet": "CSV",
                "source_row": index + 2,
                "facility_name": row["시설명"],
                "category_major": "장애인복지",
                "category_detail": detail,
                "facility_form": row["구분"],
                "district_source": district_source,
                "district": district_source,
                "address": address,
                "phone": row["전화번호"],
                "capacity": as_capacity(row["정원"]),
            }
        )
    result, removed = finalize_observations(empty_standard_frame(rows))
    return result, {"input_rows": len(df), "scope_rows": len(rows), "duplicates_removed": removed}


def load_yeonsu_disabled() -> Tuple[pd.DataFrame, Dict[str, int]]:
    dataset = "yeonsu_disabled"
    df = read_cp949_csv(SOURCE_INFO[dataset]["source_file"])
    df.columns = [compact_header(column) for column in df.columns]
    rows: List[Dict[str, object]] = []
    base = source_fields(dataset)
    for index, row in df.iterrows():
        rows.append(
            {
                **base,
                "source_sheet": "CSV",
                "source_row": index + 2,
                "facility_name": row["시설명"],
                "category_major": "장애인복지",
                "category_detail": row["구분"],
                "facility_form": row["구분"],
                "operator_name": row["법인"],
                "district_source": "연수구",
                "district": "연수구",
                "address": row["주소"],
                "phone": row["전화번호"],
                "capacity": as_capacity(row["정원"]),
                "current_occupancy": as_number(row["계"]),
                "staff_count": as_number(row["종사자"]),
                "latitude": valid_coordinate(row["위도"], 36.0, 39.5),
                "longitude": valid_coordinate(row["경도"], 124.0, 128.5),
                "installation_date": normalize_date(row["설치연월"]),
            }
        )
    result, removed = finalize_observations(empty_standard_frame(rows))
    return result, {"input_rows": len(df), "scope_rows": len(rows), "duplicates_removed": removed}


def load_michuhol_elderly() -> Tuple[pd.DataFrame, Dict[str, int]]:
    dataset = "michuhol_elderly"
    df = read_cp949_csv(SOURCE_INFO[dataset]["source_file"])
    df.columns = [compact_header(column) for column in df.columns]
    rows: List[Dict[str, object]] = []
    base = source_fields(dataset)
    for index, row in df.iterrows():
        rows.append(
            {
                **base,
                "source_sheet": "CSV",
                "source_row": index + 2,
                "facility_name": row["시설명"],
                "category_major": "노인복지",
                "category_detail": row["시설종류"],
                "district_source": "미추홀구",
                "district": "미추홀구",
                "address": row["주소"],
                "phone": row["전화번호"],
                "capacity": as_capacity(row["정원(명)"]),
                "latitude": valid_coordinate(row["위도"], 36.0, 39.5),
                "longitude": valid_coordinate(row["경도"], 124.0, 128.5),
                "designation_date": normalize_date(row["지정일자"]),
            }
        )
    result, removed = finalize_observations(empty_standard_frame(rows))
    return result, {"input_rows": len(df), "scope_rows": len(rows), "duplicates_removed": removed}


def parse_nhis_location(value: object) -> Tuple[str, str]:
    text = clean_text(value)
    parts = text.split()
    if len(parts) >= 3 and parts[0] == "인천광역시":
        return parts[1], parts[2]
    return "", ""


def load_nhis_ltc() -> Tuple[pd.DataFrame, Dict[str, int]]:
    dataset = "nhis_ltc"
    path = RAW / SOURCE_INFO[dataset]["source_file"]
    general = pd.read_excel(path, sheet_name="일반현황", dtype=str)
    capacity = pd.read_excel(path, sheet_name="입소인원", dtype=str)
    staff = pd.read_excel(path, sheet_name="인력현황", dtype=str)
    general.columns = [clean_text(column) for column in general.columns]
    capacity.columns = [clean_text(column) for column in capacity.columns]
    staff.columns = [clean_text(column) for column in staff.columns]

    location_column = "시도 시군구 법정동명"
    scope_mask = general[location_column].map(clean_text).str.startswith("인천광역시 ")
    incheon_general = general[scope_mask].copy()
    incheon_codes = set(incheon_general["장기요양기관코드"].map(clean_text))
    capacity = capacity[capacity["장기요양기관코드"].map(clean_text).isin(incheon_codes)].copy()
    staff = staff[staff["장기요양기관코드"].map(clean_text).isin(incheon_codes)].copy()

    capacity = capacity.rename(
        columns={
            "기관유형명": "capacity_type_name",
            "정원": "capacity_value",
        }
    )
    capacity["capacity_source_row"] = capacity.index + 2

    staff_columns = [
        "시설장",
        "사무국장",
        "사회복지사",
        "의사_전임",
        "의사_촉탁",
        "간호사",
        "간호조무사",
        "치위생사",
        "물리치료사",
        "작업치료사",
        "요양보호사",
        "영양사",
        "기타",
    ]
    for column in staff_columns:
        staff[column] = pd.to_numeric(staff[column], errors="coerce").fillna(0)
    staff["staff_total"] = staff[staff_columns].sum(axis=1)
    staff = staff.rename(columns={"기관유형코드명": "staff_type_name"})
    staff["staff_source_row"] = staff.index + 2

    service_keys = ["장기요양기관코드", "기관유형코드"]
    services = capacity.merge(
        staff[[*service_keys, "staff_type_name", "staff_total", "staff_source_row"]],
        on=service_keys,
        how="outer",
        validate="one_to_one",
    )
    services["service_type_name"] = services["capacity_type_name"].combine_first(services["staff_type_name"])
    services = services.merge(
        incheon_general,
        on="장기요양기관코드",
        how="left",
        validate="many_to_one",
    )

    rows: List[Dict[str, object]] = []
    base = source_fields(dataset)
    for _, row in services.iterrows():
        district_source, legal_dong = parse_nhis_location(row[location_column])
        district = normalize_district(district_source)
        source_rows = []
        if pd.notna(row.get("capacity_source_row")):
            source_rows.append(f"입소인원:{int(row['capacity_source_row'])}")
        if pd.notna(row.get("staff_source_row")):
            source_rows.append(f"인력현황:{int(row['staff_source_row'])}")
        rows.append(
            {
                **base,
                "source_sheet": "일반현황+입소인원+인력현황",
                "source_row": ";".join(source_rows),
                "source_facility_code": row["장기요양기관코드"],
                "source_service_code": row["기관유형코드"],
                "facility_name": row["장기요양기관이름"],
                "category_major": "노인복지",
                "category_detail": row["service_type_name"],
                "facility_form": "장기요양기관",
                "district_source": district_source,
                "district": district,
                "legal_dong": legal_dong,
                "address": row["기관별 상세주소"],
                "postal_code": row["우편번호"],
                "capacity": as_capacity(row.get("capacity_value")),
                "staff_count": as_number(row.get("staff_total")),
                "designation_date": normalize_date(row["지정일자"]),
                "installation_date": normalize_date(row["설치신고일자"]),
                "source_note": (
                    f"법정동코드={clean_text(row['법정동코드'])}; "
                    + (
                        "원본정원=0(해당없음/미입력으로 처리)"
                        if as_number(row.get("capacity_value")) == 0
                        else ""
                    )
                ).rstrip("; "),
            }
        )

    result, removed = finalize_observations(empty_standard_frame(rows))
    return result, {
        "input_rows": len(general),
        "scope_rows": len(services),
        "scope_facilities": incheon_general["장기요양기관코드"].nunique(),
        "duplicates_removed": removed,
    }


def entity_key(row: pd.Series) -> str:
    name_key = normalize_name_key(row["facility_name"])
    address_key = normalize_address_key(row["address"], row["district"])
    district_key = normalize_district(row["district"])
    if not name_key or not address_key:
        return row["observation_id"]
    raw_key = f"{district_key}|{name_key}|{address_key}"
    return "fac_" + hashlib.sha1(raw_key.encode("utf-8")).hexdigest()[:16]


def first_nonempty(group: pd.DataFrame, column: str) -> object:
    for value in group[column]:
        if not pd.isna(value) and clean_text(value):
            return value
    return ""


def joined_unique(values: Sequence[object]) -> str:
    cleaned = sorted({clean_text(value) for value in values if clean_text(value)})
    return " | ".join(cleaned)


def numeric_max(group: pd.DataFrame, column: str) -> object:
    values = pd.to_numeric(group[column], errors="coerce").dropna()
    if values.empty:
        return pd.NA
    return int(values.max()) if (values % 1 == 0).all() else float(values.max())


def build_canonical(observations: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    working = observations.copy()
    working["facility_id"] = working.apply(entity_key, axis=1)
    working = working.sort_values(
        ["facility_id", "source_as_of_date", "source_dataset", "source_row"],
        ascending=[True, False, True, True],
        kind="stable",
    )
    canonical_rows: List[Dict[str, object]] = []
    duplicate_rows: List[Dict[str, object]] = []

    for facility_id, group in working.groupby("facility_id", sort=True):
        representative = group.iloc[0]
        coordinate_rows = group[group["latitude"].notna() & group["longitude"].notna()]
        coordinate_row = coordinate_rows.iloc[0] if not coordinate_rows.empty else None
        canonical_rows.append(
            {
                "facility_id": facility_id,
                "facility_name": representative["facility_name"],
                "district": representative["district"],
                "legal_dong": first_nonempty(group, "legal_dong"),
                "address": representative["address"],
                "phone": first_nonempty(group, "phone"),
                "category_major": joined_unique(group["category_major"].tolist()),
                "category_detail": joined_unique(group["category_detail"].tolist()),
                "facility_form": joined_unique(group["facility_form"].tolist()),
                "capacity_max_reported": numeric_max(group, "capacity"),
                "current_occupancy_max_reported": numeric_max(group, "current_occupancy"),
                "staff_count_max_reported": numeric_max(group, "staff_count"),
                "latitude": coordinate_row["latitude"] if coordinate_row is not None else pd.NA,
                "longitude": coordinate_row["longitude"] if coordinate_row is not None else pd.NA,
                "designation_date": first_nonempty(group, "designation_date"),
                "installation_date": first_nonempty(group, "installation_date"),
                "status": joined_unique(group["status"].tolist()),
                "source_as_of_date_latest": group["source_as_of_date"].max(),
                "source_datasets": joined_unique(group["source_dataset"].tolist()),
                "source_names": joined_unique(group["source_name"].tolist()),
                "source_files": joined_unique(group["source_file"].tolist()),
                "source_facility_codes": joined_unique(group["source_facility_code"].tolist()),
                "observation_count": len(group),
                "source_count": group["source_dataset"].nunique(),
                "entity_match_rule": "exact_normalized_district_name_address",
            }
        )
        if len(group) > 1:
            duplicate_rows.append(
                {
                    "facility_id": facility_id,
                    "facility_name": representative["facility_name"],
                    "district": representative["district"],
                    "address": representative["address"],
                    "observation_count": len(group),
                    "source_count": group["source_dataset"].nunique(),
                    "source_datasets": joined_unique(group["source_dataset"].tolist()),
                    "category_details": joined_unique(group["category_detail"].tolist()),
                    "observation_ids": joined_unique(group["observation_id"].tolist()),
                    "match_rule": "exact_normalized_district_name_address",
                }
            )

    canonical = pd.DataFrame(canonical_rows)
    duplicates = pd.DataFrame(duplicate_rows)
    for column in (
        "capacity_max_reported",
        "current_occupancy_max_reported",
        "staff_count_max_reported",
        "observation_count",
        "source_count",
    ):
        canonical[column] = pd.to_numeric(canonical[column], errors="coerce").astype("Int64")
    canonical["latitude"] = pd.to_numeric(canonical["latitude"], errors="coerce").astype("Float64")
    canonical["longitude"] = pd.to_numeric(canonical["longitude"], errors="coerce").astype("Float64")
    return canonical, duplicates


def coverage_row(
    table_name: str,
    frame: pd.DataFrame,
    input_rows: int,
    scope_rows: int,
    duplicates_removed: int,
    notes: str = "",
) -> Dict[str, object]:
    count = len(frame)
    with_coordinates = int((frame["latitude"].notna() & frame["longitude"].notna()).sum())
    with_address = int(frame["address"].map(clean_text).ne("").sum())
    with_phone = int(frame["phone"].map(clean_text).ne("").sum())
    with_capacity = int(pd.to_numeric(frame["capacity"], errors="coerce").notna().sum())
    unique_entities = frame.apply(entity_key, axis=1).nunique()
    return {
        "table_name": table_name,
        "input_rows": input_rows,
        "incheon_scope_rows_before_dedup": scope_rows,
        "exact_duplicates_removed": duplicates_removed,
        "output_rows": count,
        "exact_entity_keys": unique_entities,
        "rows_with_address": with_address,
        "address_coverage_pct": round(100 * with_address / count, 2) if count else 0,
        "rows_with_phone": with_phone,
        "phone_coverage_pct": round(100 * with_phone / count, 2) if count else 0,
        "rows_with_capacity": with_capacity,
        "capacity_coverage_pct": round(100 * with_capacity / count, 2) if count else 0,
        "rows_with_coordinates": with_coordinates,
        "coordinate_coverage_pct": round(100 * with_coordinates / count, 2) if count else 0,
        "source_date_min": frame["source_as_of_date"].min() if count else "",
        "source_date_max": frame["source_as_of_date"].max() if count else "",
        "notes": notes,
    }


def canonical_coverage_row(frame: pd.DataFrame) -> Dict[str, object]:
    count = len(frame)
    coordinates = int((frame["latitude"].notna() & frame["longitude"].notna()).sum())
    capacity = int(frame["capacity_max_reported"].notna().sum())
    phone = int(frame["phone"].map(clean_text).ne("").sum())
    address = int(frame["address"].map(clean_text).ne("").sum())
    return {
        "table_name": "facilities_canonical",
        "input_rows": int(frame["observation_count"].sum()),
        "incheon_scope_rows_before_dedup": int(frame["observation_count"].sum()),
        "exact_duplicates_removed": int(frame["observation_count"].sum() - count),
        "output_rows": count,
        "exact_entity_keys": count,
        "rows_with_address": address,
        "address_coverage_pct": round(100 * address / count, 2) if count else 0,
        "rows_with_phone": phone,
        "phone_coverage_pct": round(100 * phone / count, 2) if count else 0,
        "rows_with_capacity": capacity,
        "capacity_coverage_pct": round(100 * capacity / count, 2) if count else 0,
        "rows_with_coordinates": coordinates,
        "coordinate_coverage_pct": round(100 * coordinates / count, 2) if count else 0,
        "source_date_min": "2025-01-31",
        "source_date_max": frame["source_as_of_date_latest"].max() if count else "",
        "notes": "Exact normalized district+name+address only; no fuzzy matching. Capacity is max reported, not summed.",
    }


def build_district_coverage(canonical: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for district, group in canonical.groupby("district", dropna=False, sort=True):
        category_text = group["category_major"].fillna("")
        coords = group["latitude"].notna() & group["longitude"].notna()
        rows.append(
            {
                "district": clean_text(district) or "미상",
                "facility_entities": len(group),
                "elderly_facilities": int(category_text.str.contains("노인복지", regex=False).sum()),
                "disabled_facilities": int(category_text.str.contains("장애인복지", regex=False).sum()),
                "other_welfare_facilities": int((~category_text.str.contains("노인복지|장애인복지", regex=True)).sum()),
                "entities_with_capacity": int(group["capacity_max_reported"].notna().sum()),
                "entities_with_coordinates": int(coords.sum()),
                "coordinate_coverage_pct": round(100 * coords.mean(), 2) if len(group) else 0,
            }
        )
    return pd.DataFrame(rows)


def build_quality_issues(
    elderly_stats: Dict[str, int],
    nhis: pd.DataFrame,
    observations: pd.DataFrame,
    canonical: pd.DataFrame,
) -> pd.DataFrame:
    coordinate_count = int((canonical["latitude"].notna() & canonical["longitude"].notna()).sum())
    legacy_namgu = int((nhis["district_source"] == "남구").sum())
    pre_reform = int(observations["district_source"].isin(["중구", "동구", "서구", "중 구", "서 구"]).sum())
    return pd.DataFrame(
        [
            {
                "severity": "high",
                "issue": "citywide coordinate coverage is incomplete",
                "affected_rows": len(canonical) - coordinate_count,
                "affected_rate_pct": round(100 * (len(canonical) - coordinate_count) / len(canonical), 2),
                "evidence": f"{coordinate_count}/{len(canonical)} exact facility entities have lat/lon",
                "impact": "Point-level map rendering requires geocoding or another official coordinate layer.",
                "recommended_action": "Geocode only public facility addresses and retain match confidence; aggregate low-confidence points.",
            },
            {
                "severity": "high",
                "issue": "facility sources predate the 2026-07-01 Incheon district reform",
                "affected_rows": pre_reform,
                "affected_rate_pct": round(100 * pre_reform / len(observations), 2),
                "evidence": "Rows still use source-era 중구/동구/서구 district labels.",
                "impact": "Direct joins to the new 제물포구/영종구/서해구/검단구 boundaries will misclassify records.",
                "recommended_action": "Apply the official 2026-07-01 legal/administrative-dong crosswalk before current-boundary aggregation.",
            },
            {
                "severity": "low",
                "issue": "exact duplicate elderly service rows",
                "affected_rows": elderly_stats["duplicates_removed"],
                "affected_rate_pct": round(100 * elderly_stats["duplicates_removed"] / elderly_stats["input_rows"], 2),
                "evidence": f"{elderly_stats['duplicates_removed']} rows repeated exactly on district, name, service type, address, and phone",
                "impact": "Without removal, service-supply counts would be slightly inflated.",
                "recommended_action": "Keep the exact-observation uniqueness check in the refresh pipeline.",
            },
            {
                "severity": "medium" if legacy_namgu else "low",
                "issue": "legacy district label in NHIS location field",
                "affected_rows": legacy_namgu,
                "affected_rate_pct": round(100 * legacy_namgu / len(nhis), 2),
                "evidence": f"{legacy_namgu} NHIS facility-service rows use 남구; normalized district is 미추홀구 while source label is preserved",
                "impact": "Unnormalized joins would lose this facility record.",
                "recommended_action": "Preserve district_source and use district for analysis joins.",
            },
        ]
    )


def write_csv(frame: pd.DataFrame, filename: str) -> None:
    path = OUT / filename
    frame.to_csv(path, index=False, encoding=OUTPUT_ENCODING, lineterminator="\n")
    # Verify that the produced file is readable UTF-8 and not silently truncated.
    reread = pd.read_csv(path, encoding="utf-8-sig")
    if len(reread) != len(frame):
        raise ValueError(f"row-count verification failed for {filename}: {len(frame)} != {len(reread)}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    welfare, welfare_stats = load_incheon_welfare()
    elderly, elderly_stats = load_incheon_elderly()
    disabled_day, disabled_day_stats = load_disabled_day()
    disabled_residential, disabled_residential_stats = load_disabled_residential()
    yeonsu_disabled, yeonsu_disabled_stats = load_yeonsu_disabled()
    michuhol, michuhol_stats = load_michuhol_elderly()
    nhis, nhis_stats = load_nhis_ltc()

    disabled = pd.concat(
        [disabled_day, disabled_residential, yeonsu_disabled],
        ignore_index=True,
    )
    disabled, disabled_cross_source_removed = finalize_observations(disabled)
    disabled_stats = {
        "input_rows": (
            disabled_day_stats["input_rows"]
            + disabled_residential_stats["input_rows"]
            + yeonsu_disabled_stats["input_rows"]
        ),
        "scope_rows": (
            disabled_day_stats["scope_rows"]
            + disabled_residential_stats["scope_rows"]
            + yeonsu_disabled_stats["scope_rows"]
        ),
        "duplicates_removed": (
            disabled_day_stats["duplicates_removed"]
            + disabled_residential_stats["duplicates_removed"]
            + yeonsu_disabled_stats["duplicates_removed"]
            + disabled_cross_source_removed
        ),
    }

    observations = pd.concat([welfare, elderly, disabled, michuhol, nhis], ignore_index=True)
    observations, union_removed = finalize_observations(observations)
    canonical, duplicate_groups = build_canonical(observations)
    map_points = canonical[canonical["latitude"].notna() & canonical["longitude"].notna()].copy()

    write_csv(welfare, "facilities_incheon_welfare_20250131.csv")
    write_csv(elderly, "facilities_incheon_elderly_20260630.csv")
    write_csv(disabled, "facilities_incheon_disabled.csv")
    write_csv(michuhol, "facilities_michuhol_elderly_geocoded_20250620.csv")
    write_csv(nhis, "facilities_nhis_ltc_incheon_20260610.csv")
    write_csv(observations, "facilities_all_observations.csv")
    write_csv(canonical, "facilities_canonical.csv")
    write_csv(map_points, "facilities_map_points.csv")
    write_csv(duplicate_groups, "facilities_dedup_groups.csv")

    coverage = pd.DataFrame(
        [
            coverage_row("facilities_incheon_welfare_20250131", welfare, **welfare_stats),
            coverage_row("facilities_incheon_elderly_20260630", elderly, **elderly_stats),
            coverage_row("facilities_incheon_disabled", disabled, **disabled_stats),
            coverage_row(
                "facilities_michuhol_elderly_geocoded_20250620",
                michuhol,
                **michuhol_stats,
                notes="Coordinate-rich district layer; overlaps with citywide elderly/NHIS sources are retained in observations.",
            ),
            coverage_row(
                "facilities_nhis_ltc_incheon_20260610",
                nhis,
                **{key: nhis_stats[key] for key in ("input_rows", "scope_rows", "duplicates_removed")},
                notes=f"{nhis_stats['scope_facilities']} unique Incheon institution codes expanded to service-type rows.",
            ),
            coverage_row(
                "facilities_all_observations",
                observations,
                input_rows=sum(
                    stats["input_rows"]
                    for stats in (welfare_stats, elderly_stats, disabled_stats, michuhol_stats)
                )
                + nhis_stats["input_rows"],
                scope_rows=len(observations) + union_removed,
                duplicates_removed=union_removed,
                notes="Union of source observations; cross-source overlap is intentionally preserved.",
            ),
            canonical_coverage_row(canonical),
        ]
    )
    write_csv(coverage, "facilities_coverage_summary.csv")
    write_csv(build_district_coverage(canonical), "facilities_coverage_by_district.csv")
    write_csv(
        build_quality_issues(elderly_stats, nhis, observations, canonical),
        "facilities_quality_issues.csv",
    )

    print(coverage.to_string(index=False))


if __name__ == "__main__":
    main()
