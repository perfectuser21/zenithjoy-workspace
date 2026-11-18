"""运行发布闸与 L1 汇总原文，防止失败检查被漏掉或当作业务成功。"""
import json
import os
from pathlib import Path
import re
import shutil
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

    def test_missing_receipt_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(["bash", str(GATE), "--fixture",
                                     str(Path(directory) / "missing.json")],
                                    env={**os.environ, "PROMOTE_SHA": SHA},
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

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


class FrontendBrowserDodTest(unittest.TestCase):
    def run_frontend_check(self, paths):
        jobs = yaml.safe_load((ROOT / ".github/workflows/ci-l1-process.yml").read_text())["jobs"]
        step = next(step for step in jobs["static-pr-checks"]["steps"]
                    if step.get("name") == "Detect frontend changes and check browser DoD")
        script = step["run"].replace("${{ github.base_ref }}", "main")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".dod.md").write_text("")
            binary = root / "bin"
            binary.mkdir()
            git = binary / "git"
            git.write_text('#!/bin/sh\nprintf "%s\\n" "$FRONTEND_CHANGED_FILES"\n')
            git.chmod(0o755)
            env = {**os.environ, "PATH": str(binary) + os.pathsep + os.environ["PATH"],
                   "BRANCH": "cp-browser-scope", "FRONTEND_CHANGED_FILES": "\n".join(paths)}
            return subprocess.run(["bash", "-e", "-o", "pipefail", "-c", script],
                                  cwd=root, env=env, capture_output=True, text=True)

    def test_test_only_changes_do_not_require_browser_dod(self):
        for app in ("api", "dashboard", "staff-hub"):
            for relative in ("tests/deploy/release.test.ts", "test/health.ts",
                             "src/__tests__/health.ts", "src/health.test.ts",
                             "src/health.spec.tsx", "src/probe.test.mjs"):
                with self.subTest(app=app, relative=relative):
                    result = self.run_frontend_check([f"apps/{app}/{relative}"])
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_frontend_source_still_requires_browser_dod(self):
        for app in ("dashboard", "staff-hub"):
            for relative in ("src/app.ts", "src/TestButton.tsx", "src/styles.css"):
                with self.subTest(app=app, relative=relative):
                    result = self.run_frontend_check([f"apps/{app}/{relative}"])
                    self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_api_source_uses_api_gate_not_browser_dod(self):
        result = self.run_frontend_check(["apps/api/src/services/walking-skeleton.service.ts",
                                          "apps/api/src/routes/agent.ts"])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_test_changes_cannot_hide_real_source(self):
        result = self.run_frontend_check(["apps/api/tests/deploy/health.test.ts",
                                          "apps/staff-hub/src/pages/Home.tsx"])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_unrelated_changes_do_not_require_browser_dod(self):
        result = self.run_frontend_check(["scripts/deploy/hk-api-release.sh"])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class L1AggregateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jobs = yaml.safe_load((ROOT / ".github/workflows/ci-l1-process.yml").read_text())["jobs"]
        cls.gate = cls.jobs["l1-passed"]

    def run_aggregate(self, failing_job=None, status="failure", event="pull_request"):
        # Execute the actual workflow shell after substituting GitHub needs results.
        # Missing dependencies expose no result, matching the needs context contract.
        results = {job: (status if job == failing_job else "success")
                   for job in self.gate["needs"]}
        script = "\n".join(step.get("run", "") for step in self.gate["steps"])
        script = re.sub(r"\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}",
                        lambda match: results.get(match.group(1), ""), script)
        return subprocess.run(["bash", "-e", "-c", script], capture_output=True, text=True,
                              env={**os.environ, "GITHUB_EVENT_NAME": event})

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

    def test_merge_queue_remains_closed_without_pr_metadata_evidence(self):
        result = self.run_aggregate(event="merge_group")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)


class ReleaseToolingConsolidationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jobs = yaml.safe_load((ROOT / ".github/workflows/ci-l1-process.yml").read_text())["jobs"]
        cls.job = cls.jobs["test-deploy-lib"]

    def step(self, name):
        return next(s for s in self.job["steps"] if s.get("name") == name)

    def test_both_release_guards_run_without_skips_in_required_l1(self):
        self.assertNotIn("test-install-pack-ascii", self.jobs)
        self.assertIn("test-deploy-lib", self.jobs["l1-passed"]["needs"])
        self.assertNotIn("if", self.job)
        for name in ("shellcheck deploy-lib", "Run current deployment library regressions (atomic/frontend/manual rollback)",
                     "shellcheck install-pack-ascii test", "Run install-pack-ascii guard (start.bat 含中文必报红)"):
            step = self.step(name)
            self.assertNotIn("if", step)
            self.assertFalse(step.get("continue-on-error", False))
        self.assertEqual(self.step("Run current deployment library regressions (atomic/frontend/manual rollback)")["timeout-minutes"], 10)
        self.assertEqual(self.step("Run install-pack-ascii guard (start.bat 含中文必报红)")["timeout-minutes"], 5)

    def test_actual_install_pack_step_rejects_bom_and_non_ascii(self):
        command = self.step("Run install-pack-ascii guard (start.bat 含中文必报红)")["run"]
        with tempfile.TemporaryDirectory(prefix="installpack-gate-") as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", directory], check=True)
            pack = root / "services/agent/install-pack"
            (pack / "__tests__").mkdir(parents=True)
            shutil.copy2(ROOT / "services/agent/install-pack/__tests__/install-pack-ascii.test.sh",
                         pack / "__tests__/install-pack-ascii.test.sh")
            (pack / "README.txt").write_text("readme\n")
            bat = pack / "start.bat"
            run = lambda: subprocess.run(["bash", "-e", "-c", command], cwd=root, capture_output=True, text=True)
            bat.write_bytes(b"@echo off\r\n")
            self.assertEqual(run().returncode, 0)
            bat.write_bytes(b"\xef\xbb\xbf@echo off\r\n")
            self.assertNotEqual(run().returncode, 0)
            bat.write_text("@echo off\necho 中文\n")
            self.assertNotEqual(run().returncode, 0)
            bat.write_bytes(b"@echo off\r\n")
            (pack / "中文.txt").write_text("fixture")
            self.assertNotEqual(run().returncode, 0)

    def test_actual_shell_steps_propagate_failure(self):
        commands = [self.step("shellcheck deploy-lib")["run"],
                    self.step("shellcheck install-pack-ascii test")["run"],
                    self.step("Run current deployment library regressions (atomic/frontend/manual rollback)")["run"]]
        with tempfile.TemporaryDirectory(prefix="release-gate-failure-") as directory:
            root = Path(directory)
            binary = root / "bin"
            binary.mkdir()
            shellcheck = binary / "shellcheck"
            shellcheck.write_text('#!/bin/sh\ncase "$*" in *"$FAIL_TARGET"*) exit 42;; esac\nexit 0\n')
            shellcheck.chmod(0o755)
            deploy_test = root / ".github/workflows/scripts/__tests__/deploy-lib.test.sh"
            deploy_test.parent.mkdir(parents=True)
            deploy_test.write_text("#!/bin/bash\nexit 43\n")
            env = {**os.environ, "PATH": str(binary) + os.pathsep + os.environ["PATH"]}
            for target, command in [("scripts/deploy-lib.sh", commands[0]),
                                    ("scripts/__tests__/deploy-lib.test.sh", commands[0]),
                                    ("rollback.sh", commands[0]),
                                    ("install-pack-ascii.test.sh", commands[1])]:
                result = subprocess.run(["bash", "-e", "-c", command], cwd=root,
                                        env={**env, "FAIL_TARGET": target}, capture_output=True, text=True)
                self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
            result = subprocess.run(["bash", "-e", "-c", commands[2]], cwd=root, env=env,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 43, result.stdout + result.stderr)


class StaticPrChecksTest(unittest.TestCase):
    def metadata_step(self, name, **environment):
        jobs = yaml.safe_load((ROOT / ".github/workflows/ci-l1-process.yml").read_text())["jobs"]
        step = next(s for s in jobs["static-pr-checks"]["steps"] if s.get("name") == name)
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "bin"
            binary.mkdir()
            git = binary / "git"
            git.write_text('#!/bin/sh\nif [ "$1" = diff ] && [ "$2" = --name-only ]; then printf "%s\\n" "$CHANGED_FILES"; fi\n')
            git.chmod(0o755)
            env = {**os.environ, "PATH": str(binary) + os.pathsep + os.environ["PATH"],
                   "BASE_REF": "main", "EVENT_NAME": "pull_request", "PR_HEAD_REF": "cp-11181510-test",
                   "CHANGED_FILES": "", **environment}
            return subprocess.run(["bash", "-e", "-c", step["run"]], cwd=directory,
                                  env=env, capture_output=True, text=True)

    def test_metadata_checks_remain_required_and_fail_on_invalid_inputs(self):
        jobs = yaml.safe_load((ROOT / ".github/workflows/ci-l1-process.yml").read_text())["jobs"]
        for old in ("verify-dev-workflow", "pr-title", "ci-config-audit", "frontend-browser-dod-check"):
            self.assertNotIn(old, jobs)
        self.assertIn("static-pr-checks", jobs["l1-passed"]["needs"])
        for name in ("验证分支必须通过 /dev 创建", "Check PR title follows conventional commits",
                     "Audit CI config changes", "Detect frontend changes and check browser DoD"):
            step = next(s for s in jobs["static-pr-checks"]["steps"] if s.get("name") == name)
            self.assertNotIn("if", step)
            self.assertFalse(step.get("continue-on-error", False))
        branch = "验证分支必须通过 /dev 创建"
        title = "Check PR title follows conventional commits"
        config = "Audit CI config changes"
        self.assertEqual(self.metadata_step(branch, DEV_BRANCH="cp-11181510-test").returncode, 0)
        self.assertNotEqual(self.metadata_step(branch, DEV_BRANCH="main").returncode, 0)
        self.assertEqual(self.metadata_step(title, TITLE="[CONFIG] fix(ci): test").returncode, 0)
        self.assertNotEqual(self.metadata_step(title, TITLE="untagged title").returncode, 0)
        self.assertNotEqual(self.metadata_step(config, PR_TITLE="fix(ci): test",
                            CHANGED_FILES=".github/workflows/ci-l1-process.yml").returncode, 0)
        self.assertEqual(self.metadata_step(config, PR_TITLE="[CONFIG] fix(ci): test",
                         CHANGED_FILES=".github/workflows/ci-l1-process.yml").returncode, 0)
        self.assertEqual(self.metadata_step(config, PR_TITLE="fix(ci): test",
                         CHANGED_FILES="apps/api/src/index.ts").returncode, 0)

    def test_line04_pr_does_not_duplicate_branch_push_and_preserves_other_entries(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/golden-path-4-smoke.yml").read_text())
        triggers = workflow.get("on", workflow.get(True))
        self.assertEqual(triggers["push"]["branches"], ["main"])
        self.assertEqual(triggers["pull_request"]["branches"], ["main"])
        self.assertIn("workflow_dispatch", triggers)
        self.assertEqual(set(workflow["jobs"]["golden-path-4-smoke"]["needs"]),
                         {"ws1", "ws2", "ws3", "ws4", "ws5"})

    def test_static_lints_share_one_checkout_and_keep_every_command(self):
        jobs = yaml.safe_load((ROOT / ".github/workflows/ci-l1-process.yml").read_text())["jobs"]
        job = jobs["static-pr-checks"]
        self.assertEqual(job["if"], "github.event_name == 'pull_request'")
        self.assertEqual(sum(s.get("uses") == "actions/checkout@v4" for s in job["steps"]), 1)
        commands = "\n".join(s.get("run", "") for s in job["steps"])
        for name in ("test-pairing", "test-quality", "tdd-commit-order", "no-fake-test",
                     "smoke-mock-honesty", "rpa-failure-scene", "feature-has-smoke",
                     "gp-anchor", "agent-version-bump", "line04-manifest-version-bump",
                     "contract-test-immutability"):
            self.assertEqual(commands.count("scripts/lint-" + name + ".sh"), 1, name)
        self.assertNotIn("lint-wechat-rpa-runner.sh", commands)
        self.assertNotIn("lint-nightly-sparse-checkout-deps.sh", commands)
        self.assertFalse(any(s.get("continue-on-error") for s in job["steps"]))
        self.assertIn("static-pr-checks", jobs["l1-passed"]["needs"])


if __name__ == "__main__":
    unittest.main()
