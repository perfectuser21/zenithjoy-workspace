# ZenithJoy dev后端+库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ZenithJoy dev 档有自己的后端进程（5202端口，LaunchDaemon）+ 独立库（`zenithjoy_dev`）。

**Architecture:** 新增LaunchDaemon plist模板 + 一次性provision脚本（建库/迁移/密钥合并/sudo bootstrap system/health check）。

**Tech Stack:** bash + psql/createdb + npm(ts-node) migration runner + python3 plistlib + sudo launchctl（系统域）

---

### Task 1: 新增LaunchDaemon plist模板

**Files:**
- Create: `infrastructure/launchdaemons/com.zenithjoy.api.dev.plist`

- [ ] **Step 1: 写模板文件**

```bash
mkdir -p infrastructure/launchdaemons
cat > infrastructure/launchdaemons/com.zenithjoy.api.dev.plist << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  com.zenithjoy.api.dev.plist — ZenithJoy dev环境常驻后端 launchd定义

  系统域LaunchDaemon（非LaunchAgent）：staging任务(cecelia PR#3865)实测发现自动化会话
  访问不了launchd的gui/501域，sudo也不行；系统域可被sudo正常管理。dev从一开始就走
  LaunchDaemon，不重蹈坑。

  与生产com.zenithjoy.api.plist的差异（其余env由provision-dev-daemon.sh从生产plist
  程序化继承注入密钥，不在此硬编码密钥）：
    · Label         = com.zenithjoy.api.dev
    · PORT          = 5202（生产5200，staging5201）
    · DATABASE_NAME = zenithjoy_dev（物理隔离独立库）
    · NODE_ENV      = development
    · 从releases/current跑（不建独立dev发布流水线，复用当前生产同一份build）
    · 日志          = zenithjoy-api.dev.{log,error.log}
    · BETTER_AUTH_URL/AGENT_PUBLIC_*收口到本地占位值（dev不对外，不指向真实域名）

  注意：本文件不含任何密钥。provision-dev-daemon.sh起进程时会从生产plist解析并注入
  必要密钥，覆写PORT/DATABASE_NAME/NODE_ENV等后写到/Library/LaunchDaemons/。
-->
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.zenithjoy.api.dev</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/administrator/zenithjoy-releases/current/dist/index.js</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PORT</key>
		<string>5202</string>
		<key>DATABASE_NAME</key>
		<string>zenithjoy_dev</string>
		<key>NODE_ENV</key>
		<string>development</string>
		<key>ZENITHJOY_API_URL</key>
		<string>http://localhost:5202</string>
		<key>BETTER_AUTH_URL</key>
		<string>http://localhost:5202</string>
		<key>BETTER_AUTH_TRUSTED_ORIGINS</key>
		<string>http://localhost:5202,http://localhost:5173</string>
		<key>AGENT_PUBLIC_WS_URL</key>
		<string>ws://localhost:5202/agent-ws</string>
		<key>AGENT_PUBLIC_BASE_URL</key>
		<string>http://localhost:5202</string>
	</dict>
	<key>UserName</key>
	<string>administrator</string>
	<key>WorkingDirectory</key>
	<string>/Users/administrator/zenithjoy-releases/current</string>
	<key>StandardOutPath</key>
	<string>/Users/administrator/Library/Logs/zenithjoy-api.dev.log</string>
	<key>StandardErrorPath</key>
	<string>/Users/administrator/Library/Logs/zenithjoy-api.dev.error.log</string>
	<key>KeepAlive</key>
	<true/>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
PLIST_EOF
```

- [ ] **Step 2: XML语法检查**

Run: `plutil -lint infrastructure/launchdaemons/com.zenithjoy.api.dev.plist`
Expected: `infrastructure/launchdaemons/com.zenithjoy.api.dev.plist: OK`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/launchdaemons/com.zenithjoy.api.dev.plist
git commit -m "feat: 新增ZenithJoy dev LaunchDaemon plist模板(系统域，5202端口)"
```

---

### Task 2: 新增provision脚本

**Files:**
- Create: `scripts/provision-dev-daemon.sh`

- [ ] **Step 1: 写脚本**

```bash
cat > scripts/provision-dev-daemon.sh << 'SCRIPT_EOF'
#!/usr/bin/env bash
# provision-dev-daemon.sh — 建zenithjoy_dev库 + 起dev LaunchDaemon(5202)
#
# 决策依据：initiative 0935f962 + decision d2c3cae1
# 用法：bash scripts/provision-dev-daemon.sh（需要sudo权限写系统域LaunchDaemon）

set -euo pipefail

DB_NAME="zenithjoy_dev"
PROD_PLIST="/Library/LaunchDaemons/com.zenithjoy.api.plist"
TEMPLATE="infrastructure/launchdaemons/com.zenithjoy.api.dev.plist"
OUT_PLIST="/Library/LaunchDaemons/com.zenithjoy.api.dev.plist"
LABEL="com.zenithjoy.api.dev"
HEALTH_URL="http://localhost:5202/health"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/api"

echo "=== Step 1: 建库 ${DB_NAME}（幂等） ==="
EXISTS=$(psql -h localhost -U cecelia -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME';" -d postgres | tr -d ' ')
if [ "$EXISTS" = "1" ]; then
  echo "  ℹ️  ${DB_NAME} 已存在，跳过建库"
else
  createdb -h localhost -U cecelia "$DB_NAME"
  echo "  ✅ 已建库 ${DB_NAME}"
fi

echo ""
echo "=== Step 2: 跑全量migration ==="
(
  cd "$API_DIR"
  unset DATABASE_URL
  DATABASE_HOST=localhost \
  DATABASE_PORT=5432 \
  DATABASE_NAME="$DB_NAME" \
  DATABASE_USER=cecelia \
  npm run migrate
)
echo "  ✅ migration执行完成"

echo ""
echo "=== Step 3: 合并密钥生成dev plist ==="
if [ ! -f "$PROD_PLIST" ]; then
  echo "  ❌ 生产plist不存在（${PROD_PLIST}），无密钥来源，中止" >&2
  exit 1
fi

TMP_PLIST="/tmp/com.zenithjoy.api.dev.plist.$$"
PROD_PLIST="$PROD_PLIST" TEMPLATE="$TEMPLATE" OUT_PLIST="$TMP_PLIST" \
/usr/bin/python3 - <<'PY'
import plistlib, os
prod = os.environ["PROD_PLIST"]
template = os.environ["TEMPLATE"]
out = os.environ["OUT_PLIST"]

with open(prod, "rb") as f:
    prod_data = plistlib.load(f)
prod_env = dict(prod_data.get("EnvironmentVariables", {}))

with open(template, "rb") as f:
    data = plistlib.load(f)
tmpl_env = dict(data.get("EnvironmentVariables", {}))

merged = {}
merged.update(prod_env)   # 生产密钥打底
merged.update(tmpl_env)   # 模板的PORT/DATABASE_NAME/NODE_ENV等dev安全值盖回
data["EnvironmentVariables"] = merged

with open(out, "wb") as f:
    plistlib.dump(data, f)

n = len(merged)
print(f"✅ dev plist已生成: {out} (env_keys={n})")
PY
echo "  ✅ 密钥合并完成"

echo ""
echo "=== Step 4: 安装到系统域LaunchDaemon ==="
sudo cp "$TMP_PLIST" "$OUT_PLIST"
sudo chown root:wheel "$OUT_PLIST"
sudo chmod 644 "$OUT_PLIST"
rm -f "$TMP_PLIST"
echo "  ✅ 已安装到 ${OUT_PLIST}"

echo ""
echo "=== Step 5: 重启dev daemon ==="
sudo launchctl bootout system/"$LABEL" 2>/dev/null || true
sleep 1
sudo launchctl bootstrap system "$OUT_PLIST"
echo "  ✅ daemon已启动"

echo ""
echo "=== Step 6: health check 轮询 ==="
HEALTHY=false
for i in $(seq 1 12); do
  STATUS=$(curl -sf --connect-timeout 5 --max-time 10 "$HEALTH_URL" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [ "$STATUS" = "ok" ]; then
    HEALTHY=true
    break
  fi
  echo "  尝试 $i/12: status=${STATUS}，等待..."
  sleep 10
done

if [ "$HEALTHY" = "true" ]; then
  echo ""
  echo "✅ ZenithJoy dev后端已就绪，health check通过"
  exit 0
else
  echo ""
  echo "❌ health check失败，请查看日志排查:"
  echo "  /Users/administrator/Library/Logs/zenithjoy-api.dev.error.log"
  exit 1
fi
SCRIPT_EOF
chmod +x scripts/provision-dev-daemon.sh
```

- [ ] **Step 2: 语法检查**

Run: `bash -n scripts/provision-dev-daemon.sh`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add scripts/provision-dev-daemon.sh
git commit -m "feat: 新增ZenithJoy dev环境provision脚本(建库+LaunchDaemon安装)"
```

---

### Task 3: 执行provision（生产运维操作，需要sudo权限）

**Files:**
- 无新文件，执行 Task 2 产出的脚本

- [ ] **Step 1: 记录执行前基线**

Run: `curl -s -o /dev/null -w "%{http_code}" localhost:5200/health` 和 `curl -s -o /dev/null -w "%{http_code}" localhost:5201/health`
Expected: 均200（生产/staging基线，验证不受影响用）

- [ ] **Step 2: 执行provision脚本**

Run: `bash scripts/provision-dev-daemon.sh`
Expected: Step 1-6全部✅，最终输出 `✅ ZenithJoy dev后端已就绪，health check通过`

（脚本内会有sudo命令，执行时需要sudo密码或已配置免密sudo）

- [ ] **Step 3: 若失败，不要自作主张修复，报告失败位置和完整输出**

- [ ] **Step 4: 验证daemon已注册**

Run: `sudo launchctl print system/com.zenithjoy.api.dev | head -5`
Expected: 能看到进程信息（非"Could not find service"）

- [ ] **Step 5: 验证zenithjoy_dev库migration数与独立zenithjoy库一致**

Run:
```bash
psql -h localhost -U cecelia -d zenithjoy_dev -tc "SELECT count(*) FROM zenithjoy.schema_migrations;"
psql -h localhost -U cecelia -d zenithjoy -tc "SELECT count(*) FROM zenithjoy.schema_migrations;"
```
Expected: 两者一致

- [ ] **Step 6: 验证生产/staging不受影响**

Run: `curl -s -o /dev/null -w "%{http_code}" localhost:5200/health; curl -s -o /dev/null -w "%{http_code}" localhost:5201/health`
Expected: 均200，与Step1基线一致

- [ ] **Step 7: Commit（记录执行完成）**

```bash
git add -A
git commit -m "chore: 执行ZenithJoy dev后端+库provision" --allow-empty
```

---

## Self-Review 记录

- **Spec coverage**：设计文档3个目标（LaunchDaemon不用LaunchAgent/建独立库/health验证）Task1(plist模板)+Task2(provision脚本)+Task3(执行验证)全覆盖
- **Placeholder scan**：无TBD
- **命名一致性**：`DB_NAME`/`PROD_PLIST`/`TEMPLATE`/`OUT_PLIST`/`LABEL` 在脚本内自洽引用
- **范围**：单一sprint，不建dev发布CI（已在设计文档"范围外"声明）
