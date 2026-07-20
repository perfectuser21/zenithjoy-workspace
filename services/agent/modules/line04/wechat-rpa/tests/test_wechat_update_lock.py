"""
test_wechat_update_lock.py — 强版"关死微信自动更新"模块单测（commit1/Red）。

【背景】#853 删了弱锁（实测锁不住）。真因（xian-rog 真机实测）：
  ① 路径写死 C:\\Program Files\\Tencent\\Weixin，没复用 find_weixin.discover_weixin_exe()
  ② 只锁 install-dir 的 WeixinUpdate.exe，漏了 AppData xwechat 插件系统的活更新器
     %APPDATA%\\Tencent\\xwechat\\xplugin\\plugins\\WeixinUpdate\\<id>\\extracted\\WeixinUpdate.exe
     —— 那才是 4.1.10 自升的真实通道。

强版从干净态重建：可靠定位（复用 discover）+ 两处更新器全找 + hosts 屏蔽 + 杀进程 +
AutoUpdate 注册表 + 每轮重施 + verify。本测试只测**纯逻辑**（不碰 windll/winreg/真删文件），
mac/linux 可直接 pytest 跑通。
"""
from __future__ import annotations

import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import wechat_update_lock as wul  # noqa: E402


# ---------- 更新器搜索根：必须含 install-dir + AppData xwechat 两处 ----------


def test_updater_search_roots_includes_appdata_xwechat():
    """搜索根必须含 AppData xwechat 插件目录（弱锁漏的真实自升通道），不能只有 install-dir。"""
    roots = wul.updater_search_roots(install_dir=r"C:\Program Files\Tencent\Weixin",
                                     appdata=r"C:\Users\u\AppData\Roaming")
    joined = " | ".join(roots).lower()
    assert "xwechat" in joined and "weixinupdate" in joined, \
        f"必须搜 AppData xwechat WeixinUpdate 插件目录，实际 roots={roots}"
    # install-dir 也要在
    assert any("program files" in r.lower() and "tencent" in r.lower() for r in roots)


def test_updater_search_roots_no_install_dir_still_has_appdata():
    """install_dir 探测不到（None）时，仍要返回 AppData 搜索根（不因没定位到安装目录就整个跳过）。"""
    roots = wul.updater_search_roots(install_dir=None,
                                     appdata=r"C:\Users\u\AppData\Roaming")
    assert any("xwechat" in r.lower() for r in roots), \
        f"install_dir 缺失时仍须搜 AppData，实际 {roots}"


# ---------- hosts 屏蔽：带 ZJ 标记块，幂等，只动自己那块 ----------


def test_build_hosts_block_has_marker_and_domains():
    block = wul.build_hosts_block()
    assert "ZJ-WeChat-Lock" in block, "hosts 块必须带 ZJ-WeChat-Lock 标记便于幂等增删"
    for d in ("dldir1v6.qq.com", "dldir1.qq.com", "dldir6.qq.com", "update.weixin.qq.com"):
        assert d in block, f"hosts 块缺更新域名 {d}"
    assert "127.0.0.1" in block


def test_apply_hosts_block_idempotent_no_dup():
    """已含 ZJ 块的 hosts 再施一次：不重复追加（只保留一块），且保留用户其他行。"""
    user_line = "10.0.0.1   my-internal-host"
    once = wul.upsert_hosts_block(f"{user_line}\n")
    twice = wul.upsert_hosts_block(once)
    # 用户行保留
    assert user_line in twice
    # ZJ 块只出现一次（用 BEGIN 标记计数）
    assert twice.count(wul.HOSTS_MARKER_BEGIN) == 1, "重复施加必须只保留一块 ZJ hosts"


def test_remove_hosts_block_restores_user_lines():
    """unlock：移除 ZJ 块后用户其他行原样保留。"""
    user = "10.0.0.1   my-internal-host\n8.8.8.8   dns\n"
    with_block = wul.upsert_hosts_block(user)
    removed = wul.remove_hosts_block(with_block)
    assert wul.HOSTS_MARKER_BEGIN not in removed
    assert "my-internal-host" in removed and "8.8.8.8" in removed


# ---------- verify：解读"锁后状态" → 真生效与否（纯函数）----------


def test_interpret_verify_all_locked():
    """所有更新器已 .disabled + 无活更新进程 + hosts 命中 → locked（真生效）。"""
    r = wul.interpret_lock_verify(
        enabled_updaters=[],            # 没有启用的（未 .disabled 的）更新器
        running_updater_pids=[],        # 没有在跑的更新进程
        hosts_blocked=True,
        autoupdate_regval=0,
    )
    assert r["locked"] is True
    assert r["status"] in ("ok", "fixed")


def test_interpret_verify_residual_enabled_updater():
    """仍有启用的更新器（没锁上）→ not locked（如实报，不假装锁死）。"""
    r = wul.interpret_lock_verify(
        enabled_updaters=[r"C:\Users\u\AppData\Roaming\Tencent\xwechat\...\WeixinUpdate.exe"],
        running_updater_pids=[],
        hosts_blocked=True,
        autoupdate_regval=0,
    )
    assert r["locked"] is False
    assert "WeixinUpdate" in r["detail"] or "更新器" in r["detail"]


def test_interpret_verify_hosts_not_blocked_is_partial():
    """更新器锁了但 hosts 没生效 → 部分生效（诚实标 partial，不报全绿）。"""
    r = wul.interpret_lock_verify(
        enabled_updaters=[],
        running_updater_pids=[],
        hosts_blocked=False,
        autoupdate_regval=0,
    )
    assert r["locked"] is False


# ---------- 非 Windows：动作整体 skip 不崩（顶层可 import） ----------


def test_run_lock_non_windows_skips(monkeypatch):
    monkeypatch.setattr(wul, "_is_windows", lambda: False)
    out = wul.run_update_lock(dry_run=False)
    assert out["status"] in ("warn", "skipped", "ok")
    assert "windows" in out["detail"].lower() or "非 windows" in out["detail"].lower()


def test_run_lock_dry_run_does_not_delete(monkeypatch):
    """dry_run：只探测不真改名/不杀进程/不写 hosts。"""
    monkeypatch.setattr(wul, "_is_windows", lambda: True)
    called = {"rename": 0, "kill": 0, "hosts_write": 0}
    monkeypatch.setattr(wul, "_disable_updater", lambda p: called.__setitem__("rename", called["rename"] + 1))
    monkeypatch.setattr(wul, "_kill_updater_processes", lambda: called.__setitem__("kill", called["kill"] + 1))
    monkeypatch.setattr(wul, "_write_hosts", lambda c: called.__setitem__("hosts_write", called["hosts_write"] + 1))
    wul.run_update_lock(dry_run=True)
    assert called == {"rename": 0, "kill": 0, "hosts_write": 0}, \
        f"dry_run 不应执行真实动作，实际 {called}"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
