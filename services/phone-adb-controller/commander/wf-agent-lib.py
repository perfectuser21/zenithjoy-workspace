#!/usr/bin/env python3
"""wf-agent-lib.py —— codex_agent 形态 workflow 的确定性助手（任务 c0fe7e30；决策 2186700a / 26df670a）。

wf-launch.sh / wf-agent-run.sh 只用它做 JSON 活（bash 3.2 没有可靠的 JSON 处理），所有判断都是确定性代码，不经 LLM：
  profile  <contracts.json> <cap>            打印该能力的 execution_profile（没有该能力 → 不打印、退 1）
  contract <contracts.json> <cap> <out>      取出该能力的运行时合同写到 out（没有 → 退 1）
  show     <contracts.json> <cap>            同上但打印到标准输出（work-commander 第〇节读 commander_skill 用）
  brief    <task.json>                       打印 Brain 任务标题与正文（读不到 → 退 1）
  parse-delivery <agent.log>                 打印业务块最后一个 `WF_DELIVERY {json}`（兼容 --json 包裹转义）；没有 → `{}`
  assemble <run_dir>                         按外壳事实（state.env）+ 业务块交付 + 宿主机证据清单，写各活动读回证据与 delivery.json，
                                             打印一行摘要 JSON
标准库 Python 3.9 可跑。
"""
import fnmatch
import json
import os
import re
import sys

STATUSES = ("success", "failed", "blocked")


def _load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def cmd_profile(contracts, cap):
    c = ((_load(contracts, {}) or {}).get("contracts") or {}).get(cap)
    if not c:
        return 1
    print(c.get("execution_profile") or "")
    return 0


def cmd_contract(contracts, cap, out):
    c = ((_load(contracts, {}) or {}).get("contracts") or {}).get(cap)
    if not c:
        return 1
    _write(out, dict(c, capability=cap))
    return 0


def cmd_show(contracts, cap):
    c = ((_load(contracts, {}) or {}).get("contracts") or {}).get(cap)
    if not c:
        print(json.dumps({"capability": cap, "commander_skill": None, "execution_profile": None}, ensure_ascii=False))
        return 1
    print(json.dumps(dict(c, capability=cap), ensure_ascii=False))
    return 0


def cmd_brief(task_json):
    t = _load(task_json)
    if isinstance(t, dict) and isinstance(t.get("task"), dict):
        t = t["task"]
    if not isinstance(t, dict) or not t.get("description"):
        return 1
    print("任务标题：%s" % (t.get("title") or ""))
    print(t["description"])
    return 0


_MARK = re.compile(r"WF_DELIVERY\s+(\{.*)")


def _strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)


def _last_delivery(text):
    found = None
    for line in text.splitlines():
        m = _MARK.search(line)
        if not m:
            continue
        raw = m.group(1).strip()
        dec = json.JSONDecoder()
        try:
            obj, _ = dec.raw_decode(raw)
        except Exception:
            continue
        if isinstance(obj, dict):
            found = obj
    return found


def parse_delivery(text):
    hit = _last_delivery(text)
    if hit is not None:
        return hit
    # openclaw --json 输出：回复文本在 JSON 字符串里（引号被转义），解开后再找
    try:
        doc = json.loads(text)
    except Exception:
        return {}
    for s in _strings(doc):
        h = _last_delivery(s)
        if h is not None:
            hit = h
    return hit or {}


def cmd_parse_delivery(log):
    try:
        with open(log, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except Exception:
        text = ""
    print(json.dumps(parse_delivery(text), ensure_ascii=False))
    return 0


def read_state(path):
    st = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if "=" in line:
                    k, v = line.rstrip("\n").split("=", 1)
                    st[k] = v
    except Exception:
        pass
    return st


def outward_attempts(outward):
    """outward-ledger 只读回执 → 本 run 对外动作次数（系统账，不采信执行者自报）；读不到 → None。"""
    if not isinstance(outward, dict) or outward.get("schema") != "outward_ledger_v1":
        return None
    by = ((outward.get("summary") or {}).get("attempts_by_action") or {})
    try:
        return int(sum(int(v) for v in by.values()))
    except Exception:
        return None


def _host_has(host_files, eid):
    return [f for f in host_files if f == eid or f.startswith(eid + ".")]


def assemble(run_dir):
    st = read_state(os.path.join(run_dir, "state.env"))
    contract = _load(os.path.join(run_dir, "contract.json"), {}) or {}
    agent = _load(os.path.join(run_dir, "agent-delivery.json"), {}) or {}
    if not isinstance(agent, dict):
        agent = {}
    outward = _load(os.path.join(run_dir, "outward.json"))
    try:
        with open(os.path.join(run_dir, "host-files.txt"), encoding="utf-8", errors="replace") as f:
            host_files = [l.strip() for l in f if l.strip()]
    except Exception:
        host_files = []
    run_id = st.get("RUN_ID", "")
    ev_dir = os.path.join(run_dir, "evidence")
    os.makedirs(ev_dir, exist_ok=True)

    pre_ok = st.get("PRE_OK") == "1"
    lock_status = st.get("LOCK_STATUS") or "unknown"
    attempts = outward_attempts(outward)

    # 外壳活动读回：只有活动真的做成才落 <run>-<活动>-original.json（读回 glob 数的就是它）
    if pre_ok:
        _write(os.path.join(ev_dir, "%s-preflight-original.json" % run_id), {
            "activity": "preflight", "by": "shell", "run_id": run_id,
            "serial": st.get("SERIAL"), "phone": st.get("PHONE_STATE"), "lock": st.get("LOCK_PRE"),
            "lock_acquired_by_shell": st.get("LOCK_MINE") == "1",
            "account_verified": st.get("ACCOUNT_VERIFIED") == "true", "account_nickname": st.get("ACCOUNT_NICK") or None,
            "account_note": st.get("ACCOUNT_NOTE") or None,
            "host_evidence": _host_has(host_files, "%s-preflight-account" % run_id) + _host_has(host_files, "%s-lock-acquire" % run_id),
        })
    cleanup_ok = lock_status == "free" and (st.get("LOCK_MINE") != "1" or st.get("APP_CLOSED") == "1")
    if cleanup_ok:
        _write(os.path.join(ev_dir, "%s-cleanup-original.json" % run_id), {
            "activity": "cleanup", "by": "shell", "run_id": run_id, "app_closed": st.get("APP_CLOSED") == "1",
            "lock_status": lock_status, "outward_attempts": attempts,
            "host_evidence": _host_has(host_files, "%s-lock-release" % run_id),
        })

    # 业务活动读回：执行者报的证据 ID 必须在宿主机证据目录真实存在才算（系统核对，不采信自报）
    claimed_acts = agent.get("activities") if isinstance(agent.get("activities"), dict) else {}
    for a in contract.get("activities") or []:
        if a.get("by") != "agent":
            continue
        key = a.get("key")
        claim = claimed_acts.get(key) if isinstance(claimed_acts.get(key), dict) else {}
        ids = [i for i in (claim.get("evidence_ids") or []) if isinstance(i, str)] + ["%s-%s-original" % (run_id, key)]
        verified = sorted({f for i in ids for f in _host_has(host_files, i)})
        if pre_ok and verified:
            _write(os.path.join(ev_dir, "%s-%s-original.json" % (run_id, key)), {
                "activity": key, "by": "agent", "run_id": run_id,
                "claimed_evidence_ids": ids, "verified_host_files": verified,
            })

    files = sorted(os.listdir(ev_dir))
    activities = []
    for a in contract.get("activities") or []:
        key = a.get("key")
        activities.append({
            "key": key, "by": a.get("by"), "from": a.get("from"), "readback": a.get("readback"),
            "evidence_files": [f for f in files if f.startswith("%s-%s-" % (run_id, key))],
        })

    agent_found = bool(agent)
    if not pre_ok:
        claimed, reason = "blocked", st.get("PRE_REASON") or "preflight_failed"
    elif not agent_found:
        claimed = "failed"
        reason = "agent_timeout" if st.get("AGENT_EXIT") == "timeout" else "agent_delivery_missing exit=%s" % (st.get("AGENT_EXIT") or "?")
    else:
        claimed = agent.get("claimed_result") if agent.get("claimed_result") in STATUSES else "failed"
        reason = agent.get("fail_reason") or (None if claimed == "success" else "agent_claimed_%s" % claimed)
    if st.get("INTERRUPTED"):
        reason = "; ".join([x for x in [reason, "interrupted:%s" % st["INTERRUPTED"]] if x])
        if claimed == "success":
            claimed = "failed"

    readback = dict(agent.get("readback") or {}) if isinstance(agent.get("readback"), dict) else {}
    readback["lock_status"] = lock_status
    readback["publish_attempts"] = attempts
    final_ev = [e for e in (agent.get("final_evidence") or []) if isinstance(e, str)]
    for sys_id in ("%s-lock-acquire" % run_id, "%s-lock-release" % run_id, "%s-outward-ledger" % run_id):
        if _host_has(host_files, sys_id) and sys_id not in final_ev:
            final_ev.append(sys_id)
    locations = agent.get("evidence_locations") if isinstance(agent.get("evidence_locations"), (dict, list)) else {}
    delivery = {
        "source": "wf-agent-run",
        "run_id": run_id,
        "tag": st.get("TAG"),
        "task_id": st.get("TASK_ID"),
        "workflow_key": contract.get("brain_workflow_key"),
        "contract_key": contract.get("contract_key"),
        "claimed_result": claimed,
        "fail_reason": reason,
        "lock_released": lock_status == "free",
        "side_effects": agent.get("side_effects") if isinstance(agent.get("side_effects"), list) else [],
        "readback": readback,
        "acceptance": agent.get("acceptance"),
        "final_evidence": final_ev,
        "evidence_locations": {"agent": locations, "host_evidence_root": st.get("HOST_EVIDENCE_ROOT"), "run_dir": run_dir},
        "activities": activities,
        "shell": {
            "preflight": {"ok": pre_ok, "reason": st.get("PRE_REASON") or None, "lock_acquired": st.get("LOCK_MINE") == "1",
                          "account_verified": st.get("ACCOUNT_VERIFIED") == "true", "account_nickname": st.get("ACCOUNT_NICK") or None},
            "cleanup": {"ok": cleanup_ok, "app_closed": st.get("APP_CLOSED") == "1", "lock_status": lock_status, "outward_attempts": attempts},
        },
        "agent": {"name": st.get("AGENT"), "session_id": st.get("SESSION_ID"), "exit": st.get("AGENT_EXIT") or None, "delivery_found": agent_found},
        "commander_skill": contract.get("commander_skill"),
    }
    _write(os.path.join(run_dir, "delivery.json"), delivery)
    print(json.dumps({"run_id": run_id, "claimed_result": claimed, "fail_reason": reason, "lock_released": delivery["lock_released"],
                      "publish_attempts": attempts, "readback_files": files, "commander_skill": delivery["commander_skill"]}, ensure_ascii=False))
    return 0


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, args = argv[1], argv[2:]
    if cmd == "profile" and len(args) == 2:
        return cmd_profile(*args)
    if cmd == "contract" and len(args) == 3:
        return cmd_contract(*args)
    if cmd == "show" and len(args) == 2:
        return cmd_show(*args)
    if cmd == "brief" and len(args) == 1:
        return cmd_brief(*args)
    if cmd == "parse-delivery" and len(args) == 1:
        return cmd_parse_delivery(*args)
    if cmd == "assemble" and len(args) == 1:
        return assemble(*args)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
