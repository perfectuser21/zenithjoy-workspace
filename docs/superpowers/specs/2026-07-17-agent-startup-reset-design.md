# 设计：agent 启动归零 startup-reset（扩展 bootstrap-convergence）

> Brain task `0f0368cf` ｜ decision `391063ef` ｜ PrepPRD `sprints/07171705-agent-startup-reset/prep-prd.md`
> 用户拍板：agent 一启动必须瞬间把机子归零到零状态再启动所有东西，要有 checklist。

## 目标与范围

扩展现有启动第零阶段 `services/agent/src/bootstrap-convergence.ts`（decision 72740815），新增 5 项归零能力 + checklist 上报。**不新建平行模块**——沿用「纯函数 plan + 采集层 gather + 执行层 execute」三段结构，`planConvergence` 仍是 CI 单测唯一锚点。

不包含：cloak E_ACCESSDENIED 修复（另立 sprint）；A3 CI-vs-常驻互搅根治；B6 备份残留 / B7 注册表 Run 键（另立）。

## 架构（对现有三段的增量）

### 1. EnvState 新增字段（采集层 gatherEnvState，全部 best-effort，失败按"干净"）

```ts
orphanRpaPythons: { pid: number; script: string }[];   // 命令行含 listen_chat.py / overlay_window.py 且父 PID 已死
weixinTopLevelPids: number[];                          // 顶层 Weixin.exe（父进程非 Weixin.exe）
coreDirEnvPersisted: boolean;                          // OS 级(User) ZENITHJOY_CORE_DIR 已设且指向存在目录
pythonEmbeddedPresent: boolean;                        // <coreDir>/python-embedded/python.exe 存在
envConfigConsistent: boolean | null;                   // .env 的 ZENITHJOY_API_BASE 与 config.json apiUrl 同源；无 .env → null(不判)
debrisFiles: string[];                                 // %PUBLIC% 下 zj-*/test_*/send_* 且 mtime>7天
staleOnceZjTasks: string[];                            // 计划任务：名匹配 ^ZJ + 触发类型 once + 名≠ZenithJoyAgent
staleLockFiles: string[];                              // %PUBLIC%/zj-*.lock 且 mtime>10分钟（两把锁持有时长均为秒级）
```

进程父子关系复用现有 `Win32_Process` ParentProcessId 一次采集（已为祖先链采集过，同一份 map 复用，不加第二次全表查询；`parentOf` 需从 try 块局部提升到函数作用域。孤儿判据=父 PID 不在存活进程 keys 里；weixinTopLevelPids 用定向 Weixin.exe PID 查询 + parentOf 查 ppid）。

### 2. ConvergenceAction 新增类型（planConvergence 纯函数分支）

```ts
| { type: 'kill_orphan_python'; pid: number; script: string }
| { type: 'converge_wechat'; pids: number[] }          // 顶层树>1 → 杀全部顶层树；由后续任务经 launch_weixin()(#1358 锁+幂等)按需拉起
| { type: 'persist_core_dir_env'; dir: string }        // setx ZENITHJOY_CORE_DIR（User 级，幂等自愈）
| { type: 'delete_debris'; path: string }
| { type: 'delete_stale_task'; taskName: string }
| { type: 'delete_stale_lock'; path: string }
```

`pythonEmbeddedPresent=false` / `envConfigConsistent=false` 不产生破坏性动作，走既有 `report_config_gap`（上报缺口，人来修）。

### 3. CI plan-only 护栏（执行层）

`executeConvergence(actions, deps, { planOnly })`：`planOnly=true` 时破坏性动作（kill_* / delete_* / converge_wechat / persist_core_dir_env）只记日志 `[bootstrap][plan-only] 将执行: <action>` 不执行；`report_config_gap` 照常。判定：`process.env.GITHUB_ACTIONS==='true' || process.env.CI==='true'`，在 index.ts 算好传入。

已知边界（Research 实证）：CI 从不在 xian-rog 起完整 agent core（job2 直跑 listen_chat --dryrun；PsExec 路径 env 被切断但也不起 core），此闸是纵深防御 + 让 windows-latest E2E 断言确定性，不承诺根治 A3。

### 4. checklist 上报（心跳 module_status 伪 key，零服务端改动）

```ts
interface StartupResetReport { ok: boolean; reason?: string }   // 与 ModuleStatusReport 同构
```

- 5 项各自 pass/fail/skipped(plan-only) 汇总：任一 fail → ok=false，reason 列缺项（服务端截 500 字符内自行压缩）。
- 落点：`module_status.startup_reset`。Research 实证服务端无 key 白名单，AdminCustomersPage 遍历展示（红行）；ModuleHealthPage 固定列不显示（可接受，诊断表可见即达标）。
- **覆盖式快照坑**：`saveModuleStatus` 整列覆盖 → index.ts 持有模块级 `startupResetReport`，在 `syncModulesFromHeartbeat` 的 `loop.setModuleStatus(report)` 处合并 `{ ...report, startup_reset: startupResetReport }`；且在 `loop.start()` **之前** `setModuleStatus({ startup_reset })` 一次（start() 同步 sendOnce 在首个 await 前就读 moduleStatus——放 start 前首拍心跳即带上）。
- 心跳不通时：结果驻留 loop 内存，下次成功心跳自然带上；本地日志始终先行。

### 5. 启动序列接线（index.ts 第零步现址扩展）

现有 try 块内：gather → plan → execute 参数扩展即可；整体仍 best-effort 不阻断启动。时间预算：每个外部调用已有 15s timeout，新增采集共 3 类外部调用（schtasks 枚举 / dir 扫描 / 复用进程表），最坏 ~30s 内完成，不加全局 watchdog（与现有纪律一致）。

## 判定点（已入库 decisions）

| 判定点 | 所选 | decision |
|---|---|---|
| 孤儿 RPA python | 命令行匹配常驻脚本 + **父 PID 已死**（修正版：CI job2 同机直跑 dryrun 父活不误杀；真僵尸群全是父死；活重复实例由 kill_duplicate_agent 树杀顺带收） | 9edc14f2（修正 99e05f6f） |
| 顶层 Weixin 堆积 | 父进程非 Weixin.exe 的顶层计数 >1（#1358 真机口径） | 590031ea |
| 陈旧锁 | %PUBLIC%/zj-*.lock mtime>10min（agent.lock 由 single-instance 自愈不碰） | e463d71a |
| 残骸文件 | 前缀 zj-*/test_*/send_* + mtime>7天 | 47606e73 |
| 一次性 ZJ 任务 | ^ZJ + 触发类型 once + ≠ZenithJoyAgent（Research：正式任务仅此一个；once 类型三重收紧） | b32e83a5 |

## 错误处理

- 单动作失败：记 fail 进 checklist，继续其余（现有 executeConvergence 纪律）
- 采集失败：该项按"干净"处理 + checklist 记 skipped（宁可漏杀不误杀，与祖先链保守策略同源）
- 上报失败：本地日志兜底 + loop 驻留下次心跳补报

## 测试策略（四档）

- **unit（主力）**：`planConvergence` 新分支全覆盖——孤儿父死杀/父活不杀、顶层=1 不动/>1 收敛、debris 7 天边界、ZJ 任务三重条件（缺一不杀）、锁 10min 边界、CI 判定。**变异测试**：翻转"父 PID 已死"与"≠ZenithJoyAgent"两个最危险条件，亲眼看测试红（feedback_mutation_test_the_guard）。
- **integration**：`executeConvergence` 注入 deps mock——planOnly 破坏性动作零调用、report_config_gap 照常；index.ts moduleStatus 合并不丢真模块 key。
- **E2E/smoke（环境接缝守卫，proven-to-fire）**：agent-e2e-video.yml（windows-latest，唯一 CI 起完整 core 的地方）：预埋一个 `ZJTestOnce` 一次性任务 + 一个过期 zj- 残骸文件 → 启动 agent → 断言日志出现 `[bootstrap][plan-only] 将执行: delete_stale_task ZJTestOnce`（CI 模式 plan-only 本身就是被测行为）。真机段（真删除/真 setx/微信收敛）CI 不可及 → smoke 内注明「真机段等价断言」+ TODO，部署 rog 后人工 proven-to-fire：藏 python-embedded → AdminCustomersPage 见 startup_reset 红行 → 恢复。
- **trivial**：无。

## 版本与合规

- core 版本 bump：`services/agent/package.json` 2.0.82→2.0.83（index.ts VERSION 自动跟随 require，单一源）
- 模块文件（modules/line04/**）**不动** → 不触发 1.0.134 九处 bump
- commit 前缀 `fix:`（避免 lint-feature-has-smoke）；TDD 两段 commit：commit-1 failing tests，commit-2 实现
- PR 声明：保持 Path 1/2 smoke 全绿（agent 基础设施横切，journey 636a918c 运营中枢）
