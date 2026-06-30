#!/usr/bin/env python3
"""
wechat_update_lock.py — 强版"关死微信自动更新"（24h 待机工作机专用）。

【为什么重写】#853 删的弱锁实测锁不住。真因（xian-rog 真机实测 2026-06-24）：
  ① 路径写死 C:\\Program Files\\Tencent\\Weixin，没复用 find_weixin.discover_weixin_exe()
     → 孙安青机装别处/HKCU 不可见就 "install dir not found, skipping" 整锁不应用。
  ② 微信 4.x 有**两个** WeixinUpdate.exe，弱锁只锁 install-dir 那个，**漏了 AppData xwechat
     插件系统的活更新器**：%APPDATA%\\Tencent\\xwechat\\xplugin\\plugins\\WeixinUpdate\\<id>\\
     extracted\\WeixinUpdate.exe —— 那才是 4.1.10 自升的真实通道。

【强版多层 + 每轮重施 + verify】
  A. 可靠定位：复用 find_weixin.discover_weixin_exe()（进程路径 / HKCU / HKLM 注册表），绝不写死
  B. 两处更新器全找：install-dir + AppData xwechat，都改名 .disabled + icacls DENY
  C. hosts 屏蔽腾讯更新域名（带 # ZJ-WeChat-Lock 标记的独立块，幂等，只动自己那块，可一键还原）
  D. 杀 WeixinUpdate.exe 更新进程
  E. AutoUpdate 注册表策略 = 0
  F. agent 每轮心跳重施一次（微信会恢复）+ verify 真生效（再读更新器/进程/hosts 状态）

【不删不重装】明确不卸载/不重装微信（会掉线重扫）。只关更新让它稳在当前版本。
【保留版本闸放行 4.1.8+】#852/#853 已放行，本模块不碰版本判定，只是安全网。
【诚实】腾讯更新很硬，做不到 100%。verify 只能证"更新器被改名 + 进程被杀 + hosts 命中 +
  AutoUpdate=0"，无法保证腾讯不换通道。interpret_lock_verify 如实标 locked=True/False，不假装锁死。

跨平台纪律：winreg / subprocess / 文件改名 真实动作全在**函数体内** import + try/except；
顶层 import 在 mac/linux 也能成功（供 CI 纯逻辑单测）。
"""
from __future__ import annotations

import logging
import os
import platform
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ─── 常量 ────────────────────────────────────────────────────────────────────

# 腾讯微信更新服务域名（hosts 屏到 127.0.0.1）。xian-rog DNS 实测这些是更新通道。
UPDATE_DOMAINS = (
    "dldir1v6.qq.com",
    "dldir1.qq.com",
    "dldir6.qq.com",
    "update.weixin.qq.com",
)

# hosts ZJ 独立块标记（幂等增删 + 一键还原；绝不动用户其他 hosts 行）。
HOSTS_MARKER_BEGIN = "# ZJ-WeChat-Lock BEGIN (managed by zenithjoy agent — do not edit inside)"
HOSTS_MARKER_END = "# ZJ-WeChat-Lock END"

HOSTS_PATH = r"C:\Windows\System32\drivers\etc\hosts"

# 更新器可执行名（两处都叫这个）。
UPDATER_EXE_NAME = "WeixinUpdate.exe"

# 防火墙规则统一前缀（幂等：先删同名再加）。
FIREWALL_RULE_PREFIX = "ZJ-Block-WeixinUpdate"


# ─── 纯逻辑函数（CI 单测锚点，顶层零 Windows 依赖）──────────────────────────────


def updater_search_roots(install_dir: Optional[str], appdata: Optional[str]) -> List[str]:
    """
    返回所有要搜 WeixinUpdate.exe 的根目录（纯函数）。

    必须同时覆盖：
    - install-dir（如 C:\\Program Files\\Tencent\\Weixin\\<版本>\\WeixinUpdate.exe）
    - **AppData xwechat 插件系统**（%APPDATA%\\Tencent\\xwechat\\xplugin\\plugins\\WeixinUpdate\\
      <id>\\extracted\\WeixinUpdate.exe）—— 弱锁漏的真实自升通道，绝不能省。

    install_dir 探测不到（None）也要返回 AppData 根（不因没定位到安装目录就整个跳过）。
    """
    roots: List[str] = []
    if install_dir:
        roots.append(install_dir)
    if appdata:
        roots.append(os.path.join(appdata, "Tencent", "xwechat", "xplugin", "plugins", "WeixinUpdate"))
        # 兜底：整个 xwechat 也扫（插件目录结构可能变）
        roots.append(os.path.join(appdata, "Tencent", "xwechat"))
    return roots


def build_hosts_block() -> str:
    """构造带 ZJ 标记的 hosts 屏蔽块（纯函数）。"""
    lines = [HOSTS_MARKER_BEGIN]
    for d in UPDATE_DOMAINS:
        lines.append(f"127.0.0.1   {d}")
    lines.append(HOSTS_MARKER_END)
    return "\n".join(lines)


def remove_hosts_block(content: str) -> str:
    """
    从 hosts 内容里移除 ZJ 标记块（纯函数），用户其他行原样保留。
    用于幂等重施（先删旧块再加新块）+ 一键还原 unlock。
    """
    lines = content.splitlines()
    out: List[str] = []
    skipping = False
    for ln in lines:
        if ln.strip() == HOSTS_MARKER_BEGIN:
            skipping = True
            continue
        if ln.strip() == HOSTS_MARKER_END:
            skipping = False
            continue
        if not skipping:
            out.append(ln)
    # 去掉块移除后可能残留的尾部多余空行，保持末尾单个换行
    text = "\n".join(out).rstrip("\n")
    return text + "\n" if text else ""


def upsert_hosts_block(content: str) -> str:
    """
    幂等地把 ZJ 屏蔽块写入 hosts 内容（纯函数）：先移除旧 ZJ 块（防重复），再在末尾追加新块。
    用户其他行原样保留。返回新的完整 hosts 内容。
    """
    base = remove_hosts_block(content)
    if base and not base.endswith("\n"):
        base += "\n"
    return base + build_hosts_block() + "\n"


def interpret_lock_verify(
    enabled_updaters: List[str],
    running_updater_pids: List[int],
    hosts_blocked: bool,
    autoupdate_regval: Optional[int],
) -> Dict[str, Any]:
    """
    解读"关更新后的真实状态" → 是否真锁死（纯函数，诚实判定，不假装锁死）。

    locked=True 仅当：无启用的更新器（都已 .disabled）+ 无在跑的更新进程 + hosts 命中 + AutoUpdate=0。
    任一不满足 → locked=False，detail 如实说哪层没生效（给运营看真相）。
    """
    problems: List[str] = []
    if enabled_updaters:
        problems.append(f"仍有 {len(enabled_updaters)} 个启用的更新器未锁（含 {os.path.basename(enabled_updaters[0])} 等）")
    if running_updater_pids:
        problems.append(f"仍有 {len(running_updater_pids)} 个 WeixinUpdate 进程在跑")
    if not hosts_blocked:
        problems.append("hosts 未屏蔽腾讯更新域名")
    if autoupdate_regval not in (0,):
        problems.append(f"AutoUpdate 注册表={autoupdate_regval}（期望 0）")

    if not problems:
        return {
            "locked": True,
            "status": "ok",
            "detail": "微信自动更新已关死：更新器全 .disabled + 无更新进程 + hosts 屏蔽 + AutoUpdate=0。",
        }
    return {
        "locked": False,
        "status": "warn",
        "detail": "微信自动更新未完全锁死（诚实报）：" + "；".join(problems)
        + "。腾讯更新硬，做不到 100%，已压到上述程度，下轮心跳会重施。",
    }


# ─── Windows 真实动作（全在函数体内 import + try/except）──────────────────────


def _is_windows() -> bool:
    return platform.system() == "Windows"


def _find_updaters(roots: List[str], suffix_disabled: bool = False) -> List[str]:
    """在 roots 下递归找所有 WeixinUpdate.exe（suffix_disabled=True 找 .disabled 的）。"""
    target = UPDATER_EXE_NAME + (".disabled" if suffix_disabled else "")
    found: List[str] = []
    seen: set = set()  # 去重：roots 可能重叠（如 xwechat 根 + 其下 WeixinUpdate 子目录）
    for root in roots:
        if not root or not os.path.isdir(root):
            continue
        try:
            for dirpath, _dirs, files in os.walk(root):
                for f in files:
                    if f.lower() == target.lower():
                        p = os.path.normcase(os.path.normpath(os.path.join(dirpath, f)))
                        if p not in seen:
                            seen.add(p)
                            found.append(os.path.join(dirpath, f))
        except Exception:
            continue
    return found


def _kill_updater_processes() -> int:
    """taskkill 所有 WeixinUpdate.exe 进程。返回尝试次数（best-effort）。"""
    import subprocess

    try:
        subprocess.run(
            ["taskkill", "/F", "/IM", UPDATER_EXE_NAME],
            capture_output=True, timeout=20,
        )
        return 1
    except Exception:
        return 0


def _running_updater_pids() -> List[int]:
    """列出在跑的 WeixinUpdate.exe PID（verify 用）。"""
    import subprocess

    pids: List[int] = []
    try:
        r = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {UPDATER_EXE_NAME}", "/FO", "CSV", "/NH"],
            capture_output=True, timeout=15,
        )
        out = (r.stdout or b"").decode("gbk", errors="ignore")
        for line in out.splitlines():
            parts = [p.strip('"') for p in line.split(",")]
            if len(parts) >= 2 and parts[0].lower() == UPDATER_EXE_NAME.lower():
                try:
                    pids.append(int(parts[1]))
                except ValueError:
                    pass
    except Exception:
        pass
    return pids


def _disable_updater(exe_path: str) -> bool:
    """把单个更新器改名 .disabled + icacls DENY（防被改回/执行）。成功返回 True。"""
    import subprocess

    disabled_path = exe_path + ".disabled"
    ok = False
    try:
        os.replace(exe_path, disabled_path)
        ok = True
    except Exception:
        # 可能被占用（先 _kill_updater_processes 再来）或权限不足
        if os.path.exists(disabled_path):
            ok = True
    if os.path.exists(disabled_path):
        try:
            subprocess.run(
                ["icacls", disabled_path, "/deny", "Everyone:(W,D,X)"],
                capture_output=True, timeout=30,
            )
        except Exception:
            pass
    return ok


def _read_hosts() -> str:
    try:
        with open(HOSTS_PATH, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception:
        return ""


def _write_hosts(content: str) -> bool:
    try:
        with open(HOSTS_PATH, "w", encoding="utf-8") as f:
            f.write(content)
        return True
    except Exception:
        return False


def _hosts_blocked() -> bool:
    """hosts 是否已含 ZJ 屏蔽块且命中域名（verify 用）。"""
    content = _read_hosts()
    if HOSTS_MARKER_BEGIN not in content:
        return False
    return all(d in content for d in UPDATE_DOMAINS)


def _set_autoupdate_zero() -> None:
    """HKLM\\SOFTWARE\\Policies\\Tencent\\WeChat\\AutoUpdate=0（best-effort，需管理员）。"""
    try:
        import winreg
        key = winreg.CreateKeyEx(
            winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Tencent\WeChat", 0, winreg.KEY_SET_VALUE,
        )
        winreg.SetValueEx(key, "AutoUpdate", 0, winreg.REG_DWORD, 0)
        winreg.CloseKey(key)
    except Exception:
        pass


def _read_autoupdate() -> Optional[int]:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Tencent\WeChat") as key:
            val, _ = winreg.QueryValueEx(key, "AutoUpdate")
            return int(val)
    except Exception:
        return None


def _firewall_block_updaters(updater_paths: List[str]) -> None:
    """给每个更新器加出站防火墙封禁（幂等：先删同名再加）。best-effort。"""
    import subprocess

    for i, exe in enumerate(updater_paths):
        rule = f"{FIREWALL_RULE_PREFIX}-{i}"
        try:
            subprocess.run(
                ["netsh", "advfirewall", "firewall", "delete", "rule", f"name={rule}"],
                capture_output=True, timeout=20,
            )
            subprocess.run(
                ["netsh", "advfirewall", "firewall", "add", "rule",
                 f"name={rule}", "dir=out", "action=block", f"program={exe}", "enable=yes"],
                capture_output=True, timeout=20,
            )
        except Exception:
            pass


def _resolve_install_dir() -> Optional[str]:
    """复用 find_weixin.discover_weixin_exe() 可靠定位安装目录（绝不写死）。"""
    try:
        from find_weixin import discover_weixin_exe
        exe = discover_weixin_exe()
        if exe:
            return os.path.dirname(exe)
    except Exception:
        pass
    return None


# ─── 编排：关更新（每轮重施 + verify）────────────────────────────────────────


def run_update_lock(dry_run: bool = False) -> Dict[str, Any]:
    """
    关死微信自动更新（每轮心跳调一次，幂等可重复）。

    dry_run：只探测不真改名/不杀进程/不写 hosts（CI / mac 跑）。
    返回 {status, detail, locked, found_updaters, ...}。
    """
    if not _is_windows():
        return {"status": "skipped", "locked": False,
                "detail": "非 Windows，跳过关更新（仅 Windows 工作机有效）。"}

    install_dir = _resolve_install_dir()  # 可靠定位（复用 discover），不写死
    appdata = os.environ.get("APPDATA")
    roots = updater_search_roots(install_dir, appdata)

    enabled = _find_updaters(roots, suffix_disabled=False)

    if dry_run:
        return {
            "status": "warn" if enabled else "ok",
            "locked": False,
            "detail": f"dry-run：探测到 {len(enabled)} 个启用更新器（install_dir={install_dir}）；"
                      f"真实运行将杀进程 + 改名 .disabled + icacls + hosts 屏蔽 + AutoUpdate=0。",
            "found_updaters": enabled,
        }

    # 1) 先杀更新进程（否则改名会被占用）
    _kill_updater_processes()
    # 2) 改名 .disabled + icacls（两处更新器全锁）
    for exe in enabled:
        _disable_updater(exe)
    # 3) 防火墙封禁（封 .disabled 前的真实路径 + 现有 .disabled 路径）
    disabled_now = _find_updaters(roots, suffix_disabled=True)
    _firewall_block_updaters([p[:-len(".disabled")] for p in disabled_now])
    # 4) hosts 屏蔽（幂等：upsert ZJ 块）
    _write_hosts(upsert_hosts_block(_read_hosts()))
    # 5) AutoUpdate 注册表=0
    _set_autoupdate_zero()

    # 6) verify 真生效（重读状态）
    still_enabled = _find_updaters(roots, suffix_disabled=False)
    verify = interpret_lock_verify(
        enabled_updaters=still_enabled,
        running_updater_pids=_running_updater_pids(),
        hosts_blocked=_hosts_blocked(),
        autoupdate_regval=_read_autoupdate(),
    )
    verify["found_updaters"] = enabled
    verify["install_dir"] = install_dir
    return verify


def run_update_unlock() -> Dict[str, Any]:
    """一键还原：移除 hosts ZJ 块 + 删防火墙规则 + 把 .disabled 改回（best-effort）。"""
    if not _is_windows():
        return {"status": "skipped", "detail": "非 Windows，跳过 unlock。"}
    import subprocess

    # 1) hosts 还原（只删 ZJ 块，用户其他行保留）
    _write_hosts(remove_hosts_block(_read_hosts()))
    # 2) 删防火墙规则（前缀匹配）
    for i in range(0, 32):
        try:
            subprocess.run(
                ["netsh", "advfirewall", "firewall", "delete", "rule", f"name={FIREWALL_RULE_PREFIX}-{i}"],
                capture_output=True, timeout=15,
            )
        except Exception:
            pass
    # 3) .disabled 改回
    install_dir = _resolve_install_dir()
    roots = updater_search_roots(install_dir, os.environ.get("APPDATA"))
    restored = 0
    for dp in _find_updaters(roots, suffix_disabled=True):
        orig = dp[:-len(".disabled")]
        try:
            subprocess.run(["icacls", dp, "/remove:d", "Everyone"], capture_output=True, timeout=20)
            os.replace(dp, orig)
            restored += 1
        except Exception:
            pass
    return {"status": "ok", "detail": f"已 unlock：hosts ZJ 块移除 + 防火墙规则删 + {restored} 个更新器改回。"}


if __name__ == "__main__":
    import argparse
    import json as _json
    import sys as _sys

    ap = argparse.ArgumentParser(description="微信自动更新关死/还原")
    ap.add_argument("--dry-run", action="store_true", help="只探测不真改（CI / mac）")
    ap.add_argument("--unlock", action="store_true", help="一键还原（移除 hosts/防火墙/改回更新器）")
    # 遗留①（decision b9f4f602）：关更新需 admin，被 Start-Process -Verb RunAs 提权调起；
    # 提权进程的 stdout 父进程收不到，故把 JSON 结果同时写到 --output 文件供父进程读回 interpret。
    ap.add_argument("--output", help="把 JSON 结果写到该文件（提权子进程回传父进程用）")
    args = ap.parse_args()

    if args.unlock:
        result = run_update_unlock()
    else:
        result = run_update_lock(dry_run=args.dry_run)

    payload = _json.dumps(result, ensure_ascii=False)
    print(payload)
    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as _f:
                _f.write(payload)
        except OSError:
            pass  # 写文件失败不影响 stdout 路径；父进程读不到文件会按"未产出"跳过

    if args.unlock:
        _sys.exit(0)
    _sys.exit(0 if result.get("locked") or args.dry_run else 1)
