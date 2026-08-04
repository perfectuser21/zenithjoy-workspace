# Contract Draft — 夜间安卓两 Job 迁 pc4 手机池轨

**TASK_ID**: f6c4df16-ba9c-49ed-89fc-67bbba743182
**SPRINT_DIR**: sprints/08041901-relay-f6c4df16
**GP Anchor**: line02/keyword_acquisition keep-green
GP-Anchor: line02/keyword_acquisition keep-green
**journey_type**: ci_fix
**target_environment**: ci_config
**起草日期**: 2026-08-04

---

## 变更摘要

将 `nightly-real-machine-staging.yml` 中 `douyin-read` 与 `account-scan` 两个 job 的
`runs-on` 从 `[self-hosted, wechat-capable]`（xian-rog）改为 `[self-hosted, android-capable]`
（pc4 手机池轨），并同步更新相关注释。`wechat-bubble` job 保持不变，继续绑定 `wechat-capable`。

---

## 变更文件

| 文件 | 改动行数 | 改动类型 |
|---|---|---|
| `.github/workflows/nightly-real-machine-staging.yml` | ≤ 20 行 | `runs-on` 各改一行 + 注释更新 |

---

## Invariants（不可破坏）

| ID | 描述 |
|---|---|
| INVARIANT-1 | `wechat-bubble` 必须保留 `[self-hosted, wechat-capable]`（rog）|
| INVARIANT-2 | `douyin-read`/`account-scan` job 名称不得更改（promote 前缀匹配依赖）|
| INVARIANT-3 | `needs` 依赖链 wechat-bubble → douyin-read/account-scan → nightly-report 不变 |
| INVARIANT-4 | `account-scan` 的 `DB_SSH_HOST/DB_SSH_PORT/DB_SSH_KEY` 环境变量不得删除 |

---

## E2E 验收

### 必须通过（合同级）

**[BEHAVIOR-1] douyin-read job 绑定 android-capable runner**

验收断言：`.github/workflows/nightly-real-machine-staging.yml` 中 `douyin-read` job 的
`runs-on` 字段值为 `[self-hosted, android-capable]`，不包含 `wechat-capable`。

验收命令（manual:bash）：
```bash
grep -A2 'douyin-read:' .github/workflows/nightly-real-machine-staging.yml \
  | grep 'runs-on' \
  | grep -q 'android-capable' && echo "PASS: douyin-read runs-on android-capable" \
  || { echo "FAIL: douyin-read still on wrong runner"; exit 1; }
```

---

**[BEHAVIOR-2] account-scan job 绑定 android-capable runner**

验收断言：`.github/workflows/nightly-real-machine-staging.yml` 中 `account-scan` job 的
`runs-on` 字段值为 `[self-hosted, android-capable]`，不包含 `wechat-capable`。

验收命令（manual:bash）：
```bash
grep -A2 'account-scan:' .github/workflows/nightly-real-machine-staging.yml \
  | grep 'runs-on' \
  | grep -q 'android-capable' && echo "PASS: account-scan runs-on android-capable" \
  || { echo "FAIL: account-scan still on wrong runner"; exit 1; }
```

---

**[BEHAVIOR-3] wechat-bubble job 不受影响，仍绑定 wechat-capable**

验收断言：`wechat-bubble` job 的 `runs-on` 必须保持 `[self-hosted, wechat-capable]`，
不得出现 `android-capable`。

验收命令（manual:bash）：
```bash
# 提取 wechat-bubble job 块（到下一个顶级 job 前）并检查 runs-on
awk '/^  wechat-bubble:/{found=1} found && /^  [a-z]/{if(!/^  wechat-bubble:/) found=0} found' \
  .github/workflows/nightly-real-machine-staging.yml \
  | grep 'runs-on' \
  | grep -q 'wechat-capable' && echo "PASS: wechat-bubble still on wechat-capable" \
  || { echo "FAIL: wechat-bubble runner changed"; exit 1; }
```

---

**[BEHAVIOR-4] account-scan DB_SSH 环境变量完整保留**

验收断言：`account-scan` job 中必须存在 `DB_SSH_HOST`、`DB_SSH_PORT`、`DB_SSH_KEY` 三个
环境变量配置，且值不为空。

验收命令（manual:bash）：
```bash
awk '/^  account-scan:/,/^  [a-z][a-z-]*:/' \
  .github/workflows/nightly-real-machine-staging.yml \
  | grep -c 'DB_SSH_' \
  | grep -qE '^[3-9]$|^[0-9]{2}' && echo "PASS: DB_SSH_* vars present" \
  || { echo "FAIL: DB_SSH_* vars missing or incomplete"; exit 1; }
```

---

**[BEHAVIOR-5] needs 依赖链结构不变**

验收断言：`douyin-read` 和 `account-scan` 都声明 `needs: [wechat-bubble]`；
`nightly-report` 声明 `needs: [wechat-bubble, douyin-read, account-scan]`。

验收命令（manual:bash）：
```bash
grep -E 'needs:' .github/workflows/nightly-real-machine-staging.yml \
  && echo "---" \
  && grep -c 'wechat-bubble' .github/workflows/nightly-real-machine-staging.yml \
  | grep -qE '^[2-9]' && echo "PASS: needs chain intact" \
  || { echo "FAIL: needs chain broken"; exit 1; }
```

---

### 可选验证（运行时，不作代码合入拦截）

- workflow_dispatch 手动触发后，GitHub Actions UI 中 `douyin-read`/`account-scan` 的
  Runner 列显示 pc4 机器名（非 rog 机器名）
- `account-scan` 日志中出现 `adb connect` 或 `adb devices` 输出，列出 `192.168.3.x:5555`
  系列设备（表示手机池可达）
- `nightly-report` Step Summary 不出现"runner offline / 等待 wechat-capable"字样

---

## 不在验收范围内

- 安卓 job 运行时是否绿（设备在线是运行时因素，本 PR 只保证 runner 绑定正确）
- `nightly-android-fleet-pc4.yml` 的任何改动
- `promote-all-prod.yml` 逻辑（job 名不变，前缀匹配不受影响）
