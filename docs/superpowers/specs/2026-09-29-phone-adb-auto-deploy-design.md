# 设计：智能获客(phone-adb-controller) merge到main自动部署

## 背景与问题

`services/phone-adb-controller/` 的代码只在 GitHub 上"合并"，不会自动出现在真正跑它的三台机器
（mmv 本机 + 西安 xian-m4/xian-m1）上——部署完全靠人肉记得手动跑
`bash services/phone-adb-controller/deploy.sh`。

0929 实测：DoD 审计批次4（PR #2006）merge 到 main 后 6 小时，三台机器仍在跑批次3的旧代码，
直到主理人要求立即真机验证才发现。根因排查见 `decisions` 表 `639800cc`。

## 目标

push 到 main 且改动命中 `services/phone-adb-controller/**` → 自动完成：
部署三机（mmv/xian-m4/xian-m1）→ drift-check 后验 → Bark 通知成败，全程无需人工点击。

## 方案（已确定，非选型讨论）

不做方案比较——本仓库已有两个成熟的同构 workflow
（`deploy-us-vps.yml`、`promote-prod-hk.yml`），采用完全相同的连接模式，只是把"部署动作"换成
调用已存在的 `deploy.sh`/`drift-check.sh`。不引入新的连接通道（不建 self-hosted runner、
不用 opc-remote-worker 轮询队列），因为 Tailscale + SSH 这条路径已经被证明可用。

### 架构

```
push main (路径含 services/phone-adb-controller/**)
        │
        ▼
GitHub Actions (ubuntu-latest, 云端)
        │  tailscale/github-action@v3 (secrets.TAILSCALE_AUTHKEY)
        ▼
接入 tailnet，能看到 mmv/xian-m4/xian-m1 的 Tailscale IP
        │  ssh (secrets.US_MAC_TAILSCALE_IP / US_MAC_SSH_KEY / US_MAC_USER)
        ▼
mmv（本机，已配置好到 xian-m4/xian-m1 的 SSH 别名）
        │  git fetch + checkout <deploy_sha>
        │  bash services/phone-adb-controller/deploy.sh   （推 mmv 自身 + xian-m4 + xian-m1）
        │  bash services/phone-adb-controller/drift-check.sh
        ▼
结果（成功/失败+具体原因）→ Bark 通知
```

### 组件

1. **workflow 文件**：`.github/workflows/deploy-phone-adb-controller.yml`
   - trigger: `push` to `main`，`paths: ['services/phone-adb-controller/**']`
   - 依赖：`secrets.TAILSCALE_AUTHKEY`、`secrets.US_MAC_TAILSCALE_IP`、`secrets.US_MAC_SSH_KEY`、
     `secrets.US_MAC_USER`（全部已存在，与 `deploy-us-vps.yml` 同一套，不新增 secret）

2. **远端执行**（SSH 到 mmv 后跑的命令，封装进 workflow 的 run 块，不新建独立脚本文件——
   动作本身只是"进仓库目录、拉到目标 commit、跑两个已有脚本"，没有复杂到需要单独脚本维护）：
   ```bash
   cd ~/perfect21/zenithjoy-workspace
   git fetch origin main -q
   if [[ -n "$(git status --short)" ]]; then
     echo "ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查" >&2
     exit 1
   fi
   git reset --hard "$DEPLOY_SHA"
   bash services/phone-adb-controller/deploy.sh
   bash services/phone-adb-controller/drift-check.sh
   ```

3. **Bark 通知**：直接复用 `~/.openclaw/leadgen-scripts/notify-bark.js`（已存在，`outreach-tick.sh`
   已在用同一支脚本）。用法固定：`node ~/.openclaw/leadgen-scripts/notify-bark.js <title_b64>
   <body_b64> [level]`，token 从 mmv 上的 `~/.credentials/bark.env` 读取（已配置，其他脚本已验证
   可用），在 SSH 到 mmv 执行部署命令的同一个 session 里，部署命令结束后紧跟着调用，成功/失败都发，
   失败时 body 带 `deploy.sh`/`drift-check.sh` 的失败尾部输出（具体哪个文件/哪台机器）。

### 错误处理

| 失败场景 | 处理 |
|---|---|
| tailnet 连不上 / SSH 超时 | workflow 步骤失败，GitHub Actions 本身标红，另发 Bark（不能只靠 GHA 红，因为没人天天盯 Actions 页面）|
| mmv 上仓库有未提交改动，`git reset --hard` 会冲掉 | **先 `git status --short` 检查，非空则终止并 Bark 告警"mmv本地checkout不干净,已跳过自动部署,需人工检查"**——绝不用 --hard 静默冲掉可能有价值的本地改动（这正是本次调查中发现"本地checkout脏+落后"的同一类问题，本次修复不能反过来靠暴力覆盖掩盖） |
| `deploy.sh` 内部某文件语法检查失败 | `deploy.sh` 本身已 `FAILED=1` + `exit 1`，workflow 接收非零退出码判定失败，Bark 带上 `deploy.sh` 尾部输出（含哪个文件失败） |
| `drift-check.sh` 报漂移 | 视为部署未完全生效，判定失败并告警（不能"部署跑完了就算成功"，必须验证真落地） |
| Bark 通知本身发送失败 | 吞掉但不影响 workflow 退出码判断（通知失败不该掩盖部署本身的真实成败，也不该导致部署失败被误判为"通知失败"）|

### 测试策略

这是 CI 基础设施本身，不适合、也不需要每次 PR 都真的物理跑一次三机部署来验证 CI 逻辑正确
（那样每个不相关 PR 都会触碰生产设备）。测试聚焦"该被触发的时候真的被触发，逻辑拼装正确"：

1. **trigger 条件测试**：用 `actionlint`（如仓库已有可复用；否则 GitHub 语法本身是硬校验）
   验证 workflow YAML 本身合法、`paths` 过滤器语法正确
2. **手动 dry-run 验证**（本次实现时人工做一次，不进 CI 常态）：用 `workflow_dispatch` 补一个
   手动触发入口，在开发过程中先手动跑一次确认全链路通（这次已经手动验证过 deploy.sh +
   drift-check.sh 本身工作正常，本次新增的只是"自动触发"这一层，触发条件用 `act` 本地模拟
   或直接推一次到测试分支验证 workflow 语法层面能否被 GitHub 正确识别为待触发）
3. **单元测试**（如果 Bark 通知逻辑抽成小函数/脚本）：给通知函数写单测，验证成功/失败两种
   payload 格式化正确

## 不做的事

- 不建 self-hosted GitHub Actions runner（会引入常驻维护成本，Tailscale+SSH 模式已够用）
- 不建 staging 环境（这三台物理机没有等价的"安全试跑"环境，装了也是形式主义——见决策 `639800cc`）
- 不改 `deploy.sh`/`drift-check.sh` 本身的部署逻辑
