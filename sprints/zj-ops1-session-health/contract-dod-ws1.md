---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: check-health.js 扩展（8 平台 + 3 API key + 飞书双推）

**范围**: 扩展 `scripts/sessions/check-health.js` — 添加 7 个新平台（快手/小红书/视频号/头条/微博/知乎/公众号）各 MAIN/SUB_1/2/3；3 个 API key 检查（飞书/Notion/企微）；sendFeishuAlert 函数；SKIP_HTTP_CHECK 支持
**大小**: M（~180 行净增）
**依赖**: 无（ws1 为起点）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/sessions/check-health.js` 已修改，PLATFORMS 数组含 7 个新增平台条目
  Test: node -e "const c=require('fs').readFileSync('scripts/sessions/check-health.js','utf8');if(!c.includes('KUAISHOU')||!c.includes('XIAOHONGSHU')||!c.includes('SHIPINHAO')||!c.includes('TOUTIAO')||!c.includes('WEIBO')||!c.includes('ZHIHU')||!c.includes('WECHAT'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `scripts/sessions/check-health.js` 含 `sendFeishuAlert` 函数定义
  Test: node -e "const c=require('fs').readFileSync('scripts/sessions/check-health.js','utf8');if(!c.includes('sendFeishuAlert')&&!c.includes('feishuNotify'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `scripts/sessions/check-health.js` 含 3 个 API key 检查（飞书/Notion/企微 env var 引用）
  Test: node -e "const c=require('fs').readFileSync('scripts/sessions/check-health.js','utf8');const keys=['FEISHU_APP_SECRET','NOTION_TOKEN','WECOM_BOT_KEY'];const missing=keys.filter(k=>!c.includes(k));if(missing.length>0){console.error('FAIL:缺少',missing);process.exit(1)}console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] check-health.js 包含所有 7 个新增平台 Secret env var 引用（核心扩展验证）
  Test: manual:bash -c 'node -e "
const code = require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\");
const platforms = [\"KUAISHOU\",\"XIAOHONGSHU\",\"SHIPINHAO\",\"TOUTIAO\",\"WEIBO\",\"ZHIHU\",\"WECHAT\"];
const missing = platforms.filter(p => !code.includes(p));
if (missing.length > 0) { console.error(\"FAIL: 缺少平台\", missing); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] check-health.js 包含 FEISHU_BOT_WEBHOOK 引用 + 飞书发送函数（双推告警验证）
  Test: manual:bash -c 'node -e "
const code = require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\");
if (!code.includes(\"FEISHU_BOT_WEBHOOK\")) { console.error(\"FAIL: 缺 FEISHU_BOT_WEBHOOK\"); process.exit(1); }
if (!code.includes(\"sendFeishuAlert\") && !code.includes(\"feishuNotify\")) { console.error(\"FAIL: 缺飞书告警函数\"); process.exit(1); }
if (!code.includes(\"msg_type\") && !code.includes(\"open.feishu.cn\")) { console.error(\"FAIL: 缺飞书 API 调用\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] check-health.js 包含 SKIP_HTTP_CHECK 支持（SKIP_HTTP_CHECK=true 时跳过真实 HTTP 调用）
  Test: manual:bash -c 'node -e "
const code = require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\");
if (!code.includes(\"SKIP_HTTP_CHECK\")) { console.error(\"FAIL: 缺 SKIP_HTTP_CHECK 支持\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] SKIP_HTTP_CHECK=true 模式下运行脚本，session-health-report.json 含 ≥ 8 条平台记录（集成验证，防止脚本崩溃或输出格式错误）
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true BARK_URL=https://example.com/test FEISHU_BOT_WEBHOOK=https://example.com/test node scripts/sessions/check-health.js 2>/dev/null; node -e "
const r = JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\"));
if (!Array.isArray(r.results)) { console.error(\"FAIL: results 不是数组\"); process.exit(1); }
if (r.results.length < 8) { console.error(\"FAIL: 仅\", r.results.length, \"条记录，期望>=8\"); process.exit(1); }
console.log(\"OK:\", r.results.length, \"个平台\");
"'
  期望: OK: 8 个平台（或更多）

- [ ] [BEHAVIOR] error path — 无效 JSON cookie 时 graceful skip（不崩溃，不影响其他平台检查）
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true DOUYIN_COOKIES_MAIN="invalid_json{" BARK_URL=https://example.com/test FEISHU_BOT_WEBHOOK=https://example.com/test node scripts/sessions/check-health.js 2>/dev/null; node -e "
const r = JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\"));
const errRecord = r.results.find(x => x.status === \"error\");
if (!errRecord) { console.error(\"FAIL: 无效 cookie 未产生 error 记录\"); process.exit(1); }
if (r.results.length < 8) { console.error(\"FAIL: 无效 cookie 导致其他平台检查中断\"); process.exit(1); }
console.log(\"OK: error 已 graceful 处理\");
"'
  期望: OK（exit 0；error 记录存在但其余平台正常检查）
