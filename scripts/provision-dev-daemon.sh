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
