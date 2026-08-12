#!/usr/bin/env python3
"""Build deterministic, browser-ready map assets from the verified I5 data pack.

The generated files are intentionally static so the Vite application and Vercel
deployment never need access to the large source data at runtime.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


SCRIPT_VERSION = 1
EXPECTED_COUNTS = {
    "admin_dongs": 156,
    "facilities": 3_061,
    "facilities_filtered": 2_816,
    "facilities_excluded": 245,
    "facilities_canonical_source": 3_394,
    "facilities_canonical_excluded": 279,
    "facilities_canonical_relevant": 3_115,
    "transit_stops": 6_231,
    "housing_zones": 156,
}

OUTPUT_FILES = (
    "admin-dongs.geojson",
    "facilities.geojson",
    "transit-stops.geojson",
    "summary.json",
    "manifest.json",
    "validation.json",
)

FACILITY_PROPERTIES = {
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

FACILITY_ALLOWED_MAJOR_CATEGORIES = {
    "가족·여성복지",
    "기타복지",
    "노인복지",
    "아동·돌봄",
    "장애인복지",
    "정신건강복지",
    "지역복지",
    "청소년복지",
}

FACILITY_EXCLUDED_MAJOR_CATEGORIES = {"아동·돌봄", "청소년복지"}
FACILITY_EXCLUDED_DETAIL_CONTAINS = {"영유아"}
FACILITY_EXCLUDED_DETAIL_EXACT = {"피해장애아동쉼터"}
FACILITY_REVIEWED_EXCLUSIONS = {
    "fac_7ae417c080e83c45": (
        "성착취 피해아동청소년 지원센터로 공식 시설명에서 연령 전용성이 확인됨"
    )
}

ADMIN_REQUIRED_PROPERTIES = {
    "geometry_zone_id",
    "geometry_adm_cd_20250630",
    "geometry_district_name_20250630",
    "geometry_dong_name_20250630",
    "geometry_base_date",
    "current_admin_reference_date",
    "current_district_name_20260701",
    "current_admin_dong_codes_20260701",
    "current_admin_dong_names_20260701",
    "current_admin_dong_count",
    "map_unit_status",
    "population_reference_date",
    "household_reference_date",
    "total_population",
    "population_age_65_plus",
    "total_households",
    "one_person_households",
    "one_person_households_age_65_plus",
    "population_age_65_plus_share",
    "one_person_household_share",
    "age_65_plus_one_person_share_of_age_65_plus_population",
    "bubble_metric_interpretation",
}

HOUSING_INT_FIELDS = (
    "integrated_building_geometry_features",
    "age_building_register_records_assigned",
    "age_valid_records",
    "age_missing_or_invalid_records",
    "age_30_plus_records",
    "age_40_plus_records",
    "residential_records",
    "residential_age_valid_records",
    "residential_age_missing_or_invalid_records",
    "residential_age_30_plus_records",
    "residential_age_40_plus_records",
)

HOUSING_FLOAT_FIELDS = (
    "age_coverage_pct",
    "age_30_plus_share_valid_pct",
    "age_40_plus_share_valid_pct",
    "residential_age_coverage_pct",
    "residential_age_30_plus_share_valid_pct",
    "residential_age_40_plus_share_valid_pct",
)

HOUSING_TEXT_FIELDS = (
    "metric_grain",
    "spatial_assignment_method",
    "age_data_as_of_date",
)

TRANSIT_PROPERTIES = (
    "place_id",
    "stop_number",
    "stop_name",
    "district",
    "dong",
    "reference_date",
    "reference_date_provenance",
    "boardings",
    "alightings",
    "total_board_alightings",
    "daily_average_board_alightings",
    "route_count",
    "route_numbers",
)

CAVEATS_KO = [
    "65세 이상 1인 가구 수는 관측된 주민등록 세대 수이며 복지 미수혜자 수, 고립자 수 또는 고독사 위험자 수가 아니다.",
    "인구는 2026-06-30, 세대는 2026-07-31 스냅샷이므로 두 값을 결합한 비율에는 기준일 차이가 있다.",
    "2026년 현행 162개 행정동 통계를 실제 2025-06-30 경계 156개 구역에 정합했다. 분리된 경계를 임의로 만들지 않았다.",
    "시설 점은 개인의 거주지가 아니라 공식 시설 위치다. 일부 좌표는 도로명주소와 VWorld 건물 도형으로 산출한 대표점이다.",
    "버스 승하차 값은 2026년 6월 집계 이벤트 수이며 고유 이용자 수가 아니다. 노선 수는 2025-12-31 자료와 정확히 결합된 정류소에만 제공한다.",
    "주택 값의 단위는 정규화된 건축물대장 레코드다. 고유 건물, 주택 호수, 세대 또는 돌봄 필요 인구와 같지 않다.",
    "VWorld 파생 자료의 공개 재배포는 원 데이터팩 LICENSES.md의 라이선스 주의사항을 별도로 검토해야 한다.",
]


class BuildError(RuntimeError):
    """Raised when a source or output violates the frozen web-data contract."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read valid JSON: {path}: {exc}") from exc


def read_csv(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))
    except (OSError, csv.Error) as exc:
        raise BuildError(f"cannot read valid CSV: {path}: {exc}") from exc


def required_files(source_dir: Path) -> dict[str, Path]:
    names = {
        "admin": "map_admin_dong_demographics_202607.geojson",
        "admin_validation": "map_layers_validation_202607.json",
        "facility": "demo_full_facility_points.geojson",
        "facility_validation": "demo_full_facility_points_validation.json",
        "housing": "housing_admin_geometry_summary_20260805.csv",
        "housing_validation": "housing_admin_geometry_validation_20260805.json",
        "transit": "transit_stop_usage_points.csv",
        "transit_supply": "transit_route_stops_supply.csv",
        "transit_validation": "transit_enrichment_validation.json",
    }
    paths = {key: source_dir / name for key, name in names.items()}
    missing = [str(path) for path in paths.values() if not path.is_file()]
    if missing:
        raise BuildError("missing source files:\n- " + "\n- ".join(missing))
    return paths


def parse_int(row: Mapping[str, str], key: str) -> int:
    raw = row.get(key, "")
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise BuildError(f"{key} must be an integer, got {raw!r}") from exc
    if value < 0:
        raise BuildError(f"{key} must be non-negative, got {value}")
    return value


def parse_float(row: Mapping[str, str], key: str) -> float:
    raw = row.get(key, "")
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise BuildError(f"{key} must be numeric, got {raw!r}") from exc
    if not math.isfinite(value) or value < 0:
        raise BuildError(f"{key} must be finite and non-negative, got {value}")
    return value


def parse_optional_float(row: Mapping[str, str], key: str) -> float | None:
    """Preserve a missing source ratio as JSON null instead of inventing zero."""
    if row.get(key, "").strip() == "":
        return None
    return parse_float(row, key)


def split_values(raw: str) -> list[str]:
    return sorted({item.strip() for item in raw.split(";") if item.strip()})


def iso_date(raw: Any) -> str:
    value = str(raw)
    if len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return value


def iter_coordinates(value: Any) -> Iterable[tuple[float, float]]:
    if (
        isinstance(value, Sequence)
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        yield float(value[0]), float(value[1])
        return
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for child in value:
            yield from iter_coordinates(child)


def validate_geometry(geometry: Mapping[str, Any], allowed_types: set[str]) -> None:
    geometry_type = geometry.get("type")
    if geometry_type not in allowed_types:
        raise BuildError(f"unexpected geometry type: {geometry_type!r}")
    coordinates = list(iter_coordinates(geometry.get("coordinates")))
    if not coordinates:
        raise BuildError("geometry has no coordinates")
    for longitude, latitude in coordinates:
        if not (124.0 <= longitude <= 130.0 and 36.0 <= latitude <= 39.0):
            raise BuildError(f"coordinate outside the Incheon validation envelope: {(longitude, latitude)}")


def ensure_unique(values: Sequence[str], label: str) -> None:
    duplicates = [value for value, count in Counter(values).items() if count > 1]
    if duplicates:
        raise BuildError(f"duplicate {label}: {duplicates[:10]}")


def build_admin_layer(
    admin_source: Mapping[str, Any], housing_rows: list[dict[str, str]]
) -> tuple[dict[str, Any], dict[str, int]]:
    features = admin_source.get("features")
    if admin_source.get("type") != "FeatureCollection" or not isinstance(features, list):
        raise BuildError("admin source must be a GeoJSON FeatureCollection")
    if len(features) != EXPECTED_COUNTS["admin_dongs"]:
        raise BuildError(f"expected 156 admin features, got {len(features)}")
    if len(housing_rows) != EXPECTED_COUNTS["housing_zones"]:
        raise BuildError(f"expected 156 housing rows, got {len(housing_rows)}")

    housing_by_zone: dict[str, dict[str, str]] = {}
    for row in housing_rows:
        zone_id = row.get("geometry_zone_id", "")
        if not zone_id or zone_id in housing_by_zone:
            raise BuildError(f"missing or duplicate housing geometry_zone_id: {zone_id!r}")
        housing_by_zone[zone_id] = row

    output_features: list[dict[str, Any]] = []
    zone_ids: list[str] = []
    for feature in features:
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            raise BuildError("admin feature must have object properties and geometry")
        missing = ADMIN_REQUIRED_PROPERTIES - set(properties)
        if missing:
            raise BuildError(f"admin properties missing: {sorted(missing)}")
        zone_id = properties["geometry_zone_id"]
        housing = housing_by_zone.get(zone_id)
        if housing is None:
            raise BuildError(f"admin zone has no housing join: {zone_id}")
        validate_geometry(geometry, {"Polygon", "MultiPolygon"})

        joined = dict(properties)
        for key in HOUSING_INT_FIELDS:
            joined[f"housing_{key}"] = parse_int(housing, key)
        for key in HOUSING_FLOAT_FIELDS:
            joined[f"housing_{key}"] = parse_optional_float(housing, key)
        for key in HOUSING_TEXT_FIELDS:
            value = housing.get(key, "").strip()
            if not value:
                raise BuildError(f"housing {key} is missing for {zone_id}")
            joined[f"housing_{key}"] = value

        output_features.append(
            {"type": "Feature", "properties": joined, "geometry": geometry}
        )
        zone_ids.append(zone_id)

    ensure_unique(zone_ids, "admin geometry_zone_id")
    if set(zone_ids) != set(housing_by_zone):
        raise BuildError("admin and housing geometry zone sets do not match")
    output_features.sort(key=lambda item: item["properties"]["geometry_zone_id"])
    status_counts = Counter(
        item["properties"]["map_unit_status"] for item in output_features
    )
    return (
        {"type": "FeatureCollection", "features": output_features},
        dict(sorted(status_counts.items())),
    )


def facility_exclusion_reason(properties: Mapping[str, Any]) -> str | None:
    facility_id = str(properties["facility_id"])
    major = str(properties["category_major"])
    detail = str(properties["category_detail"])
    if major not in FACILITY_ALLOWED_MAJOR_CATEGORIES:
        raise BuildError(
            f"unknown facility category_major requires review: {major!r} ({facility_id})"
        )
    if facility_id in FACILITY_REVIEWED_EXCLUSIONS:
        return "reviewed_facility_id"
    if major in FACILITY_EXCLUDED_MAJOR_CATEGORIES:
        return "major_category"
    if detail in FACILITY_EXCLUDED_DETAIL_EXACT:
        return "detail_exact"
    if any(token in detail for token in FACILITY_EXCLUDED_DETAIL_CONTAINS):
        return "detail_contains"
    return None


def build_facility_filtering_policy(
    source_count: int, output_count: int, exclusion_counts: Mapping[str, int]
) -> dict[str, Any]:
    return {
        "policy": "senior-care-map-runtime-facility-filter-v1",
        "sourceFeatureCount": source_count,
        "excludedFeatureCount": source_count - output_count,
        "outputFeatureCount": output_count,
        "canonicalSourceCount": EXPECTED_COUNTS["facilities_canonical_source"],
        "canonicalExcludedCount": EXPECTED_COUNTS["facilities_canonical_excluded"],
        "relevantCanonicalCount": EXPECTED_COUNTS["facilities_canonical_relevant"],
        "excludedMajorCategories": sorted(FACILITY_EXCLUDED_MAJOR_CATEGORIES),
        "excludedDetailContains": sorted(FACILITY_EXCLUDED_DETAIL_CONTAINS),
        "excludedDetailExact": sorted(FACILITY_EXCLUDED_DETAIL_EXACT),
        "reviewedExclusions": [
            {"facilityId": facility_id, "reason": FACILITY_REVIEWED_EXCLUSIONS[facility_id]}
            for facility_id in sorted(FACILITY_REVIEWED_EXCLUSIONS)
        ],
        "retainedMajorCategories": sorted(
            FACILITY_ALLOWED_MAJOR_CATEGORIES - FACILITY_EXCLUDED_MAJOR_CATEGORIES
        ),
        "exclusionReasonCounts": dict(sorted(exclusion_counts.items())),
    }


def build_facility_layer(
    source: Mapping[str, Any]
) -> tuple[dict[str, Any], dict[str, int], dict[str, int], dict[str, Any]]:
    features = source.get("features")
    if source.get("type") != "FeatureCollection" or not isinstance(features, list):
        raise BuildError("facility source must be a GeoJSON FeatureCollection")
    if len(features) != EXPECTED_COUNTS["facilities"]:
        raise BuildError(f"expected 3,061 facility features, got {len(features)}")

    output_features: list[dict[str, Any]] = []
    facility_ids: list[str] = []
    categories: Counter[str] = Counter()
    districts: Counter[str] = Counter()
    exclusion_counts: Counter[str] = Counter()
    for feature in features:
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            raise BuildError("facility feature must have object properties and geometry")
        if set(properties) != FACILITY_PROPERTIES:
            raise BuildError(
                "facility properties differ from the verified 17-field allowlist: "
                f"missing={sorted(FACILITY_PROPERTIES - set(properties))}, "
                f"unexpected={sorted(set(properties) - FACILITY_PROPERTIES)}"
            )
        validate_geometry(geometry, {"Point"})
        facility_id = properties["facility_id"]
        if not facility_id:
            raise BuildError("facility_id must not be blank")
        facility_ids.append(facility_id)
        exclusion_reason = facility_exclusion_reason(properties)
        if exclusion_reason is not None:
            exclusion_counts[exclusion_reason] += 1
            continue
        categories[properties["category_major"]] += 1
        districts[properties["district_scope_20260701"]] += 1
        output_features.append(
            {"type": "Feature", "properties": dict(properties), "geometry": geometry}
        )

    ensure_unique(facility_ids, "facility_id")
    if len(output_features) != EXPECTED_COUNTS["facilities_filtered"]:
        raise BuildError(
            "facility filter output count changed: "
            f"expected {EXPECTED_COUNTS['facilities_filtered']}, got {len(output_features)}"
        )
    if sum(exclusion_counts.values()) != EXPECTED_COUNTS["facilities_excluded"]:
        raise BuildError(
            "facility filter exclusion count changed: "
            f"expected {EXPECTED_COUNTS['facilities_excluded']}, "
            f"got {sum(exclusion_counts.values())}"
        )
    output_features.sort(key=lambda item: item["properties"]["facility_id"])
    filtering_policy = build_facility_filtering_policy(
        len(features), len(output_features), exclusion_counts
    )
    return (
        {"type": "FeatureCollection", "features": output_features},
        dict(sorted(categories.items())),
        dict(sorted(districts.items())),
        filtering_policy,
    )


def build_transit_layer(
    usage_rows: list[dict[str, str]], supply_rows: list[dict[str, str]]
) -> tuple[dict[str, Any], int]:
    if len(usage_rows) != EXPECTED_COUNTS["transit_stops"]:
        raise BuildError(f"expected 6,231 transit usage rows, got {len(usage_rows)}")

    supply_by_place: dict[str, dict[str, str]] = {}
    for row in supply_rows:
        place_id = row.get("place_id", "")
        if not place_id:
            continue
        if place_id in supply_by_place:
            raise BuildError(f"duplicate route-supply place_id: {place_id}")
        supply_by_place[place_id] = row

    output_features: list[dict[str, Any]] = []
    place_ids: list[str] = []
    route_count_available = 0
    for row in usage_rows:
        if row.get("match_status") != "matched":
            raise BuildError("transit web point is not an exact matched row")
        if row.get("point_status") != "incheon_map_ready":
            raise BuildError("transit web point is not marked incheon_map_ready")
        if row.get("valid_wgs84") != "true" or row.get("in_incheon") != "true":
            raise BuildError("transit web point does not have a validated Incheon coordinate")

        place_id = row.get("place_id", "")
        if not place_id:
            raise BuildError("transit place_id must not be blank")
        longitude = parse_float(row, "longitude")
        latitude = parse_float(row, "latitude")
        geometry = {"type": "Point", "coordinates": [longitude, latitude]}
        validate_geometry(geometry, {"Point"})

        boardings = parse_int(row, "boardings")
        alightings = parse_int(row, "alightings")
        total = parse_int(row, "total_board_alightings")
        if total != boardings + alightings:
            raise BuildError(f"transit total does not reconcile for {place_id}")

        supply = supply_by_place.get(place_id)
        route_count: int | None = None
        route_numbers: list[str] = []
        if supply is not None:
            route_count = parse_int(supply, "distinct_route_number_count")
            route_numbers = split_values(supply.get("route_numbers", ""))
            if route_count != len(route_numbers):
                raise BuildError(
                    f"transit route-number count does not match list for {place_id}"
                )
            route_count_available += 1

        properties = {
            "place_id": place_id,
            "stop_number": row.get("source_stop_number", ""),
            "stop_name": row.get("master_stop_name", "") or row.get("source_stop_name", ""),
            "district": row.get("district", ""),
            "dong": row.get("dong", ""),
            "reference_date": row.get("reference_date", ""),
            "reference_date_provenance": row.get("reference_date_provenance", ""),
            "boardings": boardings,
            "alightings": alightings,
            "total_board_alightings": total,
            "daily_average_board_alightings": parse_float(
                row, "daily_average_board_alightings_reported"
            ),
            "route_count": route_count,
            "route_numbers": route_numbers,
        }
        output_features.append(
            {"type": "Feature", "properties": properties, "geometry": geometry}
        )
        place_ids.append(place_id)

    ensure_unique(place_ids, "transit place_id")
    output_features.sort(key=lambda item: item["properties"]["place_id"])
    return {"type": "FeatureCollection", "features": output_features}, route_count_available


def build_summary(
    admin_layer: Mapping[str, Any],
    facility_layer: Mapping[str, Any],
    transit_layer: Mapping[str, Any],
    admin_validation: Mapping[str, Any],
    facility_validation: Mapping[str, Any],
    housing_validation: Mapping[str, Any],
    transit_validation: Mapping[str, Any],
    category_counts: Mapping[str, int],
    district_counts: Mapping[str, int],
    facility_filtering: Mapping[str, Any],
    map_status_counts: Mapping[str, int],
    route_count_available: int,
    transit_stop_master_date: str,
) -> dict[str, Any]:
    admin_totals = admin_validation["totals"]["output_geometry_156"]
    housing_totals = housing_validation["outputs"]["city_totals"]
    facility_stats = facility_validation["stats"]
    canonical_source_count = int(facility_stats["canonical_facility_count"])
    if canonical_source_count != facility_filtering["canonicalSourceCount"]:
        raise BuildError(
            "facility canonical source count changed: "
            f"expected {facility_filtering['canonicalSourceCount']}, got {canonical_source_count}"
        )
    if (
        canonical_source_count - facility_filtering["canonicalExcludedCount"]
        != facility_filtering["relevantCanonicalCount"]
    ):
        raise BuildError("facility canonical source/exclusion/relevant counts do not reconcile")
    transit_points = transit_validation["stop_usage"]["incheon_map_point_totals"]
    transit_source = transit_validation["sources"]

    facility_dates = Counter(
        feature["properties"]["source_as_of_date_latest"]
        for feature in facility_layer["features"]
    )
    return {
        "schemaVersion": SCRIPT_VERSION,
        "project": "I5 도시 돌봄 우선검토 지도",
        "counts": {
            "adminGeometryZones": len(admin_layer["features"]),
            "currentAdminDongsRepresented": admin_validation["counts"][
                "current_demographic_rows"
            ],
            "facilityPointsSource": facility_filtering["sourceFeatureCount"],
            "facilityPointsExcluded": facility_filtering["excludedFeatureCount"],
            "facilityPoints": len(facility_layer["features"]),
            "facilityCanonicalTotal": canonical_source_count,
            "facilityRelevantCanonicalTotal": facility_filtering["relevantCanonicalCount"],
            "transitUsagePoints": len(transit_layer["features"]),
            "transitUsageSourceRows": transit_validation["sources"]["stop_usage"]["rows"],
            "transitPointsWithRouteCount": route_count_available,
        },
        "cityTotals": {
            **{key: int(value) for key, value in admin_totals.items()},
            "housing": {key: int(value) for key, value in housing_totals.items()},
            "transitMapPointEvents": {
                key: int(value) for key, value in transit_points.items()
            },
        },
        "coverage": {
            "facilityCoordinateCoveragePct": round(
                100.0
                * len(facility_layer["features"])
                / facility_filtering["relevantCanonicalCount"],
                6,
            ),
            "facilitySourceCoordinateCoveragePct": round(
                100.0 * float(facility_stats["coordinate_coverage_of_canonical"]), 6
            ),
            "housingStrictAssignmentCoveragePct": float(
                housing_validation["record_assignment"]["strict_assignment_coverage_pct"]
            ),
            "transitUsageExactMatchCoveragePct": float(
                transit_validation["stop_usage"]["match_coverage_percent"]
            ),
            "transitPointRouteCountCoveragePct": round(
                100.0 * route_count_available / len(transit_layer["features"]), 6
            ),
        },
        "snapshotDates": {
            "geometry": iso_date(admin_validation["dates"]["geometry_base_date"]),
            "currentAdminReference": iso_date(
                admin_validation["dates"]["current_admin_reference_date"]
            ),
            "population": admin_validation["dates"]["population_reference_dates"][0],
            "household": admin_validation["dates"]["household_reference_dates"][0],
            "facilityPointCountsByLatestSourceDate": dict(sorted(facility_dates.items())),
            "housingAgeRecords": housing_validation["normalized_age_records"][
                "data_as_of_dates"
            ],
            "housingBuildingGeometry": housing_validation["integrated_building_geometry"][
                "data_as_of_dates"
            ],
            "transitUsage": transit_source["stop_usage"]["reference_date"],
            "transitRouteSupply": transit_source["route_stop_sequence"]["reference_date"],
            "transitStopMaster": transit_stop_master_date,
        },
        "distributions": {
            "mapUnitStatus": dict(map_status_counts),
            "facilityCategoryMajor": dict(category_counts),
            "facilityDistrict": dict(district_counts),
        },
        "filtering": {
            "facilities": dict(facility_filtering),
        },
        "metricGuardrail": admin_validation["bubble_metric"][
            "interpretation_guardrail_ko"
        ],
        "caveats": CAVEATS_KO,
    }


def build_manifest(
    paths: Mapping[str, Path],
    output_payloads: Mapping[str, bytes],
    admin_layer: Mapping[str, Any],
    facility_layer: Mapping[str, Any],
    transit_layer: Mapping[str, Any],
    route_count_available: int,
    summary: Mapping[str, Any],
) -> dict[str, Any]:
    source_keys = (
        "admin",
        "admin_validation",
        "facility",
        "facility_validation",
        "housing",
        "housing_validation",
        "transit",
        "transit_supply",
        "transit_validation",
    )
    return {
        "schemaVersion": SCRIPT_VERSION,
        "generatedBy": "scripts/prepare_web_data.py",
        "deterministic": True,
        "counts": summary["counts"],
        "coverage": summary["coverage"],
        "snapshotDates": summary["snapshotDates"],
        "sourceFiles": {
            key: {
                "file": f"processed/{paths[key].name}",
                "sha256": sha256_file(paths[key]),
            }
            for key in source_keys
        },
        "outputs": {
            "adminDongs": {
                "file": "/data/admin-dongs.geojson",
                "format": "GeoJSON FeatureCollection",
                "featureCount": len(admin_layer["features"]),
                "geometryTypes": ["Polygon", "MultiPolygon"],
                "joinKey": "geometry_zone_id",
                "properties": sorted(admin_layer["features"][0]["properties"]),
                "sha256": sha256_bytes(output_payloads["admin-dongs.geojson"]),
            },
            "facilities": {
                "file": "/data/facilities.geojson",
                "format": "GeoJSON FeatureCollection",
                "featureCount": len(facility_layer["features"]),
                "geometryTypes": ["Point"],
                "primaryKey": "facility_id",
                "properties": sorted(FACILITY_PROPERTIES),
                "sha256": sha256_bytes(output_payloads["facilities.geojson"]),
            },
            "transitStops": {
                "file": "/data/transit-stops.geojson",
                "format": "GeoJSON FeatureCollection",
                "featureCount": len(transit_layer["features"]),
                "geometryTypes": ["Point"],
                "primaryKey": "place_id",
                "properties": list(TRANSIT_PROPERTIES),
                "nullableProperties": ["route_count"],
                "routeCountAvailable": route_count_available,
                "sha256": sha256_bytes(output_payloads["transit-stops.geojson"]),
            },
            "summary": {
                "file": "/data/summary.json",
                "format": "JSON",
                "sha256": sha256_bytes(output_payloads["summary.json"]),
            },
        },
        "filtering": {
            "adminDongs": "All 156 validated 2025 geometry zones; housing aggregates joined one-to-one by geometry_zone_id.",
            "facilities": dict(summary["filtering"]["facilities"]),
            "transitStops": "Only exact matched rows marked incheon_map_ready with validated WGS84 coordinates.",
            "individualBeneficiaryPoints": "Not produced; no individual beneficiary or inferred non-recipient data is present.",
        },
        "caveats": CAVEATS_KO,
    }


def build_all(source_dir: Path, output_dir: Path) -> dict[str, str]:
    paths = required_files(source_dir)
    admin_source = read_json(paths["admin"])
    facility_source = read_json(paths["facility"])
    housing_rows = read_csv(paths["housing"])
    usage_rows = read_csv(paths["transit"])
    supply_rows = read_csv(paths["transit_supply"])
    admin_validation = read_json(paths["admin_validation"])
    facility_validation = read_json(paths["facility_validation"])
    housing_validation = read_json(paths["housing_validation"])
    transit_validation = read_json(paths["transit_validation"])

    if admin_validation.get("status") != "pass":
        raise BuildError("admin source validation is not pass")
    if facility_validation.get("status") != "pass":
        raise BuildError("facility source validation is not pass")
    if housing_validation.get("status") not in {"pass", "pass_with_documented_exclusions"}:
        raise BuildError("housing source validation is not accepted")
    if not all(transit_validation.get("assertions", {}).values()):
        raise BuildError("one or more transit source assertions failed")

    transit_master_dates = {
        iso_date(row.get("master_source_date", "")) for row in usage_rows
    }
    transit_master_dates.discard("")
    if len(transit_master_dates) != 1:
        raise BuildError(
            "transit usage points must have exactly one master source date, got "
            f"{sorted(transit_master_dates)}"
        )
    transit_stop_master_date = next(iter(transit_master_dates))

    admin_layer, map_status_counts = build_admin_layer(admin_source, housing_rows)
    facility_layer, category_counts, district_counts, facility_filtering = build_facility_layer(
        facility_source
    )
    transit_layer, route_count_available = build_transit_layer(usage_rows, supply_rows)
    summary = build_summary(
        admin_layer,
        facility_layer,
        transit_layer,
        admin_validation,
        facility_validation,
        housing_validation,
        transit_validation,
        category_counts,
        district_counts,
        facility_filtering,
        map_status_counts,
        route_count_available,
        transit_stop_master_date,
    )

    output_payloads = {
        "admin-dongs.geojson": json_bytes(admin_layer),
        "facilities.geojson": json_bytes(facility_layer),
        "transit-stops.geojson": json_bytes(transit_layer),
        "summary.json": json_bytes(summary),
    }
    manifest = build_manifest(
        paths,
        output_payloads,
        admin_layer,
        facility_layer,
        transit_layer,
        route_count_available,
        summary,
    )
    output_payloads["manifest.json"] = json_bytes(manifest)

    validation = {
        "status": "pass",
        "scriptVersion": SCRIPT_VERSION,
        "checks": {
            "adminFeatureCountIs156": len(admin_layer["features"]) == 156,
            "adminAndHousingZoneSetsMatch": True,
            "adminGeometryZoneIdsUnique": True,
            "facilitySourceCountIs3061": facility_filtering["sourceFeatureCount"] == 3_061,
            "facilityExcludedCountIs245": facility_filtering["excludedFeatureCount"] == 245,
            "facilityFeatureCountIs2816": len(facility_layer["features"]) == 2_816,
            "facilityCanonicalSourceIs3394": facility_filtering["canonicalSourceCount"]
            == 3_394,
            "facilityCanonicalExcludedIs279": facility_filtering["canonicalExcludedCount"]
            == 279,
            "facilityRelevantCanonicalIs3115": facility_filtering["relevantCanonicalCount"]
            == 3_115,
            "facilityIdsUnique": True,
            "facilityPropertiesEqualVerifiedAllowlist": True,
            "transitFeatureCountIs6231": len(transit_layer["features"]) == 6_231,
            "transitPlaceIdsUnique": True,
            "transitNumericTotalsReconciled": True,
            "allCoordinatesValidWgs84IncheonEnvelope": True,
            "noIndividualBeneficiaryPointsProduced": True,
        },
        "counts": {
            "adminDongs": len(admin_layer["features"]),
            "facilities": len(facility_layer["features"]),
            "facilitiesSource": facility_filtering["sourceFeatureCount"],
            "facilitiesExcluded": facility_filtering["excludedFeatureCount"],
            "facilitiesCanonicalSource": facility_filtering["canonicalSourceCount"],
            "facilitiesCanonicalExcluded": facility_filtering["canonicalExcludedCount"],
            "facilitiesCanonicalRelevant": facility_filtering["relevantCanonicalCount"],
            "transitStops": len(transit_layer["features"]),
            "transitStopsWithRouteCount": route_count_available,
        },
        "filtering": {
            "facilities": dict(facility_filtering),
        },
        "outputSha256": {
            name: sha256_bytes(payload) for name, payload in sorted(output_payloads.items())
        },
    }
    if not all(validation["checks"].values()):
        raise BuildError("web output validation failed")
    output_payloads["validation.json"] = json_bytes(validation)

    for name in OUTPUT_FILES:
        write_bytes(output_dir / name, output_payloads[name])
    return {name: sha256_bytes(output_payloads[name]) for name in OUTPUT_FILES}


def default_source_dir(repo_root: Path) -> Path:
    committed = repo_root / "data" / "processed"
    if committed.is_dir():
        return committed
    return repo_root.parent / "work" / "i5-data" / "processed"


def check_existing(source_dir: Path, output_dir: Path) -> dict[str, str]:
    with tempfile.TemporaryDirectory(prefix="i5-web-data-") as temporary:
        generated_dir = Path(temporary)
        hashes = build_all(source_dir, generated_dir)
        mismatches: list[str] = []
        for name in OUTPUT_FILES:
            existing = output_dir / name
            if not existing.is_file():
                mismatches.append(f"missing {existing}")
                continue
            if existing.read_bytes() != (generated_dir / name).read_bytes():
                mismatches.append(f"stale or non-deterministic {existing}")
        if mismatches:
            raise BuildError("web-data check failed:\n- " + "\n- ".join(mismatches))
        return hashes


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=default_source_dir(repo_root),
        help="directory containing the verified processed data",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=repo_root / "public" / "data",
        help="directory for browser-ready files",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="regenerate in a temporary directory and compare with committed output",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    try:
        hashes = (
            check_existing(source_dir, output_dir)
            if args.check
            else build_all(source_dir, output_dir)
        )
    except BuildError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    action = "verified" if args.check else "built"
    print(f"{action} {len(OUTPUT_FILES)} deterministic web-data files")
    for name in OUTPUT_FILES:
        print(f"{hashes[name]}  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
