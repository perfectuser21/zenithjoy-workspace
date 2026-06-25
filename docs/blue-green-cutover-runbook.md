# 蓝绿 release 隔离 — 真机 cutover runbook (mmv)

> 蓝绿加固 Line A/B（2026-06-25）。本 PR 把部署逻辑改成 **release 隔离 + 常驻 staging**，
> 但 **真机 cutover（把真实生产/staging launchd 切到 releases 软链模型）会碰真生产 :5200，
> 需用户放行后再做。** 本 runbook 是那一步的操作清单。

## 现状 → 目标

| | 现状（main 之前） | 目标（本 PR 后） |
|---|---|---|
| 生产 :5200 跑的代码 | git 工作树 `apps/api/dist/index.js` | `releases/current/dist/index.js`（软链） |
| staging | 无（或临时 slot） | 常驻 `com.zenithjoy.api.staging` :5201，跑 `releases/staging` |
| main 合并 | 自动重启生产 :5200 | 只部署常驻 staging :5201，**不碰 :5200** |
| 切生产 | 自动 | 人手点 `promote-prod.yml`（workflow_dispatch） |
| 回滚 | `git reset --hard` 工作树 + 重 build | 原子软链 `current` 回上一 release（秒级） |

`ZJ_RELEASES_DIR` 默认 `/Users/administrator/zenithjoy-releases`。

## cutover 步骤（在 mmv 上，用户放行后）

### 0. 准备 releases 目录 + 首个 release

```bash
export ZJ_RELEASES_DIR=/Users/administrator/zenithjoy-releases
mkdir -p "$ZJ_RELEASES_DIR"
cd /Users/administrator/perfect21/zenithjoy
source .github/workflows/scripts/deploy-lib.sh
export ZJ_REPO=$PWD ZJ_API_DIR=$PWD/apps/api ZJ_NODE=/opt/homebrew/bin/node
SHA="$(git rev-parse HEAD)"
build_release "$SHA"                                  # build 进 releases/<sha>/
atomic_repoint_current "$ZJ_RELEASES_DIR" "$ZJ_RELEASES_DIR/$SHA"   # current → 该 release
ln -sfn "$ZJ_RELEASES_DIR/$SHA" "$ZJ_RELEASES_DIR/staging"          # staging 也先指它
ls -l "$ZJ_RELEASES_DIR"                              # 确认 current/staging 软链就位
```

### 1. 切生产 plist 指向 current（保留全部密钥）

编辑真实 `~/Library/LaunchAgents/com.zenithjoy.api.plist`，**只改两处路径**，
`EnvironmentVariables`（密钥）原样不动（对照 `infrastructure/launchagents/com.zenithjoy.api.plist.template`）：

- `ProgramArguments[1]`：`…/apps/api/dist/index.js` → `…/zenithjoy-releases/current/dist/index.js`
- `WorkingDirectory`：`…/apps/api` → `…/zenithjoy-releases/current`

重载：
```bash
launchctl unload ~/Library/LaunchAgents/com.zenithjoy.api.plist
launchctl load   ~/Library/LaunchAgents/com.zenithjoy.api.plist
curl -sf http://localhost:5200/health && echo OK
curl -s  http://localhost:5200/version       # sha 应 = 上面 build 的 release sha
```

### 2. 装常驻 staging 实例（:5201）

把 `infrastructure/launchagents/com.zenithjoy.api.staging.plist` 装进
`~/Library/LaunchAgents/`（注入密钥后——参考它从生产 plist 继承的约定；deploy 脚本会做，
首次手装时把生产 plist 的密钥 env 拷进 staging plist 的 EnvironmentVariables，PORT/DB/NODE_ENV
保持 staging 值）：
```bash
cp infrastructure/launchagents/com.zenithjoy.api.staging.plist ~/Library/LaunchAgents/
# 注入密钥 env（同生产，覆写 PORT=5201/DATABASE_NAME=zenithjoy_test/NODE_ENV=staging）
launchctl load ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist
curl -sf http://localhost:5201/health && echo STAGING_OK
```

### 3. 验

```bash
# 真机跑一遍完整 workflow proven-to-fire（sandbox + mock，绝不碰真 :5200）
bash .github/workflows/scripts/smoke/staging-promote-workflow-smoke.sh
# 应看到 "④ 真生产 :5200 运行 sha 全程不变" 通过
```

### 4. 回滚演练（可选，建议做一次）

```bash
# 看历史 release
ls -lt "$ZJ_RELEASES_DIR"
# 手动回滚到上一 release（原子软链，不重 build）
prev=<上一个 release 的 sha>
atomic_repoint_current "$ZJ_RELEASES_DIR" "$ZJ_RELEASES_DIR/$prev"
launchctl kickstart -k gui/$(id -u)/com.zenithjoy.api
curl -s http://localhost:5200/version    # sha 应 = $prev
```

## 风险与护栏

- cutover 期间有一次生产重启（秒级），选低峰做。
- 切前先确认 `releases/current` 解析到一个含 `dist/index.js` 的真实 release，否则生产起不来。
- 出问题立刻把生产 plist 改回指向 `apps/api/dist/index.js` 并 reload（旧模型兜底）。
