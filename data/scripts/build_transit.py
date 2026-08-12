#!/usr/bin/env python3
"""Normalize Incheon bus-stop and subway-station source files.

The script uses only the Python standard library. It intentionally preserves
all source rows in the mode-specific files and emits a separate map-ready file
containing geocoded Incheon records only.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Iterable


PROJECT_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_DIR / "raw" / "transit"
OUTPUT_DIR = PROJECT_DIR / "processed"

BUS_SOURCE = RAW_DIR / "incheon_bus_stops_20260228.csv"
SUBWAY_SOURCE = RAW_DIR / "incheon_subway_stations_20250919.csv"

BUS_OUTPUT = OUTPUT_DIR / "transit_bus_stops.csv"
SUBWAY_OUTPUT = OUTPUT_DIR / "transit_subway_stations.csv"
POINTS_OUTPUT = OUTPUT_DIR / "transit_points.csv"
VALIDATION_OUTPUT = OUTPUT_DIR / "transit_validation.json"

OUTPUT_FIELDS = [
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

# Broad envelope covers the mainland, Ganghwa, and Ongjin. The available bus
# file does not provide coordinates for the far-western Ongjin stops, but the
# range remains wide enough for a later geocoded supplement.
INCHEON_BOUNDS = {
    "min_longitude": 124.50,
    "max_longitude": 126.85,
    "min_latitude": 37.15,
    "max_latitude": 37.90,
}

SOURCE_DISTRICTS = {
    "강화군",
    "계양구",
    "남동구",
    "동구",
    "미추홀구",
    "부평구",
    "서구",
    "연수구",
    "옹진군",
    "중구",
}

CURRENT_DISTRICTS = {
    "강화군",
    "계양구",
    "검단구",
    "남동구",
    "미추홀구",
    "부평구",
    "서해구",
    "연수구",
    "영종구",
    "옹진군",
    "제물포구",
}

YEONGJONG_DONGS = {
    "무의동",
    "영종동",
    "영종1동",
    "영종2동",
    "용유동",
    "운남동",
    "운북동",
    "운서동",
    "운서1동",
    "운서2동",
    "중산동",
}

GEOMDAN_DONGS = {
    "검단1동",
    "검단2동",
    "검단3동",
    "검단동",
    "금곡동",
    "당하동",
    "대곡동",
    "마전동",
    "백석동",
    "불로대곡동",
    "불로동",
    "아라동",
    "아라1동",
    "아라2동",
    "오류동",
    "오류왕길동",
    "왕길동",
    "원당동",
}

DISTRICT_BY_OLD_ADMIN_CODE = {
    "28110": "중구",
    "28140": "동구",
    "28177": "미추홀구",
    "28185": "연수구",
    "28200": "남동구",
    "28237": "부평구",
    "28245": "계양구",
    "28260": "서구",
    "28710": "강화군",
    "28720": "옹진군",
}


def cleaned(value: Any) -> str:
    return "" if value is None else str(value).strip()


def parse_float(value: Any) -> float | None:
    text = cleaned(value)
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number


def format_coordinate(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.7f}"


def inside_incheon_bounds(longitude: float | None, latitude: float | None) -> bool:
    if longitude is None or latitude is None:
        return False
    return (
        INCHEON_BOUNDS["min_longitude"] <= longitude <= INCHEON_BOUNDS["max_longitude"]
        and INCHEON_BOUNDS["min_latitude"] <= latitude <= INCHEON_BOUNDS["max_latitude"]
    )


def current_district(source_district: str, dong: str) -> str:
    """Apply the 2026-07-01 Incheon district reorganization at dong level."""
    if source_district == "동구":
        return "제물포구"
    if source_district == "중구":
        return "영종구" if dong in YEONGJONG_DONGS else "제물포구"
    if source_district == "서구":
        return "검단구" if dong in GEOMDAN_DONGS else "서해구"
    return source_district


def read_dicts(path: Path, encoding: str) -> list[dict[str, str]]:
    with path.open("r", encoding=encoding, newline="") as source:
        return list(csv.DictReader(source))


def assert_fields(rows: list[dict[str, str]], expected: Iterable[str], source: Path) -> None:
    if not rows:
        raise ValueError(f"No rows found in {source}")
    missing = set(expected) - set(rows[0])
    if missing:
        raise ValueError(f"Missing columns in {source.name}: {sorted(missing)}")


def normalize_bus(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    assert_fields(
        rows,
        [
            "기준 일자",
            "정류소 명",
            "정류소 번호",
            "정류소 ID",
            "권역",
            "행정동 명",
            "위도",
            "경도",
        ],
        BUS_SOURCE,
    )

    # The source headers are semantically reversed. Values in `위도` are 126.x
    # (longitude), while values in `경도` are 37.x (latitude). Fail loudly if a
    # future source corrects the headers, so the pipeline cannot silently swap
    # valid data back the wrong way.
    raw_header_latitudes = [
        value
        for row in rows
        if (value := parse_float(row["위도"])) not in (None, 0.0)
    ]
    raw_header_longitudes = [
        value
        for row in rows
        if (value := parse_float(row["경도"])) not in (None, 0.0)
    ]
    if not raw_header_latitudes or not raw_header_longitudes:
        raise ValueError("Bus source has no usable coordinate values")
    if not (124.0 <= median(raw_header_latitudes) <= 132.0):
        raise ValueError("Bus `위도` values no longer look like longitudes; inspect the source")
    if not (33.0 <= median(raw_header_longitudes) <= 39.5):
        raise ValueError("Bus `경도` values no longer look like latitudes; inspect the source")

    output: list[dict[str, str]] = []
    for row in rows:
        source_id = cleaned(row["정류소 ID"])
        source_district = cleaned(row["권역"])
        dong = cleaned(row["행정동 명"])

        # Intentional source-header swap, verified above.
        longitude = parse_float(row["위도"])
        latitude = parse_float(row["경도"])
        if longitude == 0.0 and latitude == 0.0:
            longitude = None
            latitude = None

        valid_wgs84 = (
            longitude is not None
            and latitude is not None
            and -180.0 <= longitude <= 180.0
            and -90.0 <= latitude <= 90.0
        )
        in_scope = (
            source_district in SOURCE_DISTRICTS
            and valid_wgs84
            and inside_incheon_bounds(longitude, latitude)
        )

        if longitude is None or latitude is None:
            coordinate_status = "missing"
        elif not valid_wgs84:
            coordinate_status = "invalid_wgs84"
        elif not inside_incheon_bounds(longitude, latitude):
            coordinate_status = "outside_incheon_bounds"
        else:
            coordinate_status = "valid_header_swapped"

        output.append(
            {
                "source_date": cleaned(row["기준 일자"]),
                "mode": "bus",
                "place_id": f"bus:{source_id}",
                "source_id": source_id,
                "source_code": cleaned(row["정류소 번호"]),
                "name": cleaned(row["정류소 명"]),
                "source_district": source_district,
                "district": current_district(source_district, dong),
                "dong": dong,
                "admin_dong_code": "",
                "latitude": format_coordinate(latitude),
                "longitude": format_coordinate(longitude),
                "coordinate_status": coordinate_status,
                "in_incheon": "true" if in_scope else "false",
            }
        )
    return output


def web_mercator_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Convert EPSG:3857 metres to WGS84 longitude/latitude."""
    radius = 6_378_137.0
    longitude = math.degrees(x / radius)
    latitude = math.degrees(2.0 * math.atan(math.exp(y / radius)) - math.pi / 2.0)
    return longitude, latitude


def split_subway_district_dong(admin_name: str, admin_code: str) -> tuple[str, str]:
    text = cleaned(admin_name).replace(" ", "")
    match = re.fullmatch(r"인천광역시(.+?[군구])(.+)", text)
    if match:
        return match.group(1), match.group(2)
    return DISTRICT_BY_OLD_ADMIN_CODE.get(admin_code[:5], ""), text


def subway_fallback_id(row: dict[str, str], longitude: float, latitude: float) -> str:
    identity = "|".join(
        [
            cleaned(row["연번"]),
            cleaned(row["지하철역_풀네임"]),
            cleaned(row["지하철코드"]),
            cleaned(row["행정동_코드"]),
            f"{longitude:.7f}",
            f"{latitude:.7f}",
        ]
    )
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:12]
    return f"generated-{digest}"


def normalize_subway(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    assert_fields(
        rows,
        [
            "연번",
            "배경일련번호",
            "지하철코드",
            "지하철역_풀네임",
            "행정동_코드",
            "행정동_이름",
            "X좌표",
            "Y좌표",
        ],
        SUBWAY_SOURCE,
    )

    output: list[dict[str, str]] = []
    # The portal published the file on 2025-09-19, while the dataset title
    # identifies 2025-09-18 as its reference date.
    source_date = "20250918"
    for row in rows:
        x = parse_float(row["X좌표"])
        y = parse_float(row["Y좌표"])
        if x is None or y is None:
            longitude = None
            latitude = None
        else:
            longitude, latitude = web_mercator_to_wgs84(x, y)

        admin_code = cleaned(row["행정동_코드"])
        source_district, dong = split_subway_district_dong(
            cleaned(row["행정동_이름"]), admin_code
        )
        background_id = cleaned(row["배경일련번호"])
        generated_id = ""
        if background_id:
            source_id = background_id
        elif longitude is not None and latitude is not None:
            generated_id = subway_fallback_id(row, longitude, latitude)
            source_id = generated_id
        else:
            source_id = f"row-{cleaned(row['연번'])}"
        if longitude is not None and latitude is not None:
            generated_id = generated_id or subway_fallback_id(row, longitude, latitude)
            place_id = f"subway:{generated_id.removeprefix('generated-')}"
        else:
            place_id = f"subway:row-{cleaned(row['연번'])}"

        valid_wgs84 = (
            longitude is not None
            and latitude is not None
            and -180.0 <= longitude <= 180.0
            and -90.0 <= latitude <= 90.0
        )
        in_scope = (
            source_district in SOURCE_DISTRICTS
            and valid_wgs84
            and inside_incheon_bounds(longitude, latitude)
        )
        if longitude is None or latitude is None:
            coordinate_status = "missing"
        elif not valid_wgs84:
            coordinate_status = "invalid_wgs84"
        elif not inside_incheon_bounds(longitude, latitude):
            coordinate_status = "outside_incheon_bounds"
        else:
            coordinate_status = "valid_epsg3857_to_wgs84"

        output.append(
            {
                "source_date": source_date,
                "mode": "subway",
                "place_id": place_id,
                "source_id": source_id,
                "source_code": cleaned(row["지하철코드"]),
                "name": cleaned(row["지하철역_풀네임"]),
                "source_district": source_district,
                "district": current_district(source_district, dong),
                "dong": dong,
                "admin_dong_code": admin_code,
                "latitude": format_coordinate(latitude),
                "longitude": format_coordinate(longitude),
                "coordinate_status": coordinate_status,
                "in_incheon": "true" if in_scope else "false",
            }
        )
    return output


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=OUTPUT_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def numeric_bounds(rows: list[dict[str, str]]) -> dict[str, float | None]:
    longitudes = [float(row["longitude"]) for row in rows if row["longitude"]]
    latitudes = [float(row["latitude"]) for row in rows if row["latitude"]]
    return {
        "min_longitude": min(longitudes) if longitudes else None,
        "max_longitude": max(longitudes) if longitudes else None,
        "min_latitude": min(latitudes) if latitudes else None,
        "max_latitude": max(latitudes) if latitudes else None,
    }


def duplicate_summary(rows: list[dict[str, str]]) -> dict[str, int]:
    id_counts = Counter(row["place_id"] for row in rows)
    source_id_counts = Counter(row["source_id"] for row in rows if row["source_id"])
    name_counts = Counter(row["name"] for row in rows)
    coordinate_counts = Counter(
        (row["latitude"], row["longitude"])
        for row in rows
        if row["latitude"] and row["longitude"]
    )
    return {
        "duplicate_place_id_groups": sum(count > 1 for count in id_counts.values()),
        "duplicate_place_id_extra_rows": sum(
            count - 1 for count in id_counts.values() if count > 1
        ),
        "duplicate_source_id_groups": sum(
            count > 1 for count in source_id_counts.values()
        ),
        "duplicate_source_id_extra_rows": sum(
            count - 1 for count in source_id_counts.values() if count > 1
        ),
        "duplicate_name_groups": sum(count > 1 for count in name_counts.values()),
        "duplicate_name_extra_rows": sum(
            count - 1 for count in name_counts.values() if count > 1
        ),
        "duplicate_coordinate_groups": sum(
            count > 1 for count in coordinate_counts.values()
        ),
        "duplicate_coordinate_extra_rows": sum(
            count - 1 for count in coordinate_counts.values() if count > 1
        ),
    }


def mode_validation(rows: list[dict[str, str]]) -> dict[str, Any]:
    status_counts = Counter(row["coordinate_status"] for row in rows)
    current_district_counts = Counter(row["district"] for row in rows)
    return {
        "rows": len(rows),
        "geocoded_rows": sum(bool(row["latitude"] and row["longitude"]) for row in rows),
        "map_ready_incheon_rows": sum(row["in_incheon"] == "true" for row in rows),
        "missing_district_rows": sum(not row["district"] for row in rows),
        "missing_dong_rows": sum(not row["dong"] for row in rows),
        "coordinate_status_counts": dict(sorted(status_counts.items())),
        "coordinate_bounds_all_geocoded": numeric_bounds(rows),
        "current_district_counts": dict(sorted(current_district_counts.items())),
        "duplicates": duplicate_summary(rows),
    }


def validate_outputs(
    bus_rows: list[dict[str, str]],
    subway_rows: list[dict[str, str]],
    map_rows: list[dict[str, str]],
) -> None:
    if len(bus_rows) != len({row["place_id"] for row in bus_rows}):
        raise ValueError("Bus place_id is not unique")
    if len(subway_rows) != len({row["place_id"] for row in subway_rows}):
        raise ValueError("Subway place_id is not unique")
    if any(row["in_incheon"] != "true" for row in map_rows):
        raise ValueError("Map-ready output contains an out-of-scope row")
    if any(not row["latitude"] or not row["longitude"] for row in map_rows):
        raise ValueError("Map-ready output contains a row without coordinates")
    if any(row["district"] not in CURRENT_DISTRICTS for row in map_rows):
        raise ValueError("Map-ready output contains an unexpected current district")
    if not all(row["coordinate_status"] == "valid_epsg3857_to_wgs84" for row in subway_rows):
        raise ValueError("A subway coordinate failed conversion or Incheon bounds validation")


def main() -> None:
    bus_source_rows = read_dicts(BUS_SOURCE, "cp949")
    subway_source_rows = read_dicts(SUBWAY_SOURCE, "utf-8-sig")

    bus_rows = normalize_bus(bus_source_rows)
    subway_rows = normalize_subway(subway_source_rows)
    map_rows = [
        row for row in [*bus_rows, *subway_rows] if row["in_incheon"] == "true"
    ]
    map_rows.sort(key=lambda row: (row["mode"], row["district"], row["dong"], row["name"], row["place_id"]))

    validate_outputs(bus_rows, subway_rows, map_rows)
    write_csv(BUS_OUTPUT, bus_rows)
    write_csv(SUBWAY_OUTPUT, subway_rows)
    write_csv(POINTS_OUTPUT, map_rows)

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "schema": OUTPUT_FIELDS,
        "incheon_validation_bounds_wgs84": INCHEON_BOUNDS,
        "coordinate_findings": {
            "bus": "Source `위도` contains longitude and source `경도` contains latitude; normalized columns intentionally swap them after a median-range assertion.",
            "subway": "Source X/Y values are EPSG:3857 metres and are transformed to WGS84 with the spherical Web Mercator inverse formula.",
        },
        "inputs": {
            "bus": {
                "path": str(BUS_SOURCE.relative_to(PROJECT_DIR)),
                "encoding": "cp949",
            },
            "subway": {
                "path": str(SUBWAY_SOURCE.relative_to(PROJECT_DIR)),
                "encoding": "utf-8-sig",
                "source_reference_date": "2025-09-18",
                "portal_publication_date": "2025-09-19",
            },
        },
        "bus": mode_validation(bus_rows),
        "subway": mode_validation(subway_rows),
        "map_ready": {
            "rows": len(map_rows),
            "mode_counts": dict(sorted(Counter(row["mode"] for row in map_rows).items())),
            "current_district_counts": dict(
                sorted(Counter(row["district"] for row in map_rows).items())
            ),
            "coordinate_bounds": numeric_bounds(map_rows),
        },
        "notes": [
            "Mode-specific outputs preserve all source records, including missing coordinates and out-of-scope route stops.",
            "transit_points.csv contains only geocoded records assigned to an Incheon source district and inside the broad Incheon envelope.",
            "The district field applies the 2026-07-01 Incheon reorganization; source_district preserves the source-era value.",
            "The dong field preserves the source label. Records such as pre-split 운서동 require a current-boundary spatial join before dong-level aggregation.",
            "Some subway 배경일련번호 values are reused across multiple station rows, so place_id is a deterministic row fingerprint rather than the raw background ID.",
            "Same-name subway rows can represent interchange stations or distinct rail records and are intentionally not deduplicated.",
        ],
    }
    VALIDATION_OUTPUT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "bus_rows": len(bus_rows),
                "subway_rows": len(subway_rows),
                "map_ready_rows": len(map_rows),
                "outputs": [
                    str(BUS_OUTPUT),
                    str(SUBWAY_OUTPUT),
                    str(POINTS_OUTPUT),
                    str(VALIDATION_OUTPUT),
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
