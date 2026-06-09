"""
test_preflight_lock.py — TDD Red 阶段：preflight.py 四层锁扩展验证 + 降级路径覆盖

Red 证据（Generator 实现前在 windows-latest 上的预期结果）：
  - TestFourLayerLock::test_layer2_icacls_deny   → FAIL（check_lock_update 未加 icacls，输出无 DENY）
  - TestFourLayerLock::test_layer3_domain_firewall → FAIL（当前封程序路径非域名，无 dldir1v6.qq.com）
  - TestFourLayerLock::test_layer4_registry_autoupdate → FAIL（注册表键不存在，Generator 未写入）

降级路径（代码已存在，补覆盖）：
  - TestDowngradePath::test_version_419_* → 预期 PASS（check_wechat_version 降级逻辑已在 line 428-429）
    这两条测试保护既有逻辑不被 Generator 意外删除

运行方式：
  # Windows（全部测试）：
  python -m pytest services/agent/wechat-rpa/tests/test_preflight_lock.py -v

  # Mac/Linux（仅降级路径）：
  python -m pytest services/agent/wechat-rpa/tests/test_preflight_lock.py -v -k TestDowngradePath
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

from preflight import CHECK_NAMES, check_lock_update, check_wechat_version


class TestDowngradePath(unittest.TestCase):
    """PRD 边界情况：微信版本 ≥4.1.9 → 降级路径被检测到（跨平台，用 mock）"""

    def test_version_419_dry_run_returns_failed_with_418_message(self):
        """版本 4.1.9 在 dry_run 模式下 → status=failed，detail 含 4.1.8"""
        with patch("preflight.get_weixin_version", return_value="4.1.9"), \
             patch("preflight._is_windows", return_value=True):
            result = check_wechat_version(dry_run=True)
        self.assertEqual(
            result["status"],
            "failed",
            f"版本 4.1.9 在 dry_run 下应返回 failed，实际: {result['status']}",
        )
        self.assertIn(
            "4.1.8",
            result.get("detail", ""),
            "detail 应包含 '4.1.8' 降级说明",
        )

    def test_version_420_also_triggers_downgrade_detection(self):
        """版本 4.2.0（高于 4.1.9）同样触发降级检测"""
        with patch("preflight.get_weixin_version", return_value="4.2.0"), \
             patch("preflight._is_windows", return_value=True):
            result = check_wechat_version(dry_run=True)
        self.assertEqual(result["status"], "failed",
            f"版本 4.2.0 在 dry_run 下应返回 failed，实际: {result['status']}")

    def test_lock_update_check_name_is_correct(self):
        """CHECK_NAMES[3] == 'lock_update'（索引不串位保护）"""
        self.assertEqual(CHECK_NAMES[3], "lock_update",
            f"CHECK_NAMES[3] 应为 'lock_update'，实际: {CHECK_NAMES[3]}")

    def test_lock_update_returns_dict_with_required_fields(self):
        """check_lock_update() 返回值含 name/status/detail 字段（跨平台接口契约）"""
        result = check_lock_update(dry_run=True)
        self.assertIn("name", result, "返回值缺 'name' 字段")
        self.assertIn("status", result, "返回值缺 'status' 字段")
        self.assertEqual(result["name"], "lock_update",
            f"name 应为 'lock_update'，实际: {result['name']}")



def _is_admin() -> bool:
    """检查当前进程是否有管理员权限（Windows 下 icacls /deny 需要 admin）"""
    if sys.platform != 'win32':
        return False
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False

@unittest.skipUnless(sys.platform == "win32", "四层锁仅在 Windows 执行（Red 证据在 windows-latest 上验证）")
class TestFourLayerLock(unittest.TestCase):
    """四层锁扩展：Generator 实现前在 windows-latest 上全部 FAIL（Red 阶段）"""

    def setUp(self):
        import shutil
        import tempfile

        self.tmpdir = tempfile.mkdtemp(prefix="zj-lock-test-")
        shutil.copy(
            r"C:\Windows\System32\notepad.exe",
            os.path.join(self.tmpdir, "WeixinUpdate.exe"),
        )

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run_lock(self):
        with patch("preflight.WEIXIN_INSTALL_ROOT", self.tmpdir):
            return check_lock_update(dry_run=False)

    def test_layer1_file_renamed_to_disabled(self):
        """Layer 1: WeixinUpdate.exe 已改名为 .disabled（现有逻辑，预期 PASS 作为基准）"""
        result = self._run_lock()
        disabled = os.path.join(self.tmpdir, "WeixinUpdate.exe.disabled")
        self.assertTrue(
            os.path.exists(disabled),
            f"Layer1: {disabled} 不存在，rename 未执行",
        )
        self.assertIn(result["status"], ("ok", "fixed", "warn"),
            f"Layer1 后 status 应为 ok/fixed/warn，实际: {result['status']}")

    @unittest.skipUnless(_is_admin(), "需要 admin 权限（windows-latest/SYSTEM 才有，普通用户跳过）")
    def test_layer2_icacls_deny_after_lock(self):
        """Layer 2: disabled 文件 icacls 含 DENY（Generator 未实现前 FAIL）"""
        import subprocess

        self._run_lock()
        disabled = os.path.join(self.tmpdir, "WeixinUpdate.exe.disabled")
        self.assertTrue(os.path.exists(disabled), f"前置 Layer1 FAIL: {disabled} 不存在")
        r = subprocess.run(["icacls", disabled], capture_output=True, text=True)
        self.assertIn(
            "DENY",
            r.stdout,
            f"Layer2: icacls 无 DENY 输出（Generator 需实现 icacls /deny）: {r.stdout[:200]}",
        )

    @unittest.skipUnless(_is_admin(), "需要 admin 权限（netsh 防火墙规则需管理员；普通用户跳过）")
    def test_layer3_domain_firewall_dldir1v6(self):
        """Layer 3: 防火墙出站规则含 dldir1v6.qq.com 域名封禁（Generator 未实现前 FAIL）"""
        import subprocess

        self._run_lock()
        fw = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", "name=all"],
            capture_output=True,
            text=True,
            errors="replace",
        )
        self.assertIn(
            "dldir1v6.qq.com",
            fw.stdout,
            "Layer3: 防火墙无 dldir1v6.qq.com 域名封禁规则（Generator 需实现域名 block，不仅是程序路径 block）",
        )

    def test_layer4_registry_autoupdate_zero(self):
        """Layer 4: HKLM\\SOFTWARE\\Policies\\Tencent\\WeChat\\AutoUpdate == 0（Generator 未实现前 FAIL）"""
        import winreg

        self._run_lock()
        try:
            k = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Policies\Tencent\WeChat",
            )
            v, _ = winreg.QueryValueEx(k, "AutoUpdate")
            self.assertEqual(
                v,
                0,
                f"Layer4: AutoUpdate={v}，期望 0",
            )
        except FileNotFoundError:
            self.fail(
                "Layer4: 注册表键 HKLM\\SOFTWARE\\Policies\\Tencent\\WeChat\\AutoUpdate 不存在，"
                "Generator 尚未实现注册表写入"
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
