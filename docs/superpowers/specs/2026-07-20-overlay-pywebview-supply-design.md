# 设计:框框(overlay)断供根治——pywebview 确定性供给 + 消灭静默降级 + 判据焊进 golden path(刀A)

日期:2026-07-20 | 决策:c7022118(安装框架方向) + 本刀 bug-fix decision | 分支:cp-0720101623-overlay-pywebview-supply

## 背景与根因(已实证)

overlay 画像卡 0717 core 升 2.0.84 换目录后死 3 天无人知晓(`overlay-diag.json` → `attach_state=preflight_failed, last_error=pywebview_missing`)。三环全漏:

1. **无供给**:`services/agent/scripts/build-install-pack.sh` R2 段预装列表 `WHEEL_PKGS="pywinauto pywin32 comtypes six requests"` 不含 pywebview;两份 requirements.txt(`services/agent/wechat-rpa/`、`services/agent/build-modules/line04/wechat-rpa/`)不含;客户机侧 `modules/line04/preflight.ts` 的 `autoRepair()` 只装 pywinauto。pywebview 系当年手工 pip 装进 rog 旧 core 目录,换目录即丢。
2. **静默降级**:`modules/line04/handlers/overlay.ts` `start()`(:110-139) preflight 失败仅 `writeDiag` 返回,不上报、不重试,agent 重启才再试。
3. **闸门全软**:CI e2e 探针 `pip install pywebview || true`(wechat-cs-e2e.yml:207)+探针失败 `|| echo` 兜底;打包脚本 R2 pip 失败仅 WARN 继续出包(build-install-pack.sh:194-198)。

对照正样本:pywinauto 同链路三处全有(WHEEL_PKGS + autoRepair + requiredChecks),从不失踪。0720 早 rog 手工补装 pywebview → overlay 立即复活,因果闭环。

## 目标

干净机全新安装即能弹框;存量机自动补装;框框死了必上红灯;判据由机器(CI/golden path)保证,不靠人记。

## 修改设计(六件套,一个 PR)

### 1. 打包链供给(build-install-pack.sh)
- `WHEEL_PKGS` 加 `pywebview==<锁定版>`(实现时以当前 pypi 稳定版为准并写死;禁止不锁版本——防上游 breaking change 铺向全部客户机)。
- 两份 requirements.txt 同步加同版本。
- R2 段 `install_embedded_pkgs` 失败从 WARN 改**硬红 exit 非 0**(铁律 9202c14e:部署链失败路径禁止 warning 降级);pip 命令加最多 3 次退避重试抗 pypi 抖动。site-packages 校验段(:201-205)同步改硬。

### 2. 客户机兜底补装(modules/line04/preflight.ts)
- `autoRepair()` 增加 `installPywebview()`,仿 `installPywinauto()`(:685,get-pip bootstrap + pip install):清华源失败回退官方 pypi;版本与打包链同锁。
- **失败必须冒泡**:安装失败时 preflight 结果显式 `ok:false, reason:'pywebview_install_failed'`,禁止 catch 吞掉(混沌 P0-2)。
- 安装目标 python 与运行时同一次 `getModulePython()`(:743)决议结果,贯穿安装+校验,防 OTA 中间态装错目录(混沌 P1-6)。
- 触发面:agent 启动/模块激活前的 preflight 均走此链,与 module 版本是否变化无关——覆盖"只升 core 换目录"场景(混沌 P0-1,本次事故直接诱因)。

### 3. 消灭静默降级(handlers/overlay.ts + 心跳)
- `start()` preflight 失败:除 writeDiag 外,把结果折成 `{ok:false, reason}` 并进心跳 `module_status`(服务端 `apps/api/src/routes/walking-skeleton.ts:66` 已解析、`agents.module_status` jsonb 已持久化;`normalizeModuleStatus` 只收 ok/reason 两字段,不塞全量)。key 用 `line04-overlay`。
- reason 必须区分 `pywebview_missing` / `webview2_missing` / `pywebview_install_failed`(混沌 P2-9,指导正确介入方向)。
- 成功态同样上报 `{ok:true}`。状态式上报(每跳带当前态),broker 断线重连即自动补报;断线窗口由现有 agent 离线检测兜底(混沌 P0-3 的接受化处理,记录在案不再加独立通道)。
- 上报挂点:line04 `index.ts` 现有健康上报链(reportHealthOnce/statusReport)→ `heartbeat-loop.ts` `setModuleStatus`(:115)。

### 4. 看板红灯(apps/dashboard)
- `ModuleHealthPage.tsx` 硬编码 `LINES`(:21-26)加 `line04-overlay` 列(StatusCell 对任意 entry 通用,只需加 key)。
- 诊断页 `AdminCustomersPage.tsx`(:328-336)动态遍历,自动显示,无需改。
- 主动告警(红灯持续→飞书/企微推送)**不在本刀**,另立小刀(用户拍板)。

### 5. diag 语义修正(handlers/overlay.ts writeDiag)
- 成功态也无条件覆写 `overlay-diag.json`(带 ts),根除"旧失败文件误导排查"已知坑(混沌 P2-7)。

### 6. CI/golden path 硬闸
- **主闸(供给证明)**:`agent-installpack.yml` dryrun verify 步(:159 起)对**打包产物的 python-embedded** 加 `python.exe -c "import webview"` 硬断言——出厂验货,windows-latest 干净机即"干净机全新安装即能弹框"的机器证明。
- **e2e 探针转硬**:wechat-cs-e2e.yml:195-210 去掉 `pip install || true` 与 `|| echo` 兜底;探针跑 `overlay_window.py --probe`(API 级,防 import 成功但建窗崩的假绿,判定点已入库)。
- **GP-4 行为判据**:`golden-path-4-smoke.sh` Step 3 扩展(沿用热键折进 3i/3j 的模式,新增小步):断言供给链四处齐备(WHEEL_PKGS 含 pywebview / requirements 含 / preflight.ts 含 installPywebview / overlay.ts 接了状态上报),任何 PR 拆掉任一处即红。不新增散装 smoke(decision fc17d9eb)。

## 错误路径(混沌审查吸收清单)

| 场景 | 处理 |
|---|---|
| 打包机 pip 失败/pypi 抖动 | 3 次退避重试后硬红,构建失败可见 |
| 客户机补装失败(无网/镜像挂/杀软) | reason=pywebview_install_failed 上红灯,清华→官方双源 |
| core 再换目录 | 启动 preflight 必跑 autoRepair,变异测试覆盖 |
| pywebview 上游坏版本 | 版本锁死;probe 建窗 API 级验证 |
| 心跳链断 | 状态式上报+重连补报+离线检测兜底 |
| WebView2 缺失 | reason 独立区分,不误导跑补装 |
| 红灯没人看 | 看板列+诊断页;主动告警另立刀 |

## 测试策略(四档)

- **unit(vitest)**:`overlay-handler.test.ts` 新增——preflight 失败必须触发状态上报(mutation:注释上报调用→红);preflight.ts——mock pip 非 0 → 断言结果含 `pywebview_install_failed`(mutation:改成吞错→红)。
- **unit(pytest)**:`test_overlay_preflight.py` 补 diag 成功态覆写断言。
- **CI/E2E**:installpack 产物 `import webview` 硬断言;e2e probe 转硬;GP-4 Step 3 新小步。
- **真机轻量 evaluator(merge 后验收)**:rog OTA 后真跑锚定断言——心跳 `module_status.line04-overlay` 出现且看板列真实变色;红灯路径用"临时移除 pywebview→红→autoRepair 补装→绿"拿 proven-to-fire 证据。

## Proven-to-fire(标 done 前必做,留证据)

1. pywebview 移出 WHEEL_PKGS 跑 installpack 验证 → 主闸红;
2. 注释 overlay.ts 上报调用 → vitest 红;
3. GP-4 新小步:临时删 requirements 中 pywebview 行 → smoke 红。

## 不做(本刀范围外)

- 主动告警推送(另立小刀,已拍板)
- 存量散装 overlay smoke(line04-ai-overlay-*)折并 GP-4(登记待办)
- WebView2 runtime 自动安装(仅区分 reason)
- 刀B(安装框架:清环境+进度可视化)、刀C(框框内容重设计)

## CI 注意(踩坑预防)

- 动 `.github/workflows/` → PR 标题带 `[CONFIG]`;改 services/agent/src → bump package.json;新 smoke 步进 smoke-baseline 无需(改已有 GP-4 脚本);`ci-l4-runtime` 的 diff -r 覆盖 wechat-rpa 整目录 → 改 python 文件须 rsync 同步 build-modules 镜像;修 bug 用 `fix:` 前缀。
