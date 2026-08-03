# 设计：真机车道假绿根治（envfail 一律红 + ADB 探测 + promote 证据 job 粒度）

日期：2026-08-03 ｜ Brain task `3e6a9041` ｜ decision `2f11ae25`(invariant) ｜ 用户拍板：方案B
PrepPRD：`sprints/08031239-realmachine-lane-envfail-red/prep-prd.md`

## 问题
nightly 真机回归安卓刀D（account-scan）自 07-30 起从未摸到手机：
- Bug1：smoke 脚本默认裸 `adb`，runner PATH 无 adb，`adb devices 2>/dev/null` 静默失败被误报"无 Android 设备在线"。
- Bug2：workflow 把 envfail(exit 3) 包装成 job success(infra-skip)，瘫痪 5 天零报警。

## 改动（4 个文件 + 3 个新测试）

### 1. `.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh`
- ADB 解析（仅当未显式传入 ADB 时探测）：
  1. glob `/c/Users/*/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_*/scrcpy-*/adb.exe`，`sort -V | tail -1` 取最新版（照抄 e2e-line02-android-collect.yml 已验证的 glob 优先顺序；sort -V 规避 3.10<3.2 字典序陷阱）
  2. 兜底 `command -v adb`
  3. 都没有 → `envfail "runner 上找不到 adb"`（独立文案）
- 无论显式/探测，设备检查前统一 `"$ADB" version` 校验，失败 → `envfail "adb 不可用: <stderr>"`（第三种文案，不吞 stderr）
- 原"无 Android 设备在线"文案保留，仅在 adb 确认可用后才可能触发。

### 2. `.github/workflows/nightly-real-machine-staging.yml`
- 刀D step：删除 `if [ "$CODE" -eq 3 ] → exit 0` 包装；保留 `set +e` 捕获、`echo code>>$GITHUB_OUTPUT`（在 exit 前写，job failure 时 outputs 仍传递——已查证 GitHub Actions 行为）、`exit "$CODE"`。
- 同步删改 job 头部"envfail 不算红/job 以 success 收尾"设计注释（否则注释说谎）。
- nightly-report：`code=3` 时标签改 `envfail(环境未就绪)`；红判定继续只 key 在 `result=failure`（容忍 code 为空：checkout 失败/timeout 场景安全降级）；issue body 处理约定补一句 envfail 分类说明。

### 3. `.github/workflows/promote-all-prod.yml` 证据②（方案B：job 粒度，互不连坐）
- 从"最近 2 次 workflow conclusion 全 success"改为：取最近 2 次 completed nightly run 的 jobs（`gh api .../runs/<id>/jobs`），按 job 名匹配：
  - **阻塞**：`真微信`、`真抖音` 两个 job 最近 2 晚必须全 success（本 promote 发的是中台后端+前端，这两条是其真机证据）
  - **不阻塞但大字警告**：`真安卓 account-scan` job 任一晚非 success → run summary 写 ⚠️ 警告（安卓 APK 走 COS 分发不经此 promote；谁放行谁知情）
- 最新 run <36h 新鲜度检查、waive_nightly 豁免逻辑不变。

### 4. supersede 声明
PR 描述注明推翻 sprint 07292330 合同"envfail 不计绿/红(infra-skip)"条款，依据 decision `2f11ae25`。

## 测试策略（档位：integration-static，CI 永久回归）
TDD 两段式：commit-1 三个 failing test，commit-2 实现变绿。均放 `.github/workflows/scripts/__tests__/`，前缀 `account-scan-realmachine-smoke.*` 保证被 ci-l1-process.yml 现有 glob 接入（不改 glob，不产孤儿测试）。

1. `account-scan-realmachine-smoke.adb-discovery.test.sh`（静态断言，抄 envbind.test.sh 模式——规避 ubuntu runner 自带 adb 干扰）：探测逻辑存在；glob 先于 command -v；`sort -V` 存在；`adb version` 校验存在且先于 devices 检查；三种 envfail 文案互异。
2. `account-scan-realmachine-smoke.envfail-red.test.sh`：提取 nightly workflow 刀D `id: run` 的 run 块，断言不存在 `-eq 3` 与 `exit 0` 组合分支；断言 `exit "$CODE"` 保留。
3. `account-scan-realmachine-smoke.promote-job-granularity.test.sh`：断言 promote-all-prod 证据② 查询 jobs 粒度（含 `/jobs` API 调用）、真微信/真抖音为阻塞判定、真安卓为警告不阻塞、36h 新鲜度保留。

**proven-to-fire（标 done 前必做）**：每个守卫用变异 fixture 自证会红——①临时把脚本探测段删掉跑 test1 见红；②临时把 exit0 包装加回跑 test2 见红；③临时把证据②还原 workflow 级跑 test3 见红。记录在 PR 描述。

**真机验收（环境接缝守卫）**：合并后手动触发 nightly workflow 一次，刀D 在 rog runner 真正摸到手机、对照 08-03 11:52 手动全绿基线（装 2.1.19 → status=done → account_ids≥1）。

## 错误路径
- runner 无 scrcpy 也无 PATH adb → envfail"找不到 adb"（红+报警，值班可辨）
- adb 存在但坏（驱动/版本冲突）→ envfail"adb 不可用"带 stderr
- 手机夜里 WiFi-adb 掉线 → envfail"无设备在线"→ 红+issue（真实暴露无线调试不稳定，不再静默；自愈 adb connect 属 nice-to-have 已排除出本刀，登记 issue）
- checkout 失败/timeout → outputs.code 为空 → nightly-report 按 result=failure 计普通红，不崩

## 不做（YAGNI）
- adb connect 自愈 / 设备唤醒（另登记 issue）
- [nightly-red] issue 自动消费/升级（另立项）
- evaluator target_environment android 档（另立项）
- Android agent 代码任何改动
