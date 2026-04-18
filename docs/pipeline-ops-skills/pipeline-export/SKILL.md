---
name: pipeline-export
description: /pipeline-export、NAS 上传、重传 — Content Pipeline Stage 6 (tar over ssh 同步 NAS) 运维 skill
---

# /pipeline-export — Stage 6 NAS 上传运维 skill

## 什么时候用
- pipeline 日志 `NAS 上传最终失败`
- 想手动重传某个 output_dir 到 NAS
- 验证 NAS 上的文件是否完整
- ssh nas 报 `Authenticating as '\220\225'`（rsync 中文用户名 bug）

## 前置检查

```bash
# 1. SSH config 有 nas alias（User 徐啸 + HostName + 密钥）
grep -A 5 "^Host nas" ~/.ssh/config

# 2. 能连上 NAS
ssh -o ConnectTimeout=5 nas "whoami && pwd" 2>&1 | head -3
# 期望输出：徐啸 + /var/services/homes/徐啸

# 3. NAS 目标目录
ssh nas "ls /volume1/workspace/vault/zenithjoy-creator/content/ | tail -5"
```

## 介入步骤

### 步骤 1: 确定 pipeline_id

```bash
KEYWORD="<关键词>"
# 从 API 查 pipeline_id
curl -s -H "Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}" \
  "http://localhost:5200/api/pipelines?limit=20" | python3 -c "
import json, sys
data = json.load(sys.stdin).get('data', {}).get('pipelines', [])
for p in data:
    if '${KEYWORD}' in (p.get('keyword') or ''):
        print(p.get('id'), p.get('keyword'), p.get('status'), p.get('current_stage'))
"
```

### 步骤 2: tar over ssh 上传（绕中文用户名 bug）

```bash
OUT_DIR="<output_dir>"
PIPELINE_ID="<pipeline_id>"
NAS_BASE="/volume1/workspace/vault/zenithjoy-creator/content"
NAS_PATH="${NAS_BASE}/${PIPELINE_ID}"

# mkdir -p 远端
ssh nas "mkdir -p '${NAS_PATH}'"

# tar -cf - | ssh 'tar -xf -'（关键：**不用** rsync）
tar -cf - -C "${OUT_DIR}" . | ssh nas "cd '${NAS_PATH}' && tar -xf -"
```

**为什么必须 tar over ssh 不用 rsync**：NAS 账号是中文用户名「徐啸」。rsync 自己 spawn ssh 子进程时 UTF-8 bytes 会被 mangle（日志 `Authenticating as '\220\225'`），导致 Permission denied。直接 `ssh nas` 走 SSH config 的 `User 徐啸` 由 OpenSSH 自己解析，不经 rsync 中间层，就能过。

### 步骤 3: 验证 NAS 上的文件

```bash
PIPELINE_ID="<pipeline_id>"
NAS_PATH="/volume1/workspace/vault/zenithjoy-creator/content/${PIPELINE_ID}"

ssh nas "ls -la '${NAS_PATH}/'"
ssh nas "ls '${NAS_PATH}/cards/' | wc -l"         # 期望 ≥ 12（9 PNG + copy.md + llm-card-content.json + person-data.json）
ssh nas "cat '${NAS_PATH}/manifest.json'" | python3 -m json.tool | head -30
```

## 批量重传所有失败的 pipeline

```bash
# 列出本地有但 NAS 没有的 output_dir
for d in ~/content-output/20*-*; do
  id=$(basename "$d")
  exists=$(ssh nas "[ -d '/volume1/workspace/vault/zenithjoy-creator/content/${id}' ] && echo Y || echo N")
  if [ "$exists" = "N" ]; then
    echo "MISSING ON NAS: $id"
  fi
done
```

## 验收标准

```bash
# 1. NAS 目录存在
ssh nas "test -d '${NAS_PATH}' && echo OK"

# 2. 文件数匹配本地
LOCAL_COUNT=$(find "${OUT_DIR}" -type f | wc -l)
NAS_COUNT=$(ssh nas "find '${NAS_PATH}' -type f | wc -l")
echo "local=$LOCAL_COUNT nas=$NAS_COUNT"
# 期望相等

# 3. manifest.json 存在
ssh nas "test -f '${NAS_PATH}/manifest.json' && echo OK"
```

## 常见坑

| 症状 | 原因 | 修法 |
|------|------|------|
| `rsync: Authenticating as '\220\225'` | 中文用户名 + rsync 子进程编码 bug | 别用 rsync，改 tar over ssh alias |
| `ssh: connect to host ...: Operation timed out` | NAS 关机 / Tailscale 断 | 检查 `ssh nas` 直接能否通；重连 tailscale |
| `Permission denied (publickey)` | SSH config 的 IdentityFile 坏了 | 检查 `~/.ssh/config` Host nas 块完整 |
| `tar: /volume1/...: Cannot chdir: No such file or directory` | mkdir 步骤挂了 | 先单独跑 `ssh nas "mkdir -p '${NAS_PATH}'"` 看错 |
| NAS 空间满 | `df -h` on NAS 看 | ssh nas "df -h /volume1" |
| 上传慢 / 卡 | TAR_TIMEOUT=120s 硬写死 | 图多时可能超；分批传或调源码 timeout |

## 相关文件路径
- NAS uploader: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/nas_uploader.py`
- Executor: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/export.py`
- SSH 配置: `~/.ssh/config` `Host nas` 块
- 环境变量: `NAS_SSH_ALIAS`（默认 `nas`）、`NAS_BASE`（默认 `/volume1/workspace/vault/zenithjoy-creator/content`）
- NAS 路径格式: `{NAS_BASE}/{pipeline_id}/{cards,article,manifest.json,...}`
