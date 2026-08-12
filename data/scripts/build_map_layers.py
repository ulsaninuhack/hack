#!/usr/bin/env python3
"""Build map-ready Incheon demographic polygon and bubble layers.

The current metric master has 162 administrative-dong rows (2026-07-01),
while the available VWorld/SGIS polygon snapshot has 156 geometry zones
(2025-06-30).  This builder follows the reviewed crosswalk and sums additive
counts for every current row sharing a geometry zone.  It then recomputes all
ratios from the summed numerators and denominators; input ratios are never
averaged.

The red-bubble layer deliberately uses only the observed
``one_person_households_age_65_plus`` count.  It does not label or estimate
people who are missing welfare benefits.

Run from any directory:

    python3 work/i5-data/scripts/build_map_layers.py
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


DATA_ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = DATA_ROOT / ".deps"
if LOCAL_DEPS.is_dir():
    sys.path.insert(0, str(LOCAL_DEPS))

try:
    from shapely.geometry import shape  # type: ignore[import-not-found]
except ImportError as exc:  # pragma: no cover - dependency failure path
    raise SystemExit(
        "Missing Shapely. Restore work/i5-data/.deps or install shapely: "
        f"{exc}"
    ) from exc


DEFAULT_BOUNDARY = (
    DATA_ROOT / "processed" / "boundary_incheon_admin_dong_20250630.geojson"
)
DEFAULT_CROSSWALK = (
    DATA_ROOT
    / "processed"
    / "boundary_current_to_geometry_crosswalk_20260701.csv"
)
DEFAULT_DEMOGRAPHICS = (
    DATA_ROOT / "processed" / "demographics_admin_dong_202607.csv"
)
DEFAULT_OUTPUT_DIR = DATA_ROOT / "processed"

GEOMETRY_BASE_DATE = "20250630"
CURRENT_ADMIN_DATE = "20260701"
SCRIPT_VERSION = 1

COUNT_FIELDS = [
    "total_population",
    "population_age_65_plus",
    "total_households",
    "one_person_households",
    "one_person_households_age_65_plus",
]

RATIO_FIELDS = [
    "population_age_65_plus_share",
    "one_person_household_share",
    "age_65_plus_one_person_share_of_age_65_plus_population",
]

BUBBLE_METRIC_NAME = "one_person_households_age_65_plus"
BUBBLE_METRIC_LABEL_KO = "65세 이상 1인 가구 수 (관측)"
BUBBLE_INTERPRETATION = (
    "관측된 65세 이상 1인 가구 규모이며 복지 미수급자 수 또는 고독사 위험자 수가 아님"
)
REPRESENTATIVE_POINT_METHOD = "shapely_representative_point_within_polygon_wgs84"

CSV_FIELDS = [
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
    "mapping_methods",
    "mapping_confidence",
    "aggregation_required",
    "metric_handling",
    "population_reference_date",
    "household_reference_date",
    *COUNT_FIELDS,
    *RATIO_FIELDS,
    "representative_longitude",
    "representative_latitude",
    "representative_point_method",
    "bubble_metric_name",
    "bubble_metric_label_ko",
    "bubble_metric_value",
    "bubble_metric_interpretation",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--boundary", type=Path, default=DEFAULT_BOUNDARY)
    parser.add_argument("--crosswalk", type=Path, default=DEFAULT_CROSSWALK)
    parser.add_argument("--demographics", type=Path, default=DEFAULT_DEMOGRAPHICS)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def atomic_write_text(path: Path, content: str) -> None:
    atomic_write_bytes(path, content.encode("utf-8"))


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = [dict(row) for row in reader]
        fields = list(reader.fieldnames or [])
    return fields, rows


def require_fields(
    actual_fields: Iterable[str], required_fields: Iterable[str], source: Path
) -> None:
    missing = set(required_fields).difference(actual_fields)
    if missing:
        raise ValueError(f"{source} is missing columns: {sorted(missing)}")


def parse_nonnegative_integer(value: str, field: str, key: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid integer {field}={value!r} at {key}") from exc
    if parsed < 0:
        raise ValueError(f"Negative integer {field}={parsed} at {key}")
    return parsed


def safe_ratio(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(numerator / denominator, 6)


def classify_map_unit(methods: set[str], member_count: int) -> str:
    if methods == {"unique_normalized_name"} and member_count == 1:
        return "exact"
    if methods == {"post_snapshot_split_aggregate"} and member_count == 2:
        return "aggregated_split"
    if methods == {
        "unique_normalized_name",
        "branch_office_parent_aggregate",
    } and member_count == 2:
        return "parent_with_branch_office"
    return "unreviewed"


def serialize_csv(rows: list[dict[str, Any]]) -> bytes:
    text_buffer = io.StringIO(newline="")
    writer = csv.DictWriter(
        text_buffer,
        fieldnames=CSV_FIELDS,
        lineterminator="\n",
        extrasaction="raise",
    )
    writer.writeheader()
    writer.writerows(rows)
    return b"\xef\xbb\xbf" + text_buffer.getvalue().encode("utf-8")


def serialize_json(payload: dict[str, Any], *, pretty: bool = False) -> bytes:
    if pretty:
        rendered = json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
            sort_keys=False,
        )
    else:
        rendered = json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=False,
        )
    return (rendered + "\n").encode("utf-8")


def duplicate_values(values: Iterable[str]) -> list[str]:
    counts = Counter(values)
    return sorted(value for value, count in counts.items() if count > 1)


def main() -> int:
    args = parse_args()
    boundary_path = args.boundary.resolve()
    crosswalk_path = args.crosswalk.resolve()
    demographics_path = args.demographics.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    table_path = output_dir / "map_demographics_by_geometry_zone_202607.csv"
    polygon_path = output_dir / "map_admin_dong_demographics_202607.geojson"
    bubble_path = output_dir / "map_bubbles_age_65_plus_one_person_202607.geojson"
    validation_path = output_dir / "map_layers_validation_202607.json"

    input_hashes = {
        "boundary_sha256": sha256_file(boundary_path),
        "crosswalk_sha256": sha256_file(crosswalk_path),
        "demographics_sha256": sha256_file(demographics_path),
    }

    boundary = json.loads(boundary_path.read_text(encoding="utf-8"))
    boundary_features = boundary.get("features", [])
    crosswalk_fields, crosswalk_rows = read_csv(crosswalk_path)
    demographic_fields, demographic_rows = read_csv(demographics_path)

    require_fields(
        crosswalk_fields,
        {
            "current_admin_dong_code_20260701",
            "current_district_name_20260701",
            "current_dong_name_20260701",
            "geometry_zone_id",
            "geometry_adm_cd_20250630",
            "geometry_district_name_20250630",
            "geometry_dong_name_20250630",
            "geometry_base_date",
            "mapping_status",
            "mapping_method",
            "mapping_confidence",
            "aggregation_required",
            "metric_handling",
        },
        crosswalk_path,
    )
    require_fields(
        demographic_fields,
        {
            "admin_dong_code_20260701",
            "district_name_20260701",
            "admin_dong_name",
            "population_reference_date",
            "household_reference_date",
            *COUNT_FIELDS,
            *RATIO_FIELDS,
        },
        demographics_path,
    )

    boundary_by_zone: dict[str, dict[str, Any]] = {}
    invalid_or_empty_boundary_zones: list[str] = []
    for feature in boundary_features:
        zone_id = str(feature.get("properties", {}).get("geometry_zone_id", ""))
        if not zone_id:
            raise ValueError("Boundary feature is missing geometry_zone_id")
        if zone_id in boundary_by_zone:
            raise ValueError(f"Duplicate boundary geometry_zone_id: {zone_id}")
        geometry = shape(feature["geometry"])
        if geometry.is_empty or not geometry.is_valid:
            invalid_or_empty_boundary_zones.append(zone_id)
        boundary_by_zone[zone_id] = feature

    demographics_by_code: dict[str, dict[str, str]] = {}
    for row in demographic_rows:
        code = row["admin_dong_code_20260701"].strip()
        if code in demographics_by_code:
            raise ValueError(f"Duplicate demographic admin code: {code}")
        demographics_by_code[code] = row

    mapped_crosswalk = [
        row for row in crosswalk_rows if row["mapping_status"] == "mapped"
    ]
    unmapped_crosswalk = [
        row for row in crosswalk_rows if row["mapping_status"] != "mapped"
    ]
    crosswalk_by_code: dict[str, dict[str, str]] = {}
    members_by_zone: dict[str, list[tuple[dict[str, str], dict[str, str]]]] = (
        defaultdict(list)
    )
    for crosswalk_row in mapped_crosswalk:
        code = crosswalk_row["current_admin_dong_code_20260701"].strip()
        if code in crosswalk_by_code:
            raise ValueError(f"Duplicate crosswalk current admin code: {code}")
        crosswalk_by_code[code] = crosswalk_row
        demographic_row = demographics_by_code.get(code)
        if demographic_row is None:
            continue
        zone_id = crosswalk_row["geometry_zone_id"].strip()
        members_by_zone[zone_id].append((crosswalk_row, demographic_row))

    input_totals = {
        field: sum(
            parse_nonnegative_integer(
                row[field], field, row["admin_dong_code_20260701"]
            )
            for row in demographic_rows
        )
        for field in COUNT_FIELDS
    }

    table_rows: list[dict[str, Any]] = []
    polygon_features: list[dict[str, Any]] = []
    bubble_features: list[dict[str, Any]] = []
    representative_point_outside_zones: list[str] = []
    non_wgs84_representative_points: list[str] = []
    source_date_conflicts: list[str] = []
    district_conflicts: list[str] = []
    name_conflicts: list[str] = []
    unreviewed_map_units: list[str] = []

    for zone_id in sorted(boundary_by_zone):
        boundary_feature = boundary_by_zone[zone_id]
        boundary_properties = boundary_feature["properties"]
        members = sorted(
            members_by_zone.get(zone_id, []),
            key=lambda pair: pair[0]["current_admin_dong_code_20260701"],
        )
        if not members:
            continue

        crosswalk_members = [pair[0] for pair in members]
        demographic_members = [pair[1] for pair in members]
        current_codes = [
            row["current_admin_dong_code_20260701"] for row in crosswalk_members
        ]
        current_names = [
            row["current_dong_name_20260701"] for row in crosswalk_members
        ]
        current_districts = sorted(
            {row["current_district_name_20260701"] for row in crosswalk_members}
        )
        if len(current_districts) != 1:
            district_conflicts.append(zone_id)

        for crosswalk_row, demographic_row in members:
            if (
                crosswalk_row["current_district_name_20260701"]
                != demographic_row["district_name_20260701"]
            ):
                district_conflicts.append(
                    f"{zone_id}:{crosswalk_row['current_admin_dong_code_20260701']}"
                )
            if (
                crosswalk_row["current_dong_name_20260701"]
                != demographic_row["admin_dong_name"]
            ):
                name_conflicts.append(
                    f"{zone_id}:{crosswalk_row['current_admin_dong_code_20260701']}"
                )

        population_dates = sorted(
            {row["population_reference_date"] for row in demographic_members}
        )
        household_dates = sorted(
            {row["household_reference_date"] for row in demographic_members}
        )
        if len(population_dates) != 1 or len(household_dates) != 1:
            source_date_conflicts.append(zone_id)

        counts = {
            field: sum(
                parse_nonnegative_integer(
                    row[field], field, row["admin_dong_code_20260701"]
                )
                for row in demographic_members
            )
            for field in COUNT_FIELDS
        }
        ratios = {
            "population_age_65_plus_share": safe_ratio(
                counts["population_age_65_plus"], counts["total_population"]
            ),
            "one_person_household_share": safe_ratio(
                counts["one_person_households"], counts["total_households"]
            ),
            "age_65_plus_one_person_share_of_age_65_plus_population": safe_ratio(
                counts["one_person_households_age_65_plus"],
                counts["population_age_65_plus"],
            ),
        }

        mapping_methods = sorted(
            {row["mapping_method"] for row in crosswalk_members}
        )
        mapping_confidences = sorted(
            {row["mapping_confidence"] for row in crosswalk_members}
        )
        map_unit_status = classify_map_unit(set(mapping_methods), len(members))
        if map_unit_status == "unreviewed":
            unreviewed_map_units.append(zone_id)
        aggregation_required = len(members) > 1
        metric_handling = (
            "sum_additive_counts_then_recompute_rates"
            if aggregation_required
            else "direct_geometry_join"
        )

        geometry = shape(boundary_feature["geometry"])
        representative_point = geometry.representative_point()
        longitude = float(representative_point.x)
        latitude = float(representative_point.y)
        if not geometry.covers(representative_point):
            representative_point_outside_zones.append(zone_id)
        if not (
            math.isfinite(longitude)
            and math.isfinite(latitude)
            and -180 <= longitude <= 180
            and -90 <= latitude <= 90
        ):
            non_wgs84_representative_points.append(zone_id)

        common_properties: dict[str, Any] = {
            "geometry_zone_id": zone_id,
            "geometry_adm_cd_20250630": boundary_properties[
                "geometry_adm_cd_20250630"
            ],
            "geometry_district_name_20250630": boundary_properties[
                "geometry_district_name_20250630"
            ],
            "geometry_dong_name_20250630": boundary_properties[
                "geometry_dong_name_20250630"
            ],
            "geometry_base_date": boundary_properties["geometry_base_date"],
            "current_admin_reference_date": CURRENT_ADMIN_DATE,
            "current_district_name_20260701": (
                current_districts[0] if len(current_districts) == 1 else None
            ),
            "current_admin_dong_codes_20260701": current_codes,
            "current_admin_dong_names_20260701": current_names,
            "current_admin_dong_count": len(members),
            "map_unit_status": map_unit_status,
            "mapping_methods": mapping_methods,
            "mapping_confidence": (
                mapping_confidences[0]
                if len(mapping_confidences) == 1
                else "mixed"
            ),
            "aggregation_required": aggregation_required,
            "metric_handling": metric_handling,
            "population_reference_date": (
                population_dates[0] if len(population_dates) == 1 else None
            ),
            "household_reference_date": (
                household_dates[0] if len(household_dates) == 1 else None
            ),
            **counts,
            **ratios,
            "representative_longitude": round(longitude, 8),
            "representative_latitude": round(latitude, 8),
            "representative_point_method": REPRESENTATIVE_POINT_METHOD,
            "bubble_metric_name": BUBBLE_METRIC_NAME,
            "bubble_metric_label_ko": BUBBLE_METRIC_LABEL_KO,
            "bubble_metric_value": counts[BUBBLE_METRIC_NAME],
            "bubble_metric_interpretation": BUBBLE_INTERPRETATION,
        }

        csv_row = dict(common_properties)
        csv_row["current_admin_dong_codes_20260701"] = "|".join(current_codes)
        csv_row["current_admin_dong_names_20260701"] = "|".join(current_names)
        csv_row["mapping_methods"] = "|".join(mapping_methods)
        csv_row["aggregation_required"] = str(aggregation_required).lower()
        for ratio_field in RATIO_FIELDS:
            if csv_row[ratio_field] is not None:
                csv_row[ratio_field] = f"{csv_row[ratio_field]:.6f}"
        csv_row["representative_longitude"] = f"{longitude:.8f}"
        csv_row["representative_latitude"] = f"{latitude:.8f}"
        table_rows.append(csv_row)

        polygon_features.append(
            {
                "type": "Feature",
                "id": zone_id,
                "properties": common_properties,
                "geometry": boundary_feature["geometry"],
            }
        )
        bubble_features.append(
            {
                "type": "Feature",
                "id": f"bubble:{zone_id}",
                "properties": {
                    "geometry_zone_id": zone_id,
                    "current_district_name_20260701": common_properties[
                        "current_district_name_20260701"
                    ],
                    "current_admin_dong_names_20260701": current_names,
                    "current_admin_dong_count": len(members),
                    "map_unit_status": map_unit_status,
                    "aggregation_required": aggregation_required,
                    "population_reference_date": common_properties[
                        "population_reference_date"
                    ],
                    "household_reference_date": common_properties[
                        "household_reference_date"
                    ],
                    "metric_name": BUBBLE_METRIC_NAME,
                    "metric_label_ko": BUBBLE_METRIC_LABEL_KO,
                    "metric_value": counts[BUBBLE_METRIC_NAME],
                    "metric_is_observed_count": True,
                    "interpretation": BUBBLE_INTERPRETATION,
                    "representative_point_method": REPRESENTATIVE_POINT_METHOD,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(longitude, 8), round(latitude, 8)],
                },
            }
        )

    population_reference_dates = sorted(
        {row["population_reference_date"] for row in demographic_rows}
    )
    household_reference_dates = sorted(
        {row["household_reference_date"] for row in demographic_rows}
    )
    common_metadata = {
        "geometry_source_date": GEOMETRY_BASE_DATE,
        "current_admin_reference_date": CURRENT_ADMIN_DATE,
        "population_reference_dates": population_reference_dates,
        "household_reference_dates": household_reference_dates,
        "spatial_join_rule": (
            "Sum additive counts for current rows sharing a geometry zone, "
            "then recompute ratios from summed numerators and denominators."
        ),
        "interpretation_guardrail_ko": BUBBLE_INTERPRETATION,
    }
    polygon_geojson = {
        "type": "FeatureCollection",
        "name": "incheon_map_admin_dong_demographics_202607",
        "description": (
            "2025-06-30 공간구역 156개에 2026-07 현행 행정동 162개 인구·가구 통계를 "
            "손실 없이 합산한 지도 레이어"
        ),
        **common_metadata,
        "bbox": boundary.get("bbox"),
        "features": polygon_features,
    }
    bubble_geojson = {
        "type": "FeatureCollection",
        "name": "incheon_map_bubbles_age_65_plus_one_person_202607",
        "description": "65세 이상 1인 가구 관측 수를 표시하는 대표점 버블 레이어",
        **common_metadata,
        "bubble_metric_name": BUBBLE_METRIC_NAME,
        "bubble_metric_label_ko": BUBBLE_METRIC_LABEL_KO,
        "bubble_metric_is_observed_count": True,
        "bbox": boundary.get("bbox"),
        "features": bubble_features,
    }

    table_bytes = serialize_csv(table_rows)
    polygon_bytes = serialize_json(polygon_geojson)
    bubble_bytes = serialize_json(bubble_geojson)
    repeated_render_checks = {
        "table_repeated_render_bytes_identical": table_bytes
        == serialize_csv(table_rows),
        "polygon_repeated_render_bytes_identical": polygon_bytes
        == serialize_json(polygon_geojson),
        "bubble_repeated_render_bytes_identical": bubble_bytes
        == serialize_json(bubble_geojson),
    }

    prior_validation: dict[str, Any] | None = None
    if validation_path.exists():
        try:
            prior_validation = json.loads(validation_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            prior_validation = None

    output_hashes = {
        "table_sha256": sha256_bytes(table_bytes),
        "polygon_geojson_sha256": sha256_bytes(polygon_bytes),
        "bubble_geojson_sha256": sha256_bytes(bubble_bytes),
    }
    prior_same_inputs = bool(
        prior_validation
        and prior_validation.get("inputs", {}).get("sha256") == input_hashes
    )
    prior_output_hashes_match: bool | None = None
    if prior_same_inputs and prior_validation is not None:
        prior_output_hashes_match = (
            prior_validation.get("outputs", {}).get("sha256") == output_hashes
        )

    atomic_write_bytes(table_path, table_bytes)
    atomic_write_bytes(polygon_path, polygon_bytes)
    atomic_write_bytes(bubble_path, bubble_bytes)

    output_totals = {
        field: sum(int(row[field]) for row in table_rows) for field in COUNT_FIELDS
    }
    table_zone_ids = [str(row["geometry_zone_id"]) for row in table_rows]
    polygon_zone_ids = [
        str(feature["properties"]["geometry_zone_id"])
        for feature in polygon_features
    ]
    bubble_zone_ids = [
        str(feature["properties"]["geometry_zone_id"])
        for feature in bubble_features
    ]
    polygon_geometry_by_zone = {
        str(feature["properties"]["geometry_zone_id"]): shape(feature["geometry"])
        for feature in polygon_features
    }
    rounded_bubble_points_outside_zones = [
        str(feature["properties"]["geometry_zone_id"])
        for feature in bubble_features
        if not polygon_geometry_by_zone[
            str(feature["properties"]["geometry_zone_id"])
        ].covers(shape(feature["geometry"]))
    ]
    map_unit_status_counts = Counter(
        str(row["map_unit_status"]) for row in table_rows
    )
    mapped_current_codes = {
        row["current_admin_dong_code_20260701"] for row in mapped_crosswalk
    }
    demographic_codes = set(demographics_by_code)
    boundary_zone_ids = set(boundary_by_zone)
    crosswalk_zone_ids = {
        row["geometry_zone_id"] for row in mapped_crosswalk
    }

    checks = {
        "boundary_feature_count_is_156": len(boundary_features) == 156,
        "crosswalk_row_count_is_162": len(crosswalk_rows) == 162,
        "demographic_row_count_is_162": len(demographic_rows) == 162,
        "all_crosswalk_rows_mapped": not unmapped_crosswalk,
        "crosswalk_current_codes_unique": not duplicate_values(
            row["current_admin_dong_code_20260701"] for row in crosswalk_rows
        ),
        "demographic_current_codes_unique": not duplicate_values(
            row["admin_dong_code_20260701"] for row in demographic_rows
        ),
        "crosswalk_and_demographic_codes_match": (
            mapped_current_codes == demographic_codes
        ),
        "crosswalk_and_boundary_zones_match": (
            crosswalk_zone_ids == boundary_zone_ids
        ),
        "boundary_geometries_valid_and_nonempty": (
            not invalid_or_empty_boundary_zones
        ),
        "table_row_count_is_156": len(table_rows) == 156,
        "polygon_feature_count_is_156": len(polygon_features) == 156,
        "bubble_feature_count_is_156": len(bubble_features) == 156,
        "table_geometry_zone_ids_unique": not duplicate_values(table_zone_ids),
        "polygon_geometry_zone_ids_unique": not duplicate_values(
            polygon_zone_ids
        ),
        "bubble_geometry_zone_ids_unique": not duplicate_values(bubble_zone_ids),
        "all_output_zone_sets_equal_boundary": (
            set(table_zone_ids)
            == set(polygon_zone_ids)
            == set(bubble_zone_ids)
            == boundary_zone_ids
        ),
        "all_current_rows_contribute_exactly_once": sum(
            int(row["current_admin_dong_count"]) for row in table_rows
        )
        == 162,
        "additive_totals_preserved_exactly": input_totals == output_totals,
        "ratios_recomputed_from_aggregated_counts": all(
            (
                float(row["population_age_65_plus_share"])
                == safe_ratio(
                    int(row["population_age_65_plus"]),
                    int(row["total_population"]),
                )
                if row["population_age_65_plus_share"] != ""
                else int(row["total_population"]) == 0
            )
            and (
                float(row["one_person_household_share"])
                == safe_ratio(
                    int(row["one_person_households"]),
                    int(row["total_households"]),
                )
                if row["one_person_household_share"] != ""
                else int(row["total_households"]) == 0
            )
            and (
                float(
                    row[
                        "age_65_plus_one_person_share_of_age_65_plus_population"
                    ]
                )
                == safe_ratio(
                    int(row["one_person_households_age_65_plus"]),
                    int(row["population_age_65_plus"]),
                )
                if row[
                    "age_65_plus_one_person_share_of_age_65_plus_population"
                ]
                != ""
                else int(row["population_age_65_plus"]) == 0
            )
            for row in table_rows
        ),
        "source_dates_consistent_within_map_units": not source_date_conflicts,
        "district_names_consistent_across_join": not district_conflicts,
        "dong_names_consistent_across_join": not name_conflicts,
        "all_map_units_use_reviewed_mapping_status": not unreviewed_map_units,
        "map_unit_status_counts_are_expected": map_unit_status_counts
        == {
            "exact": 150,
            "aggregated_split": 2,
            "parent_with_branch_office": 4,
        },
        "representative_points_are_covered_by_polygons": (
            not representative_point_outside_zones
        ),
        "rounded_serialized_bubble_points_are_covered_by_polygons": (
            not rounded_bubble_points_outside_zones
        ),
        "representative_point_coordinates_are_wgs84": (
            not non_wgs84_representative_points
        ),
        "bubble_metric_is_observed_age_65_plus_one_person_count": all(
            feature["properties"]["metric_name"] == BUBBLE_METRIC_NAME
            and feature["properties"]["metric_is_observed_count"] is True
            and feature["properties"]["metric_value"]
            == next(
                row["one_person_households_age_65_plus"]
                for row in table_rows
                if row["geometry_zone_id"]
                == feature["properties"]["geometry_zone_id"]
            )
            for feature in bubble_features
        ),
        "repeated_render_bytes_are_identical": all(
            repeated_render_checks.values()
        ),
        "written_output_hashes_match_rendered_bytes": (
            sha256_file(table_path) == output_hashes["table_sha256"]
            and sha256_file(polygon_path)
            == output_hashes["polygon_geojson_sha256"]
            and sha256_file(bubble_path)
            == output_hashes["bubble_geojson_sha256"]
        ),
    }
    status = "pass" if all(checks.values()) else "fail"

    validation = {
        "status": status,
        "script_version": SCRIPT_VERSION,
        "inputs": {
            "boundary": str(boundary_path),
            "crosswalk": str(crosswalk_path),
            "demographics": str(demographics_path),
            "sha256": input_hashes,
        },
        "outputs": {
            "table": str(table_path),
            "polygon_geojson": str(polygon_path),
            "bubble_geojson": str(bubble_path),
            "sha256": output_hashes,
        },
        "counts": {
            "boundary_geometry_zones": len(boundary_features),
            "current_demographic_rows": len(demographic_rows),
            "map_table_rows": len(table_rows),
            "polygon_features": len(polygon_features),
            "bubble_features": len(bubble_features),
            "map_unit_status_counts": dict(sorted(map_unit_status_counts.items())),
        },
        "totals": {
            "input_current_162": input_totals,
            "output_geometry_156": output_totals,
            "totals_match": input_totals == output_totals,
        },
        "dates": {
            "geometry_base_date": GEOMETRY_BASE_DATE,
            "current_admin_reference_date": CURRENT_ADMIN_DATE,
            "population_reference_dates": population_reference_dates,
            "household_reference_dates": household_reference_dates,
        },
        "bubble_metric": {
            "name": BUBBLE_METRIC_NAME,
            "label_ko": BUBBLE_METRIC_LABEL_KO,
            "city_total": output_totals[BUBBLE_METRIC_NAME],
            "is_observed_count": True,
            "interpretation_guardrail_ko": BUBBLE_INTERPRETATION,
        },
        "determinism": {
            "repeated_render_checks": repeated_render_checks,
            "prior_run_with_same_inputs_found": prior_same_inputs,
            "prior_run_output_hashes_match": prior_output_hashes_match,
            "note": (
                "The files contain no clock-dependent fields and are sorted by "
                "geometry_zone_id. On a subsequent run with identical inputs, "
                "prior_run_output_hashes_match must be true."
            ),
        },
        "issues": {
            "unmapped_crosswalk_rows": [
                row["current_admin_dong_code_20260701"]
                for row in unmapped_crosswalk
            ],
            "invalid_or_empty_boundary_zones": invalid_or_empty_boundary_zones,
            "source_date_conflicts": source_date_conflicts,
            "district_conflicts": sorted(set(district_conflicts)),
            "name_conflicts": name_conflicts,
            "unreviewed_map_units": unreviewed_map_units,
            "representative_point_outside_zones": (
                representative_point_outside_zones
            ),
            "rounded_bubble_points_outside_zones": (
                rounded_bubble_points_outside_zones
            ),
            "non_wgs84_representative_points": non_wgs84_representative_points,
        },
        "checks": checks,
    }
    atomic_write_text(
        validation_path,
        serialize_json(validation, pretty=True).decode("utf-8"),
    )

    print(
        json.dumps(
            {
                "status": status,
                "geometry_zones": len(table_rows),
                "current_rows_aggregated": sum(
                    int(row["current_admin_dong_count"]) for row in table_rows
                ),
                "bubble_metric": BUBBLE_METRIC_NAME,
                "bubble_metric_city_total": output_totals[BUBBLE_METRIC_NAME],
                "table": str(table_path),
                "polygon_geojson": str(polygon_path),
                "bubble_geojson": str(bubble_path),
                "validation": str(validation_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
