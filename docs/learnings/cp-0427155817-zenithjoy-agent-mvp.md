## ZenithJoy Agent MVP v0.1（2026-04-27）

构建中台↔Agent 最小闭环：dashboard 点按钮 → WebSocket 推指令 → Agent spawn publish-wechat-article-draft.cjs → 公众号草稿创建。9 task 端到端跑通，实测拿到真草稿 mediaId。

### 根本原因

1. **Worktree 缺 .env.production 导致全员登录卡死** — .env.production 在 .gitignore，worktree 默认不复制；build 时 VITE_FEISHU_APP_ID undefined，二维码 init 直接 `if (!APP_ID) return`，前端永远转圈。CI 没有任何前端 UI 测试拦不住。

2. **probe-all-platforms.cjs 走公网 IP，publisher 走 localhost SSH 隧道** — probe 直连 100.97.242.124:1922x，但 Windows 端口实际只在 [::1] 监听（Chrome IPv6 localhost），导致 probe 显示 0/8 通而实际可用。误导排查方向。

3. **抖音 Chrome 多实例共享 chrome-data 导致 ProcessSingleton lock** — 7 个 task 共用同一个 user-data-dir，新启动的 Chrome 因 lock file 拒绝启动（exit 0 但进程没起）。修：抖音用独立 chrome-data-douyin。

4. **HK nginx.conf 仓库版本与线上严重漂移** — 之前 PR 改了线上没回流，仓库 deploy/nginx.conf 缺 Brain API / topics-pacing-pipelines split / /auth / Tailscale 上游 IP。Task 9 要"以线上为准 + 新增 /agent-ws"重写。

5. **CI L4 e2e-smoke 不覆盖前端** — 只测 API contract + Python pipeline，dashboard UI 完全裸奔。

### 下次预防

- [ ] **deploy.yml 加 verify-build.sh 步骤**（已做 commit dbfe879）—— grep dist 验证 VITE_FEISHU_APP_ID 注入，缺失则 fail
- [ ] **worktree 部署前必须复制 .env.production**（应写入 worktree-manage.sh hook 或部署 README）
- [ ] **probe 脚本走 localhost 而不是公网 IP**（与 publisher 保持一致）
- [ ] **每个 publisher 用独立 user-data-dir** —— 避免多 Chrome 实例锁冲突
- [ ] **deploy/nginx.conf 必须跟线上保持同步** —— 要么 PR 改完 reload 时校验 diff，要么 daily 巡检
- [ ] **Brain task 91d85b70 已排队**：加 Playwright e2e 测试套件，覆盖飞书登录 / dashboard 主页 / agent-debug
- [ ] **wechat 发布脚本默认禁用 freepublish/submit**，必须 --draft-only 才放行（已做 wrapper publish-wechat-article-draft.cjs）

### 实战证据

- 8/8 单元测试通过（agent-protocol + agent-registry）
- 实测拿到草稿 mediaId: `1swQrNX2owoy0_5lNajfL4AnqRGAsh1cYS13mx4EhnoHi6-P1QTL-vhWsSrOnbD3`
- 公网 https://autopilot.zenjoymedia.media/agent-debug 可达
- Agent connected as agent-mac-mini-01 + 心跳 + spawn 正常
