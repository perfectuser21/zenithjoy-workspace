"""运行发布闸与 L1 汇总原文，防止失败检查被漏掉或当作业务成功。"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]
SHA = "a" * 40
GATE = ROOT / "scripts/release-gate/two-column-gate.sh"


class BusinessGateTest(unittest.TestCase):
    def run_gate(self, receipt, sha=SHA, bypass="false"):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "receipt.json"
            fixture.write_text(json.dumps(receipt))
            env = {**os.environ, "LC_ALL": "C", "PROMOTE_SHA": sha,
                   "BYPASS_TWO_COLUMN_INFRA": bypass,
                   "GITHUB_STEP_SUMMARY": str(Path(directory) / "summary")}
            return subprocess.run(["bash", str(GATE), "--fixture", str(fixture)],
                                  env=env, capture_output=True, text=True)

    def green(self, **changes):
        return {"finalized": True, "gate_verdict": "green", "backend_sha": SHA, **changes}

    def test_green_finalized_same_full_sha_passes(self):
        result = self.run_gate(self.green())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_failed_or_unverified_receipt_cannot_bypass(self):
        for verdict in ("red", "unknown", "not_evaluated", "", None):
            for bypass in ("false", "true"):
                with self.subTest(verdict=verdict, bypass=bypass):
                    result = self.run_gate(self.green(gate_verdict=verdict,
                        blocked_reason="ai_run_infra_error"), bypass=bypass)
                    self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_wrong_sha_never_passes_even_on_infra_bypass(self):
        result = self.run_gate(self.green(gate_verdict="red",
            blocked_reason="ai_run_infra_error", backend_sha="b" * 40), bypass="true")
        self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_matching_but_invalid_sha_does_not_pass(self):
        for sha in ("", "a" * 7, "g" * 40, "main", "a" * 41):
            with self.subTest(sha=sha):
                result = self.run_gate(self.green(backend_sha=sha), sha=sha)
                self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_finalized_requires_boolean_true(self):
        for value in (False, "true", 1, None):
            with self.subTest(value=value):
                result = self.run_gate(self.green(finalized=value))
                self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_green_with_blocked_reason_cannot_pass(self):
        for reason in ("ai_run_infra_error", "undecided_cells", "cells_red"):
            with self.subTest(reason=reason):
                result = self.run_gate(self.green(blocked_reason=reason))
                self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_supplied_ratchet_requires_complete_nonnegative_integers(self):
        counts = {name: 0 for name in ("force_reason_count", "unverifiable_count",
                                      "waive_count", "bypass_count")}
        for value in (-1, 1.5, "bad", "0", True, None, 4):
            for name in counts:
                with self.subTest(name=name, value=value):
                    result = self.run_gate(self.green(ratchet={**counts, name: value}))
                    self.assertNotEqual(result.returncode, 0, result.stdout)
        for ratchet in ({}, None, [], {"force_reason_count": 0}):
            with self.subTest(ratchet=ratchet):
                result = self.run_gate(self.green(ratchet=ratchet))
                self.assertNotEqual(result.returncode, 0, result.stdout)
        result = self.run_gate(self.green(ratchet={name: 3 for name in counts}))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class L1AggregateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jobs = yaml.safe_load((ROOT / ".github/workflows/ci-l1-process.yml").read_text())["jobs"]
        cls.gate = cls.jobs["l1-passed"]

    def run_aggregate(self, failing_job=None, status="failure"):
        # Execute the actual workflow shell after substituting GitHub needs results.
        # Missing dependencies expose no result, matching the needs context contract.
        results = {job: (status if job == failing_job else "success")
                   for job in self.gate["needs"]}
        script = "\n".join(step.get("run", "") for step in self.gate["steps"])
        script = re.sub(r"\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}",
                        lambda match: results.get(match.group(1), ""), script)
        return subprocess.run(["bash", "-e", "-c", script], capture_output=True, text=True)

    def test_all_success_can_pass(self):
        result = self.run_aggregate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_every_child_failure_skip_or_cancel_blocks_aggregate(self):
        for job in self.jobs:
            if job == "l1-passed":
                continue
            for status in ("failure", "cancelled", "skipped"):
                with self.subTest(job=job, status=status):
                    result = self.run_aggregate(job, status)
                    self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_gate_waits_for_every_child(self):
        # A gate must not finish while an unlisted check can still fail later.
        self.assertEqual(set(self.gate["needs"]), set(self.jobs) - {"l1-passed"})


if __name__ == "__main__":
    unittest.main()
