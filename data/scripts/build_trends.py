#!/usr/bin/env python3
"""Normalize MOIS resident-registration trend extracts for Incheon.

Inputs are the CP949 CSV snapshots already stored under ``raw/demographics``.
The source age tables use ten-year bands.  Because ages 60--69 cannot be split,
this builder deliberately does *not* publish a fabricated age-65-plus value.
It publishes exact age-60-plus and age-70-plus alternatives and records the
limitation in both the CSVs and the validation report.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PROJECT_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_DIR / "raw" / "demographics"
OUTPUT_DIR = PROJECT_DIR / "processed"

POPULATION_YEARS = range(2021, 2026)
HOUSEHOLD_YEARS = range(2021, 2026)
ONE_PERSON_AGE_YEARS = range(2023, 2026)

ADMIN_RE = re.compile(r"^(.*?)\s*\((\d{10})\)\s*$")
REFORMED_SOURCE_DISTRICTS = {"중구", "동구", "서구"}
AGE_65_STATUS = "not_calculated_source_aggregates_ages_60_to_69"


def compact_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def parse_admin(value: str) -> dict[str, str] | None:
    match = ADMIN_RE.match(value.strip())
    if not match:
        return None

    source_name = compact_spaces(match.group(1))
    code = match.group(2)
    parts = source_name.split(" ")
    if len(parts) < 3 or parts[0] != "인천광역시":
        return None

    sigungu_name = parts[1]
    eupmyeondong_name = " ".join(parts[2:])
    return {
        "source_admin_code": code,
        "source_admin_name": source_name,
        "source_sido_name": parts[0],
        "source_sigungu_name": sigungu_name,
        "source_eupmyeondong_name": eupmyeondong_name,
        "harmonization_status": (
            "requires_2026_07_01_reform_crosswalk"
            if sigungu_name in REFORMED_SOURCE_DISTRICTS
            else "pre_reform_code_preserved_district_not_reorganized"
        ),
    }


def is_incheon_admin_dong(raw_admin: str) -> bool:
    match = ADMIN_RE.match(raw_admin.strip())
    if not match or not compact_spaces(match.group(1)).startswith("인천광역시"):
        return False
    # MOIS 10-digit province, district, and branch aggregates end in 00000.
    # Administrative eup/myeon/dong codes have a non-zero five-digit suffix.
    return int(match.group(2)) % 100_000 != 0


def parse_int(value: str, *, field: str, file_name: str, row_number: int) -> int:
    cleaned = value.replace(",", "").strip()
    if not cleaned:
        raise ValueError(f"{file_name}:{row_number}: blank numeric field {field}")
    parsed = int(cleaned)
    if parsed < 0:
        raise ValueError(f"{file_name}:{row_number}: negative numeric field {field}")
    return parsed


def percent(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return ""
    return f"{(numerator / denominator) * 100:.4f}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_source(path: Path) -> tuple[list[str], list[tuple[int, dict[str, str]]]]:
    with path.open("r", encoding="cp949", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"{path.name}: missing header")
        rows = [(row_number, row) for row_number, row in enumerate(reader, start=2)]
        return list(reader.fieldnames), rows


def base_record(year: int, admin: dict[str, str], source_file: str) -> dict[str, Any]:
    return {
        "reference_year": year,
        "reference_period": f"{year}-12",
        **admin,
        "source_file": source_file,
    }


def exact_age_sum(
    row: dict[str, str],
    prefix: str,
    lower_decade: int,
    *,
    file_name: str,
    row_number: int,
) -> int:
    bands = [f"{age}~{age + 9}세" for age in range(lower_decade, 100, 10)]
    bands.append("100세 이상")
    return sum(
        parse_int(
            row[f"{prefix}{band}"],
            field=f"{prefix}{band}",
            file_name=file_name,
            row_number=row_number,
        )
        for band in bands
    )


def validate_unique(records: list[dict[str, Any]], label: str) -> list[str]:
    seen: set[tuple[int, str]] = set()
    duplicates: list[str] = []
    for record in records:
        key = (int(record["reference_year"]), str(record["source_admin_code"]))
        if key in seen:
            duplicates.append(f"{key[0]}:{key[1]}")
        seen.add(key)
    if duplicates:
        raise ValueError(f"{label}: duplicate dong-year keys: {duplicates[:10]}")
    return duplicates


def load_population() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records: list[dict[str, Any]] = []
    checks: dict[str, Any] = {}
    for year in POPULATION_YEARS:
        path = RAW_DIR / f"jumin_population_age_{year}12.csv"
        headers, rows = read_source(path)
        prefix = f"{year}년12월_계_"
        required = {
            "행정구역",
            f"{prefix}총인구수",
            f"{prefix}연령구간인구수",
            *(f"{prefix}{age}~{age + 9}세" for age in range(0, 100, 10)),
            f"{prefix}100세 이상",
            f"{year}년12월_남_총인구수",
            f"{year}년12월_여_총인구수",
        }
        missing_headers = sorted(required - set(headers))
        if missing_headers:
            raise ValueError(f"{path.name}: missing columns {missing_headers}")

        age_total_mismatches: list[str] = []
        sex_total_mismatches: list[str] = []
        incheon_rows = 0
        excluded_aggregate_rows = 0
        province_total: int | None = None
        for row_number, row in rows:
            raw_admin = row["행정구역"]
            if not compact_spaces(raw_admin).startswith("인천광역시"):
                continue
            incheon_rows += 1
            admin_match = ADMIN_RE.match(raw_admin.strip())
            if admin_match and admin_match.group(2) == "2800000000":
                province_total = parse_int(
                    row[f"{prefix}총인구수"],
                    field=f"{prefix}총인구수",
                    file_name=path.name,
                    row_number=row_number,
                )
            if not is_incheon_admin_dong(raw_admin):
                excluded_aggregate_rows += 1
                continue
            admin = parse_admin(raw_admin)
            if admin is None:
                raise ValueError(
                    f"{path.name}:{row_number}: malformed Incheon admin field"
                )

            total = parse_int(
                row[f"{prefix}총인구수"],
                field=f"{prefix}총인구수",
                file_name=path.name,
                row_number=row_number,
            )
            age_interval_total = parse_int(
                row[f"{prefix}연령구간인구수"],
                field=f"{prefix}연령구간인구수",
                file_name=path.name,
                row_number=row_number,
            )
            all_age_sum = exact_age_sum(
                row, prefix, 0, file_name=path.name, row_number=row_number
            )
            male_total = parse_int(
                row[f"{year}년12월_남_총인구수"],
                field=f"{year}년12월_남_총인구수",
                file_name=path.name,
                row_number=row_number,
            )
            female_total = parse_int(
                row[f"{year}년12월_여_총인구수"],
                field=f"{year}년12월_여_총인구수",
                file_name=path.name,
                row_number=row_number,
            )
            if total != age_interval_total or total != all_age_sum:
                age_total_mismatches.append(admin["source_admin_code"])
            if total != male_total + female_total:
                sex_total_mismatches.append(admin["source_admin_code"])

            age_60_plus = exact_age_sum(
                row, prefix, 60, file_name=path.name, row_number=row_number
            )
            age_70_plus = exact_age_sum(
                row, prefix, 70, file_name=path.name, row_number=row_number
            )
            records.append(
                {
                    **base_record(year, admin, path.name),
                    "population_total": total,
                    "population_male": male_total,
                    "population_female": female_total,
                    "population_age_60_plus_exact": age_60_plus,
                    "population_age_70_plus_exact": age_70_plus,
                    "population_age_60_plus_share_pct": percent(age_60_plus, total),
                    "population_age_70_plus_share_pct": percent(age_70_plus, total),
                    "population_age_65_plus_status": AGE_65_STATUS,
                }
            )

        output_total = sum(
            int(record["population_total"])
            for record in records
            if record["reference_year"] == year
        )
        province_total_mismatch_count = int(
            province_total is None or output_total != province_total
        )
        checks[str(year)] = {
            "source_file": path.name,
            "sha256": sha256(path),
            "source_column_count": len(headers),
            "source_row_count": len(rows),
            "incheon_row_count_including_aggregates": incheon_rows,
            "excluded_province_district_branch_aggregate_rows": excluded_aggregate_rows,
            "output_dong_row_count": sum(
                1 for record in records if record["reference_year"] == year
            ),
            "age_band_sum_mismatch_count": len(age_total_mismatches),
            "age_band_sum_mismatch_codes": age_total_mismatches,
            "sex_sum_mismatch_count": len(sex_total_mismatches),
            "sex_sum_mismatch_codes": sex_total_mismatches,
            "source_province_total": province_total,
            "output_dong_total": output_total,
            "province_total_mismatch_count": province_total_mismatch_count,
        }
    validate_unique(records, "population")
    return records, checks


def load_households() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records: list[dict[str, Any]] = []
    checks: dict[str, Any] = {}
    for year in HOUSEHOLD_YEARS:
        path = RAW_DIR / f"jumin_households_size_{year}12.csv"
        headers, rows = read_source(path)
        prefix = f"{year}년12월_"
        size_fields = [f"{prefix}{size}인세대" for size in range(1, 10)] + [
            f"{prefix}10인이상세대"
        ]
        required = {"행정구역", f"{prefix}전체세대", *size_fields}
        missing_headers = sorted(required - set(headers))
        if missing_headers:
            raise ValueError(f"{path.name}: missing columns {missing_headers}")

        size_sum_mismatches: list[str] = []
        incheon_rows = 0
        excluded_aggregate_rows = 0
        province_households_total: int | None = None
        province_one_person_total: int | None = None
        for row_number, row in rows:
            raw_admin = row["행정구역"]
            if not compact_spaces(raw_admin).startswith("인천광역시"):
                continue
            incheon_rows += 1
            admin_match = ADMIN_RE.match(raw_admin.strip())
            if admin_match and admin_match.group(2) == "2800000000":
                province_households_total = parse_int(
                    row[f"{prefix}전체세대"],
                    field=f"{prefix}전체세대",
                    file_name=path.name,
                    row_number=row_number,
                )
                province_one_person_total = parse_int(
                    row[f"{prefix}1인세대"],
                    field=f"{prefix}1인세대",
                    file_name=path.name,
                    row_number=row_number,
                )
            if not is_incheon_admin_dong(raw_admin):
                excluded_aggregate_rows += 1
                continue
            admin = parse_admin(raw_admin)
            if admin is None:
                raise ValueError(
                    f"{path.name}:{row_number}: malformed Incheon admin field"
                )

            total = parse_int(
                row[f"{prefix}전체세대"],
                field=f"{prefix}전체세대",
                file_name=path.name,
                row_number=row_number,
            )
            sizes = {
                field: parse_int(
                    row[field], field=field, file_name=path.name, row_number=row_number
                )
                for field in size_fields
            }
            if total != sum(sizes.values()):
                size_sum_mismatches.append(admin["source_admin_code"])

            one_person = sizes[f"{prefix}1인세대"]
            records.append(
                {
                    **base_record(year, admin, path.name),
                    "households_total": total,
                    "one_person_households": one_person,
                    "two_person_households": sizes[f"{prefix}2인세대"],
                    "three_person_households": sizes[f"{prefix}3인세대"],
                    "four_person_households": sizes[f"{prefix}4인세대"],
                    "five_person_households": sizes[f"{prefix}5인세대"],
                    "six_person_households": sizes[f"{prefix}6인세대"],
                    "seven_person_households": sizes[f"{prefix}7인세대"],
                    "eight_person_households": sizes[f"{prefix}8인세대"],
                    "nine_person_households": sizes[f"{prefix}9인세대"],
                    "ten_plus_person_households": sizes[f"{prefix}10인이상세대"],
                    "one_person_household_share_pct": percent(one_person, total),
                }
            )

        output_households_total = sum(
            int(record["households_total"])
            for record in records
            if record["reference_year"] == year
        )
        output_one_person_total = sum(
            int(record["one_person_households"])
            for record in records
            if record["reference_year"] == year
        )
        province_total_mismatch_count = int(
            province_households_total is None
            or province_one_person_total is None
            or output_households_total != province_households_total
            or output_one_person_total != province_one_person_total
        )
        checks[str(year)] = {
            "source_file": path.name,
            "sha256": sha256(path),
            "source_column_count": len(headers),
            "source_row_count": len(rows),
            "incheon_row_count_including_aggregates": incheon_rows,
            "excluded_province_district_aggregate_rows": excluded_aggregate_rows,
            "output_dong_row_count": sum(
                1 for record in records if record["reference_year"] == year
            ),
            "household_size_sum_mismatch_count": len(size_sum_mismatches),
            "household_size_sum_mismatch_codes": size_sum_mismatches,
            "source_province_households_total": province_households_total,
            "output_dong_households_total": output_households_total,
            "source_province_one_person_total": province_one_person_total,
            "output_dong_one_person_total": output_one_person_total,
            "province_total_mismatch_count": province_total_mismatch_count,
        }
    validate_unique(records, "households")
    return records, checks


def load_one_person_age() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records: list[dict[str, Any]] = []
    checks: dict[str, Any] = {}
    for year in ONE_PERSON_AGE_YEARS:
        path = RAW_DIR / f"jumin_one_person_age_{year}12.csv"
        headers, rows = read_source(path)
        prefix = f"{year}년12월_계_"
        required = {
            "행정구역",
            f"{prefix}총세대수",
            f"{prefix}연령구간세대수",
            *(f"{prefix}{age}~{age + 9}세" for age in range(0, 100, 10)),
            f"{prefix}100세 이상",
            f"{year}년12월_남_총세대수",
            f"{year}년12월_여_총세대수",
        }
        missing_headers = sorted(required - set(headers))
        if missing_headers:
            raise ValueError(f"{path.name}: missing columns {missing_headers}")

        age_total_mismatches: list[str] = []
        sex_total_mismatches: list[str] = []
        incheon_rows = 0
        excluded_aggregate_rows = 0
        province_total: int | None = None
        for row_number, row in rows:
            raw_admin = row["행정구역"]
            if not compact_spaces(raw_admin).startswith("인천광역시"):
                continue
            incheon_rows += 1
            admin_match = ADMIN_RE.match(raw_admin.strip())
            if admin_match and admin_match.group(2) == "2800000000":
                province_total = parse_int(
                    row[f"{prefix}총세대수"],
                    field=f"{prefix}총세대수",
                    file_name=path.name,
                    row_number=row_number,
                )
            if not is_incheon_admin_dong(raw_admin):
                excluded_aggregate_rows += 1
                continue
            admin = parse_admin(raw_admin)
            if admin is None:
                raise ValueError(
                    f"{path.name}:{row_number}: malformed Incheon admin field"
                )

            total = parse_int(
                row[f"{prefix}총세대수"],
                field=f"{prefix}총세대수",
                file_name=path.name,
                row_number=row_number,
            )
            age_interval_total = parse_int(
                row[f"{prefix}연령구간세대수"],
                field=f"{prefix}연령구간세대수",
                file_name=path.name,
                row_number=row_number,
            )
            all_age_sum = exact_age_sum(
                row, prefix, 0, file_name=path.name, row_number=row_number
            )
            male_total = parse_int(
                row[f"{year}년12월_남_총세대수"],
                field=f"{year}년12월_남_총세대수",
                file_name=path.name,
                row_number=row_number,
            )
            female_total = parse_int(
                row[f"{year}년12월_여_총세대수"],
                field=f"{year}년12월_여_총세대수",
                file_name=path.name,
                row_number=row_number,
            )
            if total != age_interval_total or total != all_age_sum:
                age_total_mismatches.append(admin["source_admin_code"])
            if total != male_total + female_total:
                sex_total_mismatches.append(admin["source_admin_code"])

            age_60_plus = exact_age_sum(
                row, prefix, 60, file_name=path.name, row_number=row_number
            )
            age_70_plus = exact_age_sum(
                row, prefix, 70, file_name=path.name, row_number=row_number
            )
            records.append(
                {
                    **base_record(year, admin, path.name),
                    "one_person_households_age_total": total,
                    "one_person_households_age_male": male_total,
                    "one_person_households_age_female": female_total,
                    "one_person_age_60_plus_exact": age_60_plus,
                    "one_person_age_70_plus_exact": age_70_plus,
                    "one_person_age_60_plus_share_pct": percent(age_60_plus, total),
                    "one_person_age_70_plus_share_pct": percent(age_70_plus, total),
                    "one_person_age_65_plus_status": AGE_65_STATUS,
                }
            )

        output_total = sum(
            int(record["one_person_households_age_total"])
            for record in records
            if record["reference_year"] == year
        )
        province_total_mismatch_count = int(
            province_total is None or output_total != province_total
        )
        checks[str(year)] = {
            "source_file": path.name,
            "sha256": sha256(path),
            "source_column_count": len(headers),
            "source_row_count": len(rows),
            "incheon_row_count_including_aggregates": incheon_rows,
            "excluded_province_district_aggregate_rows": excluded_aggregate_rows,
            "output_dong_row_count": sum(
                1 for record in records if record["reference_year"] == year
            ),
            "age_band_sum_mismatch_count": len(age_total_mismatches),
            "age_band_sum_mismatch_codes": age_total_mismatches,
            "sex_sum_mismatch_count": len(sex_total_mismatches),
            "sex_sum_mismatch_codes": sex_total_mismatches,
            "source_province_total": province_total,
            "output_dong_total": output_total,
            "province_total_mismatch_count": province_total_mismatch_count,
        }
    validate_unique(records, "one-person age")
    return records, checks


def write_csv(path: Path, records: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)


def code_transitions(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_year: dict[int, dict[str, str]] = defaultdict(dict)
    for record in records:
        by_year[int(record["reference_year"])][str(record["source_admin_code"])] = str(
            record["source_admin_name"]
        )

    transitions: list[dict[str, Any]] = []
    years = sorted(by_year)
    for earlier, later in zip(years, years[1:]):
        earlier_codes = set(by_year[earlier])
        later_codes = set(by_year[later])
        transitions.append(
            {
                "from_year": earlier,
                "to_year": later,
                "added": [
                    {
                        "source_admin_code": code,
                        "source_admin_name": by_year[later][code],
                    }
                    for code in sorted(later_codes - earlier_codes)
                ],
                "removed": [
                    {
                        "source_admin_code": code,
                        "source_admin_name": by_year[earlier][code],
                    }
                    for code in sorted(earlier_codes - later_codes)
                ],
                "renamed_same_code": [
                    {
                        "source_admin_code": code,
                        "old_name": by_year[earlier][code],
                        "new_name": by_year[later][code],
                    }
                    for code in sorted(earlier_codes & later_codes)
                    if by_year[earlier][code] != by_year[later][code]
                ],
            }
        )
    return transitions


def build_combined(
    population: list[dict[str, Any]],
    households: list[dict[str, Any]],
    one_person_age: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    pop_index = {(r["reference_year"], r["source_admin_code"]): r for r in population}
    household_index = {
        (r["reference_year"], r["source_admin_code"]): r for r in households
    }
    one_age_index = {
        (r["reference_year"], r["source_admin_code"]): r for r in one_person_age
    }

    combined: list[dict[str, Any]] = []
    alignment: dict[str, Any] = {}
    for year in POPULATION_YEARS:
        pop_codes = {code for record_year, code in pop_index if record_year == year}
        household_codes = {
            code for record_year, code in household_index if record_year == year
        }
        age_codes = {code for record_year, code in one_age_index if record_year == year}
        expected_age_codes = pop_codes if year in ONE_PERSON_AGE_YEARS else set()

        one_person_value_mismatches: list[dict[str, Any]] = []
        source_name_mismatches: list[dict[str, Any]] = []
        for code in sorted(pop_codes & household_codes):
            pop_record = pop_index[(year, code)]
            household_record = household_index[(year, code)]
            age_record = one_age_index.get((year, code))
            compared_names = {
                "population": pop_record["source_admin_name"],
                "households": household_record["source_admin_name"],
            }
            if age_record:
                compared_names["one_person_age"] = age_record["source_admin_name"]
            if len(set(compared_names.values())) != 1:
                source_name_mismatches.append(
                    {"source_admin_code": code, "source_names": compared_names}
                )
            if (
                age_record
                and household_record["one_person_households"]
                != age_record["one_person_households_age_total"]
            ):
                one_person_value_mismatches.append(
                    {
                        "source_admin_code": code,
                        "household_size_value": household_record[
                            "one_person_households"
                        ],
                        "age_table_value": age_record[
                            "one_person_households_age_total"
                        ],
                    }
                )

            combined.append(
                {
                    "reference_year": year,
                    "reference_period": pop_record["reference_period"],
                    "source_admin_code": code,
                    "source_admin_name": pop_record["source_admin_name"],
                    "source_sido_name": pop_record["source_sido_name"],
                    "source_sigungu_name": pop_record["source_sigungu_name"],
                    "source_eupmyeondong_name": pop_record["source_eupmyeondong_name"],
                    "harmonization_status": pop_record["harmonization_status"],
                    "population_total": pop_record["population_total"],
                    "population_age_60_plus_exact": pop_record[
                        "population_age_60_plus_exact"
                    ],
                    "population_age_70_plus_exact": pop_record[
                        "population_age_70_plus_exact"
                    ],
                    "population_age_65_plus_status": AGE_65_STATUS,
                    "households_total": household_record["households_total"],
                    "one_person_households": household_record["one_person_households"],
                    "one_person_household_share_pct": household_record[
                        "one_person_household_share_pct"
                    ],
                    "one_person_age_source_available": "yes" if age_record else "no",
                    "one_person_age_60_plus_exact": age_record[
                        "one_person_age_60_plus_exact"
                    ]
                    if age_record
                    else "",
                    "one_person_age_70_plus_exact": age_record[
                        "one_person_age_70_plus_exact"
                    ]
                    if age_record
                    else "",
                    "one_person_age_65_plus_status": AGE_65_STATUS
                    if age_record
                    else "source_not_available_before_2023",
                    "source_population_file": pop_record["source_file"],
                    "source_households_file": household_record["source_file"],
                    "source_one_person_age_file": age_record["source_file"]
                    if age_record
                    else "",
                }
            )

        alignment[str(year)] = {
            "population_code_count": len(pop_codes),
            "household_code_count": len(household_codes),
            "one_person_age_code_count": len(age_codes),
            "population_only_codes": sorted(pop_codes - household_codes),
            "household_only_codes": sorted(household_codes - pop_codes),
            "one_person_age_missing_codes": sorted(expected_age_codes - age_codes),
            "one_person_age_extra_codes": sorted(age_codes - expected_age_codes),
            "one_person_count_cross_source_mismatch_count": len(
                one_person_value_mismatches
            ),
            "one_person_count_cross_source_mismatches": one_person_value_mismatches,
            "source_name_cross_source_mismatch_count": len(source_name_mismatches),
            "source_name_cross_source_mismatches": source_name_mismatches,
        }

    validate_unique(combined, "combined")
    combined.sort(
        key=lambda row: (int(row["reference_year"]), str(row["source_admin_code"]))
    )
    return combined, alignment


def total_by_year(records: Iterable[dict[str, Any]], field: str) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for record in records:
        totals[str(record["reference_year"])] += int(record[field])
    return dict(sorted(totals.items()))


def main() -> None:
    population, population_checks = load_population()
    households, household_checks = load_households()
    one_person_age, one_person_age_checks = load_one_person_age()
    combined, alignment = build_combined(population, households, one_person_age)

    common_fields = [
        "reference_year",
        "reference_period",
        "source_admin_code",
        "source_admin_name",
        "source_sido_name",
        "source_sigungu_name",
        "source_eupmyeondong_name",
        "harmonization_status",
    ]
    write_csv(
        OUTPUT_DIR / "trends_population_2021_2025.csv",
        sorted(
            population,
            key=lambda row: (row["reference_year"], row["source_admin_code"]),
        ),
        common_fields
        + [
            "population_total",
            "population_male",
            "population_female",
            "population_age_60_plus_exact",
            "population_age_70_plus_exact",
            "population_age_60_plus_share_pct",
            "population_age_70_plus_share_pct",
            "population_age_65_plus_status",
            "source_file",
        ],
    )
    write_csv(
        OUTPUT_DIR / "trends_households_2021_2025.csv",
        sorted(
            households,
            key=lambda row: (row["reference_year"], row["source_admin_code"]),
        ),
        common_fields
        + [
            "households_total",
            "one_person_households",
            "two_person_households",
            "three_person_households",
            "four_person_households",
            "five_person_households",
            "six_person_households",
            "seven_person_households",
            "eight_person_households",
            "nine_person_households",
            "ten_plus_person_households",
            "one_person_household_share_pct",
            "source_file",
        ],
    )
    write_csv(
        OUTPUT_DIR / "trends_one_person_age_2023_2025.csv",
        sorted(
            one_person_age,
            key=lambda row: (row["reference_year"], row["source_admin_code"]),
        ),
        common_fields
        + [
            "one_person_households_age_total",
            "one_person_households_age_male",
            "one_person_households_age_female",
            "one_person_age_60_plus_exact",
            "one_person_age_70_plus_exact",
            "one_person_age_60_plus_share_pct",
            "one_person_age_70_plus_share_pct",
            "one_person_age_65_plus_status",
            "source_file",
        ],
    )
    write_csv(
        OUTPUT_DIR / "trends_dong_yearly_2021_2025.csv",
        combined,
        common_fields
        + [
            "population_total",
            "population_age_60_plus_exact",
            "population_age_70_plus_exact",
            "population_age_65_plus_status",
            "households_total",
            "one_person_households",
            "one_person_household_share_pct",
            "one_person_age_source_available",
            "one_person_age_60_plus_exact",
            "one_person_age_70_plus_exact",
            "one_person_age_65_plus_status",
            "source_population_file",
            "source_households_file",
            "source_one_person_age_file",
        ],
    )

    critical_failures: list[str] = []
    for family_name, family_checks in (
        ("population", population_checks),
        ("households", household_checks),
        ("one_person_age", one_person_age_checks),
    ):
        for year, check in family_checks.items():
            for metric, value in check.items():
                if metric.endswith("mismatch_count") and value:
                    critical_failures.append(f"{family_name}.{year}.{metric}={value}")
    for year, check in alignment.items():
        for metric in (
            "population_only_codes",
            "household_only_codes",
            "one_person_age_missing_codes",
            "one_person_age_extra_codes",
        ):
            if check[metric]:
                critical_failures.append(
                    f"alignment.{year}.{metric}={len(check[metric])}"
                )
        if check["one_person_count_cross_source_mismatch_count"]:
            critical_failures.append(
                f"alignment.{year}.one_person_count_cross_source_mismatch_count="
                f"{check['one_person_count_cross_source_mismatch_count']}"
            )
        if check["source_name_cross_source_mismatch_count"]:
            critical_failures.append(
                f"alignment.{year}.source_name_cross_source_mismatch_count="
                f"{check['source_name_cross_source_mismatch_count']}"
            )

    validation = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset": "Incheon administrative dong resident-registration annual December trends",
        "grain": "one row per source administrative dong code and reference year",
        "input_encoding": "CP949",
        "output_encoding": "UTF-8",
        "province_filter": "source admin name starts with 인천광역시",
        "aggregate_filter": "exclude 10-digit codes whose last five digits are 00000",
        "age_65_plus_policy": {
            "calculated": False,
            "reason": "All trend age sources aggregate ages 60-69 in one band, so ages 65-69 cannot be isolated exactly.",
            "published_exact_alternatives": ["age_60_plus_exact", "age_70_plus_exact"],
            "prohibited_interpretation": "Neither exact alternative is an age-65-plus estimate.",
        },
        "boundary_harmonization_policy": {
            "source_codes_and_names_preserved": True,
            "reform_effective_date": "2026-07-01",
            "requires_crosswalk_source_districts": sorted(REFORMED_SOURCE_DISTRICTS),
            "warning": "Do not aggregate pre-reform source codes into 2026 districts until the official crosswalk is applied.",
        },
        "output_row_counts": {
            "population": len(population),
            "households": len(households),
            "one_person_age": len(one_person_age),
            "combined": len(combined),
        },
        "temporal_admin_code_transitions": code_transitions(households),
        "population_checks": population_checks,
        "household_checks": household_checks,
        "one_person_age_checks": one_person_age_checks,
        "cross_source_alignment": alignment,
        "aggregate_sanity_totals": {
            "population_total_by_year": total_by_year(population, "population_total"),
            "households_total_by_year": total_by_year(households, "households_total"),
            "one_person_households_by_year": total_by_year(
                households, "one_person_households"
            ),
            "one_person_age_total_by_year": total_by_year(
                one_person_age, "one_person_households_age_total"
            ),
        },
        "critical_failure_count": len(critical_failures),
        "critical_failures": critical_failures,
        "status": "pass" if not critical_failures else "fail",
    }
    validation_path = OUTPUT_DIR / "trends_validation.json"
    with validation_path.open("w", encoding="utf-8") as handle:
        json.dump(validation, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    if critical_failures:
        raise SystemExit(f"validation failed: {critical_failures}")

    print(
        json.dumps(
            {"status": "pass", "outputs": validation["output_row_counts"]},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
