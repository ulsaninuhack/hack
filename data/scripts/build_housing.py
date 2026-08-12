#!/usr/bin/env python3
"""Normalize VWorld Incheon building-age files for care-risk mapping.

The VWorld age download is partitioned by the eleven post-2026-07-01
Incheon districts.  Its rows do not contain coordinates and use legal-dong
codes, not administrative-dong codes, so this script deliberately stops at
district/legal-dong granularity.  It does not invent an administrative-dong
join.

The source contains repeated rows after the Incheon district reorganization.
``GIS건물통합식별번호`` is not unique in this extract, while the pair
``고유번호`` + ``건물식별번호`` has invariant building attributes.  The
normalized table therefore uses that pair as its record key and preserves all
observed GIS identifiers and source district codes as pipe-delimited lineage.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import math
import re
import struct
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


PROJECT_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_DIR / "raw" / "housing"
OUTPUT_DIR = PROJECT_DIR / "processed"

AGE_ARCHIVE_DIR = RAW_DIR / "vworld_incheon_building_age_by_district_20260810"
INTEGRATED_ARCHIVE = RAW_DIR / "vworld_incheon_building_integrated_20260809.zip"
COLUMN_DICTIONARY = RAW_DIR / "vworld_national_key_data_column_dictionary_20260102.xlsx"

RECORDS_OUTPUT = OUTPUT_DIR / "housing_building_age_records.csv.gz"
DISTRICT_OUTPUT = OUTPUT_DIR / "housing_building_age_district_summary.csv"
LEGAL_DONG_OUTPUT = OUTPUT_DIR / "housing_building_age_legal_dong_summary.csv"
VALIDATION_OUTPUT = OUTPUT_DIR / "housing_building_age_validation.json"

SOURCE_ENCODING = "cp949"
OUTPUT_ENCODING = "utf-8-sig"

DISTRICTS = {
    "28125": "제물포구",
    "28155": "영종구",
    "28177": "미추홀구",
    "28185": "연수구",
    "28200": "남동구",
    "28237": "부평구",
    "28245": "계양구",
    "28275": "서해구",
    "28290": "검단구",
    "28710": "강화군",
    "28720": "옹진군",
}

EXPECTED_SOURCE_FIELDS = [
    "GIS건물통합식별번호",
    "고유번호",
    "법정동코드",
    "법정동명",
    "특수지구분코드",
    "특수지구분명",
    "지번",
    "건물식별번호",
    "집합건물구분코드",
    "집합건물구분",
    "대장종류코드",
    "대장종류",
    "건물명",
    "건물동명",
    "건물연면적",
    "건축물구조코드",
    "건축물구조명",
    "주요용도코드",
    "주요용도명",
    "건물높이",
    "지상층수",
    "지하층수",
    "허가일자",
    "사용승인일자",
    "건물연령",
    "연령대구분코드",
    "연령대구분명",
    "연령대5계급코드",
    "연령대5계급명",
    "데이터기준일자",
    "원천시도시군구코드",
]

# These fields must agree for rows sharing the selected building key.  The
# legal-dong name is handled separately because old-source rows can be blank
# while the post-reorganization copy contains the current district name.
INVARIANT_FIELDS = [
    field
    for field in EXPECTED_SOURCE_FIELDS
    if field
    not in {
        "GIS건물통합식별번호",
        "법정동명",
        "원천시도시군구코드",
    }
]

OUTPUT_FIELDS = [
    "building_key",
    "pnu",
    "building_id",
    "gis_building_ids",
    "district_code",
    "district_name",
    "legal_dong_code",
    "legal_dong_name",
    "lot_number",
    "special_land_code",
    "special_land_name",
    "collective_building_code",
    "collective_building_name",
    "register_type_code",
    "register_type_name",
    "building_name",
    "building_dong_name",
    "gross_floor_area_m2",
    "structure_code",
    "structure_name",
    "main_use_code",
    "main_use_name",
    "is_residential",
    "height_m",
    "above_ground_floors",
    "below_ground_floors",
    "permit_date",
    "approval_date",
    "building_age_official",
    "building_age_valid",
    "age_band_code",
    "age_band_name",
    "age_5year_band_code",
    "age_5year_band_name",
    "data_as_of_date",
    "source_district_codes",
    "source_archives",
    "source_row_count",
]

SUMMARY_FIELDS = [
    "district_code",
    "district_name",
    "raw_source_rows",
    "building_records",
    "duplicate_source_rows_collapsed",
    "age_valid_records",
    "age_missing_or_invalid_records",
    "age_coverage_pct",
    "age_30_plus_records",
    "age_30_plus_share_valid_pct",
    "age_40_plus_records",
    "age_40_plus_share_valid_pct",
    "residential_records",
    "residential_age_valid_records",
    "residential_age_missing_or_invalid_records",
    "residential_age_coverage_pct",
    "residential_age_30_plus_records",
    "residential_age_30_plus_share_valid_pct",
    "residential_age_40_plus_records",
    "residential_age_40_plus_share_valid_pct",
    "data_as_of_date",
    "granularity",
]

LEGAL_DONG_SUMMARY_FIELDS = [
    "district_code",
    "district_name",
    "legal_dong_code",
    "legal_dong_name",
    "building_records",
    "age_valid_records",
    "age_missing_or_invalid_records",
    "age_coverage_pct",
    "age_30_plus_records",
    "age_30_plus_share_valid_pct",
    "age_40_plus_records",
    "age_40_plus_share_valid_pct",
    "residential_records",
    "residential_age_valid_records",
    "residential_age_missing_or_invalid_records",
    "residential_age_coverage_pct",
    "residential_age_30_plus_records",
    "residential_age_30_plus_share_valid_pct",
    "residential_age_40_plus_records",
    "residential_age_40_plus_share_valid_pct",
    "data_as_of_date",
    "granularity",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def parse_int(value: Any) -> int | None:
    text = clean(value)
    if not text:
        return None
    try:
        number = int(text)
    except ValueError:
        return None
    return number


def percent(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return ""
    return f"{numerator / denominator * 100:.4f}"


def format_number(value: Any) -> str:
    text = clean(value)
    if not text:
        return ""
    try:
        number = float(text)
    except ValueError:
        return text
    if not math.isfinite(number):
        return ""
    return f"{number:.9f}".rstrip("0").rstrip(".")


def inspect_integrated_archive(path: Path) -> dict[str, Any]:
    """Read SHP/SHX/DBF headers without extracting the 623 MB archive."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        shp_name = next(name for name in names if name.lower().endswith(".shp"))
        shx_name = next(name for name in names if name.lower().endswith(".shx"))
        dbf_name = next(name for name in names if name.lower().endswith(".dbf"))
        prj_name = next(name for name in names if name.lower().endswith(".prj"))

        with archive.open(shp_name) as handle:
            shp_header = handle.read(100)
        with archive.open(shx_name) as handle:
            shx_header = handle.read(100)
        with archive.open(dbf_name) as handle:
            dbf_header = handle.read(32)
        with archive.open(prj_name) as handle:
            projection = handle.read().decode("ascii", errors="replace")

    if len(shp_header) != 100 or len(shx_header) != 100 or len(dbf_header) != 32:
        raise ValueError("Integrated SHP archive contains a truncated header")

    shp_file_code = struct.unpack(">i", shp_header[0:4])[0]
    shp_file_length = struct.unpack(">i", shp_header[24:28])[0] * 2
    shp_version = struct.unpack("<i", shp_header[28:32])[0]
    shp_type = struct.unpack("<i", shp_header[32:36])[0]
    bbox = struct.unpack("<4d", shp_header[36:68])
    shx_file_length = struct.unpack(">i", shx_header[24:28])[0] * 2
    shx_record_count = (shx_file_length - 100) // 8
    dbf_record_count = struct.unpack("<I", dbf_header[4:8])[0]

    return {
        "archive": path.name,
        "archive_sha256": sha256(path),
        "archive_uncompressed_bytes": sum(
            item.file_size for item in zipfile.ZipFile(path).infolist()
        ),
        "shp_file_code": shp_file_code,
        "shp_file_length_bytes": shp_file_length,
        "shp_version": shp_version,
        "shp_shape_type": shp_type,
        "shp_shape_type_name": "POLYGON" if shp_type == 5 else "UNKNOWN",
        "shp_bbox_epsg5186": {
            "xmin": bbox[0],
            "ymin": bbox[1],
            "xmax": bbox[2],
            "ymax": bbox[3],
        },
        "shx_record_count": shx_record_count,
        "dbf_record_count": dbf_record_count,
        "shape_attribute_count_match": shx_record_count == dbf_record_count,
        "crs": "EPSG:5186" if 'AUTHORITY["EPSG","5186"]' in projection else "unknown",
        "projection_wkt": projection,
        "consumed_by_age_outputs": False,
        "exclusion_reason": (
            "The integrated layer is 309,851 polygons and is retained as the map-geometry "
            "source rather than expanded into this compact tabular build. The official "
            "dictionary maps A1 to GIS건물통합식별번호, but an A1 age join requires explicit "
            "collision handling because GIS identifiers are not unique in the age CSV."
        ),
        "official_field_dictionary": {
            "archive": COLUMN_DICTIONARY.name,
            "sha256": sha256(COLUMN_DICTIONARY),
            "relevant_rows": {
                "건축물연령공간정보_AL_D196": "A0 도형ID; A1 GIS건물통합식별번호; A2..A30 age attributes",
                "GIS건물통합정보_AL_D010": "A0 원천도형ID; A1 GIS건물통합식별번호; A2..A28 building attributes",
            },
        },
    }


def source_archives() -> list[Path]:
    paths = sorted(AGE_ARCHIVE_DIR.glob("AL_D197_*_20260810.zip"))
    observed_codes = {
        match.group(1)
        for path in paths
        if (match := re.fullmatch(r"AL_D197_(\d{5})_20260810\.zip", path.name))
    }
    if observed_codes != set(DISTRICTS):
        raise ValueError(
            "Expected exactly the eleven current Incheon district archives; "
            f"observed={sorted(observed_codes)}"
        )
    return paths


def read_age_records() -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, Any]]:
    records: dict[tuple[str, str], dict[str, Any]] = {}
    raw_rows_by_district: Counter[str] = Counter()
    input_files: list[dict[str, Any]] = []
    source_headers: dict[str, list[str]] = {}
    malformed_rows = 0
    blank_key_rows = 0
    legal_code_partition_mismatches = 0
    nonblank_name_conflicts = 0
    invariant_conflicts: Counter[str] = Counter()
    data_dates: Counter[str] = Counter()
    source_district_codes: Counter[str] = Counter()
    gis_id_counts: Counter[str] = Counter()

    for path in source_archives():
        district_code = path.name.split("_")[2]
        input_files.append(
            {
                "archive": path.name,
                "district_code": district_code,
                "district_name": DISTRICTS[district_code],
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
        )

        with zipfile.ZipFile(path) as archive:
            members = [name for name in archive.namelist() if name.lower().endswith(".csv")]
            if len(members) != 1:
                raise ValueError(f"{path.name}: expected one CSV member, got {members}")
            member = members[0]
            with archive.open(member) as raw_handle:
                text_handle = io.TextIOWrapper(raw_handle, encoding=SOURCE_ENCODING, newline="")
                reader = csv.DictReader(text_handle)
                headers = reader.fieldnames or []
                source_headers[path.name] = headers
                if headers != EXPECTED_SOURCE_FIELDS:
                    raise ValueError(
                        f"{path.name}: unexpected schema; expected {EXPECTED_SOURCE_FIELDS}, "
                        f"got {headers}"
                    )

                for row in reader:
                    if None in row:
                        malformed_rows += 1
                        continue
                    raw_rows_by_district[district_code] += 1

                    pnu = clean(row["고유번호"])
                    building_id = clean(row["건물식별번호"])
                    if not pnu or not building_id:
                        blank_key_rows += 1
                        continue
                    key = (pnu, building_id)

                    legal_dong_code = clean(row["법정동코드"])
                    if legal_dong_code[:5] != district_code:
                        legal_code_partition_mismatches += 1

                    gis_id = clean(row["GIS건물통합식별번호"])
                    source_code = clean(row["원천시도시군구코드"])
                    legal_name = clean(row["법정동명"])
                    data_date = clean(row["데이터기준일자"])
                    gis_id_counts[gis_id] += 1
                    source_district_codes[source_code] += 1
                    data_dates[data_date] += 1

                    if key not in records:
                        records[key] = {
                            "row": {field: clean(row[field]) for field in EXPECTED_SOURCE_FIELDS},
                            "gis_ids": set(),
                            "source_codes": set(),
                            "source_archives": set(),
                            "source_row_count": 0,
                            "district_code": district_code,
                        }
                    else:
                        record = records[key]
                        if record["district_code"] != district_code:
                            invariant_conflicts["archive_district_code"] += 1
                        existing = record["row"]
                        for field in INVARIANT_FIELDS:
                            if existing[field] != clean(row[field]):
                                invariant_conflicts[field] += 1
                        old_name = clean(existing["법정동명"])
                        if old_name and legal_name and old_name != legal_name:
                            nonblank_name_conflicts += 1
                        elif not old_name and legal_name:
                            existing["법정동명"] = legal_name

                    record = records[key]
                    if gis_id:
                        record["gis_ids"].add(gis_id)
                    if source_code:
                        record["source_codes"].add(source_code)
                    record["source_archives"].add(path.name)
                    record["source_row_count"] += 1

    diagnostics = {
        "input_files": input_files,
        "source_headers": source_headers,
        "raw_rows": sum(raw_rows_by_district.values()),
        "raw_rows_by_district": dict(sorted(raw_rows_by_district.items())),
        "building_records": len(records),
        "duplicate_source_rows_collapsed": sum(raw_rows_by_district.values()) - len(records),
        "malformed_rows": malformed_rows,
        "blank_key_rows": blank_key_rows,
        "legal_code_partition_mismatches": legal_code_partition_mismatches,
        "nonblank_legal_dong_name_conflicts": nonblank_name_conflicts,
        "invariant_conflicts": dict(sorted(invariant_conflicts.items())),
        "data_dates": dict(sorted(data_dates.items())),
        "source_district_code_counts": dict(sorted(source_district_codes.items())),
        "gis_identifier": {
            "nonblank_unique_values": len([value for value in gis_id_counts if value]),
            "duplicate_value_groups": sum(
                1 for value, count in gis_id_counts.items() if value and count > 1
            ),
            "maximum_occurrences": max(gis_id_counts.values(), default=0),
            "not_used_as_primary_key": True,
        },
    }
    return records, diagnostics


def normalize_record(key: tuple[str, str], record: dict[str, Any]) -> dict[str, str]:
    row = record["row"]
    pnu, building_id = key
    district_code = record["district_code"]
    age = parse_int(row["건물연령"])
    age_valid = age is not None and 0 <= age <= 200
    main_use_code = clean(row["주요용도코드"])
    is_residential = main_use_code in {"01000", "02000"}

    return {
        "building_key": f"{pnu}|{building_id}",
        "pnu": pnu,
        "building_id": building_id,
        "gis_building_ids": "|".join(sorted(record["gis_ids"])),
        "district_code": district_code,
        "district_name": DISTRICTS[district_code],
        "legal_dong_code": clean(row["법정동코드"]),
        "legal_dong_name": clean(row["법정동명"]),
        "lot_number": clean(row["지번"]),
        "special_land_code": clean(row["특수지구분코드"]),
        "special_land_name": clean(row["특수지구분명"]),
        "collective_building_code": clean(row["집합건물구분코드"]),
        "collective_building_name": clean(row["집합건물구분"]),
        "register_type_code": clean(row["대장종류코드"]),
        "register_type_name": clean(row["대장종류"]),
        "building_name": clean(row["건물명"]),
        "building_dong_name": clean(row["건물동명"]),
        "gross_floor_area_m2": format_number(row["건물연면적"]),
        "structure_code": clean(row["건축물구조코드"]),
        "structure_name": clean(row["건축물구조명"]),
        "main_use_code": main_use_code,
        "main_use_name": clean(row["주요용도명"]),
        "is_residential": "true" if is_residential else "false",
        "height_m": format_number(row["건물높이"]),
        "above_ground_floors": clean(row["지상층수"]),
        "below_ground_floors": clean(row["지하층수"]),
        "permit_date": clean(row["허가일자"]),
        "approval_date": clean(row["사용승인일자"]),
        "building_age_official": "" if age is None else str(age),
        "building_age_valid": "true" if age_valid else "false",
        "age_band_code": clean(row["연령대구분코드"]),
        "age_band_name": clean(row["연령대구분명"]),
        "age_5year_band_code": clean(row["연령대5계급코드"]),
        "age_5year_band_name": clean(row["연령대5계급명"]),
        "data_as_of_date": clean(row["데이터기준일자"]),
        "source_district_codes": "|".join(sorted(record["source_codes"])),
        "source_archives": "|".join(sorted(record["source_archives"])),
        "source_row_count": str(record["source_row_count"]),
    }


def write_outputs(
    records: dict[tuple[str, str], dict[str, Any]], diagnostics: dict[str, Any]
) -> dict[str, Any]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    district_stats: dict[str, Counter[str]] = defaultdict(Counter)
    data_dates_by_district: dict[str, set[str]] = defaultdict(set)
    legal_dong_stats: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    legal_dong_names: dict[tuple[str, str], str] = {}
    data_dates_by_legal_dong: dict[tuple[str, str], set[str]] = defaultdict(set)

    ordered_keys = sorted(
        records,
        key=lambda key: (
            records[key]["district_code"],
            key[0],
            key[1],
        ),
    )
    # Gzip's default embeds the current time. Set mtime=0 so reruns are byte-for-byte stable.
    with RECORDS_OUTPUT.open("wb") as binary_handle:
        gzip_handle = gzip.GzipFile(
            filename="", mode="wb", fileobj=binary_handle, mtime=0
        )
        handle = io.TextIOWrapper(gzip_handle, encoding=OUTPUT_ENCODING, newline="")
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS, lineterminator="\n")
        writer.writeheader()
        for key in ordered_keys:
            output = normalize_record(key, records[key])
            writer.writerow(output)
            district = output["district_code"]
            stats = district_stats[district]
            legal_key = (district, output["legal_dong_code"])
            legal_stats = legal_dong_stats[legal_key]
            legal_dong_names[legal_key] = output["legal_dong_name"]
            stats["building_records"] += 1
            legal_stats["building_records"] += 1
            source_rows = int(output["source_row_count"])
            stats["source_rows_from_records"] += source_rows
            data_dates_by_district[district].add(output["data_as_of_date"])
            data_dates_by_legal_dong[legal_key].add(output["data_as_of_date"])

            age = parse_int(output["building_age_official"])
            valid = output["building_age_valid"] == "true"
            residential = output["is_residential"] == "true"
            if valid:
                stats["age_valid_records"] += 1
                legal_stats["age_valid_records"] += 1
                if age is not None and age >= 30:
                    stats["age_30_plus_records"] += 1
                    legal_stats["age_30_plus_records"] += 1
                if age is not None and age >= 40:
                    stats["age_40_plus_records"] += 1
                    legal_stats["age_40_plus_records"] += 1
            else:
                stats["age_missing_or_invalid_records"] += 1
                legal_stats["age_missing_or_invalid_records"] += 1

            if residential:
                stats["residential_records"] += 1
                legal_stats["residential_records"] += 1
                if valid:
                    stats["residential_age_valid_records"] += 1
                    legal_stats["residential_age_valid_records"] += 1
                    if age is not None and age >= 30:
                        stats["residential_age_30_plus_records"] += 1
                        legal_stats["residential_age_30_plus_records"] += 1
                    if age is not None and age >= 40:
                        stats["residential_age_40_plus_records"] += 1
                        legal_stats["residential_age_40_plus_records"] += 1
                else:
                    stats["residential_age_missing_or_invalid_records"] += 1
                    legal_stats["residential_age_missing_or_invalid_records"] += 1
        handle.flush()
        handle.detach()
        gzip_handle.close()

    summary_rows: list[dict[str, str]] = []
    for district_code, district_name in DISTRICTS.items():
        stats = district_stats[district_code]
        raw_rows = diagnostics["raw_rows_by_district"].get(district_code, 0)
        buildings = stats["building_records"]
        valid = stats["age_valid_records"]
        residential = stats["residential_records"]
        residential_valid = stats["residential_age_valid_records"]
        dates = sorted(date for date in data_dates_by_district[district_code] if date)
        summary_rows.append(
            {
                "district_code": district_code,
                "district_name": district_name,
                "raw_source_rows": str(raw_rows),
                "building_records": str(buildings),
                "duplicate_source_rows_collapsed": str(raw_rows - buildings),
                "age_valid_records": str(valid),
                "age_missing_or_invalid_records": str(
                    stats["age_missing_or_invalid_records"]
                ),
                "age_coverage_pct": percent(valid, buildings),
                "age_30_plus_records": str(stats["age_30_plus_records"]),
                "age_30_plus_share_valid_pct": percent(
                    stats["age_30_plus_records"], valid
                ),
                "age_40_plus_records": str(stats["age_40_plus_records"]),
                "age_40_plus_share_valid_pct": percent(
                    stats["age_40_plus_records"], valid
                ),
                "residential_records": str(residential),
                "residential_age_valid_records": str(residential_valid),
                "residential_age_missing_or_invalid_records": str(
                    stats["residential_age_missing_or_invalid_records"]
                ),
                "residential_age_coverage_pct": percent(
                    residential_valid, residential
                ),
                "residential_age_30_plus_records": str(
                    stats["residential_age_30_plus_records"]
                ),
                "residential_age_30_plus_share_valid_pct": percent(
                    stats["residential_age_30_plus_records"], residential_valid
                ),
                "residential_age_40_plus_records": str(
                    stats["residential_age_40_plus_records"]
                ),
                "residential_age_40_plus_share_valid_pct": percent(
                    stats["residential_age_40_plus_records"], residential_valid
                ),
                "data_as_of_date": "|".join(dates),
                "granularity": "district/legal_dong; not administrative_dong",
            }
        )

    with DISTRICT_OUTPUT.open("w", encoding=OUTPUT_ENCODING, newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SUMMARY_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(summary_rows)

    legal_dong_rows: list[dict[str, str]] = []
    for district_code, legal_dong_code in sorted(legal_dong_stats):
        stats = legal_dong_stats[(district_code, legal_dong_code)]
        buildings = stats["building_records"]
        valid = stats["age_valid_records"]
        residential = stats["residential_records"]
        residential_valid = stats["residential_age_valid_records"]
        dates = sorted(
            date
            for date in data_dates_by_legal_dong[(district_code, legal_dong_code)]
            if date
        )
        legal_dong_rows.append(
            {
                "district_code": district_code,
                "district_name": DISTRICTS[district_code],
                "legal_dong_code": legal_dong_code,
                "legal_dong_name": legal_dong_names[(district_code, legal_dong_code)],
                "building_records": str(buildings),
                "age_valid_records": str(valid),
                "age_missing_or_invalid_records": str(
                    stats["age_missing_or_invalid_records"]
                ),
                "age_coverage_pct": percent(valid, buildings),
                "age_30_plus_records": str(stats["age_30_plus_records"]),
                "age_30_plus_share_valid_pct": percent(
                    stats["age_30_plus_records"], valid
                ),
                "age_40_plus_records": str(stats["age_40_plus_records"]),
                "age_40_plus_share_valid_pct": percent(
                    stats["age_40_plus_records"], valid
                ),
                "residential_records": str(residential),
                "residential_age_valid_records": str(residential_valid),
                "residential_age_missing_or_invalid_records": str(
                    stats["residential_age_missing_or_invalid_records"]
                ),
                "residential_age_coverage_pct": percent(
                    residential_valid, residential
                ),
                "residential_age_30_plus_records": str(
                    stats["residential_age_30_plus_records"]
                ),
                "residential_age_30_plus_share_valid_pct": percent(
                    stats["residential_age_30_plus_records"], residential_valid
                ),
                "residential_age_40_plus_records": str(
                    stats["residential_age_40_plus_records"]
                ),
                "residential_age_40_plus_share_valid_pct": percent(
                    stats["residential_age_40_plus_records"], residential_valid
                ),
                "data_as_of_date": "|".join(dates),
                "granularity": "legal_dong; not administrative_dong",
            }
        )

    with LEGAL_DONG_OUTPUT.open("w", encoding=OUTPUT_ENCODING, newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=LEGAL_DONG_SUMMARY_FIELDS, lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(legal_dong_rows)

    totals = Counter()
    for row in summary_rows:
        for field in SUMMARY_FIELDS:
            if field.endswith("_records") or field in {
                "raw_source_rows",
                "building_records",
                "duplicate_source_rows_collapsed",
            }:
                totals[field] += int(row[field])

    return {
        "district_rows": len(summary_rows),
        "legal_dong_rows": len(legal_dong_rows),
        "district_codes": [row["district_code"] for row in summary_rows],
        "totals": dict(sorted(totals.items())),
        "output_files": {
            RECORDS_OUTPUT.name: {
                "bytes": RECORDS_OUTPUT.stat().st_size,
                "sha256": sha256(RECORDS_OUTPUT),
                "rows": len(records),
                "encoding": OUTPUT_ENCODING,
                "compression": "gzip",
            },
            DISTRICT_OUTPUT.name: {
                "bytes": DISTRICT_OUTPUT.stat().st_size,
                "sha256": sha256(DISTRICT_OUTPUT),
                "rows": len(summary_rows),
                "encoding": OUTPUT_ENCODING,
            },
            LEGAL_DONG_OUTPUT.name: {
                "bytes": LEGAL_DONG_OUTPUT.stat().st_size,
                "sha256": sha256(LEGAL_DONG_OUTPUT),
                "rows": len(legal_dong_rows),
                "encoding": OUTPUT_ENCODING,
            },
        },
    }


def main() -> None:
    records, diagnostics = read_age_records()
    if diagnostics["malformed_rows"] or diagnostics["blank_key_rows"]:
        raise ValueError(
            "Malformed or blank-key rows found: "
            f"malformed={diagnostics['malformed_rows']} "
            f"blank_key={diagnostics['blank_key_rows']}"
        )
    if diagnostics["legal_code_partition_mismatches"]:
        raise ValueError(
            "Legal-dong code does not match its district partition: "
            f"{diagnostics['legal_code_partition_mismatches']} rows"
        )
    if diagnostics["nonblank_legal_dong_name_conflicts"]:
        raise ValueError("Conflicting nonblank legal-dong names found for a building key")
    if diagnostics["invariant_conflicts"]:
        raise ValueError(
            "Building attributes conflict for the selected composite key: "
            f"{diagnostics['invariant_conflicts']}"
        )

    output_validation = write_outputs(records, diagnostics)
    validation = {
        "status": "pass",
        "source": {
            "publisher": "VWorld 국가공간정보마켓",
            "dataset": "건축물연령정보 / 건물통합정보",
            "age_dataset_url": (
                "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=1&svcCde=NA"
            ),
            "integrated_dataset_url": (
                "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=18&svcCde=NA"
            ),
            "age_download_packaging_date": "2026-08-10",
            "age_data_as_of_date": sorted(diagnostics["data_dates"]),
            "age_source_encoding": SOURCE_ENCODING,
        },
        "age_csv": diagnostics,
        "integrated_building_shapefile": inspect_integrated_archive(INTEGRATED_ARCHIVE),
        "normalization": {
            "record_key": "고유번호 + 건물식별번호",
            "record_key_reason": (
                "All non-lineage building attributes are invariant for this pair; "
                "GIS건물통합식별번호 has duplicate values assigned to different pairs."
            ),
            "gis_ids_preserved": True,
            "source_district_codes_preserved": True,
            "residential_definition": "주요용도코드 in {01000 단독주택, 02000 공동주택}",
            "valid_age_definition": (
                "operational plausibility rule: integer 0..200; blanks and the observed "
                "out-of-range value 2028 are excluded without asserting an official code meaning"
            ),
            "old_building_thresholds_years": [30, 40],
            "share_denominator": "records with a valid official building age",
        },
        "outputs": output_validation,
        "limitations": [
            "The age CSV contains legal-dong codes, not the 162 administrative-dong codes.",
            "The age CSV has no coordinates; administrative-dong assignment is not inferred.",
            "District summaries count normalized building-register records, not households or residents.",
            "13,179 source rows have blank approval_date and building_age_official=2028; the official dictionary does not define 2028 as a code, so it is only labeled out-of-range and excluded.",
            "Source district codes can retain pre-reorganization codes and are lineage, not geography.",
            "The integrated building SHP is retained raw but is not joined without a verified A0-A28 field dictionary.",
        ],
    }
    VALIDATION_OUTPUT.write_text(
        json.dumps(validation, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    # Recompute the validation file hash is intentionally omitted because a
    # file cannot contain a stable hash of itself.
    print(
        json.dumps(
            {
                "status": validation["status"],
                "raw_rows": diagnostics["raw_rows"],
                "building_records": diagnostics["building_records"],
                "district_rows": output_validation["district_rows"],
                "legal_dong_rows": output_validation["legal_dong_rows"],
                "records_output": str(RECORDS_OUTPUT),
                "summary_output": str(DISTRICT_OUTPUT),
                "validation_output": str(VALIDATION_OUTPUT),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
