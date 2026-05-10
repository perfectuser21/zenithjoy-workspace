---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Agent burner handler + comment crawl 脚本

**范围**: 新建 burner 绑定 handler + 抓评论脚本（独立文件，不动 Path 1 主号 handler）
**大小**: L
**依赖**: WS1

## ARTIFACT 条目

- [ ] [ARTIFACT] qr-bind-douyin-burner.ts 文件存在 + 不引用 Path 1 主号 handler
  Test: `node -e "const fs=require('fs');const c=fs.readFileSync('services/agent/src/handlers/qr-bind-douyin-burner.ts','utf8');if(!c.length)process.exit(1);if(/from\s+['\"]\.\/qr-bind-douyin['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] burner handler 含 burner sessionPath（含 /burner/ 子目录）+ user-data-dir 隔离路径
  Test: `node -e "const c=require('fs').readFileSync('services/agent/src/handlers/qr-bind-douyin-burner.ts','utf8');['/burner/','launchPersistentContext','account_label','storageState'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] burner handler waitForURL timeout >= 600000 (10min)
  Test: `node -e "const c=require('fs').readFileSync('services/agent/src/handlers/qr-bind-douyin-burner.ts','utf8');const m=c.match(/waitForURL[^)]*timeout:\s*(\d+)/);if(!m||parseInt(m[1])<600000)process.exit(1)"`

- [ ] [ARTIFACT] burner handler 上报 cookie_local_path + qr_login + account_nickname
  Test: `node -e "const c=require('fs').readFileSync('services/agent/src/handlers/qr-bind-douyin-burner.ts','utf8');['cookie_local_path','qr_login','account_nickname'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] douyin-comment-crawl.cjs 脚本存在 + 用 launchPersistentContext + 含 comment-item selector
  Test: `node -e "const c=require('fs').readFileSync('services/agent/scripts/douyin-comment-crawl.cjs','utf8');['launchPersistentContext','comment-item','commenter_id','publish_time'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] crawl 脚本含 5 条限制 + 评论 0 早 return + url 跳 login 检测（R4）
  Test: `node -e "const c=require('fs').readFileSync('services/agent/scripts/douyin-comment-crawl.cjs','utf8');['slice(0, 5)','/login','BURNER_SESSION_EXPIRED'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] services/agent/src/index.ts 注册新 task_type 不破坏既有 dispatcher
  Test: `node -e "const c=require('fs').readFileSync('services/agent/src/index.ts','utf8');['qr_bind/douyin_burner','crawl_comments/douyin','qr-bind-douyin-burner'].forEach(k=>{if(!c.includes(k))process.exit(1)});if(!c.includes('qr-bind-douyin'))process.exit(1)"`

- [ ] [ARTIFACT] Path 1 主号 handler qr-bind-douyin.ts 字节级未变（git diff 断言）
  Test: `bash -c "git diff origin/main...HEAD -- services/agent/src/handlers/qr-bind-douyin.ts | wc -l | grep -q '^0$'"`

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/qr-bind-douyin-burner.test.ts`：
- burner handler chrome launched 上报 phase
- waitForURL 超时 10min 上报 qr_login='timeout'
- 扫码成功上报 cookie_local_path 含 /burner/
- 上报 account_nickname

见 `tests/ws2/douyin-comment-crawl.test.ts`：
- 加载视频页 → 解析 5 条评论结构（commenter_id / text / publish_time）
- 评论 0 早 return（不解析）
- url 跳 login → 上报 BURNER_SESSION_EXPIRED
- 抓 6+ 条只返前 5 条
