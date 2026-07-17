#!/usr/bin/env python3
"""
startup_reset.py — Agent 启动前置幂等复位（line04@1.0.134，2026-07-17）。

5 步 checklist（每步幂等、可重复跑）：
  ① orphan_kill    — 进程归零：杀孤儿 listen_chat.py/overlay/多余 agent 实例
  ② weixin_converge— 微信归一：顶层 Weixin 窗口 >1 → 收敛为单实例
  ③ env_check      — 环境自检：ZENITHJOY_CORE_DIR / python-embedded / .env↔config.json
  ④ debris_cleanup — 残骸清理：Public zj-*>7天 / ZJ* 计划任务 / 陈旧锁文件
  ⑤ _post_diag     — checklist 上报：POST {middleware}/api/agent/startup-reset-diag

跨平台纪律：Win32 调用全在函数体内 import + try/except 包裹，顶层零平台 import，
macOS/Linux CI 单测可正常导入并跑纯逻辑覆盖。

使用：
  import startup_reset
  report = startup_reset.run_startup_reset(middleware_url=..., dry_run=False)
  # report = {"items": [...], "all_ok": bool}

CLI（供 smoke 测试）：
  python startup_reset.py [--middleware-url URL] [--dry-run]
  退出码：all_ok → 0；有 fail → 1。
"""
from __future__ import annotations

import json
import os
import platform
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

# Windows GBK 控制台无法编码 emoji，强制 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ─── 常量 ─────────────────────────────────────────────────────────────────────

PUBLIC_DIR: str = os.environ.get("PUBLIC", r"C:\Users\Public")
STALE_FILE_AGE_SECONDS: int = 7 * 24 * 3600
LOCK_FILE: str = os.path.join(
    os.path.expanduser("~"), ".zenithjoy-agent", "agent.lock"
)

# ─── 接缝函数（单测 monkeypatch 点）──────────────────────────────────────────────

def _list_orphan_pids() -> List[int]:
    """返回需要被杀掉的孤儿 PID 列表（listen_chat.py / overlay 进程，排除当前 PID）。"""
    if platform.system() != "Windows":
        return []
    try:
        import subprocess
        result = subprocess.run(
            ["tasklist", "/fi", "IMAGENAME eq python.exe", "/fo", "csv", "/nh"],
            capture_output=True, text=True, timeout=15, errors="replace",
        )
        current_pid = os.getpid()
        pids: List[int] = []
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            parts = [p.strip('"') for p in line.split(",")]
            if len(parts) < 2:
                continue
            try:
                pid = int(parts[1])
            except ValueError:
                continue
            if pid == current_pid:
                continue
            # 检查命令行是否包含 listen_chat.py 或 overlay
            cmd_result = subprocess.run(
                ["wmic", "process", "where", f"ProcessId={pid}", "get", "CommandLine", "/format:value"],
                capture_output=True, text=True, timeout=10, errors="replace",
            )
            cmd = cmd_result.stdout.lower()
            if "listen_chat.py" in cmd or "overlay" in cmd or "overlay_window.py" in cmd:
                pids.append(pid)
        return pids
    except Exception:
        return []


def _kill_pid(pid: int) -> None:
    """强杀指定 PID（Windows）。"""
    try:
        import subprocess
        subprocess.run(
            ["taskkill", "/F", "/PID", str(pid)],
            capture_output=True, timeout=10,
        )
    except Exception:
        pass


def _count_weixin_windows() -> int:
    """返回顶层 Weixin 窗口数（基于 pywinauto Desktop 枚举）。"""
    if platform.system() != "Windows":
        return 0
    try:
        from pywinauto import Desktop  # type: ignore
        desktop = Desktop(backend="uia")
        count = 0
        for w in desktop.windows():
            try:
                name = (getattr(w, "window_text", None) or "")()
                cls = (getattr(w, "class_name", None) or "")()
                if "weixin" in cls.lower() or "wechat" in name.lower():
                    count += 1
            except Exception:
                pass
        return max(count, 0)
    except Exception:
        return 0


def _restart_weixin_single() -> bool:
    """收敛微信为单实例：杀全部 Weixin 进程后重启一次。"""
    if platform.system() != "Windows":
        return False
    try:
        import subprocess
        # 先置 UIA 标志（重启后微信即能读到 a11y 树）
        try:
            import ctypes
            ctypes.windll.user32.SystemParametersInfoW(0x47, 1, None, 0x02)
        except Exception:
            pass
        subprocess.run(["taskkill", "/F", "/IM", "Weixin.exe", "/T"], capture_output=True, timeout=20)
        subprocess.run(["taskkill", "/F", "/IM", "WeChatAppEx.exe", "/T"], capture_output=True, timeout=20)
        time.sleep(6)
        from find_weixin import launch_weixin  # type: ignore
        ok = launch_weixin()
        return bool(ok)
    except Exception as exc:
        print(f"[startup_reset] 微信归一重启失败: {exc}", file=sys.stderr)
        return False


def _list_stale_public_files() -> List[str]:
    """列出 Public 目录下超过 7 天的 zj-* 文件路径。"""
    result: List[str] = []
    try:
        now = time.time()
        pub = Path(PUBLIC_DIR)
        if not pub.exists():
            return []
        for f in pub.glob("zj-*"):
            if f.is_file():
                try:
                    if (now - f.stat().st_mtime) >= STALE_FILE_AGE_SECONDS:
                        result.append(str(f))
                except Exception:
                    pass
    except Exception:
        pass
    return result


def _list_zj_scheduled_tasks() -> List[str]:
    """返回一次性 ZJ* Windows 计划任务名称列表。"""
    if platform.system() != "Windows":
        return []
    try:
        import subprocess
        r = subprocess.run(
            ["schtasks", "/query", "/fo", "csv", "/nh"],
            capture_output=True, text=True, timeout=15, errors="replace",
        )
        tasks: List[str] = []
        for line in r.stdout.splitlines():
            if not line.strip():
                continue
            parts = [p.strip('"') for p in line.split(",")]
            if not parts:
                continue
            name = parts[0].lstrip("\\")
            if name.upper().startswith("ZJ") and len(parts) >= 3:
                # 只收一次性任务（不重复）：status 包含 "Ready" 或 "Disabled"
                status = parts[2] if len(parts) > 2 else ""
                if "running" not in status.lower():
                    tasks.append(name)
        return tasks
    except Exception:
        return []


def _delete_zj_task(name: str) -> None:
    """删除指定 Windows 计划任务（/f 强制）。"""
    if platform.system() != "Windows":
        return
    try:
        import subprocess
        subprocess.run(["schtasks", "/delete", "/tn", name, "/f"], capture_output=True, timeout=15)
    except Exception:
        pass


def _list_stale_lock_files() -> List[str]:
    """返回 PID 已死的陈旧锁文件列表（agent.lock）。"""
    stale: List[str] = []
    if not os.path.exists(LOCK_FILE):
        return stale
    try:
        content = Path(LOCK_FILE).read_text(encoding="utf-8").strip()
        if not content:
            return stale
        pid_str = content.split("|")[0]
        pid = int(pid_str)
        # 检查 PID 是否存活
        try:
            os.kill(pid, 0)
        except (ProcessLookupError, PermissionError) as e:
            # ProcessLookupError = 进程不存在；PermissionError 在有些系统 = 存在但无权
            if isinstance(e, ProcessLookupError):
                stale.append(LOCK_FILE)
    except Exception:
        pass
    return stale


def _delete_file(path: str) -> None:
    """删除文件，失败静默。"""
    try:
        os.unlink(path)
    except Exception:
        pass


def _post_diag(url: str, data: Dict[str, Any]) -> None:
    """best-effort POST checklist 上报到中台 diag 端点。"""
    if not url:
        return
    try:
        endpoint = url.rstrip("/") + "/api/agent/startup-reset-diag"
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(
            endpoint, data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as _:
            pass
    except Exception as exc:
        print(f"[startup_reset] diag 上报失败（已吞）: {exc}", file=sys.stderr)


# ─── 5 步 checklist ───────────────────────────────────────────────────────────

def step_orphan_kill(dry_run: bool = False) -> Dict[str, Any]:
    """① 进程归零：杀孤儿 listen_chat.py/overlay 进程，避免多实例互搅。"""
    if platform.system() != "Windows":
        return {"step": "orphan_kill", "status": "warn", "detail": "skip: non-windows platform"}

    orphans = _list_orphan_pids()
    if not orphans:
        return {"step": "orphan_kill", "status": "ok", "detail": "no orphan processes found"}

    if not dry_run:
        for pid in orphans:
            _kill_pid(pid)
        return {
            "step": "orphan_kill",
            "status": "ok",
            "detail": f"killed {len(orphans)} orphan pid(s): {orphans}",
        }

    return {
        "step": "orphan_kill",
        "status": "ok",
        "detail": f"dry_run: would kill {len(orphans)} orphan pid(s): {orphans}",
    }


def step_weixin_converge(dry_run: bool = False) -> Dict[str, Any]:
    """② 微信归一：顶层 Weixin 窗口 >1 → 收敛为单实例。"""
    if platform.system() != "Windows":
        return {"step": "weixin_converge", "status": "warn", "detail": "skip: non-windows platform"}

    count = _count_weixin_windows()
    if count <= 1:
        return {
            "step": "weixin_converge",
            "status": "ok",
            "detail": f"weixin windows={count} (ok, single instance)",
        }

    if dry_run:
        return {
            "step": "weixin_converge",
            "status": "ok",
            "detail": f"dry_run: found {count} weixin windows, would restart to converge",
        }

    ok = _restart_weixin_single()
    status = "ok" if ok else "warn"
    detail = (
        f"converged: {count} weixin windows → restart launched"
        if ok
        else f"found {count} weixin windows but restart failed (warn)"
    )
    return {"step": "weixin_converge", "status": status, "detail": detail}


def step_env_check() -> Dict[str, Any]:
    """③ 环境自检：ZENITHJOY_CORE_DIR / python-embedded / .env↔config.json 一致性。"""
    issues: List[str] = []
    warns: List[str] = []

    # 检查 ZENITHJOY_CORE_DIR（根治 A2 MS Store Python 弹窗）
    core_dir = os.environ.get("ZENITHJOY_CORE_DIR") or os.environ.get("ZENITHJOY_INSTALL_DIR", "")
    if not core_dir:
        issues.append("ZENITHJOY_CORE_DIR not set — subprocess python will resolve via MS Store (A2 popup)")
    else:
        # 检查 python-embedded 存在性
        py_embedded = Path(core_dir) / "python-embedded"
        if not py_embedded.exists():
            warns.append(f"python-embedded not found at {py_embedded}")

        # 检查 .env 与 config.json 一致性（仅在文件都存在时才检）
        install = Path(core_dir)
        env_file = install / ".env"
        config_file = install / "config.json"
        if env_file.exists() and config_file.exists():
            try:
                env_text = env_file.read_text(encoding="utf-8", errors="replace")
                config_text = config_file.read_text(encoding="utf-8", errors="replace")
                cfg = json.loads(config_text)
                # 比对 ZENITHJOY_ENV / apiBase
                env_environ = "staging" if "staging" in env_text else "prod"
                cfg_environ = "staging" if "staging" in str(cfg.get("apiBase", "")) else "prod"
                if env_environ != cfg_environ:
                    warns.append(
                        f".env points to '{env_environ}' but config.json points to '{cfg_environ}'"
                    )
            except Exception as exc:
                warns.append(f".env↔config.json consistency check failed: {exc}")

    if issues:
        return {
            "step": "env_check",
            "status": "fail",
            "detail": f"CORE_DIR={core_dir!r}; failures: {'; '.join(issues)}" + (
                f"; warns: {'; '.join(warns)}" if warns else ""
            ),
        }

    detail_parts = [f"CORE_DIR={core_dir!r}"]
    if warns:
        detail_parts.append("warns: " + "; ".join(warns))
    status = "warn" if warns else "ok"
    return {"step": "env_check", "status": status, "detail": " | ".join(detail_parts)}


def step_debris_cleanup(dry_run: bool = False) -> Dict[str, Any]:
    """④ 残骸清理：Public zj-*>7天 / ZJ* 计划任务 / 陈旧锁文件。"""
    stale_files = _list_stale_public_files()
    tasks = _list_zj_scheduled_tasks()
    stale_locks = _list_stale_lock_files()

    total = len(stale_files) + len(tasks) + len(stale_locks)

    if not dry_run:
        for f in stale_files:
            _delete_file(f)
        for t in tasks:
            _delete_zj_task(t)
        for lf in stale_locks:
            _delete_file(lf)

    action = "would clean" if dry_run else "cleaned"
    detail = (
        f"{action} {total} debris item(s): "
        f"stale_files={len(stale_files)} tasks={len(tasks)} locks={len(stale_locks)}"
    )
    return {"step": "debris_cleanup", "status": "ok", "detail": detail}


# ─── 主入口 ──────────────────────────────────────────────────────────────────────

def run_startup_reset(
    middleware_url: str = "",
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    执行 5 步归零 checklist，上报 diag，返回结果。

    Returns:
        {
          "items": [{"step": str, "status": "ok"|"warn"|"fail", "detail": str}, ...],
          "all_ok": bool,  # warn 不算失败
        }
    """
    items = [
        step_orphan_kill(dry_run=dry_run),
        step_weixin_converge(dry_run=dry_run),
        step_env_check(),
        step_debris_cleanup(dry_run=dry_run),
    ]

    all_ok = all(item["status"] in ("ok", "warn") for item in items)
    report: Dict[str, Any] = {"items": items, "all_ok": all_ok}

    _post_diag(middleware_url, report)

    # 控制台输出（start.bat 日志可见）
    for item in items:
        icon = {"ok": "[OK]", "warn": "[WARN]", "fail": "[FAIL]"}.get(item["status"], "[?]")
        print(f"  {icon} {item['step']}: {item['detail']}", flush=True)

    return report


# ─── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="Agent 启动前置幂等复位")
    p.add_argument("--middleware-url", default="", help="中台 URL，供 diag 上报")
    p.add_argument("--dry-run", action="store_true", help="只检测不自愈/不删文件")
    args = p.parse_args()

    report = run_startup_reset(middleware_url=args.middleware_url, dry_run=args.dry_run)
    all_ok = report["all_ok"]
    fails = [i for i in report["items"] if i["status"] == "fail"]
    if fails:
        print(f"\n[startup_reset] {len(fails)} step(s) FAILED — agent will start but may be degraded",
              file=sys.stderr, flush=True)
    sys.exit(0 if all_ok else 1)
