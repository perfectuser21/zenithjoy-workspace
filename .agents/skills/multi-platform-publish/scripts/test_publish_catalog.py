"""路由 smoke：只读计划、类型隔离、缺项显式失败，不连接发布平台。"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


HERE = Path(__file__).resolve().parent


class CatalogSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("publish_catalog", HERE / "publish_catalog.py")
        cls.catalog = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.catalog)
        # CI 路由测试使用独立文件夹具，不依赖执行机的真实账号和旧手册安装。
        cls.skill_fixture = tempfile.TemporaryDirectory()
        cls.catalog.SKILLS = Path(cls.skill_fixture.name)
        for name in ("douyin-publisher", "wechat-publisher"):
            folder = cls.catalog.SKILLS / name
            folder.mkdir()
            (folder / "SKILL.md").write_text("# 路由文件夹具；不代表实际发布手册\n")

    @classmethod
    def tearDownClass(cls):
        cls.skill_fixture.cleanup()

    def test_douyin_article_keeps_article_entrypoint(self):
        plan = self.catalog.plan("douyin", "article", "browser")
        self.assertTrue(plan["entrypoint"].endswith("publish-douyin-article.cjs"))
        self.assertFalse(plan["executed"])
        self.assertEqual(plan["runtime_validation"], "pending")

    def test_missing_phone_zhihu_has_no_fallback(self):
        with self.assertRaisesRegex(ValueError, "未找到"):
            self.catalog.plan("zhihu", "video", "phone")

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


if __name__ == "__main__":
    unittest.main()
