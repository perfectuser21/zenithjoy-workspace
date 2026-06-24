"""
reset_stage.py — WS-B RPA 复位台逻辑层（xian-rog 专用自检台「可复位」核心）。

PrepPRD（sprints/06242347-zenithjoy-staging-promote/prep-prd.md WS-B）：
  xian-rog 从此「专用 + 可复位 + 禁手工调试」。干净不靠自律，靠每次复位脚本洗回黄金态。
  Win11 Home 无 Hyper-V → 复位用脚本（不是 VM 快照），四步回黄金态：
    ① 关掉残留 app  ② 清会话残留  ③ 校验测试微信号已登录  ④ 校验微信版本在允许范围
  任一步红 → 复位红 → smoke 不跑。

设计：逻辑层（判定 + 顺序 + 版本范围）与 UI 驱动层（真窗口副作用）分离。
  · 本模块只做判定，所有副作用通过 driver 对象注入 → 逻辑层 UI driver 全 mock 可单测（CI 跑）。
  · 真机复位时由 reset_stage_cli.py 注入真实 Win UI driver（pywinauto），见同目录。
版本范围判定复用 find_weixin._parse_version（纯函数，mac/CI 可跑），与发送守卫同一基线（>= 4.1.8）。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from find_weixin import _parse_version

# 与 config.WECHAT_MIN_VERSION / find_weixin 守卫同基线：>= 4.1.8 放行（含 4.1.10+，Qt UIA 可用）。
WECHAT_MIN_VERSION = (4, 1, 8)


@dataclass
class ResetResult:
    """复位结果。ok=False 时 failed_step / reason 指明红在哪一步（供 smoke 决定是否跑、供日志）。"""
    ok: bool
    failed_step: str = ""
    reason: str = ""
    account: Optional[str] = None
    version: Optional[str] = None


def _version_in_range(ver_str: Optional[str]) -> bool:
    """微信版本是否在允许范围（>= 4.1.8）。读不到 / 解析失败 → False（拿不准不放行）。"""
    parsed = _parse_version(ver_str)
    if parsed is None:
        return False
    # 元组比较：(4,1,8,107) >= (4,1,8) 为 True；(4,1,7,99) >= (4,1,8) 为 False
    return parsed >= WECHAT_MIN_VERSION


def reset_stage(driver: Any, *, expected_account: str) -> ResetResult:
    """把 xian-rog 复位回黄金态。四步任一红 → 整体红（smoke 不跑）。

    driver 需实现：
      close_running_wechat() -> bool       ① 关残留 app（成功返 True）
      clear_session_residue() -> bool      ② 清会话残留（成功返 True）
      get_logged_in_account() -> str|None  ③ 当前已登录账号标识（未登录返 None）
      get_wechat_version() -> str|None     ④ 微信版本串（读不到返 None）

    expected_account：专用测试微信号标识。登录的不是它 → 红（绝不在错号上发）。
    """
    # ① 关掉残留 app
    if not driver.close_running_wechat():
        return ResetResult(ok=False, failed_step="close",
                           reason="关残留微信 app 失败")

    # ② 清会话残留
    if not driver.clear_session_residue():
        return ResetResult(ok=False, failed_step="clear",
                           reason="清会话残留失败")

    # ③ 校验测试号已登录 + 是不是那个专用测试号
    account = driver.get_logged_in_account()
    if not account:
        return ResetResult(ok=False, failed_step="logged_in",
                           reason="测试微信号未登录（需先扫码登录专用测试号）")
    if account != expected_account:
        return ResetResult(ok=False, failed_step="logged_in", account=account,
                           reason=f"登录的不是专用测试号（当前={account} 期望={expected_account}）")

    # ④ 校验微信版本在允许范围
    version = driver.get_wechat_version()
    if not _version_in_range(version):
        return ResetResult(ok=False, failed_step="version", account=account, version=version,
                           reason=f"微信版本不在允许范围（当前={version} 需 >= {'.'.join(map(str, WECHAT_MIN_VERSION))}）")

    return ResetResult(ok=True, account=account, version=version)
