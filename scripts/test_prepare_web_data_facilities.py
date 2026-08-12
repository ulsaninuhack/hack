#!/usr/bin/env python3
"""Facility filtering contract tests for browser-ready web data."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = REPO_ROOT / "data" / "processed"
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import prepare_web_data


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


class FacilityFilteringContractTests(unittest.TestCase):
    def test_facility_runtime_filter_preserves_source_and_canonical_counts(self) -> None:
        with tempfile.TemporaryDirectory(prefix="web-data-facility-filter-") as temporary:
            output_dir = Path(temporary)
            prepare_web_data.build_all(SOURCE_DIR, output_dir)

            facilities = load_json(output_dir / "facilities.geojson")
            summary = load_json(output_dir / "summary.json")
            manifest = load_json(output_dir / "manifest.json")
            validation = load_json(output_dir / "validation.json")
            facility_ids = {
                feature["properties"]["facility_id"] for feature in facilities["features"]
            }
            category_majors = {
                feature["properties"]["category_major"] for feature in facilities["features"]
            }
            category_details = {
                feature["properties"]["category_detail"] for feature in facilities["features"]
            }

            self.assertEqual(summary["counts"]["facilityPointsSource"], 3_061)
            self.assertEqual(summary["counts"]["facilityPointsExcluded"], 245)
            self.assertEqual(summary["counts"]["facilityPoints"], 2_816)
            self.assertEqual(summary["counts"]["facilityCanonicalTotal"], 3_394)
            self.assertEqual(summary["counts"]["facilityRelevantCanonicalTotal"], 3_115)
            self.assertNotIn("facilityEligibleCanonicalTotal", summary["counts"])
            self.assertEqual(summary["coverage"]["facilityCoordinateCoveragePct"], 90.401284)
            self.assertEqual(len(facilities["features"]), 2_816)
            self.assertEqual(summary["counts"]["adminGeometryZones"], 156)
            self.assertEqual(summary["counts"]["currentAdminDongsRepresented"], 162)
            self.assertEqual(
                summary["distributions"]["facilityCategoryMajor"],
                {
                    "가족·여성복지": 32,
                    "기타복지": 1,
                    "노인복지": 2_500,
                    "장애인복지": 242,
                    "정신건강복지": 13,
                    "지역복지": 28,
                },
            )
            self.assertEqual(sum(summary["distributions"]["facilityDistrict"].values()), 2_816)
            self.assertEqual(len(summary["distributions"]["facilityDistrict"]), 11)

            self.assertNotIn("아동·돌봄", category_majors)
            self.assertNotIn("청소년복지", category_majors)
            self.assertFalse(any("영유아" in detail for detail in category_details))
            self.assertNotIn("피해장애아동쉼터", category_details)
            self.assertNotIn("fac_7ae417c080e83c45", facility_ids)

            self.assertIn("지역복지", category_majors)
            self.assertIn("기타복지", category_majors)
            self.assertIn("노인복지", category_majors)
            self.assertIn("장애인복지", category_majors)
            self.assertIn("가족·여성복지", category_majors)

            for document in (summary, manifest, validation):
                policy = document["filtering"]["facilities"]
                self.assertEqual(policy["sourceFeatureCount"], 3_061)
                self.assertEqual(policy["excludedFeatureCount"], 245)
                self.assertEqual(policy["outputFeatureCount"], 2_816)
                self.assertEqual(policy["canonicalSourceCount"], 3_394)
                self.assertEqual(policy["canonicalExcludedCount"], 279)
                self.assertEqual(policy["relevantCanonicalCount"], 3_115)
                self.assertIn("아동·돌봄", policy["excludedMajorCategories"])
                self.assertIn("청소년복지", policy["excludedMajorCategories"])
                self.assertIn("영유아", policy["excludedDetailContains"])
                self.assertIn("피해장애아동쉼터", policy["excludedDetailExact"])
                self.assertEqual(
                    policy["reviewedExclusions"],
                    [
                        {
                            "facilityId": "fac_7ae417c080e83c45",
                            "reason": "성착취 피해아동청소년 지원센터로 공식 시설명에서 연령 전용성이 확인됨",
                        }
                    ],
                )

            self.assertTrue(validation["checks"]["facilityFeatureCountIs2816"])
            self.assertTrue(validation["checks"]["facilitySourceCountIs3061"])
            self.assertTrue(validation["checks"]["facilityExcludedCountIs245"])
            self.assertTrue(validation["checks"]["facilityCanonicalSourceIs3394"])
            self.assertTrue(validation["checks"]["facilityCanonicalExcludedIs279"])
            self.assertTrue(validation["checks"]["facilityRelevantCanonicalIs3115"])
            self.assertTrue(validation["checks"]["adminFeatureCountIs156"])

    def test_unknown_facility_category_fails_review(self) -> None:
        with tempfile.TemporaryDirectory(prefix="web-data-unknown-facility-") as temporary:
            source_dir = Path(temporary) / "processed"
            shutil.copytree(SOURCE_DIR, source_dir)
            facility_path = source_dir / "demo_full_facility_points.geojson"
            payload = load_json(facility_path)
            payload["features"][0]["properties"]["category_major"] = "신규복지"
            facility_path.write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )

            with self.assertRaisesRegex(prepare_web_data.BuildError, "unknown facility"):
                prepare_web_data.build_all(source_dir, Path(temporary) / "output")


if __name__ == "__main__":
    unittest.main()
