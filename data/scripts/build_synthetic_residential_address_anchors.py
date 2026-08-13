#!/usr/bin/env python3
"""Build deterministic synthetic-case anchors from official residential addresses.

The output joins three public building datasets without using resident records:

1. MOIS/Juso 2026-07 building DB for exact road addresses.
2. VWorld building-age register for the residential-use filter.
3. VWorld AL_D010 building polygons for representative coordinates.

Each output row is an address reference for a synthetic ContactOps case. It is
not evidence that a resident at the address is elderly, isolated, eligible for
welfare, or in danger.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import tempfile
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

try:
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import Point, shape
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit(
        "Missing geospatial dependencies. Install data/requirements.txt first."
    ) from exc


SEED = 20_260_812
TOTAL_CASES = 5_869
JUSO_MEMBER = "build_incheon.txt"
VWORLD_STEM = "AL_D010_28_20260809"
ADDRESS_SOURCE = "MOIS_JUSO_BUILDING_DB_202607"
COORDINATE_SOURCE = "VWORLD_AL_D010_PNU_REPRESENTATIVE_POINT_20260809"
HOUSING_SOURCE = "VWORLD_BUILDING_AGE_REGISTER_20260805"
JUSO_HOUSING_SOURCE = "MOIS_JUSO_BUILDING_DB_202607_COLLECTIVE_HOUSING_FLAG"
REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ResidentialMetadata:
    main_use_names: tuple[str, ...]
    building_names: tuple[str, ...]
    apartment_reference: bool


@dataclass(frozen=True)
class AddressCandidate:
    pnu: str
    road_address: str
    building_name: str
    legal_dong_name: str
    juso_admin_dong_code: str
    juso_admin_dong_name: str
    main_use_names: tuple[str, ...]
    apartment_reference: bool
    residential_classification_sources: tuple[str, ...]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def stable_key(seed: int, *parts: object) -> str:
    material = "|".join([str(seed), *(str(part) for part in parts)])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def json_bytes(payload: Any) -> bytes:
    return (
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


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


def road_address(parts: Sequence[str]) -> str:
    road = parts[9].strip()
    if not road:
        return ""
    try:
        main = str(int(parts[11] or 0))
        sub_number = int(parts[12] or 0)
    except ValueError:
        return ""
    if main == "0":
        return ""
    number = f"{main}-{sub_number}" if sub_number else main
    underground = "지하 " if parts[10].strip() == "1" else ""
    return " ".join(
        item
        for item in (
            parts[1].strip(),
            parts[2].strip(),
            road,
            f"{underground}{number}",
        )
        if item
    )


def load_residential_metadata(path: Path) -> dict[str, ResidentialMetadata]:
    uses: dict[str, set[str]] = defaultdict(set)
    names: dict[str, set[str]] = defaultdict(set)
    apartments: dict[str, bool] = defaultdict(bool)
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["is_residential"] != "true":
                continue
            pnu = row["pnu"].strip()
            if not pnu:
                continue
            _ = uses[pnu]
            use_name = row["main_use_name"].strip()
            building_name = row["building_name"].strip()
            if use_name:
                uses[pnu].add(use_name)
            if building_name:
                names[pnu].add(building_name)
            apartments[pnu] = apartments[pnu] or any(
                marker in f"{use_name} {building_name}"
                for marker in ("아파트", "공동주택")
            )
    return {
        pnu: ResidentialMetadata(
            main_use_names=tuple(sorted(uses[pnu])) or ("주거용 건축물",),
            building_names=tuple(sorted(names[pnu])),
            apartment_reference=apartments[pnu],
        )
        for pnu in sorted(uses)
    }


def load_address_candidates(
    archive_path: Path,
    residential: Mapping[str, ResidentialMetadata],
) -> tuple[dict[str, AddressCandidate], int]:
    candidates: dict[str, AddressCandidate] = {}
    row_count = 0
    with zipfile.ZipFile(archive_path) as archive:
        with archive.open(JUSO_MEMBER) as handle:
            for encoded in handle:
                row_count += 1
                parts = encoded.decode("ms949").rstrip("\r\n").split("|")
                if len(parts) < 27:
                    continue
                pnu = derive_pnu(parts)
                metadata = residential.get(pnu)
                juso_collective_housing = parts[26].strip() == "1"
                address = road_address(parts)
                if (metadata is None and not juso_collective_housing) or not address:
                    continue
                juso_name = parts[13].strip()
                building_name = juso_name or (
                    metadata.building_names[0]
                    if metadata is not None and metadata.building_names
                    else ""
                )
                candidate = AddressCandidate(
                    pnu=pnu,
                    road_address=address,
                    building_name=building_name,
                    legal_dong_name=parts[3].strip(),
                    juso_admin_dong_code=parts[17].strip(),
                    juso_admin_dong_name=parts[18].strip(),
                    main_use_names=(
                        metadata.main_use_names
                        if metadata is not None
                        else ("공동주택(주소DB 표시)",)
                    ),
                    apartment_reference=(
                        (metadata.apartment_reference if metadata is not None else False)
                        or juso_collective_housing
                        or "아파트" in juso_name
                    ),
                    residential_classification_sources=tuple(
                        source
                        for source, present in (
                            (HOUSING_SOURCE, metadata is not None),
                            (JUSO_HOUSING_SOURCE, juso_collective_housing),
                        )
                        if present
                    ),
                )
                previous = candidates.get(pnu)
                if previous is None or (
                    candidate.road_address,
                    candidate.building_name,
                ) < (previous.road_address, previous.building_name):
                    candidates[pnu] = candidate
    return candidates, row_count


def load_building_points(
    archive_path: Path,
    target_pnus: set[str],
) -> tuple[dict[str, tuple[float, float]], int]:
    largest: dict[str, tuple[float, Any]] = {}
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
                pnu = str(shape_record.record["A2"]).strip()
                if pnu not in target_pnus:
                    continue
                geometry = shape(shape_record.shape.__geo_interface__)
                if geometry.is_empty:
                    continue
                current = largest.get(pnu)
                if current is None or geometry.area > current[0]:
                    largest[pnu] = (geometry.area, geometry)

    transformer = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)
    points: dict[str, tuple[float, float]] = {}
    for pnu, (_, geometry) in largest.items():
        point = geometry.representative_point()
        longitude, latitude = transformer.transform(point.x, point.y)
        if (
            math.isfinite(longitude)
            and math.isfinite(latitude)
            and 124 <= longitude <= 128
            and 36 <= latitude <= 39
        ):
            points[pnu] = (round(longitude, 7), round(latitude, 7))
    return points, row_count


def load_coordinate_overrides(
    path: Path,
) -> tuple[dict[str, tuple[float, float]], dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    points: dict[str, tuple[float, float]] = {}
    sources: dict[str, str] = {}
    for row in payload.get("records", []):
        pnu = str(row.get("pnu", "")).strip()
        longitude = float(row["longitude"])
        latitude = float(row["latitude"])
        if (
            len(pnu) != 19
            or not pnu.isdigit()
            or not (124 <= longitude <= 128 and 36 <= latitude <= 39)
        ):
            raise ValueError("invalid residential coordinate override")
        points[pnu] = (round(longitude, 7), round(latitude, 7))
        sources[pnu] = str(row["coordinate_source"])
    return points, sources


def load_zone_contract(
    crosswalk_path: Path,
    geometry_path: Path,
) -> tuple[dict[str, dict[str, str]], dict[str, Any]]:
    crosswalk = {
        row["current_admin_dong_code_20260701"]: row
        for row in read_csv(crosswalk_path)
    }
    geometry_payload = json.loads(geometry_path.read_text(encoding="utf-8"))
    geometries = {
        feature["properties"]["geometry_zone_id"]: shape(feature["geometry"])
        for feature in geometry_payload["features"]
    }
    if len(crosswalk) != 162 or len(geometries) != 156:
        raise ValueError("expected the frozen 162-current-dong / 156-zone contract")
    return crosswalk, geometries


def assign_points_to_zones(
    points: Mapping[str, tuple[float, float]],
    geometries: Mapping[str, Any],
) -> dict[str, list[str]]:
    bounds = {zone_id: geometry.bounds for zone_id, geometry in geometries.items()}
    by_zone: dict[str, list[str]] = defaultdict(list)
    for pnu in sorted(points):
        longitude, latitude = points[pnu]
        point = Point(longitude, latitude)
        matching: list[str] = []
        for zone_id, geometry in geometries.items():
            min_x, min_y, max_x, max_y = bounds[zone_id]
            if not (min_x <= longitude <= max_x and min_y <= latitude <= max_y):
                continue
            if geometry.covers(point):
                matching.append(zone_id)
        if matching:
            by_zone[sorted(matching)[0]].append(pnu)
    return by_zone


def allocate_case_counts(
    demographics_rows: Sequence[Mapping[str, str]], total_cases: int
) -> dict[str, int]:
    observed = {
        row["admin_dong_code_20260701"]: int(
            row["one_person_households_age_65_plus"]
        )
        for row in demographics_rows
    }
    if len(observed) != 162 or any(value <= 0 for value in observed.values()):
        raise ValueError("demographics must contain 162 positive observed counts")
    observed_total = sum(observed.values())
    ideals = {
        code: total_cases * value / observed_total for code, value in observed.items()
    }
    allocated = {code: max(1, int(value)) for code, value in ideals.items()}
    remaining = total_cases - sum(allocated.values())
    if remaining < 0:
        raise ValueError("total case count is too small for one case per dong")
    order = sorted(
        allocated,
        key=lambda code: (-(ideals[code] - int(ideals[code])), code),
    )
    for code in order[:remaining]:
        allocated[code] += 1
    return allocated


def build_payload(args: argparse.Namespace) -> dict[str, Any]:
    demographics = read_csv(args.demographics)
    current_dongs = {
        row["admin_dong_code_20260701"]: row for row in read_csv(args.current_dongs)
    }
    crosswalk, geometries = load_zone_contract(args.crosswalk, args.geometry)
    allocation = allocate_case_counts(demographics, args.total_cases)
    if set(allocation) != set(current_dongs) or set(allocation) != set(crosswalk):
        raise ValueError("current dong, demographics, and crosswalk code sets differ")

    residential = load_residential_metadata(args.housing)
    candidates, juso_row_count = load_address_candidates(args.juso, residential)
    points, vworld_row_count = load_building_points(args.vworld, set(candidates))
    override_points, override_sources = load_coordinate_overrides(
        args.coordinate_overrides
    )
    points.update(
        {
            pnu: point
            for pnu, point in override_points.items()
            if pnu in candidates and pnu not in points
        }
    )
    candidates = {pnu: item for pnu, item in candidates.items() if pnu in points}
    by_zone = assign_points_to_zones(points, geometries)

    by_current_code: dict[str, list[str]] = defaultdict(list)
    for pnu, candidate in candidates.items():
        if pnu in points:
            by_current_code[candidate.juso_admin_dong_code].append(pnu)

    anchors: list[dict[str, Any]] = []
    codes_by_zone: dict[str, list[str]] = defaultdict(list)
    for code, row in crosswalk.items():
        codes_by_zone[row["geometry_zone_id"]].append(code)

    for zone_id in sorted(codes_by_zone):
        zone_codes = sorted(codes_by_zone[zone_id])
        zone_available = {
            pnu for pnu in by_zone.get(zone_id, []) if pnu in candidates
        }
        for code in zone_codes:
            dong = current_dongs[code]
            mapping = crosswalk[code]
            direct = [
                pnu for pnu in by_current_code.get(code, []) if pnu in zone_available
            ]
            available = direct or list(zone_available)
            if not available:
                available = list(by_current_code.get(code, []))
            available = sorted(
                set(available),
                key=lambda pnu: stable_key(args.seed, code, pnu),
            )
            if not available:
                raise ValueError(
                    f"dong {code} / zone {zone_id} has no residential address anchor"
                )
            required = allocation[code]
            for index in range(1, allocation[code] + 1):
                pnu = available[(index - 1) % len(available)]
                candidate = candidates[pnu]
                longitude, latitude = points[pnu]
                anchors.append(
                    {
                        "anchor_id": f"SYN-ADDR-{code}-{index:04d}",
                        "synthetic": True,
                        "not_real_resident": True,
                        "reference_pnu": pnu,
                        "road_address": candidate.road_address,
                        "building_name": candidate.building_name,
                        "legal_dong_name": candidate.legal_dong_name,
                        "main_use_names": list(candidate.main_use_names),
                        "apartment_reference": candidate.apartment_reference,
                        "residential_building_reference": True,
                        "longitude": longitude,
                        "latitude": latitude,
                        "geometry_zone_id": zone_id,
                        "current_admin_dong_code_20260701": code,
                        "current_admin_dong_name_20260701": dong["dong_name_20260701"],
                        "current_district_name_20260701": dong[
                            "district_name_20260701"
                        ],
                        "geometry_resolution": {
                            "unique_normalized_name": "exact_2025_geometry_zone",
                            "post_snapshot_split_aggregate": (
                                "shared_pre_reform_2025_geometry_zone"
                            ),
                            "branch_office_parent_aggregate": (
                                "shared_parent_2025_geometry_zone"
                            ),
                        }.get(
                            mapping["mapping_method"],
                            "shared_2025_geometry_zone",
                        ),
                        "mapping_method": mapping["mapping_method"],
                        "juso_admin_dong_code": candidate.juso_admin_dong_code,
                        "juso_admin_dong_name": candidate.juso_admin_dong_name,
                        "address_source": ADDRESS_SOURCE,
                        "coordinate_source": override_sources.get(
                            pnu, COORDINATE_SOURCE
                        ),
                        "residential_classification_sources": list(
                            candidate.residential_classification_sources
                        ),
                        "zone_unique_anchor_count": len(available),
                        "address_reused_within_zone": required > len(available),
                    }
                )

    anchors.sort(key=lambda row: row["anchor_id"])
    if len(anchors) != args.total_cases:
        raise ValueError("generated anchor count does not match requested total")
    return {
        "schema_version": "synthetic-residential-address-anchors-v1.0.0",
        "synthetic": True,
        "not_real_resident": True,
        "interpretation": (
            "공개 주거건물 주소·대표좌표에 합성 연락업무를 배치하기 위한 기준점이며 "
            "해당 주소의 실제 주민 속성이나 위험을 뜻하지 않는다."
        ),
        "allocation_method": (
            "2026-07-31 행정동별 65세 이상 1인세대 관측 수 비례, "
            "고정 총량 5869건, 최대나머지 방식"
        ),
        "case_count": len(anchors),
        "current_admin_dong_count": len(allocation),
        "geometry_zone_count": len(geometries),
        "apartment_reference_count": sum(
            1 for anchor in anchors if anchor["apartment_reference"]
        ),
        "unique_reference_pnu_count": len(
            {anchor["reference_pnu"] for anchor in anchors}
        ),
        "reused_case_anchor_count": sum(
            1 for anchor in anchors if anchor["address_reused_within_zone"]
        ),
        "sources": {
            "demographics": {
                "path": display_path(args.demographics),
                "sha256": sha256_file(args.demographics),
            },
            "juso": {
                "path": display_path(args.juso),
                "sha256": sha256_file(args.juso),
            },
            "housing": {
                "path": display_path(args.housing),
                "sha256": sha256_file(args.housing),
            },
            "vworld": {
                "path": display_path(args.vworld),
                "sha256": sha256_file(args.vworld),
            },
            "coordinate_overrides": {
                "path": display_path(args.coordinate_overrides),
                "sha256": sha256_file(args.coordinate_overrides),
            },
            "juso_source_row_count": juso_row_count,
            "vworld_polygon_row_count": vworld_row_count,
        },
        "anchors": anchors,
    }


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--current-dongs",
        type=Path,
        default=root / "data/processed/admin_dongs_incheon_20260701.csv",
    )
    parser.add_argument(
        "--demographics",
        type=Path,
        default=root / "data/processed/demographics_admin_dong_202607.csv",
    )
    parser.add_argument(
        "--crosswalk",
        type=Path,
        default=root
        / "data/processed/boundary_current_to_geometry_crosswalk_20260701.csv",
    )
    parser.add_argument(
        "--geometry",
        type=Path,
        default=root / "public/data/admin-dongs.geojson",
    )
    parser.add_argument(
        "--juso",
        type=Path,
        default=root / "data/raw/address/juso_building_db_202607.zip",
    )
    parser.add_argument(
        "--housing",
        type=Path,
        default=root / "data/processed/housing_building_age_records.csv.gz",
    )
    parser.add_argument(
        "--vworld",
        type=Path,
        default=root
        / "data/raw/housing/vworld_incheon_building_integrated_20260809.zip",
    )
    parser.add_argument(
        "--coordinate-overrides",
        type=Path,
        default=root / "data/raw/address/residential_coordinate_overrides.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=root / "public/data/synthetic-residential-address-anchors.json",
    )
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--total-cases", type=int, default=TOTAL_CASES)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = build_payload(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(json_bytes(payload))
    print(
        json.dumps(
            {
                "output": str(args.output),
                "cases": payload["case_count"],
                "apartments": payload["apartment_reference_count"],
                "sha256": sha256_file(args.output),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
