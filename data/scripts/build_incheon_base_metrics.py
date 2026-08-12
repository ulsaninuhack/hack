#!/usr/bin/env python3
"""DEPRECATED unsafe prototype metric builder.

Do not use this script or its outputs for analysis.  It subtracts overlapping
benefit-qualification counts from a different population/date and therefore
cannot estimate people outside welfare coverage.  Kept only as an audit trail.
See ``processed/welfare_metric_recommendations.json`` and use the validated
``build_map_layers.py`` output instead.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "processed"


def read_csv(path: Path) -> pd.DataFrame:
    for encoding in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return pd.read_csv(path, encoding=encoding)
        except UnicodeDecodeError:
            continue
    return pd.read_csv(path)


def age_columns(prefix: str, start: int = 65, end: int = 110) -> list[str]:
    cols = [f"{age}세{prefix}" for age in range(start, end)]
    cols.append(f"{end}세이상 {prefix}")
    return cols


def normalize_text(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().str.replace(r"\s+", "", regex=True)


def build_dong_base() -> pd.DataFrame:
    one = read_csv(RAW / "demographics/korea_one_person_households_by_sex_age_admin_dong_20260731.csv")
    hh = read_csv(RAW / "demographics/korea_households_by_size_admin_dong_20260731.csv")

    one = one[one["시도명"] == "인천광역시"].copy()
    hh = hh[hh["시도명"] == "인천광역시"].copy()

    male_65 = [c for c in age_columns("남자") if c in one.columns]
    female_65 = [c for c in age_columns("여자") if c in one.columns]
    one["one_person_65p"] = one[male_65 + female_65].sum(axis=1)
    one["one_person_75p"] = one[
        [c for c in age_columns("남자", 75) + age_columns("여자", 75) if c in one.columns]
    ].sum(axis=1)
    one["one_person_85p"] = one[
        [c for c in age_columns("남자", 85) + age_columns("여자", 85) if c in one.columns]
    ].sum(axis=1)

    base = one[
        [
            "행정기관코드",
            "기준연월",
            "시도명",
            "시군구명",
            "읍면동명",
            "계",
            "남자",
            "여자",
            "one_person_65p",
            "one_person_75p",
            "one_person_85p",
        ]
    ].rename(
        columns={
            "기준연월": "one_person 기준연월",
            "계": "one_person_total",
            "남자": "one_person_male",
            "여자": "one_person_female",
        }
    )

    hh_small = hh[
        ["행정기관코드", "기준연월", "전체세대수", "1인세대", "2인세대", "3인세대", "4인세대"]
    ].rename(columns={"기준연월": "household 기준연월"})
    base = base.merge(hh_small, on="행정기관코드", how="left")
    base["one_person_household_ratio"] = base["1인세대"] / base["전체세대수"]
    base["elderly_one_person_ratio"] = base["one_person_65p"] / base["one_person_total"].replace(0, pd.NA)

    base["sigungu_key"] = normalize_text(base["시군구명"])
    base["dong_key"] = normalize_text(base["읍면동명"])
    return base


def build_welfare_2024() -> pd.DataFrame:
    welfare = read_csv(RAW / "welfare/incheon_basic_livelihood_recipients_by_age_dong_20241231.csv")
    age_col = "연령구간(5세단위)"
    value_col = "수급권자수"
    welfare["age_start"] = welfare[age_col].str.extract(r"(\d+)").astype(float)
    welfare_65 = welfare[welfare["age_start"] >= 65].copy()
    grouped = (
        welfare_65.groupby(["시군구", "읍면동"], as_index=False)[value_col]
        .sum()
        .rename(columns={value_col: "basic_livelihood_recipients_65p_2024"})
    )
    grouped["sigungu_key"] = normalize_text(grouped["시군구"])
    grouped["dong_key"] = normalize_text(grouped["읍면동"])
    return grouped[["sigungu_key", "dong_key", "basic_livelihood_recipients_65p_2024"]]


def build_emergency_sigungu() -> pd.DataFrame:
    emergency = read_csv(RAW / "welfare/emergency_safety_service_targets_20240520.csv")
    inc = emergency[emergency["시도"] == "인천광역시"].copy()
    inc["age_start"] = inc["나이"].str.extract(r"(\d+)").astype(float)
    inc_65 = inc[inc["age_start"] >= 65].copy()
    return (
        inc_65.groupby("시군구", as_index=False)
        .size()
        .rename(columns={"시군구": "legacy_sigungu_name", "size": "emergency_safety_targets_65p_20240520"})
    )


def main() -> None:
    raise SystemExit(
        "REFUSED: this deprecated script cannot estimate a care gap. "
        "See processed/welfare_metric_recommendations.json."
    )


if __name__ == "__main__":
    main()
