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
