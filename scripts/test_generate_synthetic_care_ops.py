#!/usr/bin/env python3
"""Contract tests for the deterministic CareOps synthetic scenario pack."""

from __future__ import annotations

import csv
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "generate_synthetic_care_ops.py"
CURRENT_DONGS = REPO_ROOT / "data" / "processed" / "admin_dongs_incheon_20260701.csv"
CROSSWALK = (
    REPO_ROOT
    / "data"
    / "processed"
    / "boundary_current_to_geometry_crosswalk_20260701.csv"
)
GEOMETRY = REPO_ROOT / "public" / "data" / "admin-dongs.geojson"
OUTPUT_NAMES = (
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
    "llm_decision",
    "ai_approval",
}

CONTACT_REQUIRED_KEYS = {
    "next_contact_date",
    "preferred_contact_method",
    "contact_cadence_days",
    "last_contact_date",
    "last_contact_result",
    "consecutive_no_answer_count",
}
WORKFLOW_REQUIRED_KEYS = {
    "follow_up_deadline",
    "follow_up_status",
    "visit_approval_status",
    "transfer_status",
    "visit_decision",
}


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def iter_keys(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for key, nested in value.items():
            yield key
            yield from iter_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from iter_keys(nested)


def validate_household_with_json_schema(household: dict[str, Any]) -> subprocess.CompletedProcess[str]:
    """Validate one household against the published household definition."""

    with tempfile.TemporaryDirectory(prefix="care-ops-schema-case-") as temporary:
        payload_path = Path(temporary) / "household.json"
        payload_path.write_text(
            json.dumps(household, ensure_ascii=False), encoding="utf-8"
        )
        return subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                (
                    "import { readFileSync } from 'node:fs'; "
                    "import Ajv2020 from 'ajv/dist/2020.js'; "
                    "import addFormats from 'ajv-formats'; "
                    "const schema=JSON.parse(readFileSync(process.argv[1], 'utf8')); "
                    "const household=JSON.parse(readFileSync(process.argv[2], 'utf8')); "
                    "const wrapper={$schema:schema.$schema,$defs:schema.$defs,$ref:'#/$defs/household'}; "
                    "const ajv=new Ajv2020({allErrors:true,strict:true}); addFormats(ajv); "
                    "const validate=ajv.compile(wrapper); "
                    "if (!validate(household)) { console.error(JSON.stringify(validate.errors)); process.exit(1); }"
                ),
                str(REPO_ROOT / "data" / "schemas" / "synthetic-household.schema.json"),
                str(payload_path),
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
        )


def point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
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


def point_in_geometry(longitude: float, latitude: float, geometry: dict[str, Any]) -> bool:
    coordinates = geometry["coordinates"]
    polygons = [coordinates] if geometry["type"] == "Polygon" else coordinates
    for polygon in polygons:
        if not point_in_ring(longitude, latitude, polygon[0]):
            continue
        if any(point_in_ring(longitude, latitude, hole) for hole in polygon[1:]):
            continue
        return True
    return False


class SyntheticCareOpsContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory(prefix="care-ops-contract-")
        cls.output_dir = Path(cls.temporary.name) / "first"
        cls.second_output_dir = Path(cls.temporary.name) / "second"
        command = [
            sys.executable,
            str(SCRIPT),
            "--current-dongs",
            str(CURRENT_DONGS),
            "--crosswalk",
            str(CROSSWALK),
            "--geometry",
            str(GEOMETRY),
            "--seed",
            "20260812",
        ]
        subprocess.run(command + ["--output-dir", str(cls.output_dir)], check=True)
        subprocess.run(command + ["--output-dir", str(cls.second_output_dir)], check=True)

        cls.workers = load_json(cls.output_dir / "synthetic-workers.json")
        cls.households = load_json(cls.output_dir / "synthetic-households.json")
        cls.manifest = load_json(cls.output_dir / "synthetic-care-ops-manifest.json")
        cls.geometry = load_json(GEOMETRY)
        cls.geometry_by_id = {
            feature["properties"]["geometry_zone_id"]: feature["geometry"]
            for feature in cls.geometry["features"]
        }
        with CURRENT_DONGS.open(encoding="utf-8-sig", newline="") as handle:
            cls.current_dong_codes = {
                row["admin_dong_code_20260701"] for row in csv.DictReader(handle)
            }

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temporary.cleanup()

    def test_covers_all_162_current_dongs_with_20_to_50_households_each(self) -> None:
        counts = Counter(
            household["location"]["current_admin_dong_code_20260701"]
            for household in self.households["households"]
        )
        self.assertEqual(set(counts), self.current_dong_codes)
        self.assertEqual(len(counts), 162)
        self.assertTrue(all(20 <= count <= 50 for count in counts.values()))

    def test_one_generic_synthetic_worker_exists_per_current_dong(self) -> None:
        workers = self.workers["workers"]
        worker_codes = {
            worker["location"]["current_admin_dong_code_20260701"] for worker in workers
        }
        self.assertEqual(len(workers), 162)
        self.assertEqual(worker_codes, self.current_dong_codes)
        self.assertTrue(all(worker["synthetic"] is True for worker in workers))
        self.assertTrue(
            all(worker["display_name"].startswith("연결단원 ") for worker in workers)
        )

    def test_records_are_contact_first_without_personal_risk_fields(self) -> None:
        workers = self.workers["workers"]
        households = self.households["households"]
        self.assertEqual(len({worker["id"] for worker in workers}), len(workers))
        self.assertEqual(
            len({household["id"] for household in households}), len(households)
        )
        self.assertFalse(FORBIDDEN_KEYS.intersection(iter_keys(self.workers)))
        self.assertFalse(FORBIDDEN_KEYS.intersection(iter_keys(self.households)))
        for household in households:
            with self.subTest(record_id=household["id"]):
                self.assertTrue(household["synthetic"] is True)
                self.assertEqual(set(household["contact"]), CONTACT_REQUIRED_KEYS)
                self.assertEqual(
                    household["contact"]["preferred_contact_method"] in {"phone", "visit"},
                    True,
                )
                self.assertGreaterEqual(
                    household["contact"]["consecutive_no_answer_count"], 0
                )
                self.assertEqual(set(household["workflow"]), WORKFLOW_REQUIRED_KEYS)
                self.assertIn(
                    household["workflow"]["visit_approval_status"],
                    {None, "recommended", "approved", "rejected"},
                )
                self.assertIn(
                    household["workflow"]["transfer_status"],
                    {"not_required", "recommended", "requested", "transferred", "closed"},
                )
                self.assertIsNone(household["workflow"]["visit_approval_status"])
                self.assertIsNone(household["workflow"]["visit_decision"])
                self.assertIsNone(household["approved_visit_constraints"])

        self.assertTrue(
            all(
                "max_route_distance_km" not in worker["constraints"]
                for worker in workers
            )
        )
        self.assertTrue(
            any(
                household["contact"]["next_contact_date"]
                <= self.households["scenario_reference_date"]
                for household in households
            )
        )
        self.assertTrue(
            any(
                household["contact"]["next_contact_date"]
                > self.households["scenario_reference_date"]
                for household in households
            )
        )
        self.assertTrue(
            any(
                household["contact"]["last_contact_result"] == "no_answer"
                and household["contact"]["consecutive_no_answer_count"] == 1
                and household["contact"]["preferred_contact_method"] == "phone"
                and household["contact"]["next_contact_date"]
                <= self.households["scenario_reference_date"]
                for household in households
            )
        )

    def test_generator_rejects_approval_without_human_decision(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "from pathlib import Path; "
                    "from scripts.generate_synthetic_care_ops import "
                    "load_admin_contract, validate_datasets; "
                    f"import json; workers=json.load(open({str(self.output_dir / 'synthetic-workers.json')!r})); "
                    f"households=json.load(open({str(self.output_dir / 'synthetic-households.json')!r})); "
                    "households['households'][0]['workflow']['visit_approval_status']='approved'; "
                    f"admin,geometry=load_admin_contract(Path({str(CURRENT_DONGS)!r}), Path({str(CROSSWALK)!r}), Path({str(GEOMETRY)!r})); "
                    "validate_datasets(workers, households, admin, geometry)"
                ),
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no_visit_is_preapproved_by_fixture_generation", result.stderr)

    def test_schema_enforces_visit_decision_and_follow_up_state_invariants(self) -> None:
        baseline = copy.deepcopy(self.households["households"][0])
        worker_id = (
            "SYN-W-"
            f"{baseline['location']['current_admin_dong_code_20260701']}-01"
        )
        constraints = {
            "max_route_distance_km": 4,
            "assigned_worker_ids": [worker_id],
            "routing_interpretation": "approved_visit_only_not_person_risk",
        }

        def decision(value: str) -> dict[str, str]:
            return {
                "decision": value,
                "decided_by": "담당자 테스트",
                "decided_at": "2026-08-12T09:00:00+09:00",
                "note": "스키마 상태 전이 테스트",
            }

        def visit_case(
            status: str | None,
            visit_decision: dict[str, str] | None,
            approved_constraints: dict[str, Any] | None,
        ) -> dict[str, Any]:
            household = copy.deepcopy(baseline)
            household["workflow"].update(
                {
                    "follow_up_deadline": None,
                    "follow_up_status": "none",
                    "visit_approval_status": status,
                    "visit_decision": visit_decision,
                }
            )
            household["approved_visit_constraints"] = approved_constraints
            return household

        valid_visit_cases = {
            "not_recommended": visit_case(None, None, None),
            "recommended": visit_case("recommended", None, None),
            "approved": visit_case("approved", decision("approved"), constraints),
            "rejected": visit_case("rejected", decision("rejected"), None),
        }
        invalid_visit_cases = {
            "approved_without_decision": visit_case("approved", None, constraints),
            "approved_with_rejected_decision": visit_case(
                "approved", decision("rejected"), constraints
            ),
            "approved_without_constraints": visit_case(
                "approved", decision("approved"), None
            ),
            "rejected_without_decision": visit_case("rejected", None, None),
            "rejected_with_approved_decision": visit_case(
                "rejected", decision("approved"), None
            ),
            "rejected_with_constraints": visit_case(
                "rejected", decision("rejected"), constraints
            ),
            "recommended_with_decision": visit_case(
                "recommended", decision("approved"), None
            ),
            "recommended_with_constraints": visit_case(
                "recommended", None, constraints
            ),
            "null_status_with_decision": visit_case(None, decision("rejected"), None),
        }

        for name, household in valid_visit_cases.items():
            with self.subTest(state=name, expected="valid"):
                result = validate_household_with_json_schema(household)
                self.assertEqual(result.returncode, 0, result.stderr)
        for name, household in invalid_visit_cases.items():
            with self.subTest(state=name, expected="invalid"):
                result = validate_household_with_json_schema(household)
                self.assertNotEqual(result.returncode, 0, result.stderr)

        for status in ("required", "overdue"):
            household = visit_case(None, None, None)
            household["workflow"].update(
                {"follow_up_status": status, "follow_up_deadline": None}
            )
            with self.subTest(follow_up_status=status, expected="invalid"):
                result = validate_household_with_json_schema(household)
                self.assertNotEqual(result.returncode, 0, result.stderr)

        for status in ("required", "overdue"):
            household = visit_case(None, None, None)
            household["workflow"].update(
                {"follow_up_status": status, "follow_up_deadline": "2026-08-13"}
            )
            with self.subTest(follow_up_status=status, expected="valid"):
                result = validate_household_with_json_schema(household)
                self.assertEqual(result.returncode, 0, result.stderr)

        for status in ("none", "completed"):
            household = visit_case(None, None, None)
            household["workflow"].update(
                {"follow_up_status": status, "follow_up_deadline": None}
            )
            with self.subTest(follow_up_status=status, expected="valid_null_deadline"):
                result = validate_household_with_json_schema(household)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_every_synthetic_coordinate_is_inside_its_declared_2025_zone(self) -> None:
        for collection_name, records in (
            ("workers", self.workers["workers"]),
            ("households", self.households["households"]),
        ):
            for record in records:
                location = record["location"]
                geometry = self.geometry_by_id[location["geometry_zone_id"]]
                with self.subTest(collection=collection_name, record_id=record["id"]):
                    self.assertTrue(
                        point_in_geometry(
                            location["longitude"], location["latitude"], geometry
                        )
                    )

    def test_outputs_are_byte_deterministic_and_manifest_hashes_match(self) -> None:
        for name in OUTPUT_NAMES:
            first = (self.output_dir / name).read_bytes()
            second = (self.second_output_dir / name).read_bytes()
            self.assertEqual(first, second, name)

        for name in OUTPUT_NAMES[:2]:
            digest = hashlib.sha256((self.output_dir / name).read_bytes()).hexdigest()
            self.assertEqual(self.manifest["outputs"][name]["sha256"], digest)

    def test_json_schemas_publish_the_same_contract_version(self) -> None:
        for name in ("synthetic-worker.schema.json", "synthetic-household.schema.json"):
            schema = load_json(REPO_ROOT / "data" / "schemas" / name)
            self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
            self.assertEqual(schema["properties"]["schema_version"]["const"], "2.0.0")
            self.assertFalse(schema.get("additionalProperties", True))

        household_schema = load_json(
            REPO_ROOT / "data" / "schemas" / "synthetic-household.schema.json"
        )
        household_definition = household_schema["$defs"]["household"]
        self.assertIn("contact", household_definition["required"])
        self.assertIn("approved_visit_constraints", household_definition["required"])
        self.assertEqual(
            set(household_schema["$defs"]["contact"]["required"]),
            CONTACT_REQUIRED_KEYS,
        )
        self.assertEqual(
            set(household_schema["$defs"]["workflow"]["required"]),
            WORKFLOW_REQUIRED_KEYS,
        )
        self.assertEqual(
            household_schema["$defs"]["contact"]["properties"]
            ["preferred_contact_method"]["enum"],
            ["phone", "visit"],
        )


if __name__ == "__main__":
    unittest.main()
