"""
test_preflight_lock.py — preflight.py 版本降级路径覆盖（锁版本动作已删，本文件只留版本判定守卫）。

【2026-06-24】lock-update（锁微信 4.1.8 + 禁自动更新四层锁）整套删除——实测锁不住（客户机重启
微信自动升 4.1.10），且 4.1.10 UIA 客服照样能发，锁既无效又无必要。故 check_lock_update 已移除，
CHECK_NAMES 不再含 lock_update（8 项检测）。本文件保留版本降级路径（< 4.1.8 仍降级）的覆盖。

运行：
  python -m pytest services/agent/wechat-rpa/tests/test_preflight_lock.py -v
"""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

from preflight import CHECK_NAMES, check_wechat_version


class TestVersionDowngradePath(unittest.TestCase):
    """只认 4.1.8.x：< 4.1.8 降级；>= 4.1.9（含 4.1.10）也降级（2026-06-29 锁回 4.1.8.x）。"""

    def test_version_417_below_baseline_downgrade(self):
        """版本 4.1.7（< 4.1.8 下界）在 dry_run 模式下 → status=failed，detail 含 4.1.8。"""
        with patch("preflight.get_weixin_version", return_value="4.1.7"), \
             patch("preflight._is_windows", return_value=True):
            result = check_wechat_version(dry_run=True)
        self.assertEqual(result["status"], "failed",
            f"版本 4.1.7（<4.1.8）应 failed，实际: {result['status']}")
        self.assertIn("4.1.8", result.get("detail", ""),
            "detail 应包含 '4.1.8' 降级说明")

    def test_version_4110_above_baseline_downgrade(self):
        """版本 4.1.10（>= 4.1.9 上界）→ status=failed（锁 4.1.8.x，控件适配未做，降级回 4.1.8）。"""
        with patch("preflight.get_weixin_version", return_value="4.1.10"), \
             patch("preflight._is_windows", return_value=True):
            result = check_wechat_version(dry_run=True)
        self.assertEqual(result["status"], "failed",
            f"版本 4.1.10（>=4.1.9）应降级 failed，实际: {result['status']}")
        self.assertIn("4.1.8", result.get("detail", ""),
            "detail 应包含 '4.1.8' 降级说明")


class TestCheckNamesNoLockUpdate(unittest.TestCase):
    """锁版本动作已删：CHECK_NAMES 不再含 lock_update，共 8 项。"""

    def test_lock_update_removed_from_check_names(self):
        self.assertNotIn("lock_update", CHECK_NAMES,
            "lock_update 应已从 CHECK_NAMES 移除（锁版本动作整套删除）")

    def test_check_names_count_is_8(self):
        self.assertEqual(len(CHECK_NAMES), 8,
            f"删 lock_update 后应为 8 项，实际: {len(CHECK_NAMES)}")


if __name__ == "__main__":
    unittest.main()
