#!/usr/bin/env python3
"""Generate deterministic, privacy-safe CareOps demo inputs for all Incheon dongs.

The output records are workload fixtures for contact queues, deterministic rule
graphs, and conditional approved-visit planning. They are not synthetic people,
estimated residents, inferred beneficiaries, or risk predictions. No names,
addresses, phone numbers, or real household coordinates are used.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import sys
import tempfile
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


SCHEMA_VERSION = "2.0.0"
GENERATOR_VERSION = 2
DEFAULT_SEED = 20_260_812
DEFAULT_SCENARIO_DATE = "2026-08-12"
OUTPUT_FILES = (
    "synthetic-workers.json",
    "synthetic-households.json",
    "synthetic-care-ops-manifest.json",
)
FORBIDDEN_KEYS = {
    "risk",
    "risk_score",
    "high_risk",
    "care_gap_score",
    "beneficiary_status",
    "unserved",
    "non_recipient",
}
TIME_WINDOWS = (
    ("09:00", "11:30"),
    ("10:00", "13:00"),
    ("13:00", "15:30"),
    ("14:30", "17:00"),
    ("09:00", "17:00"),
)
CONTACT_CADENCE_DAYS = (3, 7, 14)
CONTACT_DATE_OFFSETS = (-2, -1, 0, 1, 3)
WORKER_WINDOWS = (
    ("09:00", "13:00"),
    ("09:00", "17:00"),
    ("10:00", "16:00"),
    ("13:00", "17:00"),
)


class BuildError(RuntimeError):
    """Raised when an input or generated-output invariant is violated."""


def read_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read JSON {path}: {exc}") from exc


def read_csv(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))
    except OSError as exc:
        raise BuildError(f"cannot read CSV {path}: {exc}") from exc


def json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def stable_int(seed: int, *parts: object) -> int:
    material = "|".join([str(seed), *(str(part) for part in parts)]).encode("utf-8")
    return int.from_bytes(hashlib.sha256(material).digest()[:8], "big")


def stable_rng(seed: int, *parts: object) -> random.Random:
    return random.Random(stable_int(seed, *parts))


def ring_area(ring: Sequence[Sequence[float]]) -> float:
    area = 0.0
    previous = ring[-1]
    for current in ring:
        area += previous[0] * current[1] - current[0] * previous[1]
        previous = current
    return abs(area) / 2.0


def point_in_ring(longitude: float, latitude: float, ring: Sequence[Sequence[float]]) -> bool:
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = previous[:2]
        x2, y2 = current[:2]
        crosses = (y1 > latitude) != (y2 > latitude)
        if crosses:
            cross_x = (x2 - x1) * (latitude - y1) / (y2 - y1) + x1
            if longitude < cross_x:
                inside = not inside
        previous = current
    return inside


def geometry_polygons(geometry: Mapping[str, Any]) -> list[list[list[list[float]]]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, list):
        return [coordinates]
    if geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        return coordinates
    raise BuildError(f"unsupported geometry type: {geometry_type!r}")


def point_in_geometry(longitude: float, latitude: float, geometry: Mapping[str, Any]) -> bool:
    for polygon in geometry_polygons(geometry):
        if not point_in_ring(longitude, latitude, polygon[0]):
            continue
        if any(point_in_ring(longitude, latitude, hole) for hole in polygon[1:]):
            continue
        return True
    return False


def choose_polygon(
    polygons: Sequence[list[list[list[float]]]], rng: random.Random
) -> list[list[list[float]]]:
    weights = [
        max(ring_area(polygon[0]) - sum(ring_area(hole) for hole in polygon[1:]), 0.0)
        for polygon in polygons
    ]
    if not any(weights):
        raise BuildError("geometry contains no positive-area polygon")
    target = rng.random() * sum(weights)
    cumulative = 0.0
    for polygon, weight in zip(polygons, weights):
        cumulative += weight
        if target <= cumulative:
            return polygon
    return polygons[-1]


def sample_point(
    geometry: Mapping[str, Any],
    fallback: tuple[float, float],
    rng: random.Random,
) -> tuple[float, float]:
    polygons = geometry_polygons(geometry)
    for _ in range(4_000):
        polygon = choose_polygon(polygons, rng)
        exterior = polygon[0]
        longitudes = [coordinate[0] for coordinate in exterior]
        latitudes = [coordinate[1] for coordinate in exterior]
        longitude = rng.uniform(min(longitudes), max(longitudes))
        latitude = rng.uniform(min(latitudes), max(latitudes))
        if point_in_geometry(longitude, latitude, geometry):
            return round(longitude, 7), round(latitude, 7)
    if point_in_geometry(fallback[0], fallback[1], geometry):
        return round(fallback[0], 7), round(fallback[1], 7)
    raise BuildError("unable to sample a point inside geometry")


def geometry_resolution(map_unit_status: str) -> str:
    return {
        "exact": "exact_2025_geometry_zone",
        "aggregated_split": "shared_pre_reform_2025_geometry_zone",
        "parent_with_branch_office": "shared_parent_2025_geometry_zone",
    }.get(map_unit_status, "shared_2025_geometry_zone")


def load_admin_contract(
    current_dongs_path: Path,
    crosswalk_path: Path,
    geometry_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    current_rows = read_csv(current_dongs_path)
    crosswalk_rows = read_csv(crosswalk_path)
    geometry_payload = read_json(geometry_path)
    features = geometry_payload.get("features", [])

    if len(current_rows) != 162:
        raise BuildError(f"expected 162 current admin dongs, got {len(current_rows)}")
    if len(crosswalk_rows) != 162:
        raise BuildError(f"expected 162 crosswalk rows, got {len(crosswalk_rows)}")
    if len(features) != 156:
        raise BuildError(f"expected 156 geometry zones, got {len(features)}")

    current_by_code = {
        row["admin_dong_code_20260701"]: row for row in current_rows
    }
    crosswalk_by_code = {
        row["current_admin_dong_code_20260701"]: row for row in crosswalk_rows
    }
    if set(current_by_code) != set(crosswalk_by_code):
        raise BuildError("current-dong and crosswalk code sets differ")

    geometry_by_id: dict[str, dict[str, Any]] = {}
    for feature in features:
        properties = feature.get("properties", {})
        geometry_zone_id = properties.get("geometry_zone_id")
        if not isinstance(geometry_zone_id, str) or not geometry_zone_id:
            raise BuildError("geometry feature missing geometry_zone_id")
        if geometry_zone_id in geometry_by_id:
            raise BuildError(f"duplicate geometry_zone_id: {geometry_zone_id}")
        geometry_by_id[geometry_zone_id] = feature
    if len(geometry_by_id) != 156:
        raise BuildError("geometry zone identifiers are not unique")

    admin_contract: list[dict[str, Any]] = []
    for code in sorted(current_by_code):
        current = current_by_code[code]
        crosswalk = crosswalk_by_code[code]
        geometry_zone_id = crosswalk["geometry_zone_id"]
        feature = geometry_by_id.get(geometry_zone_id)
        if feature is None:
            raise BuildError(f"crosswalk geometry zone not found: {geometry_zone_id}")
        properties = feature["properties"]
        admin_contract.append(
            {
                "code": code,
                "district": current["district_name_20260701"],
                "dong": current["dong_name_20260701"],
                "geometry_zone_id": geometry_zone_id,
                "mapping_method": crosswalk["mapping_method"],
                "map_unit_status": properties["map_unit_status"],
                "geometry_resolution": geometry_resolution(properties["map_unit_status"]),
                "representative_point": (
                    float(properties["representative_longitude"]),
                    float(properties["representative_latitude"]),
                ),
            }
        )
    return admin_contract, geometry_by_id


def make_location(
    admin: Mapping[str, Any], longitude: float, latitude: float
) -> dict[str, Any]:
    return {
        "longitude": longitude,
        "latitude": latitude,
        "geometry_zone_id": admin["geometry_zone_id"],
        "current_admin_dong_code_20260701": admin["code"],
        "current_admin_dong_name_20260701": admin["dong"],
        "current_district_name_20260701": admin["district"],
        "geometry_resolution": admin["geometry_resolution"],
        "mapping_method": admin["mapping_method"],
        "spatial_basis": "synthetic_point_within_2025_geometry_zone",
    }


def worker_record(
    admin: Mapping[str, Any],
    feature: Mapping[str, Any],
    city_index: int,
    seed: int,
) -> dict[str, Any]:
    code = admin["code"]
    rng = stable_rng(seed, "worker", code)
    longitude, latitude = sample_point(
        feature["geometry"], admin["representative_point"], rng
    )
    window_start, window_end = WORKER_WINDOWS[stable_int(seed, code, "window") % len(WORKER_WINDOWS)]
    travel_pattern = stable_int(seed, code, "travel") % 4
    travel_modes = (
        ["walking", "public_transit"]
        if travel_pattern in {0, 1}
        else (["car", "walking"] if travel_pattern == 2 else ["walking"])
    )
    return {
        "id": f"SYN-W-{code}-01",
        "synthetic": True,
        "display_name": f"연결단원 {city_index:03d}",
        "role": "neighbor_connector",
        "location": make_location(admin, longitude, latitude),
        "constraints": {
            "stairs_allowed": stable_int(seed, code, "stairs") % 7 != 0,
            "available_time_window": {"start": window_start, "end": window_end},
            "max_daily_approved_visits": 2 + stable_int(seed, code, "visits") % 4,
            "assigned_admin_dong_codes_20260701": [code],
            "travel_modes": travel_modes,
        },
        "matching_profile": {
            "gender_for_preference_matching": ("female", "male", "not_specified")[
                stable_int(seed, code, "gender") % 3
            ]
        },
        "workflow": {"availability_status": "available"},
    }


def iso_date(value: date) -> str:
    return value.isoformat()


def contact_state(
    code: str,
    dong_index: int,
    seed: int,
    scenario_day: date,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build a deterministic contact snapshot without pre-authorizing a visit."""

    cadence_days = CONTACT_CADENCE_DAYS[
        stable_int(seed, code, dong_index, "cadence") % len(CONTACT_CADENCE_DAYS)
    ]
    next_offset = CONTACT_DATE_OFFSETS[
        stable_int(seed, code, dong_index, "next_contact") % len(CONTACT_DATE_OFFSETS)
    ]
    preferred_contact_method = (
        "visit" if stable_int(seed, code, dong_index, "contact_method") % 10 == 0 else "phone"
    )
    profile = stable_int(seed, code, dong_index, "contact_history") % 5

    # Every dong gets one deterministic RED/GREEN demo candidate: a due phone
    # task with one prior unanswered attempt. The second no-answer is applied by
    # the rule engine, not precomputed by this generator.
    if dong_index == 1:
        preferred_contact_method = "phone"
        next_offset = 0
        profile = 2

    next_contact_day = scenario_day + timedelta(days=next_offset)
    last_contact_day: date | None = None
    last_contact_result = "not_attempted"
    consecutive_no_answer_count = 0
    follow_up_deadline: str | None = None
    follow_up_status = "none"

    if profile == 1:
        last_contact_day = scenario_day - timedelta(days=cadence_days)
        last_contact_result = "connected_ok"
    elif profile == 2:
        last_contact_day = scenario_day - timedelta(days=1)
        last_contact_result = "no_answer"
        consecutive_no_answer_count = 1
        follow_up_deadline = iso_date(next_contact_day)
        follow_up_status = "required"
    elif profile == 3:
        last_contact_day = scenario_day - timedelta(days=2)
        last_contact_result = "connected_concern"
        follow_up_deadline = iso_date(next_contact_day)
        follow_up_status = "required"
    elif profile == 4:
        last_contact_day = scenario_day - timedelta(days=1)
        last_contact_result = "refused"
        follow_up_deadline = iso_date(next_contact_day)
        follow_up_status = "required"

    return (
        {
            "next_contact_date": iso_date(next_contact_day),
            "preferred_contact_method": preferred_contact_method,
            "contact_cadence_days": cadence_days,
            "last_contact_date": (
                iso_date(last_contact_day) if last_contact_day is not None else None
            ),
            "last_contact_result": last_contact_result,
            "consecutive_no_answer_count": consecutive_no_answer_count,
        },
        {
            "follow_up_deadline": follow_up_deadline,
            "follow_up_status": follow_up_status,
            "visit_approval_status": None,
            "transfer_status": "not_required",
            "visit_decision": None,
        },
    )


def household_record(
    admin: Mapping[str, Any],
    feature: Mapping[str, Any],
    dong_index: int,
    seed: int,
    scenario_day: date,
) -> dict[str, Any]:
    code = admin["code"]
    household_id = f"SYN-HH-{code}-{dong_index:04d}"
    rng = stable_rng(seed, "household", code, dong_index)
    longitude, latitude = sample_point(
        feature["geometry"], admin["representative_point"], rng
    )
    contact, workflow = contact_state(code, dong_index, seed, scenario_day)
    window_start, window_end = TIME_WINDOWS[
        stable_int(seed, code, dong_index, "time") % len(TIME_WINDOWS)
    ]
    stairs_present = stable_int(seed, code, dong_index, "stairs") % 4 == 0
    requires_two = stable_int(seed, code, dong_index, "pair") % 11 == 0
    requires_official = stable_int(seed, code, dong_index, "official") % 19 == 0
    if requires_official:
        requires_two = True
    return {
        "id": household_id,
        "synthetic": True,
        "location": make_location(admin, longitude, latitude),
        "contact": contact,
        "visit_context": {
            "preferred_visit_time_window": {"start": window_start, "end": window_end},
            "preferred_worker_gender": ("any", "female", "male")[
                stable_int(seed, code, dong_index, "preference") % 3
            ],
            "stairs_present": stairs_present,
            "service_duration_minutes": (20, 30, 40, 60)[
                stable_int(seed, code, dong_index, "duration") % 4
            ],
            "requires_two_person_team": requires_two,
            "requires_public_official_companion": requires_official,
        },
        "workflow": workflow,
        "approved_visit_constraints": None,
    }


def build_datasets(
    admin_contract: Sequence[Mapping[str, Any]],
    geometry_by_id: Mapping[str, Mapping[str, Any]],
    seed: int,
    scenario_date: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        scenario_day = date.fromisoformat(scenario_date)
    except ValueError as exc:
        raise BuildError(f"scenario date must be YYYY-MM-DD: {scenario_date!r}") from exc
    workers: list[dict[str, Any]] = []
    households: list[dict[str, Any]] = []
    for city_index, admin in enumerate(admin_contract, start=1):
        feature = geometry_by_id[admin["geometry_zone_id"]]
        workers.append(worker_record(admin, feature, city_index, seed))
        household_count = 20 + stable_int(seed, admin["code"], "household_count") % 31
        for dong_index in range(1, household_count + 1):
            households.append(
                household_record(admin, feature, dong_index, seed, scenario_day)
            )

    shared_spatial_contract = {
        "current_admin_reference_date": "2026-07-01",
        "geometry_reference_date": "2025-06-30",
        "current_admin_dong_count": 162,
        "geometry_zone_count": 156,
        "note": (
            "운서1·2동, 아라1·2동과 4개 출장소는 현재 경계가 아니라 공유하는 "
            "2025 공간구역 안에 합성 좌표를 생성한다."
        ),
    }
    common = {
        "schema_version": SCHEMA_VERSION,
        "synthetic": True,
        "scenario_reference_date": scenario_date,
        "seed": seed,
        "guardrail": (
            "합성 운영업무이며 실제 주민·수급자·고립자·고독사 위험자 또는 미수혜자 추정치가 아니다."
        ),
        "spatial_contract": shared_spatial_contract,
    }
    worker_payload = {
        **common,
        "dataset_id": "incheon-care-ops-synthetic-workers-v2",
        "workers": workers,
    }
    household_payload = {
        **common,
        "dataset_id": "incheon-care-ops-synthetic-households-v2",
        "households": households,
    }
    return worker_payload, household_payload


def iter_keys(value: Any) -> Iterable[str]:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            yield str(key)
            yield from iter_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from iter_keys(nested)


def validate_datasets(
    worker_payload: Mapping[str, Any],
    household_payload: Mapping[str, Any],
    admin_contract: Sequence[Mapping[str, Any]],
    geometry_by_id: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    workers = worker_payload["workers"]
    households = household_payload["households"]
    current_codes = {admin["code"] for admin in admin_contract}
    worker_codes = {
        worker["location"]["current_admin_dong_code_20260701"] for worker in workers
    }
    household_counts = Counter(
        household["location"]["current_admin_dong_code_20260701"]
        for household in households
    )
    scenario_date = household_payload["scenario_reference_date"]
    due_contact_tasks = [
        household
        for household in households
        if household["contact"]["next_contact_date"] <= scenario_date
    ]
    future_contact_tasks = [
        household
        for household in households
        if household["contact"]["next_contact_date"] > scenario_date
    ]
    phone_tasks = [
        household
        for household in households
        if household["contact"]["preferred_contact_method"] == "phone"
    ]
    coordinates_inside = True
    for record in [*workers, *households]:
        location = record["location"]
        geometry = geometry_by_id[location["geometry_zone_id"]]["geometry"]
        if not point_in_geometry(location["longitude"], location["latitude"], geometry):
            coordinates_inside = False
            break
    forbidden = FORBIDDEN_KEYS.intersection(
        [*iter_keys(worker_payload), *iter_keys(household_payload)]
    )
    checks = {
        "schema_versions_match": (
            worker_payload["schema_version"]
            == household_payload["schema_version"]
            == SCHEMA_VERSION
        ),
        "all_records_marked_synthetic": all(
            record["synthetic"] is True for record in [*workers, *households]
        ),
        "one_worker_per_current_admin_dong": (
            len(workers) == 162 and worker_codes == current_codes
        ),
        "household_buckets_cover_162_current_admin_dongs": (
            set(household_counts) == current_codes
        ),
        "household_count_per_dong_between_20_and_50": all(
            20 <= household_counts[code] <= 50 for code in current_codes
        ),
        "due_and_future_contact_tasks_exist": bool(
            due_contact_tasks and future_contact_tasks
        ),
        "every_dong_has_due_phone_retry_candidate": all(
            any(
                household["location"]["current_admin_dong_code_20260701"] == code
                and household["contact"]["preferred_contact_method"] == "phone"
                and household["contact"]["next_contact_date"] <= scenario_date
                and household["contact"]["last_contact_result"] == "no_answer"
                and household["contact"]["consecutive_no_answer_count"] == 1
                for household in households
            )
            for code in current_codes
        ),
        "worker_ids_unique": len({worker["id"] for worker in workers}) == len(workers),
        "household_ids_unique": (
            len({household["id"] for household in households}) == len(households)
        ),
        "coordinates_inside_declared_geometry_zones": coordinates_inside,
        "no_forbidden_person_risk_or_beneficiary_keys": not forbidden,
        "no_visit_is_preapproved_by_fixture_generation": all(
            household["workflow"]["visit_approval_status"] is None
            and household["workflow"]["visit_decision"] is None
            and household["approved_visit_constraints"] is None
            for household in households
        ),
        "route_distance_only_exists_after_explicit_approval": all(
            "max_route_distance_km" not in worker["constraints"]
            for worker in workers
        ),
        "official_companion_tasks_require_two_person_team": all(
            household["visit_context"]["requires_two_person_team"] is True
            for household in households
            if household["visit_context"]["requires_public_official_companion"] is True
        ),
    }
    if not all(checks.values()):
        failures = [name for name, passed in checks.items() if not passed]
        raise BuildError(f"synthetic dataset validation failed: {failures}")
    return {
        "status": "pass",
        "checks": checks,
        "counts": {
            "workers": len(workers),
            "households": len(households),
            "current_admin_dongs": len(current_codes),
            "geometry_zones": len(geometry_by_id),
            "households_per_dong_min": min(household_counts.values()),
            "households_per_dong_max": max(household_counts.values()),
            "due_contact_tasks": len(due_contact_tasks),
            "future_contact_tasks": len(future_contact_tasks),
            "phone_preferred_tasks": len(phone_tasks),
            "visit_preferred_tasks": len(households) - len(phone_tasks),
            "approved_visit_tasks": 0,
        },
    }


def write_outputs(
    output_dir: Path,
    worker_payload: Mapping[str, Any],
    household_payload: Mapping[str, Any],
    validation: Mapping[str, Any],
) -> dict[str, str]:
    worker_bytes = json_bytes(worker_payload)
    household_bytes = json_bytes(household_payload)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generator_version": GENERATOR_VERSION,
        "dataset_id": "incheon-care-ops-synthetic-scenario-v2",
        "synthetic": True,
        "scenario_reference_date": worker_payload["scenario_reference_date"],
        "seed": worker_payload["seed"],
        **validation,
        "outputs": {
            "synthetic-workers.json": {
                "record_count": len(worker_payload["workers"]),
                "schema": "data/schemas/synthetic-worker.schema.json",
                "sha256": sha256_bytes(worker_bytes),
            },
            "synthetic-households.json": {
                "record_count": len(household_payload["households"]),
                "schema": "data/schemas/synthetic-household.schema.json",
                "sha256": sha256_bytes(household_bytes),
            },
        },
        "usage": {
            "ui": "전화 안부 큐·연락결과·후속조치·방문권고 상태 프로토타입 입력",
            "rules": "미응답·기한 검사는 결정론적 규칙으로 수행하며 방문을 자동 승인하지 않음",
            "conditional_routing": "담당자가 approved로 명시 승인한 예외 방문만 향후 경로 후보로 사용",
            "not_for": "개인 위험·복지 적격성·미수혜자·실제 업무량 추정",
        },
    }
    payloads = {
        "synthetic-workers.json": worker_bytes,
        "synthetic-households.json": household_bytes,
        "synthetic-care-ops-manifest.json": json_bytes(manifest),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, payload in payloads.items():
        (output_dir / name).write_bytes(payload)
    return {name: sha256_bytes(payload) for name, payload in payloads.items()}


def build(
    current_dongs_path: Path,
    crosswalk_path: Path,
    geometry_path: Path,
    output_dir: Path,
    seed: int,
    scenario_date: str,
) -> dict[str, str]:
    admin_contract, geometry_by_id = load_admin_contract(
        current_dongs_path, crosswalk_path, geometry_path
    )
    worker_payload, household_payload = build_datasets(
        admin_contract, geometry_by_id, seed, scenario_date
    )
    validation = validate_datasets(
        worker_payload, household_payload, admin_contract, geometry_by_id
    )
    return write_outputs(output_dir, worker_payload, household_payload, validation)


def check_existing(args: argparse.Namespace) -> dict[str, str]:
    with tempfile.TemporaryDirectory(prefix="care-ops-synthetic-check-") as temporary:
        generated = Path(temporary)
        hashes = build(
            args.current_dongs,
            args.crosswalk,
            args.geometry,
            generated,
            args.seed,
            args.scenario_date,
        )
        mismatches: list[str] = []
        for name in OUTPUT_FILES:
            existing = args.output_dir / name
            if not existing.is_file():
                mismatches.append(f"missing {existing}")
            elif existing.read_bytes() != (generated / name).read_bytes():
                mismatches.append(f"stale or non-deterministic {existing}")
        if mismatches:
            raise BuildError("synthetic data check failed:\n- " + "\n- ".join(mismatches))
        return hashes


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--current-dongs",
        type=Path,
        default=repo_root / "data" / "processed" / "admin_dongs_incheon_20260701.csv",
    )
    parser.add_argument(
        "--crosswalk",
        type=Path,
        default=(
            repo_root
            / "data"
            / "processed"
            / "boundary_current_to_geometry_crosswalk_20260701.csv"
        ),
    )
    parser.add_argument(
        "--geometry",
        type=Path,
        default=repo_root / "public" / "data" / "admin-dongs.geojson",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=repo_root / "public" / "data"
    )
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--scenario-date", default=DEFAULT_SCENARIO_DATE)
    parser.add_argument(
        "--check",
        action="store_true",
        help="regenerate in a temporary directory and compare committed outputs",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        hashes = (
            check_existing(args)
            if args.check
            else build(
                args.current_dongs,
                args.crosswalk,
                args.geometry,
                args.output_dir,
                args.seed,
                args.scenario_date,
            )
        )
    except BuildError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    for name in OUTPUT_FILES:
        print(f"{name}\t{hashes[name]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
