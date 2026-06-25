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
| 回滚 | `git reset --hard` 工作树 + 重 build | 人工入口 `rollback.sh`（无参=上一 release / 带 sha=留存里挑）或 `rollback-prod.yml`，原子软链 `current`（秒级） |

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

### 4. 回滚（人工入口 `rollback.sh`）

promote 之后才发现新版本有问题，要把生产 :5200 回拨到留存的旧 release，用仓库根 `rollback.sh`
（薄封装 `deploy-lib.sh` 的 `previous_release`/`atomic_repoint_current`/`staging_rollback`：
自动算"上一个 release"、校验"指定 sha 在不在留存里"、回拨后做 health + 版本断言）。

```bash
# 在 mmv 上（生产机），先看留存清单（只读，不动生产）
./rollback.sh --list
# 无参 = 回退到 current 的上一个留存 release（最常用）
./rollback.sh
# 或指定某个留存 release sha（不在留存内会报错退出，绝不臆造）
./rollback.sh <sha>
```

也可走 GitHub Actions 人工放行闸：手点 **`rollback-prod.yml`**（workflow_dispatch + confirm=`ROLLBACK`，
sha 留空=上一个 release）。机制与本地 `rollback.sh` 完全一致（SSH 进 mmv 跑同一个脚本）。

### 5. Dashboard（HK）回滚

Dashboard 生产在 HK，2026-06-25 起也上了 **同款 sha-keyed release 隔离**：
`promote-dashboard-prod.yml` build 进 `/opt/zenithjoy/autopilot-dashboard/releases/<sha>/` →
原子切 `dist` 软链（`dist → releases/current → releases/<sha>`）→ 留最近 5 份。
docker bind-mount 在容器启动解析软链，所以切完软链都要 `docker restart autopilot-dashboard`。

```bash
# 在 HK 上（生产机）
./rollback.sh dashboard --list      # 看留存（只读）
./rollback.sh dashboard             # 回退到上一个 release（只切软链）
./rollback.sh dashboard <sha>       # 指定留存 release
# 切完软链后必须重启容器让 bind-mount 重解析：
docker restart autopilot-dashboard
```

或手点 **`rollback-dashboard-prod.yml`**（confirm=`ROLLBACK`，SSH 进 HK 跑上面的脚本 + restart + 公网验证）。

> 拓扑收口：**API 生产 mmv:5200** 回滚走 `rollback.sh`（默认/`api`）/ `rollback-prod.yml`；
> **Dashboard 生产 HK** 回滚走 `rollback.sh dashboard` / `rollback-dashboard-prod.yml`。两条都是 sha-keyed 软链回拨。

## 风险与护栏

- cutover 期间有一次生产重启（秒级），选低峰做。
- 切前先确认 `releases/current` 解析到一个含 `dist/index.js` 的真实 release，否则生产起不来。
- 出问题立刻把生产 plist 改回指向 `apps/api/dist/index.js` 并 reload（旧模型兜底）。
