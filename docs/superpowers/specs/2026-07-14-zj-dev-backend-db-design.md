# Design: ZenithJoy dev 后端 + 库

## 背景

Initiative `0935f962`（Cecelia×ZenithJoy三档分离）最后一项：ZenithJoy dev 档完全没有后端进程和独立库。决策记录 `d2c3cae1`，交接文档"建议下一步 Task5"。

## 关键决策：LaunchDaemon 而非 LaunchAgent

staging 任务（cecelia PR#3865）实测发现：这台机器的自动化会话（Claude Code bash 环境）访问不了 launchd 的 `gui/501` 域，`launchctl load/bootstrap/asuser` 全部报 `125`。但 `sudo launchctl print system/...`（系统域）可以正常工作。

**dev 后端从一开始就用系统域 LaunchDaemon**（`/Library/LaunchDaemons/`），不用 LaunchAgent，避免重蹈 staging 当初的坑（staging 现在也是遗留在 LaunchAgent，是历史债务，另案处理，不在本次范围）。

## 方案

### 1. 建 `zenithjoy_dev` 库

```bash
createdb -h localhost -U cecelia zenithjoy_dev
cd apps/api && DATABASE_NAME=zenithjoy_dev DATABASE_USER=cecelia npm run migrate
```
（同 staging 任务已验证过的模式：显式传 DATABASE_*，子 shell 内 `unset DATABASE_URL`）

### 2. 新增 LaunchDaemon 模板 `infrastructure/launchdaemons/com.zenithjoy.api.dev.plist`

仿照已有的 `infrastructure/launchagents/com.zenithjoy.api.staging.plist`，但：
- 类型是 LaunchDaemon（放 `/Library/LaunchDaemons/`，不是 `~/Library/LaunchAgents/`）
- `Label = com.zenithjoy.api.dev`
- `PORT = 5202`
- `DATABASE_NAME = zenithjoy_dev`
- `NODE_ENV = development`
- 从 `releases/current`（复用现有生产同一份 build，不建独立 dev 发布流水线——超出本次范围，交接文档也只要求"起一个后端进程"）跑：`ProgramArguments = [node, releases/current/dist/index.js]`
- `BETTER_AUTH_URL`/`AGENT_PUBLIC_*` 收口到一个 dev 专属占位值（不指向真实域名，dev 不对外）
- `KeepAlive=true`/`RunAtLoad=true`

### 3. 新增一次性运维脚本 `scripts/provision-dev-daemon.sh`

程序化合并密钥（同 `deploy-lib.sh` 里 `ensure_staging_plist()` 的 python plistlib 手法，但简化——本次是一次性脚本不是 CI 复用函数）：
```
Step 1: 建库（幂等，若已存在跳过）
Step 2: 跑migration
Step 3: 用python plistlib从生产plist(/Library/LaunchDaemons/com.zenithjoy.api.plist)读密钥，
        merge进dev模板的PORT/DATABASE_NAME/NODE_ENV等覆写值，写出到/tmp临时文件
Step 4: sudo cp 临时文件 → /Library/LaunchDaemons/com.zenithjoy.api.dev.plist
Step 5: sudo chown root:wheel + chmod 644（LaunchDaemon要求的权限，否则launchd拒绝加载）
Step 6: sudo launchctl bootout system/com.zenithjoy.api.dev 2>/dev/null || true（幂等卸载旧的）
Step 7: sudo launchctl bootstrap system /Library/LaunchDaemons/com.zenithjoy.api.dev.plist
Step 8: health check轮询 curl localhost:5202/health
```

## 错误处理

- Step2 migration失败 → 库已建但空，daemon不会被安装，不产生半成品服务
- Step7 bootstrap失败 → 不影响生产(5200)/staging(5201)，因为是全新Label独立进程
- Step8 health check超时 → 报错退出，不自动回滚（这是全新服务，没有"之前状态"可回滚，只需人工看日志 `/Users/administrator/Library/Logs/zenithjoy-api.dev.error.log`）

## 测试策略

- Manual：Step1/2/8都有内置断言（库存在性、migration执行结果、health 200）
- 无 unit test（一次性运维脚本+plist模板，非可复用逻辑）
- 守卫：真URL冒烟（health check）即可，这是"你控的一台开发机"级别，不需要额外常驻巡检

## 范围外

- 不建独立 dev 发布 CI/CD 流水线（`releases/dev` 软链暂不建，直接从 `releases/current` 跑）
- 不处理 staging 遗留在 LaunchAgent 的历史债务（Notion issue `199219fa` 已记录）
- 不给 dev 配域名/HTTPS/Cloudflare Access（本地端口访问，跟 dev 使用场景一致）
