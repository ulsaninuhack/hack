#!/usr/bin/env python3
"""Build a normalized catalogue of Incheon's official one-person programs.

The six category pages are treated as the discovery source.  Detail pages are
downloaded once and cached byte-for-byte under ``raw/policies/program_details``.
Subsequent runs use the cache unless ``--refresh`` is supplied.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


BASE_URL = "https://www.incheon.go.kr"
DETAIL_PATH = "/1in/OHH020108/view?oneHouseHoldId={program_id}"
CATEGORY_NAMES = {
    "OHH020101": "정서",
    "OHH020102": "주거",
    "OHH020103": "안전",
    "OHH020104": "건강",
    "OHH020105": "경제",
    "OHH020106": "기타",
}

CSV_COLUMNS = [
    "program_id",
    "category_code",
    "category",
    "title",
    "status",
    "description",
    "gender",
    "lifecycle",
    "region",
    "intro",
    "period",
    "content",
    "target",
    "scale",
    "apply_period",
    "apply_method",
    "contact",
    "updated_date",
    "source_url",
]

# Keep both the pre-2026 and 2026-07-01 district names.  Program pages can
# legitimately retain the name that applied when the program was published.
REGION_NAMES = [
    "강화군",
    "옹진군",
    "제물포구",
    "영종구",
    "미추홀구",
    "연수구",
    "남동구",
    "부평구",
    "계양구",
    "서해구",
    "검단구",
    "중구",
    "동구",
    "서구",
]

# The fourth three-digit component of the portal ID identifies the publishing
# local-government organization.  Only codes that remain unambiguous across
# the 2026 district reform are used as a fallback; ambiguous legacy Jung/Dong
# and split-Seo codes are deliberately excluded.
ORGANIZATION_REGION_FALLBACK = {
    "000": "인천광역시 전체",
    "004": "미추홀구",
    "005": "연수구",
    "006": "남동구",
    "007": "부평구",
    "008": "계양구",
    "010": "강화군",
    "011": "옹진군",
    "012": "제물포구",
}

PLACE_REGION_ALIASES = {
    "영종도": "영종구",
    "만석동": "제물포구",
}

RELEVANCE_TERMS = {
    "고립·관계망": [
        "고립",
        "은둔",
        "고독",
        "외로움",
        "사회적 관계망",
        "사회적관계망",
        "사회적 연결",
        "관계 형성",
        "관계망 형성",
        "고위험군",
        "위기가구",
    ],
    "돌봄·발굴": [
        "돌봄",
        "독거",
        "안부",
        "말벗",
        "사례관리",
        "생활지원",
        "일상생활 지원",
        "가사지원",
        "가사 지원",
        "식사지원",
        "식사 지원",
        "반찬",
        "방문서비스",
        "방문 서비스",
        "취약가구",
        "긴급위기지원",
        "위기지원",
        "복지사각",
        "사각지대",
        "위험가구 발굴",
        "고립가구 발굴",
        "복지안심",
        "통합지원",
    ],
    "안전·응급": [
        "안전",
        "응급",
        "구조",
        "화재",
        "방범",
        "범죄예방",
        "범죄 예방",
        "안심폰",
        "안심홈",
        "돌봄플러그",
        "스마트플러그",
        "iot",
        "전기 사용량",
        "이상징후",
        "조도 측정",
    ],
}


@dataclass(frozen=True)
class ListRecord:
    program_id: str
    category_code: str
    category: str
    title: str
    status: str
    description: str
    source_url: str


def clean_text(value: str | None) -> str:
    """Collapse HTML whitespace while retaining readable multi-line content."""
    if not value:
        return ""
    lines = []
    for raw_line in value.replace("\xa0", " ").replace("\r", "\n").split("\n"):
        line = re.sub(r"[\t\f\v ]+", " ", raw_line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def extract_program_id(href: str) -> str:
    values = parse_qs(urlparse(href).query).get("oneHouseHoldId", [])
    return values[0].strip() if values else ""


def category_code_from_path(path: Path, soup: BeautifulSoup) -> str:
    match = re.search(r"(OHH02010[1-6])", path.name)
    if match:
        return match.group(1)
    hidden = soup.select_one('input[name="icnMnDvsnCd"]')
    return clean_text(hidden.get("value")) if hidden else ""


def parse_list_file(path: Path) -> list[ListRecord]:
    soup = BeautifulSoup(path.read_bytes(), "html.parser")
    category_code = category_code_from_path(path, soup)
    if category_code not in CATEGORY_NAMES:
        raise ValueError(f"Cannot determine category for {path}")

    records: list[ListRecord] = []
    for item in soup.select("li.system-policy__item"):
        link = item.select_one('a[href*="oneHouseHoldId="]')
        if not link:
            continue
        program_id = extract_program_id(link.get("href", ""))
        if not program_id:
            continue
        title_node = item.select_one(".system-policy__item-title")
        description_node = item.select_one(".system-policy__item-txt")
        status_node = item.select_one(".states p")
        records.append(
            ListRecord(
                program_id=program_id,
                category_code=category_code,
                category=CATEGORY_NAMES[category_code],
                title=clean_text(title_node.get_text("\n", strip=True)) if title_node else "",
                status=clean_text(status_node.get_text("\n", strip=True)) if status_node else "",
                description=(
                    clean_text(description_node.get_text("\n", strip=True))
                    if description_node
                    else ""
                ),
                source_url=urljoin(BASE_URL, link.get("href", "")),
            )
        )
    return records


def discover_records(list_dir: Path) -> tuple[list[ListRecord], list[dict[str, str]]]:
    files = sorted(list_dir.glob("program_list_OHH02010[1-6].html"))
    if len(files) != 6:
        raise RuntimeError(f"Expected six category list files, found {len(files)} in {list_dir}")

    records: list[ListRecord] = []
    source_files: list[dict[str, str]] = []
    for path in files:
        payload = path.read_bytes()
        parsed = parse_list_file(path)
        records.extend(parsed)
        source_files.append(
            {
                "file": path.name,
                "bytes": str(len(payload)),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "records": str(len(parsed)),
            }
        )
    return records, source_files


def build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (compatible; Incheon-I5-hackathon-data-collector/1.0; "
                "+https://www.incheon.go.kr/)"
            ),
            "Accept": "text/html,application/xhtml+xml",
        }
    )
    return session


def detail_looks_valid(payload: bytes) -> bool:
    if len(payload) < 5_000:
        return False
    soup = BeautifulSoup(payload, "html.parser")
    title = soup.select_one("section.openPortal-subPage h4")
    table = soup.select_one("section.openPortal-subPage table")
    return bool(title and clean_text(title.get_text(" ", strip=True)) and table)


def fetch_detail(
    session: requests.Session,
    program_id: str,
    cache_path: Path,
    *,
    refresh: bool,
    offline: bool,
    throttle: float,
) -> tuple[bytes, str]:
    if cache_path.exists() and not refresh:
        payload = cache_path.read_bytes()
        if detail_looks_valid(payload):
            return payload, "cache"
    if offline:
        raise RuntimeError(f"No valid cached detail for {program_id}")

    url = urljoin(BASE_URL, DETAIL_PATH.format(program_id=program_id))
    response = session.get(url, timeout=(10, 30))
    response.raise_for_status()
    payload = response.content
    if not detail_looks_valid(payload):
        raise RuntimeError(f"Response for {program_id} is not a valid program detail page")
    cache_path.write_bytes(payload)
    if throttle > 0:
        time.sleep(throttle)
    return payload, "download"


def parse_table_fields(soup: BeautifulSoup) -> dict[str, str]:
    fields: dict[str, str] = {}
    table = soup.select_one("section.openPortal-subPage table")
    if not table:
        return fields
    for row in table.select("tr"):
        header = row.find("th")
        if not header:
            continue
        key = clean_text(header.get_text(" ", strip=True))
        cells = row.find_all("td")
        value = " | ".join(
            part for part in (clean_text(cell.get_text("\n", strip=True)) for cell in cells) if part
        )
        if key:
            fields[key] = value
    return fields


def first_field(fields: dict[str, str], *names: str) -> str:
    for name in names:
        if fields.get(name):
            return fields[name]
    return ""


def extract_updated_date(soup: BeautifulSoup) -> str:
    for item in soup.select("#mnuChargerContainer li"):
        label = item.select_one(".item")
        value = item.select_one(".item-data")
        if label and value and clean_text(label.get_text(" ", strip=True)) == "최종업데이트":
            return clean_text(value.get_text(" ", strip=True))
    return ""


def infer_region(values: Iterable[str], program_id: str) -> str:
    text = "\n".join(value for value in values if value)
    # Longest-first, non-overlapping matching prevents ``남동구`` from also
    # being misread as the separate legacy district ``동구``.
    pattern = re.compile("|".join(re.escape(name) for name in sorted(REGION_NAMES, key=len, reverse=True)))
    found = list(dict.fromkeys(match.group(0) for match in pattern.finditer(text)))
    if found:
        return " | ".join(found)
    for place, region in PLACE_REGION_ALIASES.items():
        if place in text:
            return region
    if "인천광역시" in text or "인천시" in text:
        return "인천광역시 전체"
    organization_code = program_id[18:21] if len(program_id) >= 21 else ""
    return ORGANIZATION_REGION_FALLBACK.get(organization_code, "")


def parse_detail(payload: bytes, record: ListRecord) -> dict[str, str]:
    soup = BeautifulSoup(payload, "html.parser")
    section = soup.select_one("section.openPortal-subPage")
    title_node = section.select_one("h4") if section else None
    fields = parse_table_fields(soup)

    title = clean_text(title_node.get_text(" ", strip=True)) if title_node else record.title
    row = {
        "program_id": record.program_id,
        "category_code": record.category_code,
        "category": record.category,
        "title": title or record.title,
        "status": record.status,
        "description": record.description,
        "gender": first_field(fields, "성별"),
        "lifecycle": first_field(fields, "생애주기", "생애 주기"),
        "region": "",
        "intro": first_field(fields, "사업소개", "사업 소개"),
        "period": first_field(fields, "사업기간", "사업 기간", "운영기간", "운영 기간"),
        "content": first_field(fields, "사업내용", "사업 내용", "지원내용", "지원 내용"),
        "target": first_field(fields, "지원대상", "지원 대상", "사업대상", "사업 대상", "대상"),
        "scale": first_field(
            fields,
            "사업규모",
            "사업 규모",
            "지원규모",
            "지원 규모",
            "모집인원",
            "모집 인원",
        ),
        "apply_period": first_field(fields, "신청기간", "신청 기간", "접수기간", "접수 기간"),
        "apply_method": first_field(fields, "신청방법", "신청 방법", "접수방법", "접수 방법"),
        "contact": first_field(fields, "문의처", "문의", "담당부서", "담당 부서"),
        "updated_date": extract_updated_date(soup),
        "source_url": record.source_url,
    }
    row["region"] = infer_region(
        [
            row["title"],
            row["description"],
            row["intro"],
            row["content"],
            row["target"],
            row["apply_method"],
            row["contact"],
        ],
        record.program_id,
    )
    return row


def relevance_for(row: dict[str, str]) -> tuple[list[str], list[str]]:
    searchable = "\n".join(
        row.get(name, "")
        for name in ("title", "description", "intro", "content", "target", "apply_method")
    ).lower()
    domains: list[str] = []
    matches: list[str] = []
    for domain, terms in RELEVANCE_TERMS.items():
        domain_matches = [term for term in terms if term.lower() in searchable]
        if domain_matches:
            domains.append(domain)
            matches.extend(domain_matches)
    # Every official safety-category program is pertinent to the map's safety
    # layer even when its short description omits one of the curated keywords.
    if row.get("category_code") == "OHH020103" and "안전·응급" not in domains:
        domains.append("안전·응급")
        matches.append("분류:안전")
    return domains, list(dict.fromkeys(matches))


def write_csv(path: Path, rows: list[dict[str, str]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def counter_dict(values: Iterable[str]) -> dict[str, int]:
    return dict(sorted(Counter(values).items(), key=lambda item: item[0]))


def main() -> int:
    script_path = Path(__file__).resolve()
    default_root = script_path.parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default_root, help="work/i5-data directory")
    parser.add_argument("--refresh", action="store_true", help="redownload valid cached pages")
    parser.add_argument("--offline", action="store_true", help="fail instead of accessing the network")
    parser.add_argument(
        "--throttle",
        type=float,
        default=0.15,
        help="seconds to wait after each successful download (default: 0.15)",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    list_dir = root / "raw" / "policies"
    cache_dir = list_dir / "program_details"
    output_dir = root / "processed"
    cache_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    discovered, source_files = discover_records(list_dir)
    by_id: dict[str, list[ListRecord]] = defaultdict(list)
    for record in discovered:
        by_id[record.program_id].append(record)

    duplicate_ids = {program_id: len(items) for program_id, items in by_id.items() if len(items) > 1}
    rows: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []
    fetch_sources = Counter()
    session = build_session()

    total = len(by_id)
    for index, (program_id, candidates) in enumerate(sorted(by_id.items()), start=1):
        # The first category occurrence is the canonical record. If a future
        # list assigns multiple categories, preserve all of them in-place.
        record = candidates[0]
        if len(candidates) > 1:
            record = ListRecord(
                program_id=record.program_id,
                category_code=" | ".join(dict.fromkeys(item.category_code for item in candidates)),
                category=" | ".join(dict.fromkeys(item.category for item in candidates)),
                title=record.title,
                status=record.status,
                description=record.description,
                source_url=record.source_url,
            )
        cache_path = cache_dir / f"{program_id}.html"
        try:
            payload, fetch_source = fetch_detail(
                session,
                program_id,
                cache_path,
                refresh=args.refresh,
                offline=args.offline,
                throttle=max(args.throttle, 0.0),
            )
            fetch_sources[fetch_source] += 1
            rows.append(parse_detail(payload, record))
        except Exception as exc:  # Continue to provide a complete failure inventory.
            failures.append({"program_id": program_id, "error": str(exc)})
        if index == 1 or index % 25 == 0 or index == total:
            print(f"processed {index}/{total} detail pages", file=sys.stderr)

    rows.sort(key=lambda row: (row["category_code"], row["title"], row["program_id"]))
    relevant_rows: list[dict[str, str]] = []
    relevance_domain_counts: Counter[str] = Counter()
    for row in rows:
        domains, keywords = relevance_for(row)
        if domains:
            extended = dict(row)
            extended["relevance_domains"] = " | ".join(domains)
            extended["relevance_keywords"] = " | ".join(keywords)
            relevant_rows.append(extended)
            relevance_domain_counts.update(domains)

    all_path = output_dir / "programs_all.csv"
    relevant_path = output_dir / "programs_relevant.csv"
    validation_path = output_dir / "programs_validation.json"
    write_csv(all_path, rows, CSV_COLUMNS)
    write_csv(
        relevant_path,
        relevant_rows,
        CSV_COLUMNS + ["relevance_domains", "relevance_keywords"],
    )

    completeness = {
        column: {
            "non_empty": sum(bool(row.get(column, "").strip()) for row in rows),
            "empty": sum(not bool(row.get(column, "").strip()) for row in rows),
        }
        for column in CSV_COLUMNS
    }
    validation = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "official_base_url": BASE_URL,
        "source_list_files": source_files,
        "discovered_links": len(discovered),
        "unique_program_ids": len(by_id),
        "duplicate_program_ids": duplicate_ids,
        "parsed_programs": len(rows),
        "detail_failures": failures,
        "detail_source_counts": dict(sorted(fetch_sources.items())),
        "cached_detail_files": len(list(cache_dir.glob("*.html"))),
        "category_counts": counter_dict(row["category"] for row in rows),
        "status_counts": counter_dict(row["status"] for row in rows),
        "region_counts": counter_dict(row["region"] or "(미표기)" for row in rows),
        "field_completeness": completeness,
        "relevant_programs": len(relevant_rows),
        "relevance_domain_counts": dict(sorted(relevance_domain_counts.items())),
        "checks": {
            "six_list_files": len(source_files) == 6,
            "expected_173_unique_ids": len(by_id) == 173,
            "all_details_parsed": len(rows) == len(by_id) and not failures,
            "one_cached_detail_per_id": len(list(cache_dir.glob("*.html"))) == len(by_id),
            "all_source_urls_https": all(row["source_url"].startswith("https://") for row in rows),
            "all_ids_unique_in_output": len({row["program_id"] for row in rows}) == len(rows),
        },
        "outputs": {
            "all": str(all_path.relative_to(root)),
            "relevant": str(relevant_path.relative_to(root)),
            "validation": str(validation_path.relative_to(root)),
        },
    }
    validation_path.write_text(
        json.dumps(validation, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "unique_program_ids": len(by_id),
                "parsed_programs": len(rows),
                "relevant_programs": len(relevant_rows),
                "failures": len(failures),
                "downloads": fetch_sources.get("download", 0),
                "cache_hits": fetch_sources.get("cache", 0),
            },
            ensure_ascii=False,
        )
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
