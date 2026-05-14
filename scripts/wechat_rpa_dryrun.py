#!/usr/bin/env python3
"""
WS1 dryrun stub for wechat-rpa handler.

stdin: JSON { "type": "...", "payload": {...} }
stdout: JSON { "wechat_id": "mock_wx_<8 hex>", "task_type": "...", "dryrun": bool, "status": "ok" }
"""
import json
import sys
import hashlib

raw = sys.stdin.read()
try:
    msg = json.loads(raw)
except Exception:
    print(json.dumps({"error": "invalid stdin json"}))
    sys.exit(1)

task_type = msg.get("type", "")
payload = msg.get("payload", {})

# Stable mock id based on agent_id
agent_id = str(payload.get("agent_id", "default"))
mock_suffix = hashlib.md5(agent_id.encode()).hexdigest()[:8]
wechat_id = f"mock_wx_{mock_suffix}"

receipt = {
    "wechat_id": wechat_id,
    "task_type": task_type,
    "dryrun": bool(payload.get("dryrun", False)),
    "status": "ok",
}
print(json.dumps(receipt))
sys.exit(0)
