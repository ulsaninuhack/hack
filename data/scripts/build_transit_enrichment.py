#!/usr/bin/env python3
"""Build defensible bus-route and stop-usage enrichment tables.

The route and ridership sources do not share the master stop ID.  A source row
is linked only when ``stop number + normalized stop name`` identifies exactly
one row in the normalized bus-stop master.  A stop number on its own is never
used to impute a link: unmatched and ambiguous rows remain in the full outputs
and are also exposed in issue tables.

The ridership source contains monthly boarding/alighting event counts.  Those
counts are not unique people and this pipeline never labels them as such.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable, Sequence


PROJECT_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_DIR / "raw" / "transit"
PROCESSED_DIR = PROJECT_DIR / "processed"

MASTER_SOURCE = PROCESSED_DIR / "transit_bus_stops.csv"
ROUTE_SOURCE = RAW_DIR / "route_bus_route_stop_sequence_20251231.csv"
USAGE_SOURCE = RAW_DIR / "ridership_bus_stop_usage_20260630.csv"

ROUTE_LINK_OUTPUT = PROCESSED_DIR / "transit_route_stops.csv"
ROUTE_SUPPLY_OUTPUT = PROCESSED_DIR / "transit_route_stops_supply.csv"
ROUTE_ISSUES_OUTPUT = PROCESSED_DIR / "transit_route_stops_issues.csv"
USAGE_OUTPUT = PROCESSED_DIR / "transit_stop_usage.csv"
USAGE_POINTS_OUTPUT = PROCESSED_DIR / "transit_stop_usage_points.csv"
USAGE_ISSUES_OUTPUT = PROCESSED_DIR / "transit_stop_usage_issues.csv"
VALIDATION_OUTPUT = PROCESSED_DIR / "transit_enrichment_validation.json"

ROUTE_EXPECTED_FIELDS = [
    "기준일자",
    "회사명",
    "회사아이디",
    "노선번호",
    "노선아이디",
    "순번",
    "정류소명",
    "정류소번호",
    "아이에스씨 아이디",
    "정류소구간거리",
    "정류소간누적거리",
    "주요경유지여부",
    "상_하행",
]

USAGE_EXPECTED_FIELDS = [
    "정류장명",
    "정류장 번호",
    "승차인원수",
    "하차인원수",
    "승차인원수(카드)",
    "하차인원수(카드)",
    "승차인원수(현금)",
    "일평균 승하차인원수",
]

MASTER_EXPECTED_FIELDS = [
    "source_date",
    "mode",
    "place_id",
    "source_id",
    "source_code",
    "name",
    "source_district",
    "district",
    "dong",
    "admin_dong_code",
    "latitude",
    "longitude",
    "coordinate_status",
    "in_incheon",
]

ROUTE_LINK_FIELDS = [
    "source_data_row",
    "source_date",
    "company_name",
    "company_id",
    "route_number",
    "route_id",
    "sequence",
    "source_stop_name",
    "source_stop_number",
    "source_isc_id",
    "segment_distance_m",
    "cumulative_distance_m",
    "major_via_flag",
    "direction",
    "normalized_stop_name",
    "stop_match_key",
    "match_status",
    "match_candidate_count",
    "same_number_candidate_count",
    "candidate_place_ids",
    "candidate_names",
    "place_id",
    "master_source_id",
    "master_source_date",
    "master_stop_name",
    "source_district",
    "district",
    "dong",
    "latitude",
    "longitude",
    "coordinate_status",
    "valid_wgs84",
    "in_incheon",
    "point_status",
]

ROUTE_SUPPLY_FIELDS = [
    "source_stop_number",
    "source_stop_name",
    "normalized_stop_name",
    "stop_match_key",
    "match_status",
    "match_candidate_count",
    "same_number_candidate_count",
    "candidate_place_ids",
    "candidate_names",
    "place_id",
    "master_source_id",
    "master_stop_name",
    "source_district",
    "district",
    "dong",
    "latitude",
    "longitude",
    "coordinate_status",
    "valid_wgs84",
    "in_incheon",
    "point_status",
    "source_dates",
    "route_row_count",
    "distinct_route_count",
    "distinct_route_number_count",
    "distinct_route_direction_count",
    "distinct_direction_count",
    "directions",
    "route_ids",
    "route_numbers",
    "major_via_yes_row_count",
]

USAGE_FIELDS = [
    "source_data_row",
    "reference_date",
    "reference_date_provenance",
    "source_stop_name",
    "source_stop_number",
    "normalized_stop_name",
    "stop_match_key",
    "boardings",
    "alightings",
    "boardings_card",
    "alightings_card",
    "boardings_cash",
    "total_board_alightings",
    "daily_average_board_alightings_reported",
    "match_status",
    "match_candidate_count",
    "same_number_candidate_count",
    "candidate_place_ids",
    "candidate_names",
    "place_id",
    "master_source_id",
    "master_source_date",
    "master_stop_name",
    "source_district",
    "district",
    "dong",
    "latitude",
    "longitude",
    "coordinate_status",
    "valid_wgs84",
    "in_incheon",
    "point_status",
]

USAGE_REFERENCE_DATE = "2026-06-30"
USAGE_REFERENCE_DATE_PROVENANCE = "portal_metadata_and_filename_not_record_field"


def cleaned(value: object) -> str:
    return "" if value is None else str(value).strip()


def normalize_identifier(value: object) -> str:
    """Normalize width and surrounding whitespace without changing identity."""
    return unicodedata.normalize("NFKC", cleaned(value))


def normalize_stop_name(value: object) -> str:
    """Normalize width/case and ignore whitespace/punctuation only.

    The retained characters must be alphanumeric.  This deliberately does not
    perform fuzzy matching, synonym expansion, suffix removal, or rename rules.
    """
    normalized = unicodedata.normalize("NFKC", cleaned(value)).casefold()
    return "".join(character for character in normalized if character.isalnum())


def stop_key(stop_number: str, stop_name: str) -> tuple[str, str]:
    return normalize_identifier(stop_number), normalize_stop_name(stop_name)


def stop_key_text(key: tuple[str, str]) -> str:
    return f"{key[0]}|{key[1]}"


def parse_nonnegative_int(value: object, field: str, row_number: int) -> int:
    text = cleaned(value)
    if not re.fullmatch(r"\d+", text):
        raise ValueError(f"{field} must be a non-negative integer at data row {row_number}: {text!r}")
    return int(text)


def parse_optional_nonnegative_int(value: object, field: str, row_number: int) -> int | None:
    text = cleaned(value)
    if not text:
        return None
    return parse_nonnegative_int(text, field, row_number)


def parse_nonnegative_decimal(value: object, field: str, row_number: int) -> Decimal:
    text = cleaned(value)
    try:
        number = Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f"{field} must be numeric at data row {row_number}: {text!r}") from error
    if not number.is_finite() or number < 0:
        raise ValueError(f"{field} must be finite and non-negative at data row {row_number}: {text!r}")
    return number


def parse_coordinate(value: object) -> float | None:
    text = cleaned(value)
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def valid_wgs84(master: dict[str, str]) -> bool:
    latitude = parse_coordinate(master.get("latitude"))
    longitude = parse_coordinate(master.get("longitude"))
    return (
        latitude is not None
        and longitude is not None
        and -90.0 <= latitude <= 90.0
        and -180.0 <= longitude <= 180.0
    )


def read_csv(path: Path, encoding: str) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding=encoding, newline="") as source:
        reader = csv.DictReader(source)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    bad_width_rows = [
        index
        for index, row in enumerate(rows, start=1)
        if None in row or any(value is None for value in row.values())
    ]
    if bad_width_rows:
        raise ValueError(
            f"Malformed row width in {path.name}; first data rows: {bad_width_rows[:10]}"
        )
    return fields, rows


def require_exact_schema(actual: Sequence[str], expected: Sequence[str], path: Path) -> None:
    if list(actual) != list(expected):
        raise ValueError(
            f"Unexpected schema for {path.name}: expected {list(expected)!r}, got {list(actual)!r}"
        )


def write_csv(path: Path, fields: Sequence[str], rows: Iterable[dict[str, object]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(
            target,
            fieldnames=list(fields),
            extrasaction="raise",
            lineterminator="\n",
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def sorted_join(values: Iterable[str]) -> str:
    return ";".join(sorted({value for value in values if value}))


@dataclass(frozen=True)
class MatchResult:
    status: str
    composite_candidates: tuple[dict[str, str], ...]
    number_candidates: tuple[dict[str, str], ...]

    @property
    def master(self) -> dict[str, str] | None:
        if self.status == "matched":
            return self.composite_candidates[0]
        return None


class MasterIndex:
    def __init__(self, rows: list[dict[str, str]]) -> None:
        self.rows = rows
        self.by_composite: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
        self.by_number: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in rows:
            key = stop_key(row["source_code"], row["name"])
            self.by_composite[key].append(row)
            self.by_number[key[0]].append(row)

    def match(self, source_stop_number: str, source_stop_name: str) -> MatchResult:
        key = stop_key(source_stop_number, source_stop_name)
        composite = tuple(self.by_composite.get(key, ()))
        number = tuple(self.by_number.get(key[0], ()))
        if len(composite) == 1:
            status = "matched"
        elif len(composite) > 1:
            status = "ambiguous"
        else:
            status = "unmatched"
        return MatchResult(status, composite, number)


def match_columns(result: MatchResult) -> dict[str, object]:
    master = result.master
    candidates = result.composite_candidates if result.composite_candidates else result.number_candidates
    is_valid_wgs84 = bool(master and valid_wgs84(master))
    is_incheon = bool(master and master["in_incheon"].lower() == "true")

    if result.status == "matched" and is_valid_wgs84 and is_incheon:
        point_status = "incheon_map_ready"
    elif result.status == "matched" and is_valid_wgs84:
        point_status = "valid_wgs84_outside_incheon_scope"
    elif result.status == "matched":
        point_status = "matched_without_valid_wgs84"
    else:
        point_status = result.status

    return {
        "match_status": result.status,
        "match_candidate_count": len(result.composite_candidates),
        "same_number_candidate_count": len(result.number_candidates),
        "candidate_place_ids": sorted_join(candidate["place_id"] for candidate in candidates),
        "candidate_names": sorted_join(candidate["name"] for candidate in candidates),
        "place_id": master["place_id"] if master else "",
        "master_source_id": master["source_id"] if master else "",
        "master_source_date": master["source_date"] if master else "",
        "master_stop_name": master["name"] if master else "",
        "source_district": master["source_district"] if master else "",
        "district": master["district"] if master else "",
        "dong": master["dong"] if master else "",
        "latitude": master["latitude"] if master else "",
        "longitude": master["longitude"] if master else "",
        "coordinate_status": master["coordinate_status"] if master else "",
        "valid_wgs84": "true" if is_valid_wgs84 else "false",
        "in_incheon": "true" if is_incheon else "false",
        "point_status": point_status,
    }


def build_route_links(
    rows: list[dict[str, str]], master_index: MasterIndex
) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for row_number, source in enumerate(rows, start=1):
        sequence = parse_nonnegative_int(source["순번"], "순번", row_number)
        segment_distance = parse_optional_nonnegative_int(
            source["정류소구간거리"], "정류소구간거리", row_number
        )
        cumulative_distance = parse_optional_nonnegative_int(
            source["정류소간누적거리"], "정류소간누적거리", row_number
        )
        source_stop_number = normalize_identifier(source["정류소번호"])
        source_stop_name = cleaned(source["정류소명"])
        normalized_name = normalize_stop_name(source_stop_name)
        key = (source_stop_number, normalized_name)
        result = master_index.match(source_stop_number, source_stop_name)
        output.append(
            {
                "source_data_row": row_number,
                "source_date": cleaned(source["기준일자"]),
                "company_name": cleaned(source["회사명"]),
                "company_id": normalize_identifier(source["회사아이디"]),
                "route_number": normalize_identifier(source["노선번호"]),
                "route_id": normalize_identifier(source["노선아이디"]),
                "sequence": sequence,
                "source_stop_name": source_stop_name,
                "source_stop_number": source_stop_number,
                "source_isc_id": normalize_identifier(source["아이에스씨 아이디"]),
                "segment_distance_m": "" if segment_distance is None else segment_distance,
                "cumulative_distance_m": "" if cumulative_distance is None else cumulative_distance,
                "major_via_flag": cleaned(source["주요경유지여부"]),
                "direction": cleaned(source["상_하행"]),
                "normalized_stop_name": normalized_name,
                "stop_match_key": stop_key_text(key),
                **match_columns(result),
            }
        )
    return output


def build_route_supply(route_links: list[dict[str, object]]) -> list[dict[str, object]]:
    groups: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in route_links:
        groups[str(row["stop_match_key"])].append(row)

    output: list[dict[str, object]] = []
    for key in sorted(groups):
        rows = groups[key]
        exemplar = rows[0]
        invariant_fields = [
            "source_stop_number",
            "source_stop_name",
            "normalized_stop_name",
            "stop_match_key",
            "match_status",
            "match_candidate_count",
            "same_number_candidate_count",
            "candidate_place_ids",
            "candidate_names",
            "place_id",
            "master_source_id",
            "master_stop_name",
            "source_district",
            "district",
            "dong",
            "latitude",
            "longitude",
            "coordinate_status",
            "valid_wgs84",
            "in_incheon",
            "point_status",
        ]
        for field in invariant_fields:
            if len({str(row[field]) for row in rows}) != 1:
                raise AssertionError(f"Non-invariant {field} in supply group {key}")

        route_ids = {str(row["route_id"]) for row in rows if row["route_id"]}
        route_numbers = {str(row["route_number"]) for row in rows if row["route_number"]}
        directions = {str(row["direction"]) for row in rows if row["direction"]}
        route_directions = {
            (str(row["route_id"]), str(row["direction"]))
            for row in rows
            if row["route_id"]
        }
        output.append(
            {
                **{field: exemplar[field] for field in invariant_fields},
                "source_dates": sorted_join(str(row["source_date"]) for row in rows),
                "route_row_count": len(rows),
                "distinct_route_count": len(route_ids),
                "distinct_route_number_count": len(route_numbers),
                "distinct_route_direction_count": len(route_directions),
                "distinct_direction_count": len(directions),
                "directions": sorted_join(directions),
                "route_ids": sorted_join(route_ids),
                "route_numbers": sorted_join(route_numbers),
                "major_via_yes_row_count": sum(row["major_via_flag"] == "Y" for row in rows),
            }
        )
    return output


def build_usage(
    rows: list[dict[str, str]], master_index: MasterIndex
) -> tuple[list[dict[str, object]], dict[str, int]]:
    output: list[dict[str, object]] = []
    consistency = Counter()
    for row_number, source in enumerate(rows, start=1):
        boardings = parse_nonnegative_int(source["승차인원수"], "승차인원수", row_number)
        alightings = parse_nonnegative_int(source["하차인원수"], "하차인원수", row_number)
        card_boardings = parse_nonnegative_int(
            source["승차인원수(카드)"], "승차인원수(카드)", row_number
        )
        card_alightings = parse_nonnegative_int(
            source["하차인원수(카드)"], "하차인원수(카드)", row_number
        )
        cash_boardings = parse_nonnegative_int(
            source["승차인원수(현금)"], "승차인원수(현금)", row_number
        )
        daily_average = parse_nonnegative_decimal(
            source["일평균 승하차인원수"], "일평균 승하차인원수", row_number
        )
        total = boardings + alightings
        consistency["boarding_card_plus_cash_equal_total"] += (
            card_boardings + cash_boardings == boardings
        )
        consistency["alighting_card_equal_total"] += card_alightings == alightings
        consistency["daily_average_within_0_01_of_30_day_total"] += (
            abs(daily_average - Decimal(total) / Decimal(30)) <= Decimal("0.01")
        )

        source_stop_number = normalize_identifier(source["정류장 번호"])
        source_stop_name = cleaned(source["정류장명"])
        normalized_name = normalize_stop_name(source_stop_name)
        key = (source_stop_number, normalized_name)
        result = master_index.match(source_stop_number, source_stop_name)
        output.append(
            {
                "source_data_row": row_number,
                "reference_date": USAGE_REFERENCE_DATE,
                "reference_date_provenance": USAGE_REFERENCE_DATE_PROVENANCE,
                "source_stop_name": source_stop_name,
                "source_stop_number": source_stop_number,
                "normalized_stop_name": normalized_name,
                "stop_match_key": stop_key_text(key),
                "boardings": boardings,
                "alightings": alightings,
                "boardings_card": card_boardings,
                "alightings_card": card_alightings,
                "boardings_cash": cash_boardings,
                "total_board_alightings": total,
                "daily_average_board_alightings_reported": cleaned(
                    source["일평균 승하차인원수"]
                ),
                **match_columns(result),
            }
        )
    return output, dict(consistency)


def count_duplicate_extras(values: Iterable[object], include_blank: bool = False) -> int:
    counts = Counter(str(value) for value in values if include_blank or str(value))
    return sum(count - 1 for count in counts.values() if count > 1)


def status_counts(rows: Iterable[dict[str, object]], field: str) -> dict[str, int]:
    return dict(sorted(Counter(str(row[field]) for row in rows).items()))


def output_metadata(path: Path, rows: int) -> dict[str, object]:
    return {
        "path": str(path.relative_to(PROJECT_DIR)),
        "rows": rows,
        "sha256": sha256(path),
    }


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    master_fields, master_rows = read_csv(MASTER_SOURCE, "utf-8-sig")
    route_fields, route_rows = read_csv(ROUTE_SOURCE, "cp949")
    usage_fields, usage_rows = read_csv(USAGE_SOURCE, "utf-8-sig")
    require_exact_schema(master_fields, MASTER_EXPECTED_FIELDS, MASTER_SOURCE)
    require_exact_schema(route_fields, ROUTE_EXPECTED_FIELDS, ROUTE_SOURCE)
    require_exact_schema(usage_fields, USAGE_EXPECTED_FIELDS, USAGE_SOURCE)
    if not master_rows or not route_rows or not usage_rows:
        raise ValueError("All three transit inputs must contain data rows")
    if {row["mode"] for row in master_rows} != {"bus"}:
        raise ValueError("Transit stop master must contain bus rows only")
    if {row["기준일자"] for row in route_rows} != {"2025-12-31"}:
        raise ValueError("Route source reference date changed; review before rebuilding")

    master_place_ids = [row["place_id"] for row in master_rows]
    if len(master_place_ids) != len(set(master_place_ids)):
        raise ValueError("Bus master place_id is not unique")
    master_index = MasterIndex(master_rows)

    route_links = build_route_links(route_rows, master_index)
    route_supply = build_route_supply(route_links)
    route_issues = [row for row in route_links if row["match_status"] != "matched"]
    usage, usage_consistency = build_usage(usage_rows, master_index)
    usage_points = [row for row in usage if row["point_status"] == "incheon_map_ready"]
    usage_issues = [row for row in usage if row["point_status"] != "incheon_map_ready"]

    route_link_count = write_csv(ROUTE_LINK_OUTPUT, ROUTE_LINK_FIELDS, route_links)
    route_supply_count = write_csv(ROUTE_SUPPLY_OUTPUT, ROUTE_SUPPLY_FIELDS, route_supply)
    route_issue_count = write_csv(ROUTE_ISSUES_OUTPUT, ROUTE_LINK_FIELDS, route_issues)
    usage_count = write_csv(USAGE_OUTPUT, USAGE_FIELDS, usage)
    usage_points_count = write_csv(USAGE_POINTS_OUTPUT, USAGE_FIELDS, usage_points)
    usage_issue_count = write_csv(USAGE_ISSUES_OUTPUT, USAGE_FIELDS, usage_issues)

    source_usage_totals = {
        "boardings": sum(parse_nonnegative_int(row["승차인원수"], "승차인원수", index) for index, row in enumerate(usage_rows, start=1)),
        "alightings": sum(parse_nonnegative_int(row["하차인원수"], "하차인원수", index) for index, row in enumerate(usage_rows, start=1)),
    }
    source_usage_totals["board_alightings"] = (
        source_usage_totals["boardings"] + source_usage_totals["alightings"]
    )
    output_usage_totals = {
        "boardings": sum(int(row["boardings"]) for row in usage),
        "alightings": sum(int(row["alightings"]) for row in usage),
        "board_alightings": sum(int(row["total_board_alightings"]) for row in usage),
    }
    point_usage_totals = {
        "boardings": sum(int(row["boardings"]) for row in usage_points),
        "alightings": sum(int(row["alightings"]) for row in usage_points),
        "board_alightings": sum(int(row["total_board_alightings"]) for row in usage_points),
    }

    route_match_counts = status_counts(route_links, "match_status")
    usage_match_counts = status_counts(usage, "match_status")
    route_point_counts = status_counts(route_links, "point_status")
    usage_point_counts = status_counts(usage, "point_status")
    supply_route_row_sum = sum(int(row["route_row_count"]) for row in route_supply)

    assertions = {
        "route_source_rows_preserved": route_link_count == len(route_rows),
        "usage_source_rows_preserved": usage_count == len(usage_rows),
        "route_supply_partitions_all_route_rows": supply_route_row_sum == len(route_rows),
        "route_issue_table_exact": route_issue_count == sum(
            count for status, count in route_match_counts.items() if status != "matched"
        ),
        "usage_points_are_incheon_map_ready_only": usage_points_count
        == usage_point_counts.get("incheon_map_ready", 0),
        "usage_issue_table_is_points_complement": usage_issue_count + usage_points_count
        == usage_count,
        "usage_totals_preserved": source_usage_totals == output_usage_totals,
        "usage_point_coordinates_are_valid_wgs84": all(
            row["valid_wgs84"] == "true" for row in usage_points
        ),
        "usage_points_are_incheon_scope": all(row["in_incheon"] == "true" for row in usage_points),
        "matched_rows_have_one_composite_candidate": all(
            int(row["match_candidate_count"]) == 1
            for row in [*route_links, *usage]
            if row["match_status"] == "matched"
        ),
        "unmatched_rows_have_zero_composite_candidates": all(
            int(row["match_candidate_count"]) == 0
            for row in [*route_links, *usage]
            if row["match_status"] == "unmatched"
        ),
        "ambiguous_rows_have_multiple_composite_candidates": all(
            int(row["match_candidate_count"]) > 1
            for row in [*route_links, *usage]
            if row["match_status"] == "ambiguous"
        ),
        "boarding_components_reconcile_every_row": usage_consistency.get(
            "boarding_card_plus_cash_equal_total", 0
        )
        == len(usage_rows),
        "alighting_card_reconciles_every_row": usage_consistency.get(
            "alighting_card_equal_total", 0
        )
        == len(usage_rows),
        "reported_daily_average_reconciles_to_30_day_period": usage_consistency.get(
            "daily_average_within_0_01_of_30_day_total", 0
        )
        == len(usage_rows),
    }
    if not all(assertions.values()):
        failed = [name for name, passed in assertions.items() if not passed]
        raise AssertionError(f"Transit enrichment validation failed: {failed}")

    outputs = {
        "route_stops": output_metadata(ROUTE_LINK_OUTPUT, route_link_count),
        "route_stop_supply": output_metadata(ROUTE_SUPPLY_OUTPUT, route_supply_count),
        "route_stop_issues": output_metadata(ROUTE_ISSUES_OUTPUT, route_issue_count),
        "stop_usage": output_metadata(USAGE_OUTPUT, usage_count),
        "stop_usage_points": output_metadata(USAGE_POINTS_OUTPUT, usage_points_count),
        "stop_usage_issues": output_metadata(USAGE_ISSUES_OUTPUT, usage_issue_count),
    }

    validation = {
        "pipeline": {
            "name": "build_transit_enrichment",
            "version": 1,
            "deterministic": True,
            "schedule_fields_available": False,
            "schedule_fields_omitted": ["earliest_service_time", "latest_service_time"],
        },
        "join_contract": {
            "key": ["stop_number_exact_after_nfkc_trim", "stop_name_nfkc_casefold_alphanumeric"],
            "matched": "exact composite key identifies one master row",
            "unmatched": "exact composite key identifies no master row; stop-number-only candidates are diagnostic only",
            "ambiguous": "exact composite key identifies more than one master row; no master fields assigned",
            "fuzzy_matching": False,
            "stop_number_only_imputation": False,
        },
        "metric_contract": {
            "ridership_unit": "boarding_and_alighting_events_reported_for_the_source_period",
            "unique_people": False,
            "cash_alightings_field_available": False,
            "daily_average": "source_reported_and_reconciled_against_30_day_June_2026_total",
            "map_points": "matched rows with valid WGS84 coordinates and master in_incheon=true",
        },
        "sources": {
            "bus_stop_master": {
                "path": str(MASTER_SOURCE.relative_to(PROJECT_DIR)),
                "encoding": "UTF-8",
                "rows": len(master_rows),
                "sha256": sha256(MASTER_SOURCE),
                "distinct_place_ids": len(set(master_place_ids)),
                "duplicate_composite_key_groups": sum(
                    len(candidates) > 1 for candidates in master_index.by_composite.values()
                ),
                "duplicate_stop_number_groups": sum(
                    len(candidates) > 1 for candidates in master_index.by_number.values()
                ),
            },
            "route_stop_sequence": {
                "dataset_id": "15048265",
                "source_url": "https://www.data.go.kr/data/15048265/fileData.do",
                "path": str(ROUTE_SOURCE.relative_to(PROJECT_DIR)),
                "encoding": "CP949",
                "reference_date": "2025-12-31",
                "rows": len(route_rows),
                "sha256": sha256(ROUTE_SOURCE),
                "distinct_route_ids": len({row["노선아이디"] for row in route_rows}),
                "distinct_route_numbers": len({row["노선번호"] for row in route_rows}),
                "distinct_stop_numbers": len({row["정류소번호"] for row in route_rows}),
                "distinct_stop_composite_keys": len(
                    {stop_key(row["정류소번호"], row["정류소명"]) for row in route_rows}
                ),
            },
            "stop_usage": {
                "dataset_id": "15048264",
                "source_url": "https://www.data.go.kr/data/15048264/fileData.do",
                "path": str(USAGE_SOURCE.relative_to(PROJECT_DIR)),
                "encoding": "UTF-8 with BOM",
                "reference_date": USAGE_REFERENCE_DATE,
                "reference_date_provenance": USAGE_REFERENCE_DATE_PROVENANCE,
                "rows": len(usage_rows),
                "sha256": sha256(USAGE_SOURCE),
                "distinct_stop_numbers": len({row["정류장 번호"] for row in usage_rows}),
                "duplicate_stop_number_extra_rows": count_duplicate_extras(
                    row["정류장 번호"] for row in usage_rows
                ),
                "distinct_stop_composite_keys": len(
                    {stop_key(row["정류장 번호"], row["정류장명"]) for row in usage_rows}
                ),
                "exact_duplicate_source_rows": len(usage_rows)
                - len({tuple(row[field] for field in USAGE_EXPECTED_FIELDS) for row in usage_rows}),
            },
        },
        "route_stops": {
            "match_status_counts": route_match_counts,
            "match_coverage_percent": round(
                100 * route_match_counts.get("matched", 0) / len(route_links), 6
            ),
            "point_status_counts": route_point_counts,
            "supply_rows": route_supply_count,
            "supply_route_row_count_sum": supply_route_row_sum,
            "distinct_supply_route_ids": len(
                {row["route_id"] for row in route_links if row["route_id"]}
            ),
            "matched_place_id_duplicate_extra_rows": count_duplicate_extras(
                row["place_id"] for row in route_supply if row["place_id"]
            ),
        },
        "stop_usage": {
            "match_status_counts": usage_match_counts,
            "match_coverage_percent": round(
                100 * usage_match_counts.get("matched", 0) / len(usage), 6
            ),
            "point_status_counts": usage_point_counts,
            "source_totals": source_usage_totals,
            "full_output_totals": output_usage_totals,
            "incheon_map_point_totals": point_usage_totals,
            "matched_place_id_duplicate_extra_rows": count_duplicate_extras(
                row["place_id"] for row in usage if row["place_id"]
            ),
            "row_consistency_counts": usage_consistency,
        },
        "assertions": assertions,
        "outputs": outputs,
    }
    with VALIDATION_OUTPUT.open("w", encoding="utf-8", newline="") as target:
        json.dump(validation, target, ensure_ascii=False, indent=2)
        target.write("\n")


if __name__ == "__main__":
    main()
