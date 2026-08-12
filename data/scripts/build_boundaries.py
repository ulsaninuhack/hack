#!/usr/bin/env python3
"""Build app-ready Incheon administrative-dong boundaries and a time crosswalk.

The available VWorld/SGIS polygon snapshot is dated 2025-06-30 (156 spatial
zones), while the metric master is the MOIS 2026-07-01 list (162 current
administrative dongs).  This builder deliberately keeps the older geometry
zones intact.  Current rows created by a split, and branch-office rows without
their own polygon, are mapped to a shared 2025 geometry zone so additive metrics
can be aggregated.  It never invents or estimates a polygon split.

Run from any directory:

    python3 work/i5-data/scripts/build_boundaries.py

The script automatically adds ``work/i5-data/.deps`` to ``sys.path`` so the
vendored pyshp, pyproj, and shapely packages are used when present.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
import unicodedata
import warnings
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


DATA_ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = DATA_ROOT / ".deps"
if LOCAL_DEPS.is_dir():
    sys.path.insert(0, str(LOCAL_DEPS))

try:
    import shapefile  # type: ignore[import-not-found]
    from pyproj import CRS, Transformer  # type: ignore[import-not-found]
    from shapely.geometry import (  # type: ignore[import-not-found]
        GeometryCollection,
        MultiPolygon,
        Polygon,
        mapping,
        shape,
    )
    from shapely.ops import transform, unary_union  # type: ignore[import-not-found]
    from shapely.validation import make_valid  # type: ignore[import-not-found]
except ImportError as exc:  # pragma: no cover - dependency failure path
    raise SystemExit(
        "Missing GIS dependencies. Install pyshp, pyproj, and shapely, or "
        f"restore {LOCAL_DEPS}: {exc}"
    ) from exc


DEFAULT_SHAPEFILE = (
    DATA_ROOT
    / "raw"
    / "boundaries"
    / "vworld_census_admin_dong_boundary_20260410"
    / "BND_ADM_DONG_PG.shp"
)
DEFAULT_CURRENT_DONGS = (
    DATA_ROOT / "processed" / "admin_dongs_incheon_20260701.csv"
)
DEFAULT_OUTPUT_DIR = DATA_ROOT / "processed"

SOURCE_DATE = "20250630"
CURRENT_DATE = "20260701"
SOURCE_CRS_EPSG = 5186
TARGET_CRS_EPSG = 4326
INCHEON_SGIS_PREFIX = "23"
SCRIPT_VERSION = 1


# VWorld/SGIS ADM_CD uses an eight-digit statistical-area code.  The first
# four digits identify the 2025-06-30 district represented by the polygon.
SGIS_DISTRICT_BY_PREFIX = {
    "2301": "중구",
    "2302": "동구",
    "2304": "연수구",
    "2305": "남동구",
    "2306": "부평구",
    "2307": "계양구",
    "2308": "서구",
    "2309": "미추홀구",
    "2351": "강화군",
    "2352": "옹진군",
}


# Explicit safe many-to-one mappings.  Values are the name of an existing
# 2025-06-30 geometry zone.  These are aggregation relationships, not inferred
# polygon subdivisions.
SAFE_AGGREGATION_OVERRIDES = {
    # The 2025 polygon predates the current two-way administrative-dong split.
    "운서1동": {
        "geometry_name": "운서동",
        "current_district": "영종구",
        "geometry_district": "중구",
        "method": "post_snapshot_split_aggregate",
        "note": "운서1동과 운서2동 지표를 2025 운서동 공간구역에 합산",
    },
    "운서2동": {
        "geometry_name": "운서동",
        "current_district": "영종구",
        "geometry_district": "중구",
        "method": "post_snapshot_split_aggregate",
        "note": "운서1동과 운서2동 지표를 2025 운서동 공간구역에 합산",
    },
    "아라1동": {
        "geometry_name": "아라동",
        "current_district": "검단구",
        "geometry_district": "서구",
        "method": "post_snapshot_split_aggregate",
        "note": "아라1동과 아라2동 지표를 2025 아라동 공간구역에 합산",
    },
    "아라2동": {
        "geometry_name": "아라동",
        "current_district": "검단구",
        "geometry_district": "서구",
        "method": "post_snapshot_split_aggregate",
        "note": "아라1동과 아라2동 지표를 2025 아라동 공간구역에 합산",
    },
    # MOIS exposes these branch offices as current administrative-code rows,
    # but the statistical boundary snapshot has only their containing 면.
    "서도면볼음출장소": {
        "geometry_name": "서도면",
        "current_district": "강화군",
        "geometry_district": "강화군",
        "method": "branch_office_parent_aggregate",
        "note": "출장소 지표를 상위 서도면 공간구역에 합산",
    },
    "북도면장봉출장소": {
        "geometry_name": "북도면",
        "current_district": "옹진군",
        "geometry_district": "옹진군",
        "method": "branch_office_parent_aggregate",
        "note": "출장소 지표를 상위 북도면 공간구역에 합산",
    },
    "대청면소청출장소": {
        "geometry_name": "대청면",
        "current_district": "옹진군",
        "geometry_district": "옹진군",
        "method": "branch_office_parent_aggregate",
        "note": "출장소 지표를 상위 대청면 공간구역에 합산",
    },
    "자월면이작출장소": {
        "geometry_name": "자월면",
        "current_district": "옹진군",
        "geometry_district": "옹진군",
        "method": "branch_office_parent_aggregate",
        "note": "출장소 지표를 상위 자월면 공간구역에 합산",
    },
}


CROSSWALK_FIELDS = [
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
    "aggregation_group_size",
    "metric_handling",
    "notes",
]

GEOMETRY_TO_CURRENT_FIELDS = [
    "geometry_zone_id",
    "geometry_adm_cd_20250630",
    "geometry_district_name_20250630",
    "geometry_dong_name_20250630",
    "geometry_base_date",
    "current_admin_dong_count",
    "current_admin_dong_codes_20260701",
    "current_district_names_20260701",
    "current_dong_names_20260701",
    "map_unit_status",
    "aggregation_required",
    "metric_handling",
    "notes",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shapefile", type=Path, default=DEFAULT_SHAPEFILE)
    parser.add_argument(
        "--current-dongs", type=Path, default=DEFAULT_CURRENT_DONGS
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--simplify-meters",
        type=float,
        default=10.0,
        help="Topology-preserving simplification in EPSG:5186 metres (default: 10)",
    )
    return parser.parse_args()


def normalize_name(value: str) -> str:
    """Normalize only typography known to vary across the two official files."""

    normalized = unicodedata.normalize("NFKC", value or "").strip()
    for separator in (".", "ㆍ", "・", "∙"):
        normalized = normalized.replace(separator, "·")
    return "".join(normalized.split())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding=encoding)
    temporary.replace(path)


def write_crosswalk(
    path: Path, rows: list[dict[str, Any]], fields: list[str]
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def polygonal_only(geometry: Any) -> Any:
    """Return only polygonal components after a validity repair."""

    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    if isinstance(geometry, GeometryCollection):
        polygonal_parts: list[Any] = []
        for part in geometry.geoms:
            if isinstance(part, Polygon):
                polygonal_parts.append(part)
            elif isinstance(part, MultiPolygon):
                polygonal_parts.extend(part.geoms)
        if polygonal_parts:
            return unary_union(polygonal_parts)
    raise ValueError(f"Geometry has no polygonal component: {geometry.geom_type}")


def load_source_crs(shapefile_path: Path) -> tuple[CRS, str]:
    prj_path = shapefile_path.with_suffix(".prj")
    if not prj_path.exists():
        raise FileNotFoundError(f"Missing projection file: {prj_path}")
    wkt = prj_path.read_text(encoding="ascii", errors="strict").strip()
    crs = CRS.from_wkt(wkt)
    # ESRI WKT in the VWorld bundle omits authority nodes, so pyproj's default
    # (70%) identification threshold returns None even though the projection
    # parameters match EPSG:5186.  At 50% PROJ identifies the exact parameter
    # set; the expected-code guard still prevents silently accepting another CRS.
    detected_epsg = crs.to_epsg(min_confidence=50)
    if detected_epsg != SOURCE_CRS_EPSG:
        raise ValueError(
            f"Expected EPSG:{SOURCE_CRS_EPSG}, detected {detected_epsg!r}"
        )
    return crs, wkt


def load_geometry_records(shapefile_path: Path) -> list[dict[str, Any]]:
    if not shapefile_path.exists():
        raise FileNotFoundError(f"Missing shapefile: {shapefile_path}")

    # The bundle's .cpg contains numeric "949".  pyshp warns that its spelling
    # differs from the Python codec name even though both denote the same codec.
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore", message=r"Specified encoding: cp949 different.*"
        )
        reader = shapefile.Reader(str(shapefile_path), encoding="cp949")
        records: list[dict[str, Any]] = []
        for shape_record in reader.iterShapeRecords():
            attributes = shape_record.record.as_dict()
            adm_cd = str(attributes.get("ADM_CD", "")).strip()
            if not adm_cd.startswith(INCHEON_SGIS_PREFIX):
                continue
            base_date = str(attributes.get("BASE_DATE", "")).strip()
            dong_name = str(attributes.get("ADM_NM", "")).strip()
            district_name = SGIS_DISTRICT_BY_PREFIX.get(adm_cd[:4], "")
            source_geometry = shape(shape_record.shape.__geo_interface__)
            if source_geometry.is_empty:
                raise ValueError(f"Empty source geometry: {adm_cd} {dong_name}")
            if not source_geometry.is_valid:
                source_geometry = polygonal_only(make_valid(source_geometry))
            records.append(
                {
                    "base_date": base_date,
                    "adm_cd": adm_cd,
                    "dong_name": dong_name,
                    "normalized_name": normalize_name(dong_name),
                    "district_name": district_name,
                    "geometry": source_geometry,
                }
            )

    records.sort(key=lambda row: row["adm_cd"])
    return records


def load_current_dongs(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing current administrative-dong master: {path}. "
            "Run build_admin_crosswalk.py first."
        )
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            "admin_dong_code_20260701",
            "sido_name_20260701",
            "district_name_20260701",
            "dong_name_20260701",
        }
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Current-dong file is missing columns: {sorted(missing)}")
        rows = [
            {
                "code": row["admin_dong_code_20260701"].strip(),
                "sido": row["sido_name_20260701"].strip(),
                "district": row["district_name_20260701"].strip(),
                "dong_name": row["dong_name_20260701"].strip(),
            }
            for row in reader
        ]
    rows.sort(key=lambda row: row["code"])
    return rows


def build_crosswalk(
    current_rows: list[dict[str, str]], geometry_rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    geometry_by_normalized_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in geometry_rows:
        geometry_by_normalized_name[row["normalized_name"]].append(row)

    mapped: list[dict[str, Any]] = []
    for current in current_rows:
        current_name = current["dong_name"]
        normalized_current_name = normalize_name(current_name)
        candidates = geometry_by_normalized_name.get(normalized_current_name, [])
        method = "unique_normalized_name"
        note = "2025 공간구역과 정규화 동명이 인천 내에서 유일하게 일치"

        override = SAFE_AGGREGATION_OVERRIDES.get(current_name)
        if override is not None:
            if current["district"] != override["current_district"]:
                candidates = []
                note = (
                    "안전 집계 규칙의 현행 구와 불일치: "
                    f"expected={override['current_district']}"
                )
            else:
                candidates = geometry_by_normalized_name.get(
                    normalize_name(override["geometry_name"]), []
                )
                candidates = [
                    candidate
                    for candidate in candidates
                    if candidate["district_name"] == override["geometry_district"]
                ]
                method = str(override["method"])
                note = str(override["note"])

        if len(candidates) == 1:
            geometry = candidates[0]
            mapped.append(
                {
                    "current_admin_dong_code_20260701": current["code"],
                    "current_district_name_20260701": current["district"],
                    "current_dong_name_20260701": current_name,
                    "geometry_zone_id": (
                        f"vworld_sgis_{SOURCE_DATE}:{geometry['adm_cd']}"
                    ),
                    "geometry_adm_cd_20250630": geometry["adm_cd"],
                    "geometry_district_name_20250630": geometry["district_name"],
                    "geometry_dong_name_20250630": geometry["dong_name"],
                    "geometry_base_date": geometry["base_date"],
                    "mapping_status": "mapped",
                    "mapping_method": method,
                    "mapping_confidence": "high",
                    "aggregation_required": "",
                    "aggregation_group_size": "",
                    "metric_handling": "",
                    "notes": note,
                }
            )
        else:
            reason = "no_candidate" if not candidates else "ambiguous_name"
            mapped.append(
                {
                    "current_admin_dong_code_20260701": current["code"],
                    "current_district_name_20260701": current["district"],
                    "current_dong_name_20260701": current_name,
                    "geometry_zone_id": "",
                    "geometry_adm_cd_20250630": "",
                    "geometry_district_name_20250630": "",
                    "geometry_dong_name_20250630": "",
                    "geometry_base_date": "",
                    "mapping_status": "unmatched",
                    "mapping_method": reason,
                    "mapping_confidence": "none",
                    "aggregation_required": "",
                    "aggregation_group_size": "",
                    "metric_handling": "do_not_map",
                    "notes": note if override else "일치 후보가 없어 추측하지 않음",
                }
            )

    group_sizes = Counter(
        row["geometry_zone_id"] for row in mapped if row["geometry_zone_id"]
    )
    for row in mapped:
        if not row["geometry_zone_id"]:
            continue
        group_size = group_sizes[row["geometry_zone_id"]]
        aggregation_required = group_size > 1
        row["aggregation_group_size"] = str(group_size)
        row["aggregation_required"] = str(aggregation_required).lower()
        row["metric_handling"] = (
            "sum_additive_counts_then_recompute_rates"
            if aggregation_required
            else "direct_geometry_join"
        )
    return mapped


def classify_map_unit(members: list[dict[str, Any]]) -> tuple[str, str]:
    """Classify a 2025 polygon by how its current metric rows must be joined."""

    if not members:
        return "unmapped", "현재 행정동 연결이 없어 사용하지 않음"
    methods = {member["mapping_method"] for member in members}
    if methods == {"unique_normalized_name"} and len(members) == 1:
        return "exact", "현재 행정동 1개와 공간구역 1개가 일치"
    if methods == {"post_snapshot_split_aggregate"} and len(members) > 1:
        return (
            "aggregated_split",
            "분할된 현재 행정동들의 가산 지표를 기존 공간구역에 합산",
        )
    if (
        "branch_office_parent_aggregate" in methods
        and "unique_normalized_name" in methods
        and len(members) > 1
    ):
        return (
            "parent_with_branch_office",
            "상위 읍면과 출장소의 가산 지표를 하나의 공간구역에 합산",
        )
    return "unreviewed_many_to_one", "명시적 안전 집계 유형에 포함되지 않음"


def build_geometry_to_current_crosswalk(
    geometry_rows: list[dict[str, Any]],
    current_crosswalk_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    current_by_geometry: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in current_crosswalk_rows:
        if row["mapping_status"] == "mapped":
            current_by_geometry[row["geometry_adm_cd_20250630"]].append(row)

    output: list[dict[str, Any]] = []
    for geometry in geometry_rows:
        members = sorted(
            current_by_geometry.get(geometry["adm_cd"], []),
            key=lambda row: row["current_admin_dong_code_20260701"],
        )
        status, note = classify_map_unit(members)
        aggregation_required = len(members) > 1
        output.append(
            {
                "geometry_zone_id": f"vworld_sgis_{SOURCE_DATE}:{geometry['adm_cd']}",
                "geometry_adm_cd_20250630": geometry["adm_cd"],
                "geometry_district_name_20250630": geometry["district_name"],
                "geometry_dong_name_20250630": geometry["dong_name"],
                "geometry_base_date": geometry["base_date"],
                "current_admin_dong_count": str(len(members)),
                "current_admin_dong_codes_20260701": "|".join(
                    member["current_admin_dong_code_20260701"] for member in members
                ),
                "current_district_names_20260701": "|".join(
                    sorted(
                        {
                            member["current_district_name_20260701"]
                            for member in members
                        }
                    )
                ),
                "current_dong_names_20260701": "|".join(
                    member["current_dong_name_20260701"] for member in members
                ),
                "map_unit_status": status,
                "aggregation_required": str(aggregation_required).lower(),
                "metric_handling": (
                    "sum_additive_counts_then_recompute_rates"
                    if aggregation_required
                    else "direct_geometry_join"
                ),
                "notes": note,
            }
        )
    return output


def finite_bounds(bounds: Iterable[float]) -> bool:
    return all(math.isfinite(value) for value in bounds)


def build_geojson(
    geometry_rows: list[dict[str, Any]],
    crosswalk_rows: list[dict[str, Any]],
    transformer: Transformer,
    simplify_meters: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    current_by_geometry: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in crosswalk_rows:
        if row["mapping_status"] == "mapped":
            current_by_geometry[row["geometry_adm_cd_20250630"]].append(row)

    features: list[dict[str, Any]] = []
    projected_area_before = 0.0
    projected_area_after = 0.0
    repaired_before_count = 0
    invalid_after_projection: list[str] = []
    empty_after_projection: list[str] = []
    output_geometry_types: Counter[str] = Counter()

    for geometry_row in geometry_rows:
        source_geometry = geometry_row["geometry"]
        projected_area_before += source_geometry.area
        simplified = source_geometry.simplify(
            simplify_meters, preserve_topology=True
        )
        if simplified.is_empty:
            raise ValueError(
                f"Simplification emptied geometry {geometry_row['adm_cd']}"
            )
        if not simplified.is_valid:
            simplified = polygonal_only(make_valid(simplified))
            repaired_before_count += 1
        projected_area_after += simplified.area

        wgs84_geometry = transform(transformer.transform, simplified)
        if not wgs84_geometry.is_valid:
            wgs84_geometry = polygonal_only(make_valid(wgs84_geometry))
        if wgs84_geometry.is_empty:
            empty_after_projection.append(geometry_row["adm_cd"])
        if not wgs84_geometry.is_valid:
            invalid_after_projection.append(geometry_row["adm_cd"])
        if not finite_bounds(wgs84_geometry.bounds):
            raise ValueError(f"Non-finite bounds: {geometry_row['adm_cd']}")
        min_lon, min_lat, max_lon, max_lat = wgs84_geometry.bounds
        if not (-180 <= min_lon <= max_lon <= 180):
            raise ValueError(f"Longitude outside WGS84 range: {geometry_row['adm_cd']}")
        if not (-90 <= min_lat <= max_lat <= 90):
            raise ValueError(f"Latitude outside WGS84 range: {geometry_row['adm_cd']}")

        members = sorted(
            current_by_geometry.get(geometry_row["adm_cd"], []),
            key=lambda row: row["current_admin_dong_code_20260701"],
        )
        member_codes = [
            row["current_admin_dong_code_20260701"] for row in members
        ]
        member_names = [row["current_dong_name_20260701"] for row in members]
        member_districts = sorted(
            {row["current_district_name_20260701"] for row in members}
        )
        aggregation_required = len(members) > 1
        map_unit_status, map_unit_note = classify_map_unit(members)
        output_geometry_types[wgs84_geometry.geom_type] += 1
        features.append(
            {
                "type": "Feature",
                "id": f"vworld_sgis_{SOURCE_DATE}:{geometry_row['adm_cd']}",
                "properties": {
                    "geometry_zone_id": (
                        f"vworld_sgis_{SOURCE_DATE}:{geometry_row['adm_cd']}"
                    ),
                    "geometry_adm_cd_20250630": geometry_row["adm_cd"],
                    "geometry_district_name_20250630": geometry_row[
                        "district_name"
                    ],
                    "geometry_dong_name_20250630": geometry_row["dong_name"],
                    "geometry_base_date": geometry_row["base_date"],
                    "current_admin_dong_codes_20260701": member_codes,
                    "current_district_names_20260701": member_districts,
                    "current_dong_names_20260701": member_names,
                    "current_dong_count": len(members),
                    "map_unit_status": map_unit_status,
                    "aggregation_required": aggregation_required,
                    "metric_handling": (
                        "sum_additive_counts_then_recompute_rates"
                        if aggregation_required
                        else "direct_geometry_join"
                    ),
                    "mapping_notes": map_unit_note,
                },
                "geometry": mapping(wgs84_geometry),
            }
        )

    if features:
        all_bounds = [shape(feature["geometry"]).bounds for feature in features]
        bbox = [
            min(bounds[0] for bounds in all_bounds),
            min(bounds[1] for bounds in all_bounds),
            max(bounds[2] for bounds in all_bounds),
            max(bounds[3] for bounds in all_bounds),
        ]
    else:
        bbox = []

    geojson = {
        "type": "FeatureCollection",
        "name": "incheon_admin_dong_geometry_zones_20250630",
        "source_dataset": "VWorld census administrative-dong boundary",
        "source_base_date": SOURCE_DATE,
        "source_crs": f"EPSG:{SOURCE_CRS_EPSG}",
        "target_crs": f"EPSG:{TARGET_CRS_EPSG}",
        "current_metric_date": CURRENT_DATE,
        "simplify_tolerance_meters": simplify_meters,
        "bbox": bbox,
        "features": features,
    }
    geometry_validation = {
        "projected_area_m2_before_simplification": projected_area_before,
        "projected_area_m2_after_simplification": projected_area_after,
        "area_retention_ratio": (
            projected_area_after / projected_area_before
            if projected_area_before
            else None
        ),
        "simplified_geometry_repair_count": repaired_before_count,
        "invalid_wgs84_geometry_codes": invalid_after_projection,
        "empty_wgs84_geometry_codes": empty_after_projection,
        "output_geometry_types": dict(sorted(output_geometry_types.items())),
        "bbox_wgs84": bbox,
    }
    return geojson, geometry_validation


def duplicate_values(values: Iterable[str]) -> list[str]:
    counts = Counter(values)
    return sorted(value for value, count in counts.items() if count > 1)


def main() -> int:
    args = parse_args()
    if args.simplify_meters < 0:
        raise SystemExit("--simplify-meters must be non-negative")

    shapefile_path = args.shapefile.resolve()
    current_dongs_path = args.current_dongs.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    geojson_path = output_dir / "boundary_incheon_admin_dong_20250630.geojson"
    crosswalk_path = (
        output_dir / "boundary_current_to_geometry_crosswalk_20260701.csv"
    )
    geometry_crosswalk_path = (
        output_dir / "boundary_geometry_to_current_crosswalk_20260701.csv"
    )
    validation_path = output_dir / "boundary_validation.json"

    source_crs, source_crs_wkt = load_source_crs(shapefile_path)
    geometry_rows = load_geometry_records(shapefile_path)
    current_rows = load_current_dongs(current_dongs_path)
    crosswalk_rows = build_crosswalk(current_rows, geometry_rows)
    geometry_crosswalk_rows = build_geometry_to_current_crosswalk(
        geometry_rows, crosswalk_rows
    )

    transformer = Transformer.from_crs(
        source_crs, CRS.from_epsg(TARGET_CRS_EPSG), always_xy=True
    )
    geojson, geometry_validation = build_geojson(
        geometry_rows, crosswalk_rows, transformer, args.simplify_meters
    )

    atomic_write_text(
        geojson_path,
        json.dumps(
            geojson,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=False,
            separators=(",", ":"),
        )
        + "\n",
    )
    write_crosswalk(crosswalk_path, crosswalk_rows, CROSSWALK_FIELDS)
    write_crosswalk(
        geometry_crosswalk_path,
        geometry_crosswalk_rows,
        GEOMETRY_TO_CURRENT_FIELDS,
    )

    # Reopen the serialized GeoJSON so validation covers what downstream users
    # will actually read, rather than only the in-memory Shapely objects.
    serialized_geojson = json.loads(geojson_path.read_text(encoding="utf-8"))
    serialized_features = serialized_geojson.get("features", [])
    serialized_invalid = []
    serialized_empty = []
    for feature in serialized_features:
        geometry = shape(feature["geometry"])
        if geometry.is_empty:
            serialized_empty.append(feature["id"])
        if not geometry.is_valid:
            serialized_invalid.append(feature["id"])

    base_dates = sorted({row["base_date"] for row in geometry_rows})
    unknown_district_geometry_codes = sorted(
        row["adm_cd"] for row in geometry_rows if not row["district_name"]
    )
    unmatched_rows = [
        row for row in crosswalk_rows if row["mapping_status"] != "mapped"
    ]
    mapped_rows = [
        row for row in crosswalk_rows if row["mapping_status"] == "mapped"
    ]
    mapping_method_counts = Counter(row["mapping_method"] for row in crosswalk_rows)
    group_members: dict[str, list[str]] = defaultdict(list)
    for row in mapped_rows:
        group_members[row["geometry_zone_id"]].append(
            row["current_dong_name_20260701"]
        )
    aggregation_groups = {
        zone_id: sorted(names)
        for zone_id, names in sorted(group_members.items())
        if len(names) > 1
    }
    unused_geometry_codes = sorted(
        {row["adm_cd"] for row in geometry_rows}
        - {row["geometry_adm_cd_20250630"] for row in mapped_rows}
    )
    map_unit_status_counts = Counter(
        row["map_unit_status"] for row in geometry_crosswalk_rows
    )

    checks = {
        "source_base_date_is_20250630": base_dates == [SOURCE_DATE],
        "source_crs_is_epsg_5186": (
            source_crs.to_epsg(min_confidence=50) == SOURCE_CRS_EPSG
        ),
        "incheon_geometry_count_is_156": len(geometry_rows) == 156,
        "current_admin_dong_count_is_162": len(current_rows) == 162,
        "crosswalk_row_count_equals_current_count": (
            len(crosswalk_rows) == len(current_rows)
        ),
        "all_current_rows_mapped": not unmatched_rows,
        "mapped_geometry_zone_count_is_156": (
            len({row["geometry_zone_id"] for row in mapped_rows}) == 156
        ),
        "all_source_geometry_zones_used": not unused_geometry_codes,
        "source_geometry_codes_unique": not duplicate_values(
            row["adm_cd"] for row in geometry_rows
        ),
        "current_admin_codes_unique": not duplicate_values(
            row["code"] for row in current_rows
        ),
        "all_source_district_prefixes_known": not unknown_district_geometry_codes,
        "geojson_feature_count_matches_geometry_count": (
            len(serialized_features) == len(geometry_rows)
        ),
        "geometry_to_current_row_count_is_156": (
            len(geometry_crosswalk_rows) == 156
        ),
        "map_unit_statuses_are_reviewed": set(map_unit_status_counts).issubset(
            {"exact", "aggregated_split", "parent_with_branch_office"}
        ),
        "map_unit_status_counts_are_expected": map_unit_status_counts
        == {
            "exact": 150,
            "aggregated_split": 2,
            "parent_with_branch_office": 4,
        },
        "serialized_geojson_geometries_valid": not serialized_invalid,
        "serialized_geojson_geometries_nonempty": not serialized_empty,
        "aggregation_group_count_is_6": len(aggregation_groups) == 6,
    }
    status = "pass" if all(checks.values()) else "fail"

    shapefile_bundle_hashes = {}
    for suffix in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
        component_path = shapefile_path.with_suffix(suffix)
        if component_path.exists():
            shapefile_bundle_hashes[component_path.name] = sha256_file(component_path)

    validation = {
        "status": status,
        "script_version": SCRIPT_VERSION,
        "inputs": {
            "shapefile": str(shapefile_path),
            "shapefile_bundle_sha256": shapefile_bundle_hashes,
            "current_admin_dongs": str(current_dongs_path),
            "current_admin_dongs_sha256": sha256_file(current_dongs_path),
            "source_crs_epsg_detected": source_crs.to_epsg(min_confidence=50),
            "source_crs_wkt": source_crs_wkt,
            "source_base_dates": base_dates,
        },
        "outputs": {
            "geojson": str(geojson_path),
            "geojson_sha256": sha256_file(geojson_path),
            "crosswalk": str(crosswalk_path),
            "crosswalk_sha256": sha256_file(crosswalk_path),
            "geometry_to_current_crosswalk": str(geometry_crosswalk_path),
            "geometry_to_current_crosswalk_sha256": sha256_file(
                geometry_crosswalk_path
            ),
        },
        "counts": {
            "source_national_geometry_count": 3559,
            "incheon_geometry_zone_count": len(geometry_rows),
            "current_admin_dong_count": len(current_rows),
            "crosswalk_row_count": len(crosswalk_rows),
            "mapped_current_row_count": len(mapped_rows),
            "unmatched_current_row_count": len(unmatched_rows),
            "mapped_unique_geometry_zone_count": len(
                {row["geometry_zone_id"] for row in mapped_rows}
            ),
            "aggregation_group_count": len(aggregation_groups),
            "mapping_method_counts": dict(sorted(mapping_method_counts.items())),
            "map_unit_status_counts": dict(sorted(map_unit_status_counts.items())),
        },
        "mapping": {
            "policy": (
                "Use unique normalized names, plus explicit safe many-to-one "
                "aggregation rules; never fabricate post-snapshot polygon splits."
            ),
            "aggregation_rule": (
                "Sum additive numerators/denominators across every current row "
                "sharing a geometry_zone_id, then recompute rates; never average rates."
            ),
            "aggregation_groups": aggregation_groups,
            "unmatched_current_rows": [
                {
                    "code": row["current_admin_dong_code_20260701"],
                    "district": row["current_district_name_20260701"],
                    "dong": row["current_dong_name_20260701"],
                    "reason": row["mapping_method"],
                }
                for row in unmatched_rows
            ],
            "unused_geometry_codes": unused_geometry_codes,
        },
        "geometry": {
            **geometry_validation,
            "serialized_invalid_feature_ids": serialized_invalid,
            "serialized_empty_feature_ids": serialized_empty,
            "simplify_tolerance_meters": args.simplify_meters,
        },
        "checks": checks,
    }
    atomic_write_text(
        validation_path,
        json.dumps(validation, ensure_ascii=False, indent=2, allow_nan=False)
        + "\n",
    )

    print(
        json.dumps(
            {
                "status": status,
                "geometry_zones": len(geometry_rows),
                "current_dongs": len(current_rows),
                "mapped": len(mapped_rows),
                "unmatched": len(unmatched_rows),
                "aggregation_groups": len(aggregation_groups),
                "geojson": str(geojson_path),
                "crosswalk": str(crosswalk_path),
                "geometry_to_current_crosswalk": str(geometry_crosswalk_path),
                "validation": str(validation_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
