# Design: ZenithJoy staging 建真正独立库

## 背景

ZenithJoy staging 后端（本机 5201 端口，`~/Library/LaunchAgents/com.zenithjoy.api.staging.plist`）目前 `DATABASE_NAME=zenithjoy_test`，借用测试库顶替，不是真正独立的 staging 库。决策记录 `d76d715b`，交接文档 `docs/handoffs/202607140930-0935f962-initiative-handoff.md` 建议下一步 Task 4。

## 目标

1. 新建独立 `zenithjoy_staging` 库，与独立 `zenithjoy`（生产）库同构（跑同一套 migrations）
2. staging 后端切到这个新库
3. 旧 `zenithjoy_test` 库不删除（其他测试流程可能还在用）

## 方案

新增一次性运维脚本 `scripts/create-staging-db.sh`（放在 zenithjoy repo 根目录 `scripts/`，风格参考 cecelia repo 已有的 `migrate-341-bare-tables.sh`）：

```
Step 1: createdb zenithjoy_staging（若已存在则跳过，幂等）
Step 2: cd apps/api && DATABASE_HOST=localhost DATABASE_PORT=5432 DATABASE_NAME=zenithjoy_staging \
        DATABASE_USER=cecelia npm run migrate
        （显式传全部DATABASE_*环境变量——run-migration.ts的DATABASE_NAME默认值是'cecelia'，
        不显式传会静默对生产cecelia库跑迁移，这是必须规避的高危默认值陷阱）
Step 3: 校验 zenithjoy_staging 库的 zenithjoy.schema_migrations 行数 == 独立zenithjoy库的行数
Step 4: 备份当前 staging plist（cp 一份 .bak.<timestamp>，参照已有的 com.zenithjoy.api.plist.bak.* 命名习惯）
Step 5: 用 sed/plutil 把 plist 里 DATABASE_NAME 从 zenithjoy_test 改成 zenithjoy_staging
Step 6: launchctl unload/load 重启 staging 服务
Step 7: 轮询 curl localhost:5201/health 直到 200 或超时（12次*10秒，参照CI里preview health check的重试模式）
```

## 错误处理

- Step 2 迁移失败 → 整个脚本 `set -euo pipefail` 退出，plist 未被改动，staging 服务仍连旧库不受影响
- Step 7 health check 超时 → 脚本报错退出，**自动回滚**：用 Step 4 的备份恢复 plist，重新 unload/load，因为这一步失败意味着新库不可用，staging 服务必须能继续服务（不能让运维脚本让 staging 长期挂掉）
- 迁移脚本本身是幂等的（`schema_migrations` 表追踪已应用文件），可安全重跑

## 测试策略

- Manual：脚本内置 Step 3（迁移行数比对）+ Step 7（health check 轮询）两处断言，失败非零退出
- 无 unit test（一次性运维操作，非可复用逻辑）
- 守卫：这是"你控的一台生产机"级别（staging，非无穷客户机），按 SKILL.md 哨兵分级用"启动自检+部署后冒烟"——Step 7 的 health check 轮询本身就是这个守卫，不需要额外常驻巡检（跟 cecelia 侧 zenithjoy-db-compare.sh 定位不同，那是双写验证期的持续巡检，staging 库切换是一次性动作后 health 稳定即完成）

## 范围外

- 不改 ZenithJoy prod（5200端口）任何配置
- 不删除 `zenithjoy_test` 库
- 不处理 launchd LaunchAgents→LaunchDaemon 系统域迁移（已知问题，另立任务）
- 不涉及 Cecelia 侧任何代码

## 范围扩大（用户拍板，2026-07-14）

执行中发现两个问题导致 Task2 的手动 plist 切换无法长期生效：

1. 本机自动化会话（本次任务的 bash 环境）碰不到 launchd `gui/501` 域（`launchctl bootstrap/asuser` 均报 `125: Domain does not support specified action`），无法从这里重启 LaunchAgent。但 CI/CD 自持 runner 显然有权限（观察到 staging 服务在任务执行期间被正常部署流水线重启过一次，release symlink 正常轮转），说明**真正的重启必须交给现有部署流水线**，不在本地手动补。
2. `.github/workflows/{deploy-us-vps,promote-prod,promote-all-prod}.yml` 三处硬编码 `export ZJ_STAGING_DB=zenithjoy_test`，每次自动部署都会用这个值重新生成 staging plist（`deploy-lib.sh` 的 `ensure_staging_plist()`），手动改的 plist 撑不过下一次部署。

用户拍板：扩大范围，一并改这3个 workflow 文件。

### 方案：复用已有的"决策0710" repo variable 模式

`promote-prod.yml`/`promote-all-prod.yml` 里生产库名已经是这个模式：
```yaml
export ZJ_PROD_DB="${{ vars.ZJ_PROD_DB || 'cecelia' }}"
```
（"切换日翻这个变量为 zenithjoy...回滚=翻回"）

照此把三处 `export ZJ_STAGING_DB=zenithjoy_test` 改成：
```yaml
export ZJ_STAGING_DB="${{ vars.ZJ_STAGING_DB || 'zenithjoy_test' }}"
```
不设 repo variable 时行为不变（默认还是 zenithjoy_test，向后兼容零风险）；PR 合并后用 `gh variable set ZJ_STAGING_DB --body zenithjoy_staging` 翻开关，下一次任意一个部署 workflow 跑起来就会自然把 staging 切到独立库并重启（走 CI/CD 自己有权限的重启路径，不需要本地 launchctl）。

### 不在本次范围
- 不改 `ZJ_PROD_DB`（生产库切换是另一件事，仍在双写验证期，截止 07-16）
- 不修 `deploy-lib.test.sh`（测试里的 `ZJ_STAGING_DB=zenithjoy_test` 是显式传参测试通用机制，与生产默认值无关，不用改）
- 不在本地尝试任何 launchctl 重启（已确认此路不通，交给CI/CD）
