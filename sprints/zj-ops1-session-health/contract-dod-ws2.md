---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: sync-from-xian-rog.sh 扩展 + windows-task-scheduler.xml 新建

**范围**: 重构 `sync-from-xian-rog.sh`（添加 sync_matrix 函数支持 8 平台 × MAIN/SUB_1/2/3）；新建 `scripts/sessions/windows-task-scheduler.xml`（2hr sync + 45min 视频号心跳 + 4hr 其他平台心跳）
**大小**: M（~120 行净增，2 文件）
**依赖**: Workstream 1 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/sessions/sync-from-xian-rog.sh` 含 KUAISHOU_MAIN、XIAOHONGSHU_MAIN 等新平台 Secret 引用
  Test: node -e "const c=require('fs').readFileSync('scripts/sessions/sync-from-xian-rog.sh','utf8');if(!c.includes('KUAISHOU_MAIN'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `scripts/sessions/windows-task-scheduler.xml` 文件存在
  Test: node -e "require('fs').accessSync('scripts/sessions/windows-task-scheduler.xml');console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] sync-from-xian-rog.sh 包含所有 7 个新平台的 MAIN Secret 引用（sync 覆盖面验证）
  Test: manual:bash -c 'node -e "
const sync = require(\"fs\").readFileSync(\"scripts/sessions/sync-from-xian-rog.sh\",\"utf8\");
const platforms = [\"KUAISHOU_MAIN\",\"XIAOHONGSHU_MAIN\",\"SHIPINHAO_MAIN\",\"TOUTIAO_MAIN\",\"WEIBO_MAIN\",\"ZHIHU_MAIN\",\"WECHAT_MAIN\"];
const missing = platforms.filter(p => !sync.includes(p));
if (missing.length > 0) { console.error(\"FAIL: sync 脚本缺少\", missing); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] windows-task-scheduler.xml 存在且包含 2 小时 sync 触发器（自动同步频率验证）
  Test: manual:bash -c 'node -e "
require(\"fs\").accessSync(\"scripts/sessions/windows-task-scheduler.xml\");
const xml = require(\"fs\").readFileSync(\"scripts/sessions/windows-task-scheduler.xml\",\"utf8\");
if (!xml.includes(\"PT2H\") && !xml.includes(\"02:00:00\") && !xml.includes(\"120\") && !xml.includes(\"Hour>2\")) {
  console.error(\"FAIL: XML 缺少 2 小时 sync 触发器\"); process.exit(1);
}
console.log(\"OK\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] windows-task-scheduler.xml 包含 45 分钟视频号心跳触发器 + 4 小时其他平台心跳触发器（维稳频率验证）
  Test: manual:bash -c 'node -e "
const xml = require(\"fs\").readFileSync(\"scripts/sessions/windows-task-scheduler.xml\",\"utf8\");
const has45min = xml.includes(\"PT45M\") || xml.includes(\"00:45:00\") || xml.includes(\"Minute>45\");
const has4hr = xml.includes(\"PT4H\") || xml.includes(\"04:00:00\") || xml.includes(\"Hour>4\");
const hasShipinhao = xml.includes(\"SHIPINHAO\") || xml.includes(\"shipinhao\") || xml.includes(\"视频号\");
if (!has45min) { console.error(\"FAIL: 缺少 45 分钟心跳配置\"); process.exit(1); }
if (!has4hr) { console.error(\"FAIL: 缺少 4 小时心跳配置\"); process.exit(1); }
if (!hasShipinhao) { console.error(\"FAIL: XML 未标注视频号心跳任务\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] sync-from-xian-rog.sh 不含硬编码 GITHUB_CLASSIC_TOKEN（安全规则：凭据不进代码）
  Test: manual:bash -c 'node -e "
const sync = require(\"fs\").readFileSync(\"scripts/sessions/sync-from-xian-rog.sh\",\"utf8\");
// 检查没有真实 token 格式（40位十六进制）
const tokenPattern = /ghp_[A-Za-z0-9]{36}/;
if (tokenPattern.test(sync)) { console.error(\"FAIL: 发现硬编码 GitHub token\"); process.exit(1); }
console.log(\"OK: 无硬编码凭据\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] error path — sync 脚本对 SSH 连接失败的平台不 abort，继续处理其他平台（继续执行验证）
  Test: manual:bash -c 'node -e "
const sync = require(\"fs\").readFileSync(\"scripts/sessions/sync-from-xian-rog.sh\",\"utf8\");
// 验证脚本有错误处理（|| true 或 continue 或 failed 数组）而非 set -e 简单 abort
const hasErrorHandling = sync.includes(\"failed\") || sync.includes(\"|| true\") || sync.includes(\"continue\");
if (!hasErrorHandling) { console.error(\"FAIL: sync 脚本缺少失败容错逻辑\"); process.exit(1); }
console.log(\"OK: 含失败容错逻辑\");
"'
  期望: OK（exit 0）
