"""路由 smoke：只读计划、类型隔离、缺项显式失败，不连接发布平台。"""
import contextlib
import importlib.util
import io
import json
import hashlib
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


class CatalogSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("publish_catalog", HERE / "publish_catalog.py")
        cls.catalog = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.catalog)
        original_workspace = cls.catalog.WORKSPACE
        cls.legacy_workspace = tempfile.TemporaryDirectory()
        cls.catalog.WORKSPACE = Path(cls.legacy_workspace.name)
        original_catalog = cls.catalog.load_catalog()
        cls.catalog.CATALOG = cls.catalog.WORKSPACE / "catalog.json"
        cls.catalog.CATALOG.write_text(json.dumps(original_catalog))
        for route in original_catalog["routes"]:
            for channel in route["channels"].values():
                for source in (channel["source"], channel.get("instruction")):
                    if source and source["root"] == "workspace":
                        target = cls.catalog.WORKSPACE / source["path"]
                        target.parent.mkdir(parents=True, exist_ok=True)
                        if not target.exists():
                            target.symlink_to(original_workspace / source["path"])
        # CI 路由测试使用独立文件夹具，不依赖执行机的真实账号和旧手册安装。
        cls.skill_fixture = tempfile.TemporaryDirectory()
        cls.catalog.SKILLS = Path(cls.skill_fixture.name)
        for name in ("douyin-publisher", "wechat-publisher", "android-publish"):
            folder = cls.catalog.SKILLS / name
            folder.mkdir()
            (folder / "SKILL.md").write_text("# 路由文件夹具；不代表实际发布手册\n")

    @classmethod
    def tearDownClass(cls):
        cls.skill_fixture.cleanup()
        cls.legacy_workspace.cleanup()

    def test_douyin_article_keeps_article_entrypoint(self):
        plan = self.catalog.plan("douyin", "article", "browser")
        self.assertTrue(plan["entrypoint"].endswith("publish-douyin-article.cjs"))
        self.assertFalse(plan["executed"])
        self.assertEqual(plan["runtime_validation"], "pending")

    def test_unknown_phone_zhihu_type_has_no_fallback(self):
        with self.assertRaisesRegex(ValueError, "未找到"):
            self.catalog.plan("zhihu", "image", "phone")

    def test_additional_android_modes_use_phone_guidance(self):
        for platform, kind in (("xiaohongshu", "image"), ("xiaohongshu", "article"),
                               ("toutiao", "article"), ("weibo", "article"),
                               ("zhihu", "idea"), ("zhihu", "video"), ("zhihu", "article")):
            with self.subTest(platform=platform, kind=kind):
                plan = self.catalog.plan(platform, kind, "phone")
                self.assertTrue(plan["entrypoint"].endswith("android-additional-modes.md"))
                self.assertEqual(plan["channel"], "phone")
                self.assertTrue(any(p.endswith("android-publish/SKILL.md") for p in plan["instructions"]))
                self.assertFalse(plan["executed"])
                self.assertEqual(plan["runtime_validation"], "pending")

    def test_current_scope_has_21_android_modes_and_one_wechat_api(self):
        scope = self.catalog.load_catalog()["active_acceptance_scope"]
        self.assertEqual(len(scope), 22)
        self.assertEqual(len(set(scope)), 22)
        self.assertEqual(sum(r.endswith(".phone") for r in scope), 21)
        self.assertEqual([r for r in scope if r.startswith("wechat.")], ["wechat.article.api"])

    def test_wechat_api_is_mass_send_not_draft_completion(self):
        plan = self.catalog.plan("wechat", "article", "api")
        self.assertTrue(plan["entrypoint"].endswith("wechat-mp-freepublish.py"))
        self.assertIn("SEND_SUCCESS", plan["readback"])

    def test_wechat_browser_preserves_long_article_input(self):
        plan = self.catalog.plan("wechat", "article", "browser")
        self.assertIn("body_html", plan["interface"])
        self.assertIn("markdown_path", plan["interface"])

    def test_same_content_is_not_counted_twice_for_two_channels(self):
        catalog = self.catalog.load_catalog()
        keys = [(r["platform"], r["type"]) for r in catalog["routes"]]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(catalog["logical_route_count"], len(keys))
        self.assertEqual(len([p for p, t in keys if p == "douyin"]), 3)

    def test_long_image_is_image_and_image_video_is_ambiguous(self):
        self.assertEqual(self.catalog.normalize_type("长图文"), "image")
        with self.assertRaisesRegex(ValueError, "成品"):
            self.catalog.normalize_type("图文短视频")

    def test_nonexistent_sources_fail_before_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, "不存在"):
                self.catalog.plan("douyin", "video", "browser", workspace=Path(folder))

    def test_unknown_types_do_not_fall_back_to_image(self):
        with self.assertRaises(ValueError):
            self.catalog.plan("kuaishou", "article", "browser")

    def test_cli_only_outputs_plan(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = self.catalog.main(["plan", "--platform", "douyin", "--type", "video", "--channel", "browser"])
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(output.getvalue())["executed"])


class PinnedReleaseSmoke(unittest.TestCase):
    """用两个真实 Git 源版本验证发布路由；不访问网络、不启动发布。"""
    def git(self, root, *args):
        return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", str(root), *args], stderr=subprocess.PIPE).decode().strip()

    def commit(self, root):
        self.git(root, "add", ".")
        self.git(root, "commit", "-qm", "fixture")
        return self.git(root, "rev-parse", "HEAD")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.workspace = self.root / "release"
        self.source = self.root / "source"
        for root in (self.workspace, self.source):
            root.mkdir()
            self.git(root, "init", "-q")
            self.git(root, "config", "user.email", "fixture@example.invalid")
            self.git(root, "config", "user.name", "fixture")
        spec = importlib.util.spec_from_file_location("pinned_catalog", HERE / "publish_catalog.py")
        self.catalog = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.catalog)
        self.catalog.WORKSPACE = self.workspace
        self.catalog.SKILLS = self.root / "zenithjoy-skills"
        for name in ("android-douyin-publish", "android-publish"):
            target = self.catalog.SKILLS / name / "SKILL.md"
            target.parent.mkdir(parents=True)
            target.write_text("mutable-development-copy")
        self.catalog.CATALOG = self.workspace / ".agents/skills/multi-platform-publish/references/catalog.json"
        bootstrap = self.workspace / "scripts/skills-source.py"
        bootstrap.parent.mkdir()
        bootstrap.write_bytes((HERE.parents[3] / "scripts/skills-source.py").read_bytes())
        self.catalog_data = {"routes": [{"platform": "douyin", "type": "video", "name": "test", "channels": {
            "phone": {"source": {"root": "skills", "path": "android-douyin-publish/SKILL.md"}}}}]}
        self.versions = []
        for version in ("one", "two"):
            payloads = {
                ".agents/skills/multi-platform-publish/references/catalog.json": json.dumps(self.catalog_data).encode(),
                ".skills-runtime/android-douyin-publish/SKILL.md": ("phone-" + version).encode(),
                ".skills-runtime/android-publish/SKILL.md": ("base-" + version).encode(),
            }
            entries = []
            for index, (dest, content) in enumerate(payloads.items()):
                src = "source-" + str(index)
                (self.source / src).write_bytes(content)
                entries.append({"path": dest, "source": src, "sha256": hashlib.sha256(content).hexdigest()})
            (self.source / "distribution").mkdir(exist_ok=True)
            (self.source / "distribution/catalog.json").write_text(json.dumps({"profiles": {"zenithjoy": {"files": entries}}}))
            sha = self.commit(self.source)
            lock = {"repository": "perfectuser21/zenithjoy-skills", "revision": sha, "profile": "zenithjoy", "loader_sha256": "0" * 64}
            (self.workspace / ".skills-source.json").write_text(json.dumps(lock))
            ref = self.commit(self.workspace)
            self.versions.append((ref, lock, payloads))
        subprocess.run(["git", "clone", "-q", str(self.source), str(self.workspace / ".skills-source")], check=True)
        self.install(1)

    def install(self, version):
        for path, content in self.versions[version][2].items():
            target = self.workspace / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)

    def plan(self, **kwargs):
        return self.catalog.plan("douyin", "video", "phone", **kwargs)

    def test_routes_resolve_to_verified_local_release_files_for_both_source_shas(self):
        for index, (ref, _, _) in enumerate(self.versions):
            with self.subTest(version=index):
                self.install(index)
                result = self.plan(ref=ref)
                self.assertEqual(result["entrypoint"], str(self.workspace / ".skills-runtime/android-douyin-publish/SKILL.md"))
                self.assertEqual(result["instructions"], [str(self.workspace / ".skills-runtime/android-publish/SKILL.md")])
                self.assertFalse(result["executed"])

    def test_old_release_ignores_uncommitted_new_lock_and_adjacent_skill_edits(self):
        self.install(0)
        adjacent = self.root / "zenithjoy-skills/android-douyin-publish/SKILL.md"
        adjacent.parent.mkdir(parents=True, exist_ok=True)
        adjacent.write_text("unreleased-change")
        before = self.plan(ref=self.versions[0][0])
        (self.workspace / ".skills-source.json").write_text(json.dumps(self.versions[1][1]))
        adjacent.write_text("another-change")
        self.assertEqual(before, self.plan(ref=self.versions[0][0]))

    def test_tampered_or_missing_runtime_rejected_even_with_forged_state(self):
        target = self.workspace / ".skills-runtime/android-publish/SKILL.md"
        (self.workspace / ".skills-source-state.json").write_text(json.dumps({"verified": True}))
        target.write_text("tampered")
        with self.assertRaises(ValueError):
            self.plan()
        target.unlink()
        with self.assertRaises(ValueError):
            self.plan()

    def test_tampered_generated_catalog_and_untrusted_overrides_rejected(self):
        self.catalog.CATALOG.write_text(json.dumps({"routes": []}))
        with self.assertRaises(ValueError):
            self.plan()
        self.install(1)
        for name in ("ZENITHJOY_SKILLS_ROOT", "ZENITHJOY_WORKSPACE_ROOT"):
            with self.subTest(name=name), patch.dict(os.environ, {name: str(self.root)}):
                with self.assertRaises(ValueError):
                    self.plan()
        with self.assertRaises(ValueError):
            self.plan(skills=self.root)

    def test_runtime_symlink_is_rejected_and_mutable_bootstrap_not_executed(self):
        target = self.workspace / ".skills-runtime/android-publish/SKILL.md"
        escaped = self.root / "same-bytes"
        escaped.write_bytes(target.read_bytes())
        target.unlink()
        target.symlink_to(escaped)
        with self.assertRaises(ValueError):
            self.plan()
        target.unlink()
        self.install(1)
        (self.workspace / "scripts/skills-source.py").write_text("raise RuntimeError('mutable bootstrap must not execute')")
        self.assertTrue(self.plan()["entrypoint"].endswith("android-douyin-publish/SKILL.md"))


if __name__ == "__main__":
    unittest.main()
