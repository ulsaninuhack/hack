#!/usr/bin/env python3
"""Build conservative, browser-safe public-demo layers.

This exporter never edits the canonical data.  It produces a deliberately
small public surface from the canonical facility and demographic layers:

* residential, shelter, mental-health and other sensitive facilities are
  available only as district-level counts;
* non-sensitive, public-facing service locations may be published as points,
  but without address, phone, capacity, occupancy, staff or source codes;
* demographic cells below ``SMALL_CELL_THRESHOLD`` are suppressed together
  with their derived rates.

The policy is intentionally more conservative than the public-source status of
the input records.  A source being public does not by itself make an exact
location appropriate for a hackathon browser demo.
"""

from __future__ import annotations

import csv
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "processed"

FACILITIES_CANONICAL = PROCESSED / "facilities_canonical.csv"
FACILITIES_MAP_POINTS = PROCESSED / "facilities_map_points.csv"
FACILITIES_GEOCODED_PRIVATE = PROCESSED / "facilities_geocoded_private.csv"
DEMOGRAPHICS = PROCESSED / "demographics_admin_dong_202607.csv"
MAP_DEMOGRAPHICS = PROCESSED / "map_admin_dong_demographics_202607.geojson"
MAP_BUBBLES = PROCESSED / "map_bubbles_age_65_plus_one_person_202607.geojson"

OUT_FACILITY_POINTS = PROCESSED / "public_demo_facility_points.geojson"
OUT_FACILITY_COUNTS = PROCESSED / "public_demo_facility_counts_by_district.csv"
OUT_SENSITIVE_COUNTS = PROCESSED / "public_demo_sensitive_facilities_by_district.csv"
OUT_DEMOGRAPHICS = PROCESSED / "public_demo_admin_dong_demographics.csv"
OUT_MAP_DEMOGRAPHICS = PROCESSED / "public_demo_map_admin_dong_demographics.geojson"
OUT_MAP_BUBBLES = PROCESSED / "public_demo_map_age65_one_person_bubbles.geojson"
OUT_METADATA = PROCESSED / "public_demo_metadata.json"
OUT_VALIDATION = PROCESSED / "public_demo_validation.json"
OUT_FULL_FACILITY_POINTS = PROCESSED / "demo_full_facility_points.geojson"
OUT_FULL_FACILITY_VALIDATION = PROCESSED / "demo_full_facility_points_validation.json"

OUTPUT_ENCODING = "utf-8-sig"
SMALL_CELL_THRESHOLD = 5
SENSITIVE_BUCKET_MIN_COUNT = 3

DEMOGRAPHIC_COUNT_FIELDS = (
    "total_population",
    "population_age_65_plus",
    "total_households",
    "one_person_households",
    "one_person_households_age_65_plus",
)

DEMOGRAPHIC_RATE_FIELDS = (
    "population_age_65_plus_share",
    "one_person_household_share",
    "age_65_plus_one_person_share_of_age_65_plus_population",
)

# Match against the normalized combination of category, form and facility name.
# Broad shelter/household/residential terms are intentional: missing a sensitive
# point is worse than withholding an ordinary public service location.
SENSITIVE_RULES: Sequence[Tuple[str, Sequence[str]]] = (
    (
        "노인 거주·요양",
        (
            "노인요양시설",
            "노인의료복지시설",
            "노인요양공동생활가정",
            "치매전담형노인요양공동생활가정",
            "노인주거복지시설",
            "노인양로시설",
            "노인공동생활가정",
            "노인복지주택",
            "노인전문요양시설",
            "단기보호",
            "학대피해노인전용쉼터",
        ),
    ),
    (
        "장애인 거주",
        (
            "장애인거주시설",
            "장애인 거주시설",
            "장애인공동생활가정",
            "장애인단기거주시설",
            "피해장애아동쉼터",
        ),
    ),
    (
        "정신건강 보호·재활",
        (
            "정신재활시설",
            "정신요양시설",
            "정신건강복지",
        ),
    ),
    (
        "피해자·아동·청소년 보호",
        (
            "공동생활시설",
            "공동생활가정",
            "그룹홈",
            "쉼터",
            "보호시설",
            "아동양육시설",
            "아동일시보호시설",
            "한부모가족복지시설",
            "청소년복지시설",
            "폭력피해",
            "성매매피해",
            "학대피해",
        ),
    ),
    (
        "기타 생활·거주",
        (
            "생활시설",
            "단기시설",
            "주거복지",
            "노숙인요양시설",
            "노숙인자활시설",
        ),
    ),
)

FORBIDDEN_PUBLIC_PROPERTY_NAMES = {
    "address",
    "주소",
    "phone",
    "전화번호",
    "postal_code",
    "우편번호",
    "capacity",
    "capacity_max_reported",
    "정원",
    "current_occupancy",
    "current_occupancy_max_reported",
    "현원",
    "staff_count",
    "staff_count_max_reported",
    "종사자수",
    "source_facility_codes",
    "source_facility_code",
    "facility_id",
    "source_files",
    "operator_name",
    "installation_date",
    "designation_date",
}

# The full hackathon-demo layer is intentionally different from the safe public
# fallback: exact official facility address and point are permitted by the user,
# including residential/protective facility types.  Operational/personal fields
# remain excluded from the browser payload.
FULL_DEMO_ALLOWED_PROPERTIES = {
    "facility_id",
    "facility_name",
    "district_source",
    "district_scope_20260701",
    "district_assignment_status",
    "admin_dong_code_20260701",
    "admin_dong_name_20260701",
    "legal_dong",
    "official_address",
    "category_major",
    "category_detail",
    "facility_form",
    "source_as_of_date_latest",
    "coordinate_source",
    "coordinate_method",
    "coordinate_match_confidence",
    "coordinate_is_representative_point",
}

FULL_DEMO_FORBIDDEN_PROPERTIES = {
    "phone",
    "postal_code",
    "capacity",
    "capacity_max_reported",
    "current_occupancy",
    "current_occupancy_max_reported",
    "staff_count",
    "staff_count_max_reported",
    "operator_name",
    "source_facility_code",
    "source_facility_codes",
    "matched_pnu",
    "matched_juso_building_count",
    "matched_vworld_polygon_count",
    "privacy_scope",
    "requires_public_export_policy_review",
    # Known individual-record/emergency-service concepts are blocked even if a
    # future upstream schema accidentally adds them.
    "highRisk",
    "dissStatDesc",
    "moneyActYn",
    "recBirth",
    "recSex",
    "recipient_name",
    "person_id",
    "household_id",
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    return re.sub(r"\s+", " ", text).strip()


def compact(value: Any) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]", "", clean_text(value)).lower()


def read_csv(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: Sequence[Mapping[str, Any]], fields: Sequence[str]) -> None:
    with path.open("w", encoding=OUTPUT_ENCODING, newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(fields), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def write_geojson(path: Path, data: Any) -> None:
    """Write compact GeoJSON so browser-demo payloads stay lightweight."""
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")


def classify_sensitive(row: Mapping[str, Any]) -> Tuple[bool, str, str]:
    searchable = compact(
        " ".join(
            clean_text(row.get(field, ""))
            for field in (
                "facility_name",
                "category_major",
                "category_detail",
                "facility_form",
            )
        )
    )
    for bucket, terms in SENSITIVE_RULES:
        for term in terms:
            if compact(term) in searchable:
                return True, bucket, term
    return False, "", ""


def public_service_category(row: Mapping[str, Any]) -> str:
    major = clean_text(row.get("category_major"))
    detail = compact(row.get("category_detail"))
    if major == "노인복지":
        if any(term in detail for term in ("방문요양", "방문목욕", "방문간호")):
            return "재가·방문 돌봄"
        if "주야간보호" in detail or "주간" in detail:
            return "주간 돌봄"
        if "복지용구" in detail:
            return "복지용구"
        if any(term in detail for term in ("복지관", "노인대학", "노인교실")):
            return "노인 여가·복지"
        if "일자리" in detail:
            return "노인 일자리·사회참여"
        return "노인복지 서비스"
    if major == "장애인복지":
        if "직업재활" in detail or "생산품" in detail:
            return "장애인 직업재활"
        if "주간" in detail:
            return "장애인 주간·지역사회 서비스"
        if "복지관" in detail:
            return "장애인복지관"
        return "장애인 지역사회 서비스"
    category_map = {
        "아동·돌봄": "아동 돌봄 서비스",
        "가족·여성복지": "가족·여성 지원 서비스",
        "지역복지": "지역복지 서비스",
        "청소년복지": "청소년 지원 서비스",
        "기타복지": "기타 복지 서비스",
    }
    return category_map.get(major, "복지 서비스")


def current_district_scope(source_district: str) -> Tuple[str, str]:
    """Represent only administratively defensible 2026-07-01 assignments."""
    district = clean_text(source_district)
    if district == "동구":
        return "제물포구", "exact_pre_reform_donggu_to_jemulpogu"
    if district == "중구":
        return (
            "제물포구·영종구(미배분)",
            "aggregate_only_pre_reform_junggu_cannot_be_split_without_exact_location",
        )
    if district == "서구":
        return (
            "서구·검단구(미배분)",
            "aggregate_only_pre_reform_seogu_cannot_be_split_without_exact_location",
        )
    return district, "exact_unchanged_district_name"


def parse_coordinate(value: Any, low: float, high: float) -> float | None:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or not low <= number <= high:
        return None
    return number


def coordinate_key(row: Mapping[str, Any]) -> Tuple[float, float] | None:
    lat = parse_coordinate(row.get("latitude"), 37.0, 38.2)
    lon = parse_coordinate(row.get("longitude"), 124.0, 127.5)
    if lat is None or lon is None:
        return None
    return round(lat, 7), round(lon, 7)


def build_facility_exports() -> Dict[str, Any]:
    canonical = read_csv(FACILITIES_CANONICAL)
    map_points = read_csv(FACILITIES_MAP_POINTS)

    sensitivity: Dict[str, Tuple[bool, str, str]] = {}
    sensitive_counts: Counter[Tuple[str, str, str]] = Counter()
    district_all_counts: Counter[Tuple[str, str]] = Counter()
    district_public_counts: Counter[Tuple[str, str]] = Counter()
    district_sensitive_counts: Counter[Tuple[str, str]] = Counter()
    matched_rules: Counter[str] = Counter()

    for row in canonical:
        facility_id = row.get("facility_id", "")
        sensitive, bucket, term = classify_sensitive(row)
        sensitivity[facility_id] = (sensitive, bucket, term)
        scope, status = current_district_scope(row.get("district", ""))
        district_all_counts[(scope, status)] += 1
        if sensitive:
            sensitive_counts[(scope, status, bucket)] += 1
            district_sensitive_counts[(scope, status)] += 1
            matched_rules[term] += 1
        else:
            district_public_counts[(scope, status)] += 1

    sensitive_coordinate_keys = {
        key
        for row in map_points
        if sensitivity.get(row.get("facility_id", ""), classify_sensitive(row))[0]
        for key in (coordinate_key(row),)
        if key is not None
    }

    eligible: List[Dict[str, Any]] = []
    invalid_coordinate_count = 0
    shared_sensitive_coordinate_count = 0
    sensitive_point_withheld_count = 0
    for row in map_points:
        facility_id = row.get("facility_id", "")
        sensitive, _, _ = sensitivity.get(facility_id, classify_sensitive(row))
        if sensitive:
            sensitive_point_withheld_count += 1
            continue
        key = coordinate_key(row)
        if key is None:
            invalid_coordinate_count += 1
            continue
        if key in sensitive_coordinate_keys:
            shared_sensitive_coordinate_count += 1
            continue
        scope, status = current_district_scope(row.get("district", ""))
        eligible.append(
            {
                "facility_name": clean_text(row.get("facility_name")),
                "district_scope_20260701": scope,
                "district_assignment_status": status,
                "legal_dong_general": clean_text(row.get("legal_dong")),
                "category_major": clean_text(row.get("category_major")),
                "public_service_category": public_service_category(row),
                "source_as_of_date_latest": clean_text(row.get("source_as_of_date_latest")),
                "longitude": key[1],
                "latitude": key[0],
            }
        )

    eligible.sort(
        key=lambda row: (
            row["district_scope_20260701"],
            row["public_service_category"],
            row["facility_name"],
            row["latitude"],
            row["longitude"],
        )
    )
    features = []
    for index, row in enumerate(eligible, start=1):
        properties = {key: value for key, value in row.items() if key not in {"longitude", "latitude"}}
        properties["public_facility_id"] = f"public_facility_{index:04d}"
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [row["longitude"], row["latitude"]],
                },
                "properties": properties,
            }
        )

    points_geojson = {
        "type": "FeatureCollection",
        "name": "public_demo_non_sensitive_welfare_service_points",
        "description": (
            "Public-facing, non-sensitive welfare service points only. Residential, shelter, "
            "mental-health and other sensitive facilities are withheld from this point layer."
        ),
        "privacy_policy": "public_demo_conservative_v1",
        "features": features,
    }
    write_geojson(OUT_FACILITY_POINTS, points_geojson)

    district_rows = []
    for scope, status in sorted(district_all_counts):
        district_rows.append(
            {
                "district_scope_20260701": scope,
                "district_assignment_status": status,
                "public_service_facility_count": district_public_counts[(scope, status)],
                "sensitive_facility_count": district_sensitive_counts[(scope, status)],
                "total_canonical_facility_count": district_all_counts[(scope, status)],
                "sensitive_exact_points_published": 0,
            }
        )
    write_csv(
        OUT_FACILITY_COUNTS,
        district_rows,
        (
            "district_scope_20260701",
            "district_assignment_status",
            "public_service_facility_count",
            "sensitive_facility_count",
            "total_canonical_facility_count",
            "sensitive_exact_points_published",
        ),
    )

    # Bucket counts below the threshold are rolled into a generic district-level
    # bucket, preserving the district total without identifying a rare subtype.
    sensitive_rows = []
    by_district: Dict[Tuple[str, str], List[Tuple[str, int]]] = defaultdict(list)
    for (scope, status, bucket), count in sensitive_counts.items():
        by_district[(scope, status)].append((bucket, count))
    rolled_up_bucket_rows = 0
    rare_sensitive_facilities_omitted = 0
    for (scope, status), buckets in sorted(by_district.items()):
        small_total = sum(count for _, count in buckets if count < SENSITIVE_BUCKET_MIN_COUNT)
        for bucket, count in sorted(buckets):
            if count < SENSITIVE_BUCKET_MIN_COUNT:
                rolled_up_bucket_rows += 1
                continue
            sensitive_rows.append(
                {
                    "district_scope_20260701": scope,
                    "district_assignment_status": status,
                    "sensitive_category": bucket,
                    "facility_count": count,
                    "location_precision": "district_aggregate_only",
                }
            )
        if small_total >= SENSITIVE_BUCKET_MIN_COUNT:
            sensitive_rows.append(
                {
                    "district_scope_20260701": scope,
                    "district_assignment_status": status,
                    "sensitive_category": "기타 민감 시설(소수 범주 통합)",
                    "facility_count": small_total,
                    "location_precision": "district_aggregate_only",
                }
            )
        else:
            rare_sensitive_facilities_omitted += small_total
    write_csv(
        OUT_SENSITIVE_COUNTS,
        sensitive_rows,
        (
            "district_scope_20260701",
            "district_assignment_status",
            "sensitive_category",
            "facility_count",
            "location_precision",
        ),
    )

    return {
        "canonical_facility_count": len(canonical),
        "canonical_map_point_count": len(map_points),
        "sensitive_facility_count": sum(district_sensitive_counts.values()),
        "non_sensitive_facility_count": sum(district_public_counts.values()),
        "public_non_sensitive_point_count": len(features),
        "sensitive_map_points_withheld": sensitive_point_withheld_count,
        "non_sensitive_points_withheld_due_to_shared_sensitive_coordinate": shared_sensitive_coordinate_count,
        "invalid_coordinate_points_withheld": invalid_coordinate_count,
        "sensitive_exact_points_published": 0,
        "sensitive_district_aggregate_row_count": len(sensitive_rows),
        "sensitive_small_bucket_rows_rolled_up": rolled_up_bucket_rows,
        "sensitive_facilities_withheld_from_rare_subtype_table": rare_sensitive_facilities_omitted,
        "sensitive_rule_matches": dict(sorted(matched_rules.items())),
    }


def build_full_demo_facility_export() -> Dict[str, Any]:
    """Build the internal full-facility demo layer from offline geocoding.

    The input is private because it contains QA/matching fields.  The output is
    a minimized browser layer containing only official facility identity/type,
    official address and the selected point.  It is not a person/household
    layer, and no emergency-service records are read or joined.
    """
    canonical_rows = read_csv(FACILITIES_CANONICAL)
    geocoded_rows = read_csv(FACILITIES_GEOCODED_PRIVATE)
    canonical_by_id = {row.get("facility_id", ""): row for row in canonical_rows}
    geocoded_by_id = {row.get("facility_id", ""): row for row in geocoded_rows}

    canonical_ids = [row.get("facility_id", "") for row in canonical_rows]
    geocoded_ids = [row.get("facility_id", "") for row in geocoded_rows]
    duplicate_canonical_ids = sorted(
        facility_id for facility_id, count in Counter(canonical_ids).items() if count > 1
    )
    duplicate_geocoded_ids = sorted(
        facility_id for facility_id, count in Counter(geocoded_ids).items() if count > 1
    )

    features = []
    coordinate_source_counts: Counter[str] = Counter()
    invalid_or_missing_coordinate_count = 0
    sensitive_valid_coordinate_count = 0
    sensitive_output_count = 0
    missing_official_address_count = 0

    for facility_id in sorted(canonical_by_id):
        canonical = canonical_by_id[facility_id]
        geocoded = geocoded_by_id.get(facility_id, {})
        lat = parse_coordinate(geocoded.get("best_latitude"), 37.0, 38.2)
        lon = parse_coordinate(geocoded.get("best_longitude"), 124.0, 127.5)
        sensitive, _, _ = classify_sensitive(canonical)
        if lat is None or lon is None:
            invalid_or_missing_coordinate_count += 1
            continue
        if sensitive:
            sensitive_valid_coordinate_count += 1

        source_district = clean_text(canonical.get("district"))
        juso_current_district = clean_text(geocoded.get("juso_current_district"))
        if juso_current_district:
            district_scope = juso_current_district
            district_status = "exact_juso_current_district"
        else:
            district_scope, district_status = current_district_scope(source_district)

        official_address = clean_text(canonical.get("address"))
        if not official_address:
            missing_official_address_count += 1
        coordinate_source = clean_text(geocoded.get("coordinate_source")) or "unknown"
        coordinate_source_counts[coordinate_source] += 1
        properties = {
            "facility_id": facility_id,
            "facility_name": clean_text(canonical.get("facility_name")),
            "district_source": source_district,
            "district_scope_20260701": district_scope,
            "district_assignment_status": district_status,
            "admin_dong_code_20260701": clean_text(geocoded.get("juso_admin_dong_code")),
            "admin_dong_name_20260701": clean_text(geocoded.get("juso_admin_dong_name")),
            "legal_dong": clean_text(geocoded.get("juso_legal_dong"))
            or clean_text(canonical.get("legal_dong")),
            "official_address": official_address,
            "category_major": clean_text(canonical.get("category_major")),
            "category_detail": clean_text(canonical.get("category_detail")),
            "facility_form": clean_text(canonical.get("facility_form")),
            "source_as_of_date_latest": clean_text(canonical.get("source_as_of_date_latest")),
            "coordinate_source": coordinate_source,
            "coordinate_method": clean_text(geocoded.get("geocode_method"))
            or coordinate_source,
            "coordinate_match_confidence": clean_text(geocoded.get("match_confidence")),
            "coordinate_is_representative_point": coordinate_source
            == "juso_pnu_vworld_representative_point",
        }
        if sensitive:
            sensitive_output_count += 1
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": properties,
            }
        )

    full_geojson = {
        "type": "FeatureCollection",
        "name": "demo_full_official_welfare_facility_points",
        "description": (
            "Default internal hackathon-demo layer of official welfare facilities. It includes all "
            "facility types with a usable point, including residential/protective types, but contains "
            "no recipient, household, emergency-service, occupancy or staffing records."
        ),
        "distribution_scope": "internal_hackathon_demo_default",
        "public_release_fallback": OUT_FACILITY_POINTS.name,
        "coordinate_interpretation": (
            "source_dataset_coordinate is retained when valid; otherwise the point is an offline "
            "Juso-PNU to VWorld geometry representative point and may not be an entrance coordinate."
        ),
        "license_caution": "Internal/private demo only; review LICENSES.md before redistribution.",
        "features": features,
    }
    write_geojson(OUT_FULL_FACILITY_POINTS, full_geojson)

    return {
        "canonical_facility_count": len(canonical_rows),
        "geocoded_input_row_count": len(geocoded_rows),
        "full_demo_point_count": len(features),
        "coordinate_coverage_of_canonical": round(
            len(features) / len(canonical_rows), 8
        )
        if canonical_rows
        else None,
        "invalid_or_missing_coordinate_count": invalid_or_missing_coordinate_count,
        "missing_official_address_count": missing_official_address_count,
        "sensitive_facilities_with_valid_coordinate": sensitive_valid_coordinate_count,
        "sensitive_facilities_in_full_demo": sensitive_output_count,
        "coordinate_source_counts": dict(sorted(coordinate_source_counts.items())),
        "canonical_id_set_equals_geocoded_input_id_set": set(canonical_ids) == set(geocoded_ids),
        "canonical_ids_missing_from_geocoded_input": sorted(set(canonical_ids) - set(geocoded_ids)),
        "unknown_geocoded_input_ids": sorted(set(geocoded_ids) - set(canonical_ids)),
        "duplicate_canonical_ids": duplicate_canonical_ids,
        "duplicate_geocoded_input_ids": duplicate_geocoded_ids,
    }


def validate_full_demo_facility_export(stats: Mapping[str, Any]) -> Dict[str, Any]:
    with OUT_FULL_FACILITY_POINTS.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    features = data.get("features", [])
    canonical_by_id = {
        row.get("facility_id", ""): row for row in read_csv(FACILITIES_CANONICAL)
    }

    unexpected_properties: Dict[str, List[str]] = {}
    forbidden_property_findings: Dict[str, List[str]] = {}
    invalid_geometry_findings = []
    duplicate_output_ids = []
    canonical_mismatch_findings = []
    output_id_counts: Counter[str] = Counter()
    sensitive_output_count = 0

    for feature_number, feature in enumerate(features, start=1):
        properties = feature.get("properties", {})
        property_names = set(properties)
        unexpected = sorted(property_names - FULL_DEMO_ALLOWED_PROPERTIES)
        forbidden = sorted(property_names & FULL_DEMO_FORBIDDEN_PROPERTIES)
        if unexpected:
            unexpected_properties[str(feature_number)] = unexpected
        if forbidden:
            forbidden_property_findings[str(feature_number)] = forbidden

        facility_id = clean_text(properties.get("facility_id"))
        output_id_counts[facility_id] += 1
        canonical = canonical_by_id.get(facility_id)
        if canonical is None:
            canonical_mismatch_findings.append(
                {"feature": feature_number, "facility_id": facility_id, "reason": "unknown_id"}
            )
        else:
            expected = {
                "facility_name": clean_text(canonical.get("facility_name")),
                "official_address": clean_text(canonical.get("address")),
                "category_major": clean_text(canonical.get("category_major")),
                "category_detail": clean_text(canonical.get("category_detail")),
                "facility_form": clean_text(canonical.get("facility_form")),
            }
            mismatched = {
                field: {"expected": value, "actual": clean_text(properties.get(field))}
                for field, value in expected.items()
                if clean_text(properties.get(field)) != value
            }
            if mismatched:
                canonical_mismatch_findings.append(
                    {
                        "feature": feature_number,
                        "facility_id": facility_id,
                        "reason": "canonical_property_mismatch",
                        "fields": mismatched,
                    }
                )
            if classify_sensitive(canonical)[0]:
                sensitive_output_count += 1

        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        valid_point = geometry.get("type") == "Point" and len(coordinates) == 2
        if valid_point:
            lon = parse_coordinate(coordinates[0], 124.0, 127.5)
            lat = parse_coordinate(coordinates[1], 37.0, 38.2)
            valid_point = lon is not None and lat is not None
        if not valid_point:
            invalid_geometry_findings.append(
                {"feature": feature_number, "facility_id": facility_id}
            )

    duplicate_output_ids = sorted(
        facility_id for facility_id, count in output_id_counts.items() if count > 1
    )
    checks = {
        "output_exists_and_nonempty": OUT_FULL_FACILITY_POINTS.exists()
        and OUT_FULL_FACILITY_POINTS.stat().st_size > 0,
        "geocoded_input_is_one_to_one_with_canonical": bool(
            stats.get("canonical_id_set_equals_geocoded_input_id_set")
        )
        and not stats.get("duplicate_canonical_ids")
        and not stats.get("duplicate_geocoded_input_ids"),
        "feature_count_matches_valid_input_coordinates": len(features)
        == stats.get("full_demo_point_count"),
        "only_explicitly_allowed_properties": not unexpected_properties,
        "operational_and_personal_fields_absent": not forbidden_property_findings,
        "all_geometries_are_valid_incheon_envelope_points": not invalid_geometry_findings,
        "output_facility_ids_are_unique": not duplicate_output_ids,
        "identity_address_and_type_match_canonical_facilities": not canonical_mismatch_findings,
        "all_coordinate_eligible_sensitive_facilities_are_included": sensitive_output_count
        == stats.get("sensitive_facilities_with_valid_coordinate")
        == stats.get("sensitive_facilities_in_full_demo"),
        "no_emergency_or_person_record_input_joined": True,
    }
    validation = {
        "status": "pass" if all(checks.values()) else "fail",
        "layer_role": "internal_hackathon_demo_default",
        "public_release_fallback": OUT_FACILITY_POINTS.name,
        "input": FACILITIES_GEOCODED_PRIVATE.name,
        "checks": checks,
        "stats": dict(stats),
        "unexpected_property_findings": unexpected_properties,
        "forbidden_property_findings": forbidden_property_findings,
        "invalid_geometry_findings": invalid_geometry_findings,
        "duplicate_output_ids": duplicate_output_ids,
        "canonical_mismatch_findings": canonical_mismatch_findings,
        "intentional_exact_point_policy": (
            "All official facility types, including residential/protective types, are intentionally "
            "included for the internal demo when coordinates exist. This is not an individual-client map."
        ),
        "excluded_data": [
            "raw emergency-service person/household records",
            "phone",
            "capacity",
            "current occupancy",
            "staff count",
            "operator and source facility codes",
            "personal eligibility, risk or non-recipient inference",
        ],
    }
    write_json(OUT_FULL_FACILITY_VALIDATION, validation)
    return validation


def numeric_value(value: Any) -> int | float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def row_has_small_demographic_cell(properties: Mapping[str, Any]) -> bool:
    for field in DEMOGRAPHIC_COUNT_FIELDS:
        value = numeric_value(properties.get(field))
        if value is not None and value < SMALL_CELL_THRESHOLD:
            return True
    return False


def safe_demographic_properties(properties: Mapping[str, Any], *, geometry: bool) -> Dict[str, Any]:
    if geometry:
        out: Dict[str, Any] = {
            "geometry_zone_id": properties.get("geometry_zone_id"),
            "current_district_name_20260701": properties.get("current_district_name_20260701"),
            "current_admin_dong_names_20260701": properties.get("current_admin_dong_names_20260701"),
            "current_admin_dong_count": properties.get("current_admin_dong_count"),
            "map_unit_status": properties.get("map_unit_status"),
            "aggregation_required": properties.get("aggregation_required"),
            "population_reference_date": properties.get("population_reference_date"),
            "household_reference_date": properties.get("household_reference_date"),
        }
    else:
        out = {
            "admin_dong_code_20260701": properties.get("admin_dong_code_20260701"),
            "district_name_20260701": properties.get("district_name_20260701"),
            "admin_dong_name": properties.get("admin_dong_name"),
            "population_reference_date": properties.get("population_reference_date"),
            "household_reference_date": properties.get("household_reference_date"),
        }

    suppressed = row_has_small_demographic_cell(properties)
    out["privacy_cell_status"] = "suppressed_small_cell" if suppressed else "publishable_aggregate"
    for field in DEMOGRAPHIC_COUNT_FIELDS + DEMOGRAPHIC_RATE_FIELDS:
        out[field] = None if suppressed else numeric_value(properties.get(field))
    return out


def build_demographic_exports() -> Dict[str, Any]:
    rows = read_csv(DEMOGRAPHICS)
    public_rows = [safe_demographic_properties(row, geometry=False) for row in rows]
    demo_fields = (
        "admin_dong_code_20260701",
        "district_name_20260701",
        "admin_dong_name",
        "population_reference_date",
        "household_reference_date",
        "privacy_cell_status",
        *DEMOGRAPHIC_COUNT_FIELDS,
        *DEMOGRAPHIC_RATE_FIELDS,
    )
    write_csv(OUT_DEMOGRAPHICS, public_rows, demo_fields)

    with MAP_DEMOGRAPHICS.open("r", encoding="utf-8") as handle:
        source_map = json.load(handle)
    public_features = []
    suppressed_geometry_count = 0
    for feature in source_map.get("features", []):
        props = safe_demographic_properties(feature.get("properties", {}), geometry=True)
        if props["privacy_cell_status"] != "publishable_aggregate":
            suppressed_geometry_count += 1
        public_features.append(
            {
                "type": "Feature",
                "geometry": feature.get("geometry"),
                "properties": props,
            }
        )
    public_map = {
        "type": "FeatureCollection",
        "name": "public_demo_admin_dong_demographics",
        "description": "Aggregate map layer; demographic cells below 5 are fully suppressed.",
        "privacy_policy": "public_demo_conservative_v1",
        "geometry_source_date": source_map.get("geometry_source_date"),
        "current_admin_reference_date": source_map.get("current_admin_reference_date"),
        "interpretation_guardrail_ko": source_map.get("interpretation_guardrail_ko"),
        "bbox": source_map.get("bbox"),
        "features": public_features,
    }
    write_geojson(OUT_MAP_DEMOGRAPHICS, public_map)

    with MAP_BUBBLES.open("r", encoding="utf-8") as handle:
        source_bubbles = json.load(handle)
    bubble_features = []
    suppressed_bubble_count = 0
    for feature in source_bubbles.get("features", []):
        source_props = feature.get("properties", {})
        metric_value = numeric_value(source_props.get("metric_value"))
        suppressed = metric_value is not None and metric_value < SMALL_CELL_THRESHOLD
        if suppressed:
            suppressed_bubble_count += 1
        props = {
            "geometry_zone_id": source_props.get("geometry_zone_id"),
            "current_district_name_20260701": source_props.get("current_district_name_20260701"),
            "current_admin_dong_names_20260701": source_props.get("current_admin_dong_names_20260701"),
            "current_admin_dong_count": source_props.get("current_admin_dong_count"),
            "map_unit_status": source_props.get("map_unit_status"),
            "aggregation_required": source_props.get("aggregation_required"),
            "population_reference_date": source_props.get("population_reference_date"),
            "household_reference_date": source_props.get("household_reference_date"),
            "metric_name": source_props.get("metric_name"),
            "metric_label_ko": source_props.get("metric_label_ko"),
            "metric_value": None if suppressed else metric_value,
            "privacy_cell_status": "suppressed_small_cell" if suppressed else "publishable_aggregate",
            "interpretation": source_props.get("interpretation"),
        }
        bubble_features.append(
            {
                "type": "Feature",
                "geometry": None if suppressed else feature.get("geometry"),
                "properties": props,
            }
        )
    public_bubbles = {
        "type": "FeatureCollection",
        "name": "public_demo_age65_one_person_household_bubbles",
        "description": "Representative geometry-zone points, never individual household locations.",
        "privacy_policy": "public_demo_conservative_v1",
        "metric_is_observed_aggregate_not_unmet_need": True,
        "bbox": source_bubbles.get("bbox"),
        "features": bubble_features,
    }
    write_geojson(OUT_MAP_BUBBLES, public_bubbles)

    suppressed_admin_rows = sum(
        row["privacy_cell_status"] == "suppressed_small_cell" for row in public_rows
    )
    source_minima = {
        field: min(
            value
            for row in rows
            for value in (numeric_value(row.get(field)),)
            if value is not None
        )
        for field in DEMOGRAPHIC_COUNT_FIELDS
    }
    return {
        "admin_dong_row_count": len(public_rows),
        "admin_dong_rows_suppressed": suppressed_admin_rows,
        "map_geometry_feature_count": len(public_features),
        "map_geometry_features_suppressed": suppressed_geometry_count,
        "bubble_feature_count": len(bubble_features),
        "bubble_features_suppressed": suppressed_bubble_count,
        "small_cell_threshold": SMALL_CELL_THRESHOLD,
        "source_minimum_count_by_field": source_minima,
    }


def property_names_from_geojson(path: Path) -> set[str]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    names: set[str] = set()
    for feature in data.get("features", []):
        names.update(feature.get("properties", {}).keys())
    return names


def csv_headers(path: Path) -> set[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return set(next(csv.reader(handle)))


def validate_exports(facility_stats: Mapping[str, Any], demographic_stats: Mapping[str, Any]) -> Dict[str, Any]:
    public_files = (
        OUT_FACILITY_POINTS,
        OUT_FACILITY_COUNTS,
        OUT_SENSITIVE_COUNTS,
        OUT_DEMOGRAPHICS,
        OUT_MAP_DEMOGRAPHICS,
        OUT_MAP_BUBBLES,
    )
    property_sets = {
        OUT_FACILITY_POINTS.name: property_names_from_geojson(OUT_FACILITY_POINTS),
        OUT_FACILITY_COUNTS.name: csv_headers(OUT_FACILITY_COUNTS),
        OUT_SENSITIVE_COUNTS.name: csv_headers(OUT_SENSITIVE_COUNTS),
        OUT_DEMOGRAPHICS.name: csv_headers(OUT_DEMOGRAPHICS),
        OUT_MAP_DEMOGRAPHICS.name: property_names_from_geojson(OUT_MAP_DEMOGRAPHICS),
        OUT_MAP_BUBBLES.name: property_names_from_geojson(OUT_MAP_BUBBLES),
    }
    forbidden_findings = {
        filename: sorted(names & FORBIDDEN_PUBLIC_PROPERTY_NAMES)
        for filename, names in property_sets.items()
        if names & FORBIDDEN_PUBLIC_PROPERTY_NAMES
    }

    with OUT_FACILITY_POINTS.open("r", encoding="utf-8") as handle:
        point_data = json.load(handle)
    accidentally_sensitive = []
    for feature in point_data.get("features", []):
        props = feature.get("properties", {})
        sensitive, bucket, term = classify_sensitive(props)
        if sensitive:
            accidentally_sensitive.append(
                {
                    "public_facility_id": props.get("public_facility_id"),
                    "bucket": bucket,
                    "matched_term": term,
                }
            )

    small_cell_violations = []
    for filename in (OUT_DEMOGRAPHICS,):
        for row_number, row in enumerate(read_csv(filename), start=2):
            if row.get("privacy_cell_status") != "publishable_aggregate":
                continue
            for field in DEMOGRAPHIC_COUNT_FIELDS:
                value = numeric_value(row.get(field))
                if value is not None and value < SMALL_CELL_THRESHOLD:
                    small_cell_violations.append(
                        {"file": filename.name, "row": row_number, "field": field, "value": value}
                    )

    rare_sensitive_aggregate_findings = []
    for row_number, row in enumerate(read_csv(OUT_SENSITIVE_COUNTS), start=2):
        count = numeric_value(row.get("facility_count"))
        if count is not None and count < SENSITIVE_BUCKET_MIN_COUNT:
            rare_sensitive_aggregate_findings.append(
                {"row": row_number, "facility_count": count}
            )

    checks = {
        "all_expected_outputs_exist": all(path.exists() and path.stat().st_size > 0 for path in public_files),
        "forbidden_columns_absent": not forbidden_findings,
        "no_sensitive_exact_points": not accidentally_sensitive
        and facility_stats.get("sensitive_exact_points_published") == 0,
        "no_public_small_demographic_cells": not small_cell_violations,
        "no_rare_sensitive_subtype_aggregate_cells": not rare_sensitive_aggregate_findings,
        "public_points_have_only_point_geometry": all(
            feature.get("geometry", {}).get("type") == "Point"
            for feature in point_data.get("features", [])
        ),
    }
    return {
        "status": "pass" if all(checks.values()) else "fail",
        "policy_version": "public_demo_conservative_v1",
        "checks": checks,
        "facility_stats": dict(facility_stats),
        "demographic_stats": dict(demographic_stats),
        "forbidden_property_findings": forbidden_findings,
        "sensitive_point_findings": accidentally_sensitive,
        "small_cell_findings": small_cell_violations,
        "rare_sensitive_aggregate_findings": rare_sensitive_aggregate_findings,
        "outputs": [path.name for path in public_files],
    }


def build_metadata() -> Dict[str, Any]:
    return {
        "policy_version": "public_demo_conservative_v1",
        "purpose": (
            "Conservative public-release fallback exports; canonical/raw inputs remain unchanged. "
            "The internal demo default, when built, is demo_full_facility_points.geojson."
        ),
        "layer_role": "public_release_fallback",
        "internal_demo_default": OUT_FULL_FACILITY_POINTS.name,
        "facility_policy": {
            "exact_point_allowed_only_for": "non-sensitive public-facing service facilities with valid source coordinates",
            "point_properties_allowed": [
                "public_facility_id",
                "facility_name",
                "district_scope_20260701",
                "district_assignment_status",
                "legal_dong_general",
                "category_major",
                "public_service_category",
                "source_as_of_date_latest",
            ],
            "always_removed": sorted(FORBIDDEN_PUBLIC_PROPERTY_NAMES),
            "sensitive_facility_handling": "district aggregate only; never exact point or facility name",
            "sensitive_categories": [
                {"bucket": bucket, "match_terms": list(terms)} for bucket, terms in SENSITIVE_RULES
            ],
            "rare_sensitive_bucket_rule": (
                f"District/category counts below {SENSITIVE_BUCKET_MIN_COUNT} are rolled into a generic "
                "district-level sensitive bucket only when the combined generic bucket also reaches the "
                "threshold; otherwise they remain available only in the all-sensitive district total."
            ),
            "shared_coordinate_rule": (
                "A non-sensitive service point is withheld if its exact coordinate is shared by a sensitive facility."
            ),
            "administrative_reform_rule": {
                "reference_date": "2026-07-01",
                "동구": "제물포구 exact",
                "중구": "제물포구·영종구 aggregate, not split without exact assignment",
                "서구": "서구·검단구 aggregate, not split without exact assignment",
            },
        },
        "demographic_policy": {
            "small_cell_threshold": SMALL_CELL_THRESHOLD,
            "suppression_rule": (
                "If any selected aggregate count in a row is below the threshold, all demographic counts "
                "and derived rates for that row are set to null."
            ),
            "bubble_location_rule": "Representative geometry-zone point, not a household or person location.",
            "interpretation_rule": (
                "65+ one-person household counts are observed aggregates, not counts of welfare non-recipients, "
                "unmet need, depression, solitary-death risk, or individual cases."
            ),
        },
        "canonical_inputs_preserved": [
            FACILITIES_CANONICAL.name,
            FACILITIES_MAP_POINTS.name,
            DEMOGRAPHICS.name,
            MAP_DEMOGRAPHICS.name,
            MAP_BUBBLES.name,
        ],
        "full_demo_policy": {
            "output": OUT_FULL_FACILITY_POINTS.name,
            "role": "internal_hackathon_demo_default",
            "input": FACILITIES_GEOCODED_PRIVATE.name,
            "intentional_scope": (
                "Includes official facility name, type, official address and point for every facility "
                "with a usable coordinate, including residential/protective facility types."
            ),
            "excluded": [
                "raw emergency-service person/household records",
                "phone",
                "capacity and current occupancy",
                "staff count",
                "operator and source facility codes",
                "private geocoding QA/PNU fields",
                "personal risk, eligibility or non-recipient inference",
            ],
            "redistribution_note": "Internal/private demo only; review LICENSES.md before redistribution.",
        },
    }


def main() -> None:
    missing = [
        str(path)
        for path in (
            FACILITIES_CANONICAL,
            FACILITIES_MAP_POINTS,
            DEMOGRAPHICS,
            MAP_DEMOGRAPHICS,
            MAP_BUBBLES,
        )
        if not path.exists()
    ]
    if missing:
        raise FileNotFoundError("Missing canonical inputs: " + ", ".join(missing))

    facility_stats = build_facility_exports()
    demographic_stats = build_demographic_exports()
    write_json(OUT_METADATA, build_metadata())
    validation = validate_exports(facility_stats, demographic_stats)
    write_json(OUT_VALIDATION, validation)
    if validation["status"] != "pass":
        raise RuntimeError(f"Public-demo validation failed: {OUT_VALIDATION}")

    result: Dict[str, Any] = {"public_release_fallback": validation}
    if FACILITIES_GEOCODED_PRIVATE.exists():
        full_stats = build_full_demo_facility_export()
        full_validation = validate_full_demo_facility_export(full_stats)
        if full_validation["status"] != "pass":
            raise RuntimeError(
                f"Full-facility demo validation failed: {OUT_FULL_FACILITY_VALIDATION}"
            )
        result["internal_demo_default"] = full_validation
    else:
        result["internal_demo_default"] = {
            "status": "not_built",
            "reason": f"Waiting for {FACILITIES_GEOCODED_PRIVATE.name}",
        }

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
