#!/usr/bin/env python3
"""Normalize the 2024 Incheon basic-livelihood snapshot for 2026 dong use.

The source is qualification-by-age data.  A person may appear under more than
one qualification, so qualification counts are intentionally kept separate.
The script also refuses to allocate pre-split 운서동/아라동 observations to
their 2026 child dongs.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW_PATH = (
    ROOT
    / "raw"
    / "welfare"
    / "incheon_basic_livelihood_recipients_by_age_dong_20241231.csv"
)
CURRENT_PATH = ROOT / "processed" / "admin_dongs_incheon_20260701.csv"
OUT = ROOT / "processed"

QUALIFICATION_CODES = {
    "기초생계급여": "living",
    "기초의료급여": "medical",
    "기초주거급여": "housing",
    "기초교육급여": "education",
}

# These source labels omit their parent 읍/면 but otherwise identify the same
# long-running 출장소.  The aliases are explicit so that name normalization
# cannot silently invent arbitrary matches.
DOCUMENTED_NAME_ALIASES = {
    "볼음출장소": "서도면볼음출장소",
    "장봉출장소": "북도면장봉출장소",
    "소청출장소": "대청면소청출장소",
}

SPLIT_SOURCE_TO_CURRENT = {
    "운서동": ("운서1동", "운서2동"),
    "아라동": ("아라1동", "아라2동"),
}


def normalize_name(value: str) -> str:
    """Normalize only known punctuation/spacing variants in admin-unit names."""

    value = unicodedata.normalize("NFKC", str(value).strip())
    value = value.replace("·", ".").replace(",", ".")
    return re.sub(r"\s+", "", value)


def parse_age_band(value: str) -> tuple[int, int | None]:
    match = re.fullmatch(r"(\d+)세~(\d+)세", value)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.fullmatch(r"(\d+)세이상", value)
    if match:
        return int(match.group(1)), None
    raise ValueError(f"unrecognized age band: {value!r}")


def join_pipe(values: list[str]) -> str:
    return "|".join(values)


def load_sources() -> tuple[pd.DataFrame, pd.DataFrame]:
    raw = pd.read_csv(RAW_PATH, encoding="cp949")
    current = pd.read_csv(CURRENT_PATH, encoding="utf-8-sig", dtype=str)

    expected_raw = {"시군구", "읍면동", "자격", "연령구간(5세단위)", "수급권자수"}
    if set(raw.columns) != expected_raw:
        raise RuntimeError(f"unexpected welfare schema: {list(raw.columns)}")
    if set(raw["자격"].unique()) != set(QUALIFICATION_CODES):
        raise RuntimeError(f"unexpected qualifications: {sorted(raw['자격'].unique())}")
    if raw.duplicated(["시군구", "읍면동", "자격", "연령구간(5세단위)"]).any():
        raise RuntimeError("duplicate welfare rows at source grain")
    if raw["수급권자수"].isna().any() or (raw["수급권자수"] <= 0).any():
        raise RuntimeError("source is expected to contain positive, non-null cells only")
    if len(current) != 162 or current["admin_dong_code_20260701"].duplicated().any():
        raise RuntimeError("current admin-dong dimension must contain 162 unique codes")

    current["normalized_current_name"] = current["dong_name_20260701"].map(normalize_name)
    if current["normalized_current_name"].duplicated().any():
        duplicates = current.loc[
            current["normalized_current_name"].duplicated(keep=False),
            ["district_name_20260701", "dong_name_20260701"],
        ]
        raise RuntimeError(f"current normalized dong names are ambiguous:\n{duplicates}")
    return raw, current


def build_unit_mapping(raw: pd.DataFrame, current: pd.DataFrame) -> pd.DataFrame:
    by_normalized_name = {
        row.normalized_current_name: row
        for row in current.itertuples(index=False)
    }
    by_exact_name = {
        row.dong_name_20260701: row
        for row in current.itertuples(index=False)
    }

    records: list[dict[str, object]] = []
    source_units = raw[["시군구", "읍면동"]].drop_duplicates()
    for source_district, source_dong in source_units.itertuples(index=False, name=None):
        base: dict[str, object] = {
            "source_reference_date": "2024-12-31",
            "source_district_name_2024": source_district,
            "source_dong_name_2024": source_dong,
            "source_geography_type": "admin_dong_snapshot_2024",
            "mapping_status": "",
            "mapping_method": "",
            "current_candidate_count": 0,
            "current_candidate_admin_dong_codes_20260701": "",
            "current_candidate_district_names_20260701": "",
            "current_candidate_dong_names_20260701": "",
        }

        # Rows whose 읍면동 label repeats the district are not a current
        # administrative dong.  Their values are retained, not redistributed.
        if source_dong == source_district:
            base.update(
                {
                    "source_geography_type": "district_named_non_admin_record",
                    "mapping_status": "excluded_district_named_record",
                    "mapping_method": "not_a_current_admin_dong",
                }
            )
            records.append(base)
            continue

        if source_dong in SPLIT_SOURCE_TO_CURRENT:
            target_names = SPLIT_SOURCE_TO_CURRENT[source_dong]
            targets = [by_exact_name[name] for name in target_names]
            base.update(
                {
                    "mapping_status": "one_to_many_split_unresolved",
                    "mapping_method": "pre_split_source_requires_nonpublic_allocation_key",
                    "current_candidate_count": len(targets),
                    "current_candidate_admin_dong_codes_20260701": join_pipe(
                        [row.admin_dong_code_20260701 for row in targets]
                    ),
                    "current_candidate_district_names_20260701": join_pipe(
                        [row.district_name_20260701 for row in targets]
                    ),
                    "current_candidate_dong_names_20260701": join_pipe(
                        [row.dong_name_20260701 for row in targets]
                    ),
                }
            )
            records.append(base)
            continue

        if source_dong == "검단4동":
            base.update(
                {
                    "mapping_status": "retired_legacy_unit_unresolved",
                    "mapping_method": "no_current_admin_dong_equivalent_asserted",
                }
            )
            records.append(base)
            continue

        lookup_name = DOCUMENTED_NAME_ALIASES.get(source_dong, source_dong)
        normalized = normalize_name(lookup_name)
        target = by_normalized_name.get(normalized)
        if target is None:
            base.update(
                {
                    "mapping_status": "unmatched_unexpected",
                    "mapping_method": "no_unique_current_name_match",
                }
            )
            records.append(base)
            continue

        if source_dong in DOCUMENTED_NAME_ALIASES:
            method = "documented_parent_prefix_alias"
        elif source_dong == target.dong_name_20260701:
            method = "unique_exact_dong_name"
        else:
            method = "unique_normalized_punctuation_name"
        base.update(
            {
                "mapping_status": "one_to_one_mapped",
                "mapping_method": method,
                "current_candidate_count": 1,
                "current_candidate_admin_dong_codes_20260701": target.admin_dong_code_20260701,
                "current_candidate_district_names_20260701": target.district_name_20260701,
                "current_candidate_dong_names_20260701": target.dong_name_20260701,
            }
        )
        records.append(base)

    mapping = pd.DataFrame(records)
    unexpected = mapping[mapping["mapping_status"] == "unmatched_unexpected"]
    if not unexpected.empty:
        raise RuntimeError(f"unexpected unmatched source units:\n{unexpected}")
    return mapping


def build_long(raw: pd.DataFrame, mapping: pd.DataFrame) -> pd.DataFrame:
    long = raw.rename(
        columns={
            "시군구": "source_district_name_2024",
            "읍면동": "source_dong_name_2024",
            "자격": "qualification_name_ko",
            "연령구간(5세단위)": "age_band_5y_ko",
            "수급권자수": "recipient_count",
        }
    ).copy()
    ages = long["age_band_5y_ko"].map(parse_age_band)
    long["age_start"] = ages.map(lambda item: item[0])
    long["age_end"] = ages.map(lambda item: item[1]).astype("Int64")
    long["qualification_code"] = long["qualification_name_ko"].map(QUALIFICATION_CODES)
    long["is_age_65_plus_band"] = long["age_start"] >= 65
    long["is_age_75_plus_band"] = long["age_start"] >= 75
    long["is_age_85_plus_band"] = long["age_start"] >= 85
    long = long.merge(
        mapping,
        on=["source_district_name_2024", "source_dong_name_2024"],
        how="left",
        validate="many_to_one",
    )
    columns = [
        "source_reference_date",
        "source_district_name_2024",
        "source_dong_name_2024",
        "source_geography_type",
        "mapping_status",
        "mapping_method",
        "current_candidate_count",
        "current_candidate_admin_dong_codes_20260701",
        "current_candidate_district_names_20260701",
        "current_candidate_dong_names_20260701",
        "qualification_code",
        "qualification_name_ko",
        "age_band_5y_ko",
        "age_start",
        "age_end",
        "is_age_65_plus_band",
        "is_age_75_plus_band",
        "is_age_85_plus_band",
        "recipient_count",
    ]
    return long[columns]


def build_source_summary(long: pd.DataFrame, mapping: pd.DataFrame) -> pd.DataFrame:
    grouped = []
    for keys, frame in long.groupby(
        ["source_district_name_2024", "source_dong_name_2024"], sort=False
    ):
        record: dict[str, object] = {
            "source_district_name_2024": keys[0],
            "source_dong_name_2024": keys[1],
        }
        for qualification in QUALIFICATION_CODES.values():
            subset = frame[frame["qualification_code"] == qualification]
            for suffix, threshold in (
                ("all_ages", 0),
                ("age_65_plus", 65),
                ("age_75_plus", 75),
                ("age_85_plus", 85),
            ):
                record[f"recipient_count_{qualification}_{suffix}"] = int(
                    subset.loc[subset["age_start"] >= threshold, "recipient_count"].sum()
                )
        grouped.append(record)

    values = pd.DataFrame(grouped)
    summary = mapping.merge(
        values,
        on=["source_district_name_2024", "source_dong_name_2024"],
        how="left",
        validate="one_to_one",
    )
    return summary


def build_current_mapping(
    current: pd.DataFrame, source_summary: pd.DataFrame
) -> pd.DataFrame:
    exact = source_summary[source_summary["mapping_status"] == "one_to_one_mapped"].copy()
    exact["admin_dong_code_20260701"] = exact[
        "current_candidate_admin_dong_codes_20260701"
    ]
    value_columns = [column for column in source_summary if column.startswith("recipient_count_")]
    exact_columns = [
        "admin_dong_code_20260701",
        "source_reference_date",
        "source_district_name_2024",
        "source_dong_name_2024",
        "mapping_method",
        *value_columns,
    ]
    result = current[
        [
            "admin_dong_code_20260701",
            "sido_name_20260701",
            "district_name_20260701",
            "dong_name_20260701",
        ]
    ].merge(exact[exact_columns], on="admin_dong_code_20260701", how="left", validate="one_to_one")

    split_target_to_source = {
        target: source
        for source, targets in SPLIT_SOURCE_TO_CURRENT.items()
        for target in targets
    }
    missing_mask = result["source_dong_name_2024"].isna()
    result["mapping_status"] = "one_to_one_mapped"
    for index in result.index[missing_mask]:
        current_name = result.at[index, "dong_name_20260701"]
        source_name = split_target_to_source.get(current_name)
        if source_name:
            source_row = source_summary[source_summary["source_dong_name_2024"] == source_name]
            if len(source_row) != 1:
                raise RuntimeError(f"expected one split source row for {source_name}")
            source_row = source_row.iloc[0]
            result.at[index, "source_reference_date"] = source_row["source_reference_date"]
            result.at[index, "source_district_name_2024"] = source_row[
                "source_district_name_2024"
            ]
            result.at[index, "source_dong_name_2024"] = source_name
            result.at[index, "mapping_method"] = (
                "pre_split_source_value_retained_but_not_allocated"
            )
            result.at[index, "mapping_status"] = "one_to_many_split_unresolved"
        else:
            result.at[index, "mapping_status"] = "unmatched_unexpected"

    if (result["mapping_status"] == "unmatched_unexpected").any():
        raise RuntimeError(
            "unexpected current targets without source mapping:\n"
            + result.loc[
                result["mapping_status"] == "unmatched_unexpected",
                ["district_name_20260701", "dong_name_20260701"],
            ].to_string(index=False)
        )
    result["source_values_assignable_to_current_dong"] = (
        result["mapping_status"] == "one_to_one_mapped"
    )
    # Preserve counts as nullable integers; unresolved split targets should be
    # blank, never serialized as either a fabricated zero or a decimal value.
    for column in value_columns:
        result[column] = result[column].astype("Int64")
    ordered = [
        "admin_dong_code_20260701",
        "sido_name_20260701",
        "district_name_20260701",
        "dong_name_20260701",
        "source_reference_date",
        "source_district_name_2024",
        "source_dong_name_2024",
        "mapping_status",
        "mapping_method",
        "source_values_assignable_to_current_dong",
        *value_columns,
    ]
    return result[ordered]


def as_int_dict(series: pd.Series) -> dict[str, int]:
    return {str(key): int(value) for key, value in series.items()}


def build_validation(
    raw: pd.DataFrame,
    long: pd.DataFrame,
    mapping: pd.DataFrame,
    current_mapping: pd.DataFrame,
) -> dict[str, object]:
    source_admin = mapping[mapping["source_geography_type"] == "admin_dong_snapshot_2024"]
    exact_source = source_admin[source_admin["mapping_status"] == "one_to_one_mapped"]
    source_65 = long[
        (long["source_geography_type"] == "admin_dong_snapshot_2024")
        & long["is_age_65_plus_band"]
    ]
    exact_65 = source_65[source_65["mapping_status"] == "one_to_one_mapped"]
    special_65 = long[
        (long["source_geography_type"] == "district_named_non_admin_record")
        & long["is_age_65_plus_band"]
    ]
    unresolved_65 = source_65[source_65["mapping_status"] != "one_to_one_mapped"]

    raw_totals_all = raw.groupby("자격")["수급권자수"].sum()
    raw_totals_65 = (
        long[long["is_age_65_plus_band"]]
        .groupby("qualification_name_ko")["recipient_count"]
        .sum()
    )
    mapped_current_65 = {
        qualification: int(
            current_mapping[f"recipient_count_{code}_age_65_plus"].sum(skipna=True)
        )
        for qualification, code in QUALIFICATION_CODES.items()
    }
    exact_65_totals = exact_65.groupby("qualification_name_ko")["recipient_count"].sum()
    if mapped_current_65 != as_int_dict(exact_65_totals):
        raise RuntimeError("current table changed one-to-one mapped qualification totals")

    return {
        "source_file": str(RAW_PATH.relative_to(ROOT)),
        "source_reference_date": "2024-12-31",
        "raw_row_count": int(len(raw)),
        "raw_column_count": int(len(raw.columns)),
        "raw_duplicate_grain_count": int(
            raw.duplicated(["시군구", "읍면동", "자격", "연령구간(5세단위)"]).sum()
        ),
        "raw_null_cell_count": int(raw.isna().sum().sum()),
        "raw_nonpositive_value_count": int((raw["수급권자수"] <= 0).sum()),
        "source_distinct_geography_row_count": int(len(mapping)),
        "source_admin_dong_snapshot_count": int(len(source_admin)),
        "source_district_named_non_admin_record_count": int(
            (mapping["source_geography_type"] == "district_named_non_admin_record").sum()
        ),
        "source_to_current_one_to_one_count": int(len(exact_source)),
        "source_to_current_one_to_one_rate": round(len(exact_source) / len(source_admin), 6),
        "current_admin_dong_count": int(len(current_mapping)),
        "current_one_to_one_covered_count": int(
            (current_mapping["mapping_status"] == "one_to_one_mapped").sum()
        ),
        "current_one_to_one_coverage_rate": round(
            (current_mapping["mapping_status"] == "one_to_one_mapped").mean(), 6
        ),
        "current_split_unresolved_count": int(
            (current_mapping["mapping_status"] == "one_to_many_split_unresolved").sum()
        ),
        "mapping_status_counts_source_units": as_int_dict(mapping["mapping_status"].value_counts()),
        "mapping_status_counts_current_dongs": as_int_dict(
            current_mapping["mapping_status"].value_counts()
        ),
        "raw_recipient_count_by_qualification_all_ages": as_int_dict(raw_totals_all),
        "raw_recipient_count_by_qualification_age_65_plus": as_int_dict(raw_totals_65),
        "one_to_one_mapped_recipient_count_by_qualification_age_65_plus": as_int_dict(
            exact_65_totals
        ),
        "unresolved_admin_source_recipient_count_by_qualification_age_65_plus": as_int_dict(
            unresolved_65.groupby("qualification_name_ko")["recipient_count"].sum()
        ),
        "district_named_non_admin_recipient_count_by_qualification_age_65_plus": as_int_dict(
            special_65.groupby("qualification_name_ko")["recipient_count"].sum()
        ),
        "important_quality_notes": [
            "Qualification counts are not summed into a distinct-person count because benefit qualifications may overlap for one person.",
            "The source contains positive cells only; absent qualification-age cells are represented as zero in source-dong summaries.",
            "2024 운서동 and 아라동 values are retained at their pre-split grain and are not allocated to 2026 child dongs.",
            "Rows whose 읍면동 label repeats the district are retained as non-admin records and are not distributed to dongs.",
            "2024 검단4동 has no asserted 2026 equivalent; its sole raw observation is medical-benefit age 60-64 count 1, so its age-65-plus counts are zero.",
        ],
    }


def write_recommendations() -> None:
    recommendations = {
        "reviewed_script": "scripts/build_incheon_base_metrics.py",
        "overall_verdict": "do_not_use_existing_potential_care_gap_proxy",
        "findings": [
            {
                "severity": "critical",
                "finding": "The script sums recipient counts across four benefit qualifications.",
                "risk": "The same person can hold multiple qualifications, so the result is not a distinct recipient count.",
                "remediation": "Keep living, medical, housing, and education qualification counts separate unless a person-level deduplicated source is obtained.",
            },
            {
                "severity": "critical",
                "finding": "potential_care_gap_proxy subtracts 2024 multi-qualification recipients from 2026 age-65-plus one-person households.",
                "risk": "The populations, reference dates, and inclusion rules differ; the difference cannot identify non-recipients or a care gap.",
                "remediation": "Remove this subtraction and the derived rate/top-20 ranking from product decisions and demo claims.",
            },
            {
                "severity": "high",
                "finding": "The welfare join uses 2026 district plus dong names against pre-reform 2024 geography.",
                "risk": "It misses valid dongs moved from 중구/동구/서구 into 제물포구/영종구/서해구/검단구 and does not express split uncertainty.",
                "remediation": "Join with welfare_basic_livelihood_2024_current_dong_mapping.csv and keep the four split targets null.",
            },
            {
                "severity": "high",
                "finding": "The proxy name sounds like a measured count of residents who need but do not receive welfare.",
                "risk": "Public aggregate data does not establish individual eligibility, need, enrollment, or non-receipt.",
                "remediation": "Label public-data output as a potential care-vulnerability priority score, not non-recipient population or confirmed blind spot.",
            },
        ],
        "safe_near_term_use": [
            "Use qualification-specific age-65-plus counts as contextual demand or existing-support-load indicators.",
            "Build a separately documented prioritization score from elderly one-person-household share, aging trend, facility/transit access, and old housing.",
            "Show source date and mapping status in tooltips; suppress current-dong welfare values for 운서1동, 운서2동, 아라1동, and 아라2동.",
        ],
        "data_needed_for_actual_nonrecipient_count": [
            "A defined eligible-or-needs-assessed resident universe at person level",
            "Service enrollment/receipt status for the same people and reference period",
            "A privacy-preserving linkage key and lawful access/processing basis",
        ],
    }
    (OUT / "welfare_metric_recommendations.json").write_text(
        json.dumps(recommendations, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    raw, current = load_sources()
    mapping = build_unit_mapping(raw, current)
    long = build_long(raw, mapping)
    source_summary = build_source_summary(long, mapping)
    current_mapping = build_current_mapping(current, source_summary)

    long.to_csv(
        OUT / "welfare_basic_livelihood_2024_normalized_long.csv",
        index=False,
        encoding="utf-8-sig",
    )
    source_summary.to_csv(
        OUT / "welfare_basic_livelihood_2024_source_dong_summary.csv",
        index=False,
        encoding="utf-8-sig",
    )
    current_mapping.to_csv(
        OUT / "welfare_basic_livelihood_2024_current_dong_mapping.csv",
        index=False,
        encoding="utf-8-sig",
    )
    issues = source_summary[source_summary["mapping_status"] != "one_to_one_mapped"]
    issues.to_csv(
        OUT / "welfare_basic_livelihood_2024_mapping_issues.csv",
        index=False,
        encoding="utf-8-sig",
    )

    validation = build_validation(raw, long, mapping, current_mapping)
    (OUT / "welfare_basic_livelihood_2024_validation.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_recommendations()


if __name__ == "__main__":
    main()
