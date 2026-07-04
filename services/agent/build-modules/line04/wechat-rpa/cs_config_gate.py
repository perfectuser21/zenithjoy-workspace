# -*- coding: utf-8 -*-
"""客户机真发 gate 决策（纯函数）+ 按 machine_id 拉自己那份配置。

对齐 services/agent/build-modules/line04/cs-config-gate.js（同语义）：JS 版给 Node 测/smoke 用，
本 Python 版是 listen_chat 真正运行时用。

背景：原先客户机靠装包写死 env（REAL_PUBLISH / ZENITHJOY_AGENT_REAL_PUBLISH）决定真发，
导致「装一次写死一次、改开关要重装」。本模块把真发 gate 改成「跟随该客服中台配置的
auto_agent_enabled」，并对「中台不可达拉配置失败」做强制 dryrun 兜底——绝不误真发。
身份链路（决策 143f5d00）：按本机 machine_id 拉（中台 service_agents 反查绑定 wechat_id）。
"""
# requests 顶层 import 但容忍缺失：纯函数（should_reply / resolve_send_mode / resolve_active_config）
# 不依赖 HTTP 库，没装 requests 的环境（smoke / CI gate 只验白名单纯函数）也要能 `import cs_config_gate`。
# 同时保留模块级 `requests` 属性（=None 时）让单测的 monkeypatch.setattr(gate.requests, ...) 在装了
# requests 的 agent 测试环境仍可用——两个环境都不破。
try:
    import requests
except ImportError:  # pragma: no cover —— 纯函数环境没装 requests
    requests = None


def resolve_send_mode(config, pull_ok):
    """真发 gate 决策：
    - auto_agent_enabled=True 且 pull_ok=True → 'real'（真发）
    - auto_agent_enabled=False               → 'dryrun'（演练）
    - pull_ok=False（拉配置失败/中台不可达）  → 'dryrun'（强制演练，绝不误真发）
    """
    if not pull_ok:
        return "dryrun"
    if config and config.get("auto_agent_enabled") is True:
        return "real"
    return "dryrun"


def resolve_active_config(fresh, cached, pull_ok):
    """断网期缓存继续判定：pull_ok=True 用 fresh；否则用上次缓存的自己那份（不丢配置，
    下游由 resolve_send_mode 强制 dryrun，中台恢复后自动重拉）。"""
    return fresh if pull_ok else cached


def should_reply(config, sender_name):
    """接管判定（CRM 重做：黑名单主模型 + whitelist 兼容回退）。

    takeover_mode 决定语义（决策 1，lead 拍板）：
    - 'blacklist'（新接入客服机主模型）：**默认全接管**，sender ∉ blacklist 才回；
      被显式拉黑（自己小号/测试号/朋友）→ 不回。空黑名单 / blacklist 非 list（脏数据）
      → 当空处理 → 全员回。
    - 'whitelist'（存量客服机 / 小众）或**无 takeover_mode 字段（存量旧配置）**：
      回退旧逻辑——sender ∈ whitelist 才回。绝不让存量客服机一升级就突变成全接管误发。

    注意：本函数只决定"该不该回这个人"，不决定"真发还是 dryrun"——真发由
    resolve_send_mode（跟随 auto_agent_enabled + pull_ok）控制，双重护栏。
    """
    if not config:
        return False
    mode = config.get("takeover_mode")
    if mode == "blacklist":
        bl = config.get("blacklist")
        if not isinstance(bl, list):
            bl = []  # 脏数据/缺失 → 当空黑名单，默认全接管
        return sender_name not in bl
    # whitelist 模式 + 无 takeover_mode 的存量配置 → 旧白名单逻辑（零误发兜底）
    wl = config.get("whitelist")
    if not isinstance(wl, list):
        return False
    return sender_name in wl


def fetch_cs_config(middleware_url, machine_id, timeout=10, agent_id=None):
    """按 machine_id（+ 可选 agent_id）拉该客服那一份配置 → (config|None, pull_ok)。

    v1.0.108 Bug3修复：同机双租户时 machine_id 可能绑定多个 agent，LIMIT 1 取到错误的那份。
    传入 agent_id 时服务端优先按 agent_id 精确解析（license_machines 联查），消除歧义。

    200 → (config, True)；403（未绑/未配）/ 其它码 / 网络异常 / 坏 JSON → (None, False)。
    pull_ok=False 让 resolve_send_mode 强制 dryrun，绝不误真发；不抛，不拖垮监听主链路。
    """
    if not middleware_url or not machine_id:
        return None, False
    if requests is None:  # 没装 requests 的纯函数环境不该走到真拉配置；强制 dryrun 兜底
        return None, False
    url = middleware_url.rstrip("/") + "/api/wechat/cs/agent-config"
    params = {"machine_id": machine_id}
    if agent_id:
        params["agent_id"] = agent_id
    try:
        resp = requests.get(url, params=params, timeout=timeout)
    except Exception:
        return None, False
    if resp.status_code != 200:
        return None, False
    try:
        return resp.json(), True
    except Exception:
        return None, False
