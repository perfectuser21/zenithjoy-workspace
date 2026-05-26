---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: CI workflow 更新 + session-health-smoke.sh + e2e-windows.yml

**范围**: 更新 `.github/workflows/session-health-check.yml`（env 段添加 36 个 Secret 引用 + FEISHU_BOT_WEBHOOK）；新建 `.github/workflows/scripts/smoke/session-health-smoke.sh`；新建 `.github/workflows/e2e-windows.yml`（workflow_dispatch + windows-latest）
**大小**: S（~100 行净增，3 文件）
**依赖**: Workstream 3 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/session-health-check.yml` env 段含 KUAISHOU_MAIN secret 引用
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8');if(!c.includes('KUAISHOU_MAIN'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/session-health-smoke.sh` 文件存在
  Test: node -e "require('fs').accessSync('.github/workflows/scripts/smoke/session-health-smoke.sh');console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/e2e-windows.yml` 文件存在且含 windows-latest runner 配置
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-windows.yml','utf8');if(!c.includes('windows-latest'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] session-health-check.yml 包含所有新增平台的 Secret 引用（workflow 必须能读到新 Secrets）
  Test: manual:bash -c 'node -e "
const wf = require(\"fs\").readFileSync(\".github/workflows/session-health-check.yml\",\"utf8\");
const required = [\"KUAISHOU_MAIN\",\"XIAOHONGSHU_MAIN\",\"SHIPINHAO_MAIN\",\"TOUTIAO_MAIN\",\"WEIBO_MAIN\",\"ZHIHU_MAIN\",\"WECHAT_MAIN\",\"FEISHU_BOT_WEBHOOK\"];
const missing = required.filter(k => !wf.includes(k));
if (missing.length > 0) { console.error(\"FAIL: workflow 缺少\", missing); process.exit(1); }
console.log(\"OK: workflow 含所有新增 Secrets\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] session-health-smoke.sh 文件存在且包含实质内容（≥5 行非空非注释行，不是 exit 0 占位）
  Test: manual:bash -c '
SMOKE=".github/workflows/scripts/smoke/session-health-smoke.sh"
if [ ! -f "$SMOKE" ]; then echo "FAIL: smoke 文件不存在"; exit 1; fi
# 计算实质内容行数（去除空行和注释行）
LINES=$(grep -v "^#" "$SMOKE" | grep -v "^[[:space:]]*$" | wc -l)
if [ "$LINES" -lt 5 ]; then echo "FAIL: smoke 脚本仅 $LINES 行实质内容"; exit 1; fi
echo "OK: $LINES 行实质内容"'
  期望: OK: N 行实质内容（N≥5）

- [ ] [BEHAVIOR] e2e-windows.yml 存在且配置正确（workflow_dispatch + windows-latest runner）
  Test: manual:bash -c 'node -e "
require(\"fs\").accessSync(\".github/workflows/e2e-windows.yml\");
const wf = require(\"fs\").readFileSync(\".github/workflows/e2e-windows.yml\",\"utf8\");
if (!wf.includes(\"windows-latest\")) { console.error(\"FAIL: 缺 windows-latest runner\"); process.exit(1); }
if (!wf.includes(\"workflow_dispatch\")) { console.error(\"FAIL: 缺 workflow_dispatch 触发器\"); process.exit(1); }
console.log(\"OK: e2e-windows.yml 配置正确\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] error path — session-health-smoke.sh 检测到缺必要字段时以非零退出（防止 smoke 永远假绿）
  Test: manual:bash -c 'node -e "
const smoke = require(\"fs\").readFileSync(\".github/workflows/scripts/smoke/session-health-smoke.sh\",\"utf8\");
// 验证 smoke 脚本含 exit 1 或非零退出（真正的 FAIL 路径）
if (!smoke.includes(\"exit 1\") && !smoke.includes(\"exit \$?\") && !smoke.includes(\"false\")) {
  console.error(\"FAIL: smoke 脚本缺少 exit 1 失败路径\");
  process.exit(1);
}
console.log(\"OK: smoke 脚本含失败退出路径\");
"'
  期望: OK（exit 0）
