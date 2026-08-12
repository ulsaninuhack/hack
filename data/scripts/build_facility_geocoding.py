#!/usr/bin/env python3
"""Offline facility geocoding for private analysis.

The pipeline deliberately uses only checked-in, official bulk datasets:

1. Parse a canonical facility road name + building number.
2. Resolve it to exactly one PNU in the MOIS/Juso 2026-07 building DB.
3. Locate that PNU in the VWorld 2026-08-09 integrated building polygons.
4. Derive an inside-polygon representative point and transform EPSG:5186 to
   WGS84 (EPSG:4326).

This script NEVER emits a public exact-point layer.  Its CSV is explicitly a
private-analysis intermediate.  A separate public exporter must make an
affirmative field/category policy decision before using any coordinate.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any, Iterable, Mapping, Sequence

try:
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import unary_union
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit(
        "Missing geospatial dependency. Run with "
        "`PYTHONPATH=.deps python3 scripts/build_facility_geocoding.py` "
        "from work/i5-data."
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "processed"
RAW = ROOT / "raw"

CANONICAL = PROCESSED / "facilities_canonical.csv"
JUSO_ZIP = RAW / "address" / "juso_building_db_202607.zip"
JUSO_META = RAW / "address" / "juso_building_db_202607.source.json"
VWORLD_ZIP = RAW / "housing" / "vworld_incheon_building_integrated_20260809.zip"

OUTPUT = PROCESSED / "facilities_geocoded_private.csv"
VALIDATION = PROCESSED / "facilities_geocoding_validation.json"
COVERAGE = PROCESSED / "facilities_geocoding_coverage_by_district.json"

JUSO_MEMBER = "build_incheon.txt"
VWORLD_STEM = "AL_D010_28_20260809"
OUTPUT_ENCODING = "utf-8-sig"

PRIVACY_SCOPE = "private_analysis_only"
PUBLIC_REVIEW = "true"

OUTPUT_FIELDS = (
    "facility_id",
    "facility_name",
    "district",
    "legal_dong",
    "address",
    "category_major",
    "category_detail",
    "facility_form",
    "road_name_normalized",
    "road_building_main",
    "road_building_sub",
    "matched_pnu",
    "juso_current_district",
    "juso_legal_dong",
    "juso_admin_dong_code",
    "juso_admin_dong_name",
    "geocode_status",
    "geocode_method",
    "match_confidence",
    "matched_juso_building_count",
    "matched_vworld_polygon_count",
    "source_latitude",
    "source_longitude",
    "geocoded_latitude",
    "geocoded_longitude",
    "best_latitude",
    "best_longitude",
    "coordinate_source",
    "privacy_scope",
    "requires_public_export_policy_review",
)


@dataclass(frozen=True)
class JusoBuilding:
    pnu: str
    district: str
    legal_dong: str
    admin_dong_code: str
    admin_dong_name: str


@dataclass(frozen=True)
class ParsedAddress:
    status: str
    road: str = ""
    main_no: str = ""
    sub_no: str = "0"


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = text.translate(str.maketrans({"–": "-", "—": "-", "−": "-", "‐": "-"}))
    return re.sub(r"\s+", " ", text).strip()


def compact(value: Any) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]", "", clean_text(value)).lower()


def compact_with_positions(value: Any) -> tuple[str, list[int], str]:
    """Return compact text plus indexes back into the NFKC source string."""
    source = clean_text(value)
    chars: list[str] = []
    positions: list[int] = []
    for index, char in enumerate(source):
        if re.match(r"[0-9A-Za-z가-힣]", char):
            chars.append(char.lower())
            positions.append(index)
    return "".join(chars), positions, source


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_coordinate(latitude: Any, longitude: Any) -> bool:
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return False
    # Broad Incheon envelope includes the western islands while rejecting
    # swapped, null-island and clearly non-Korean coordinates.
    return math.isfinite(lat) and math.isfinite(lon) and 36.0 <= lat <= 39.0 and 124.0 <= lon <= 128.0


def format_coordinate(value: float | str) -> str:
    if value == "" or value is None:
        return ""
    return f"{float(value):.8f}".rstrip("0").rstrip(".")


def derive_pnu(parts: Sequence[str]) -> str:
    legal_code = parts[0].strip()
    parcel_type = "2" if parts[5].strip() == "1" else "1"
    try:
        main = f"{int(parts[6] or 0):04d}"
        sub = f"{int(parts[7] or 0):04d}"
    except ValueError:
        return ""
    pnu = f"{legal_code}{parcel_type}{main}{sub}"
    return pnu if len(pnu) == 19 and pnu.isdigit() else ""


def load_juso_index(
    archive_path: Path,
) -> tuple[dict[tuple[str, int, int], list[JusoBuilding]], list[str], int]:
    address_index: dict[tuple[str, int, int], list[JusoBuilding]] = defaultdict(list)
    road_names: set[str] = set()
    row_count = 0
    with zipfile.ZipFile(archive_path) as archive:
        with archive.open(JUSO_MEMBER) as binary:
            for raw_line in binary:
                row_count += 1
                parts = raw_line.decode("ms949").rstrip("\r\n").split("|")
                if len(parts) != 31:
                    raise ValueError(f"{JUSO_MEMBER} row {row_count} has {len(parts)} columns, expected 31")
                road = compact(parts[9])
                pnu = derive_pnu(parts)
                if not road or not pnu:
                    continue
                try:
                    main_no = int(parts[11] or 0)
                    sub_no = int(parts[12] or 0)
                except ValueError:
                    continue
                road_names.add(road)
                address_index[(road, main_no, sub_no)].append(
                    JusoBuilding(
                        pnu=pnu,
                        district=clean_text(parts[2]),
                        legal_dong=clean_text(parts[3]),
                        admin_dong_code=clean_text(parts[17]),
                        admin_dong_name=clean_text(parts[18]),
                    )
                )
    # Longest-first prevents "OO로" from winning over "OO로12번길".
    return address_index, sorted(road_names, key=lambda item: (-len(item), item)), row_count


def parse_road_address(address: str, roads_longest_first: Sequence[str]) -> ParsedAddress:
    if not clean_text(address) or compact(address) in {"비공개", "주소비공개"}:
        return ParsedAddress("road_not_parsed")
    compact_address, positions, source = compact_with_positions(address)
    matched: tuple[str, int] | None = None
    for road in roads_longest_first:
        position = compact_address.find(road)
        if position >= 0:
            matched = (road, position)
            break
    if matched is None:
        return ParsedAddress("road_not_parsed")
    road, position = matched
    original_end = positions[position + len(road) - 1] + 1
    tail = source[original_end:]
    number = re.match(r"^\s*([0-9]+)(?:\s*-\s*([0-9]+))?", tail)
    if not number:
        return ParsedAddress("building_number_not_parsed", road=road)
    main_no = str(int(number.group(1)))
    sub_no = str(int(number.group(2) or 0))
    return ParsedAddress("parsed", road=road, main_no=main_no, sub_no=sub_no)


DISTRICT_COMPATIBILITY: Mapping[str, set[str]] = {
    "동구": {"제물포구"},
    "중구": {"제물포구", "영종구"},
    "서구": {"서구", "서해구", "검단구"},
}


def filter_candidates(
    candidates: Sequence[JusoBuilding], source_district: str, source_legal_dong: str
) -> list[JusoBuilding]:
    district = clean_text(source_district)
    allowed = DISTRICT_COMPATIBILITY.get(district, {district} if district else set())
    filtered = [record for record in candidates if not allowed or record.district in allowed]
    if not filtered:
        filtered = list(candidates)

    dong = compact(source_legal_dong)
    if dong:
        by_dong = [
            record
            for record in filtered
            if dong in {compact(record.legal_dong), compact(record.admin_dong_name)}
        ]
        if by_dong:
            filtered = by_dong
    return filtered


def resolve_facilities(
    canonical_rows: Sequence[Mapping[str, str]],
    address_index: Mapping[tuple[str, int, int], Sequence[JusoBuilding]],
    road_names: Sequence[str],
) -> list[dict[str, Any]]:
    resolved: list[dict[str, Any]] = []
    for source in canonical_rows:
        parsed = parse_road_address(source.get("address", ""), road_names)
        row: dict[str, Any] = {
            field: clean_text(source.get(field, ""))
            for field in (
                "facility_id",
                "facility_name",
                "district",
                "legal_dong",
                "address",
                "category_major",
                "category_detail",
                "facility_form",
            )
        }
        row.update(
            {
                "road_name_normalized": parsed.road,
                "road_building_main": parsed.main_no,
                "road_building_sub": parsed.sub_no if parsed.main_no else "",
                "matched_pnu": "",
                "juso_current_district": "",
                "juso_legal_dong": "",
                "juso_admin_dong_code": "",
                "juso_admin_dong_name": "",
                "geocode_status": parsed.status,
                "geocode_method": "",
                "match_confidence": "none",
                "matched_juso_building_count": 0,
                "matched_vworld_polygon_count": 0,
                "source_latitude": clean_text(source.get("latitude", "")),
                "source_longitude": clean_text(source.get("longitude", "")),
                "geocoded_latitude": "",
                "geocoded_longitude": "",
                "best_latitude": "",
                "best_longitude": "",
                "coordinate_source": "none",
                "privacy_scope": PRIVACY_SCOPE,
                "requires_public_export_policy_review": PUBLIC_REVIEW,
            }
        )
        if parsed.status == "parsed":
            key = (parsed.road, int(parsed.main_no), int(parsed.sub_no))
            candidates = filter_candidates(
                address_index.get(key, ()), row["district"], row["legal_dong"]
            )
            row["matched_juso_building_count"] = len(candidates)
            pnus = sorted({candidate.pnu for candidate in candidates})
            if not candidates:
                row["geocode_status"] = "no_juso_address_match"
            elif len(pnus) != 1:
                row["geocode_status"] = "ambiguous_juso_pnu"
            else:
                pnu = pnus[0]
                representative = sorted(
                    (candidate for candidate in candidates if candidate.pnu == pnu),
                    key=lambda item: (
                        item.district,
                        item.legal_dong,
                        item.admin_dong_code,
                        item.admin_dong_name,
                    ),
                )[0]
                row.update(
                    {
                        "matched_pnu": pnu,
                        "juso_current_district": representative.district,
                        "juso_legal_dong": representative.legal_dong,
                        "juso_admin_dong_code": representative.admin_dong_code,
                        "juso_admin_dong_name": representative.admin_dong_name,
                        "geocode_status": "matched_juso_pnu_no_vworld_geometry",
                        "geocode_method": "exact_road_name_building_number_unique_pnu",
                        "match_confidence": "high_address_match",
                    }
                )
        resolved.append(row)
    return resolved


def load_vworld_points(
    target_pnus: set[str], archive_path: Path
) -> tuple[dict[str, tuple[float, float, int]], int]:
    geometries: dict[str, list[Any]] = defaultdict(list)
    row_count = 0
    with zipfile.ZipFile(archive_path) as archive:
        with (
            archive.open(f"{VWORLD_STEM}.shp") as shp,
            archive.open(f"{VWORLD_STEM}.shx") as shx,
            archive.open(f"{VWORLD_STEM}.dbf") as dbf,
        ):
            reader = shapefile.Reader(shp=shp, shx=shx, dbf=dbf, encoding="cp949")
            for shape_record in reader.iterShapeRecords(fields=["A2"]):
                row_count += 1
                pnu = clean_text(shape_record.record["A2"])
                if pnu not in target_pnus:
                    continue
                geometry = shape(shape_record.shape.__geo_interface__)
                if not geometry.is_empty:
                    geometries[pnu].append(geometry)

    transformer = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)
    points: dict[str, tuple[float, float, int]] = {}
    for pnu, parts in geometries.items():
        merged = unary_union(parts)
        point = merged.representative_point()
        longitude, latitude = transformer.transform(point.x, point.y)
        if not valid_coordinate(latitude, longitude):
            continue
        points[pnu] = (latitude, longitude, len(parts))
    return points, row_count


def apply_coordinates(
    rows: Sequence[dict[str, Any]], points: Mapping[str, tuple[float, float, int]]
) -> None:
    for row in rows:
        pnu = row["matched_pnu"]
        if pnu and pnu in points:
            latitude, longitude, polygon_count = points[pnu]
            row["geocoded_latitude"] = format_coordinate(latitude)
            row["geocoded_longitude"] = format_coordinate(longitude)
            row["matched_vworld_polygon_count"] = polygon_count
            row["geocode_status"] = "matched_vworld_pnu"
            row["geocode_method"] = (
                "exact_road_name_building_number_unique_pnu_then_"
                "vworld_building_union_representative_point"
            )
            row["match_confidence"] = "high"

        if valid_coordinate(row["source_latitude"], row["source_longitude"]):
            row["best_latitude"] = format_coordinate(row["source_latitude"])
            row["best_longitude"] = format_coordinate(row["source_longitude"])
            row["coordinate_source"] = "source_dataset_coordinate"
        elif valid_coordinate(row["geocoded_latitude"], row["geocoded_longitude"]):
            row["best_latitude"] = row["geocoded_latitude"]
            row["best_longitude"] = row["geocoded_longitude"]
            row["coordinate_source"] = "juso_pnu_vworld_representative_point"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: Sequence[Mapping[str, Any]]) -> None:
    with path.open("w", encoding=OUTPUT_ENCODING, newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_008.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    value = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(value))


def percentile(values: Sequence[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def build_qa(
    rows: Sequence[Mapping[str, Any]], juso_rows: int, vworld_rows: int, archive_sha: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    status_counts = Counter(str(row["geocode_status"]) for row in rows)
    coordinate_counts = Counter(str(row["coordinate_source"]) for row in rows)
    unique_ids = len({row["facility_id"] for row in rows})
    invalid_best = sum(
        1
        for row in rows
        if row["coordinate_source"] != "none"
        and not valid_coordinate(row["best_latitude"], row["best_longitude"])
    )
    disagreements: list[float] = []
    for row in rows:
        if valid_coordinate(row["source_latitude"], row["source_longitude"]) and valid_coordinate(
            row["geocoded_latitude"], row["geocoded_longitude"]
        ):
            disagreements.append(
                haversine_meters(
                    float(row["source_latitude"]),
                    float(row["source_longitude"]),
                    float(row["geocoded_latitude"]),
                    float(row["geocoded_longitude"]),
                )
            )

    checks = {
        "archive_sha256_matches_provenance": archive_sha
        == "3d6dc01f6cb1bf8a95cff3c5d956dd2d5a87b37647ffb80f621848e5ab4efad9",
        "input_output_row_count_equal": len(rows) == 3394,
        "facility_ids_unique": unique_ids == len(rows),
        "all_emitted_coordinates_in_broad_incheon_envelope": invalid_best == 0,
        "ambiguous_pnu_never_received_geocoded_coordinate": all(
            not row["geocoded_latitude"]
            for row in rows
            if row["geocode_status"] == "ambiguous_juso_pnu"
        ),
        "every_row_marked_private_analysis_only": all(
            row["privacy_scope"] == PRIVACY_SCOPE for row in rows
        ),
        "every_row_requires_public_export_review": all(
            row["requires_public_export_policy_review"] == PUBLIC_REVIEW for row in rows
        ),
        "no_public_exact_point_output_created_by_this_pipeline": True,
    }
    validation = {
        "status": "pass" if all(checks.values()) else "fail",
        "pipeline": "juso_unique_pnu_to_vworld_building_representative_point",
        "pipeline_version": 1,
        "privacy_scope": PRIVACY_SCOPE,
        "inputs": {
            "canonical": str(CANONICAL.relative_to(ROOT)),
            "juso_building_db": str(JUSO_ZIP.relative_to(ROOT)),
            "vworld_integrated_buildings": str(VWORLD_ZIP.relative_to(ROOT)),
            "juso_building_rows_read": juso_rows,
            "vworld_building_polygons_read": vworld_rows,
            "juso_archive_sha256": archive_sha,
        },
        "outputs": {
            "private_csv": str(OUTPUT.relative_to(ROOT)),
            "coverage_json": str(COVERAGE.relative_to(ROOT)),
            "public_exact_point_outputs": [],
        },
        "counts": {
            "canonical_facilities": len(rows),
            "unique_facility_ids": unique_ids,
            "unique_juso_pnu_matches": sum(bool(row["matched_pnu"]) for row in rows),
            "vworld_geocoded": status_counts["matched_vworld_pnu"],
            "existing_source_coordinate": coordinate_counts["source_dataset_coordinate"],
            "new_offline_coordinate_used": coordinate_counts[
                "juso_pnu_vworld_representative_point"
            ],
            "best_coordinate_available": len(rows) - coordinate_counts["none"],
            "best_coordinate_missing": coordinate_counts["none"],
            "invalid_best_coordinates": invalid_best,
        },
        "rates": {
            "vworld_geocoded_pct": round(100 * status_counts["matched_vworld_pnu"] / len(rows), 4),
            "best_coordinate_available_pct": round(
                100 * (len(rows) - coordinate_counts["none"]) / len(rows), 4
            ),
        },
        "geocode_status_counts": dict(sorted(status_counts.items())),
        "coordinate_source_counts": dict(sorted(coordinate_counts.items())),
        "existing_vs_geocoded_distance_meters": {
            "comparison_count": len(disagreements),
            "median": round(median(disagreements), 3) if disagreements else None,
            "p95": round(percentile(disagreements, 0.95) or 0, 3) if disagreements else None,
            "max": round(max(disagreements), 3) if disagreements else None,
            "over_1000m": sum(value > 1000 for value in disagreements),
        },
        "checks": checks,
        "public_export_contract": {
            "join_key": "facility_id",
            "coordinate_fields": ["best_latitude", "best_longitude"],
            "required_action": "A separate exporter must affirmatively select allowed fields/categories. Do not copy this private CSV wholesale.",
            "excluded_from_this_private_output": [
                "phone",
                "capacity_max_reported",
                "current_occupancy_max_reported",
                "staff_count_max_reported",
                "source_facility_codes",
            ],
        },
    }

    district_rows: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        district_rows[clean_text(row["district"]) or "(미상)"].append(row)
    districts: list[dict[str, Any]] = []
    for district, subset in sorted(district_rows.items()):
        status = Counter(str(row["geocode_status"]) for row in subset)
        coordinate = Counter(str(row["coordinate_source"]) for row in subset)
        best = len(subset) - coordinate["none"]
        districts.append(
            {
                "source_district": district,
                "facilities": len(subset),
                "unique_juso_pnu_matches": sum(bool(row["matched_pnu"]) for row in subset),
                "vworld_geocoded": status["matched_vworld_pnu"],
                "existing_source_coordinate": coordinate["source_dataset_coordinate"],
                "new_offline_coordinate_used": coordinate[
                    "juso_pnu_vworld_representative_point"
                ],
                "best_coordinate_available": best,
                "best_coordinate_available_pct": round(100 * best / len(subset), 4),
                "geocode_status_counts": dict(sorted(status.items())),
            }
        )
    coverage = {
        "pipeline_version": 1,
        "privacy_scope": PRIVACY_SCOPE,
        "district_basis": "source-era canonical district; juso_current_district is retained per row",
        "districts": districts,
    }
    return validation, coverage


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-sha256",
        action="store_true",
        help="Skip the large-archive checksum (not recommended; QA records it as unverified).",
    )
    args = parser.parse_args()

    for required in (CANONICAL, JUSO_ZIP, JUSO_META, VWORLD_ZIP):
        if not required.exists():
            raise FileNotFoundError(required)
    metadata = json.loads(JUSO_META.read_text(encoding="utf-8"))
    expected_sha = metadata["integrity"]["sha256"]
    archive_sha = "skipped" if args.skip_sha256 else sha256_file(JUSO_ZIP)
    if archive_sha != "skipped" and archive_sha != expected_sha:
        raise ValueError(f"Juso archive SHA-256 mismatch: {archive_sha} != {expected_sha}")

    canonical_rows = read_csv(CANONICAL)
    address_index, road_names, juso_rows = load_juso_index(JUSO_ZIP)
    expected_juso_rows = next(
        item["row_count"] for item in metadata["members_used"] if item["path"] == JUSO_MEMBER
    )
    if juso_rows != expected_juso_rows:
        raise ValueError(f"Juso row count mismatch: {juso_rows} != {expected_juso_rows}")

    rows = resolve_facilities(canonical_rows, address_index, road_names)
    target_pnus = {str(row["matched_pnu"]) for row in rows if row["matched_pnu"]}
    points, vworld_rows = load_vworld_points(target_pnus, VWORLD_ZIP)
    apply_coordinates(rows, points)

    validation, coverage = build_qa(rows, juso_rows, vworld_rows, archive_sha)
    write_csv(OUTPUT, rows)
    write_json(VALIDATION, validation)
    write_json(COVERAGE, coverage)

    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "validation": str(VALIDATION),
                "status": validation["status"],
                "counts": validation["counts"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if validation["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
