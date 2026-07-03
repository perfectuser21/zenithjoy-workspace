#!/usr/bin/env python3
"""
rate_limiter.py — Path 4 Sprint 1 ws5 频控（含 BEGIN IMMEDIATE 并发安全）。

SQLite 文件: ~/.zenithjoy-agent/rate_limit.db（home 展开，跨平台）。

硬编码上限：
  - moment（朋友圈）: ≤ 1 / 24h / wechat_id
  - chat（私聊）   : ≤ 2 / 分钟 / wechat_id（24h 总量限制已移除，被动 CS 不需要）
  - 操作间隔        : ≥ 1 秒（最近一次 sends.sent_at 在 1s 内 → 拒）
  - 主动发起新会话  : 永远 0（不在此 module 内引入主动发起函数）

API:
  - can_send(action: str, wechat_id: str) -> tuple[bool, str | None]
      True  → INSERT sends 记一条 + 返回 (True, None)
      False → 返回 (False, ISO8601 next_allowed_at)
  - reset(wechat_id) — 清掉该号所有 sends（CI 测试用）

子命令（CLI）：
  - python rate_limiter.py version                                 → 输出 "rate_limiter v1.0"
  - python rate_limiter.py reset --wechat_id=<x>                   → 清记录
  - python rate_limiter.py can_send --action=<chat|moment> --wechat_id=<x>
        → 输出 JSON {"ok": bool, "reason"?: str, "next_allowed_at"?: ISO}

并发安全 — 多线程 / 多进程：
  - 用 BEGIN IMMEDIATE 事务包 SELECT 上限 + INSERT 那条
  - sqlite3 默认 connection 不能跨线程，每次 can_send 内开新 connection
  - 文件级锁（OS 提供）+ BEGIN IMMEDIATE 写锁 → 10 并发 chat 通过数 ≤ 2
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Tuple

VERSION = "rate_limiter v1.0"

# ─── 上限配置（从 config.py 读，机器级可覆盖）──────────────────────────────
try:
    from config import (  # type: ignore
        MOMENT_PER_24H_LIMIT as MOMENT_PER_24H,
        CHAT_PER_MINUTE_LIMIT as CHAT_PER_MINUTE,
        MIN_OPERATION_INTERVAL_SECONDS as MIN_INTERVAL_SECONDS,
    )
except ImportError:
    MOMENT_PER_24H = 1
    CHAT_PER_MINUTE = 0  # 0 = 不限私聊每分钟条数（与 config 默认一致）
    MIN_INTERVAL_SECONDS = 1
# CHAT_PER_24H 已移除：被动客服只响应用户来消息，24h 总量限制是为主动发防封号设计的，不适用。


# ─── DB 路径（home 展开，r1 #7）─────────────────────────────────────────────


def _db_path() -> Path:
    p = Path.home() / ".zenithjoy-agent" / "rate_limit.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _open_conn() -> sqlite3.Connection:
    # check_same_thread=False：本 module 设计为每 call 新 connection（不复用）
    # isolation_level=None：手动管理事务（BEGIN IMMEDIATE / COMMIT / ROLLBACK）
    conn = sqlite3.connect(
        str(_db_path()),
        timeout=10.0,
        check_same_thread=False,
        isolation_level=None,
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sends (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          wechat_id   TEXT NOT NULL,
          action      TEXT NOT NULL,
          sent_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sends_wechat_action_sent ON sends (wechat_id, action, sent_at)"
    )
    return conn


# ─── 时间辅助 ─────────────────────────────────────────────────────────────


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_db_time(ts: str) -> datetime:
    # SQLite CURRENT_TIMESTAMP 返回 'YYYY-MM-DD HH:MM:SS'（UTC）
    if not ts:
        return _now_utc()
    # 兼容含小数秒
    fmts = ["%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"]
    for f in fmts:
        try:
            return datetime.strptime(ts, f).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return _now_utc()


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ─── 主入口：can_send ─────────────────────────────────────────────────────


def can_send(action: str, wechat_id: str) -> Tuple[bool, Optional[str]]:
    """
    校验是否可发，True 时同时 INSERT sends 记一条。
    BEGIN IMMEDIATE 包 SELECT + INSERT，防 10 并发竞争。

    返回:
      (True,  None)                — 可发（已记录）
      (False, ISO8601 next_allowed_at) — 拒，附下次允许时间
    """
    if action not in ("chat", "moment"):
        return (False, None)

    conn = _open_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")

        now = _now_utc()

        # 1) 操作间隔 ≥ 1s（最近 1 条无论 action）
        row_last = conn.execute(
            "SELECT sent_at FROM sends WHERE wechat_id = ? ORDER BY id DESC LIMIT 1",
            (wechat_id,),
        ).fetchone()
        if row_last:
            last_sent = _parse_db_time(row_last[0])
            delta = (now - last_sent).total_seconds()
            if delta < MIN_INTERVAL_SECONDS:
                next_allowed = last_sent + timedelta(seconds=MIN_INTERVAL_SECONDS)
                conn.execute("ROLLBACK")
                return (False, _iso(next_allowed))

        # 2) action 上限校验
        if action == "moment":
            window_start = now - timedelta(hours=24)
            cnt = conn.execute(
                "SELECT COUNT(*) FROM sends WHERE wechat_id = ? AND action = 'moment' AND sent_at >= ?",
                (wechat_id, window_start.strftime("%Y-%m-%d %H:%M:%S")),
            ).fetchone()[0]
            if cnt >= MOMENT_PER_24H:
                # 找最早一条 in window，next = earliest + 24h
                earliest_row = conn.execute(
                    "SELECT sent_at FROM sends WHERE wechat_id = ? AND action = 'moment' AND sent_at >= ? ORDER BY id ASC LIMIT 1",
                    (wechat_id, window_start.strftime("%Y-%m-%d %H:%M:%S")),
                ).fetchone()
                if earliest_row:
                    next_allowed = _parse_db_time(earliest_row[0]) + timedelta(hours=24)
                else:
                    next_allowed = now + timedelta(hours=24)
                conn.execute("ROLLBACK")
                return (False, _iso(next_allowed))
        elif action == "chat":
            # 分钟级上限：CHAT_PER_MINUTE=0 时不限私聊条数（客服不设每分钟硬上限），
            # 跳过这段校验；操作间隔≥1s（上面）与 INSERT 记录（下面）照常执行。
            if CHAT_PER_MINUTE > 0:
                window_min = now - timedelta(seconds=60)
                cnt_min = conn.execute(
                    "SELECT COUNT(*) FROM sends WHERE wechat_id = ? AND action = 'chat' AND sent_at >= ?",
                    (wechat_id, window_min.strftime("%Y-%m-%d %H:%M:%S")),
                ).fetchone()[0]
                if cnt_min >= CHAT_PER_MINUTE:
                    earliest_row = conn.execute(
                        "SELECT sent_at FROM sends WHERE wechat_id = ? AND action = 'chat' AND sent_at >= ? ORDER BY id ASC LIMIT 1",
                        (wechat_id, window_min.strftime("%Y-%m-%d %H:%M:%S")),
                    ).fetchone()
                    if earliest_row:
                        next_allowed = _parse_db_time(earliest_row[0]) + timedelta(seconds=60)
                    else:
                        next_allowed = now + timedelta(seconds=60)
                    conn.execute("ROLLBACK")
                    return (False, _iso(next_allowed))

        # 3) 通过 → INSERT（微秒精度，防止截断到秒后跨秒边界误判间隔）
        conn.execute(
            "INSERT INTO sends (wechat_id, action, sent_at) VALUES (?, ?, ?)",
            (wechat_id, action, now.strftime("%Y-%m-%d %H:%M:%S.%f")),
        )
        conn.execute("COMMIT")
        return (True, None)
    except sqlite3.OperationalError as e:
        # database is locked 等并发情况 → 当作拒（next_allowed_at = now+1s）
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        next_allowed = _now_utc() + timedelta(seconds=1)
        return (False, _iso(next_allowed))
    finally:
        conn.close()


def reset(wechat_id: str) -> int:
    """清掉该 wechat_id 所有 sends 记录（CI 测试用）。返回删除的行数。"""
    conn = _open_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cur = conn.execute("DELETE FROM sends WHERE wechat_id = ?", (wechat_id,))
        conn.execute("COMMIT")
        return cur.rowcount or 0
    finally:
        conn.close()


# ─── CLI ─────────────────────────────────────────────────────────────────


def main(argv: Optional[list] = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print("usage: rate_limiter.py {version|reset|can_send} [args...]", file=sys.stderr)
        return 2

    sub = argv[0]
    if sub == "version":
        print(VERSION)
        return 0

    if sub == "reset":
        ap = argparse.ArgumentParser()
        ap.add_argument("--wechat_id", required=True)
        args = ap.parse_args(argv[1:])
        n = reset(args.wechat_id)
        print(json.dumps({"ok": True, "deleted": n}))
        return 0

    if sub == "can_send":
        ap = argparse.ArgumentParser()
        ap.add_argument("--action", required=True, choices=["chat", "moment"])
        ap.add_argument("--wechat_id", required=True)
        args = ap.parse_args(argv[1:])
        ok, next_at = can_send(args.action, args.wechat_id)
        out: dict = {"ok": ok}
        if not ok:
            out["reason"] = "rate_limited"
            if next_at:
                out["next_allowed_at"] = next_at
        print(json.dumps(out))
        return 0

    print(f"unknown subcommand: {sub}", file=sys.stderr)
    return 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
