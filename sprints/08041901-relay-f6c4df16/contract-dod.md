# Contract DoD — 夜间安卓两 Job 迁 pc4 手机池轨

**TASK_ID**: f6c4df16-ba9c-49ed-89fc-67bbba743182
**SPRINT_DIR**: sprints/08041901-relay-f6c4df16

---

## 完成定义（Definition of Done）

### [BEHAVIOR-1] douyin-read 绑定 android-capable runner

- 描述：`nightly-real-machine-staging.yml` 内 `douyin-read` job 的 `runs-on` 为 `[self-hosted, android-capable]`
- 验收类型：manual:bash
- 验收命令：
  ```bash
  grep -A2 'douyin-read:' .github/workflows/nightly-real-machine-staging.yml \
    | grep 'runs-on' \
    | grep -q 'android-capable' && echo "PASS" || { echo "FAIL"; exit 1; }
  ```

---

### [BEHAVIOR-2] account-scan 绑定 android-capable runner

- 描述：`nightly-real-machine-staging.yml` 内 `account-scan` job 的 `runs-on` 为 `[self-hosted, android-capable]`
- 验收类型：manual:bash
- 验收命令：
  ```bash
  grep -A2 'account-scan:' .github/workflows/nightly-real-machine-staging.yml \
    | grep 'runs-on' \
    | grep -q 'android-capable' && echo "PASS" || { echo "FAIL"; exit 1; }
  ```

---

### [BEHAVIOR-3] wechat-bubble 保留 wechat-capable（keep-green 约束）

- 描述：`wechat-bubble` job 的 `runs-on` 必须保持 `[self-hosted, wechat-capable]`，迁移不得波及微信 job
- 验收类型：manual:bash
- 验收命令：
  ```bash
  awk '/^  wechat-bubble:/{found=1} found && /^  [a-z]/{if(!/^  wechat-bubble:/) found=0} found' \
    .github/workflows/nightly-real-machine-staging.yml \
    | grep 'runs-on' \
    | grep -q 'wechat-capable' && echo "PASS" || { echo "FAIL: wechat-bubble runner changed"; exit 1; }
  ```

---

### [BEHAVIOR-4] account-scan 的 DB_SSH 环境变量完整保留

- 描述：`DB_SSH_HOST`、`DB_SSH_PORT`、`DB_SSH_KEY` 三个变量在 `account-scan` job 中均存在（pc4 runner ACL 已就绪）
- 验收类型：manual:bash
- 验收命令：
  ```bash
  count=$(awk '/^  account-scan:/,/^  nightly-report:/' \
    .github/workflows/nightly-real-machine-staging.yml \
    | grep -c 'DB_SSH_') && \
  [ "$count" -ge 3 ] && echo "PASS: DB_SSH vars=$count" || { echo "FAIL: DB_SSH vars=$count (expected >=3)"; exit 1; }
  ```

---

### [BEHAVIOR-5] wechat-capable 不再出现在安卓两 job 中

- 描述：`douyin-read` 和 `account-scan` job 的 `runs-on` 行不得包含 `wechat-capable`，确保不存在残留绑定
- 验收类型：manual:bash
- 验收命令：
  ```bash
  # 检查安卓两 job 块内不出现 wechat-capable
  python3 -c "
  import re, sys
  txt = open('.github/workflows/nightly-real-machine-staging.yml').read()
  # 找 douyin-read 和 account-scan job 块的 runs-on 行
  jobs = re.findall(r'(douyin-read|account-scan):[^\n]*\n(?:.*\n)*?.*runs-on:\s*\[([^\]]+)\]', txt)
  bad = [(j, r) for j, r in jobs if 'wechat-capable' in r]
  if bad:
      print('FAIL: wechat-capable found in:', bad); sys.exit(1)
  print('PASS: no wechat-capable in android jobs')
  "
  ```

---

## 集成测试脚本

运行所有 DoD 检查：
```bash
bash sprints/08041901-relay-f6c4df16/tests/contract-check.sh
```

---

## 不在 DoD 内

- 安卓 job 在真机环境下的运行时绿状态（设备在线属运行时因素）
- `promote-all-prod.yml` 验证（job 名不变，不受影响）
- 任何新功能或脚本逻辑变更
