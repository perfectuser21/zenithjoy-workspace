# Deploy Unify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 ZenithJoy Dashboard 部署入口为 `deploy/deploy.sh`，根目录加 2 行 redirect，删除 `deploy-hk.sh` 的重复实现。

**Architecture:** 保留 `deploy/deploy.sh` 作为唯一真正实现，补上 git 安全三检（未提交/未跟踪/未 push）和公网 smoke；根目录 `deploy.sh` 和 `deploy-hk.sh` 各为 2 行 exec redirect，不含任何业务逻辑。

**Tech Stack:** bash, git, rsync, curl

---

### Task 1: 更新 `deploy/deploy.sh` — 加 git 安全检查 + 公网 smoke

**Files:**
- Modify: `deploy/deploy.sh`

- [ ] **Step 1: 在 "检查分支" 之后（第 39 行之后）、"构建" 之前插入 git 安全三检**

将 `deploy/deploy.sh` 的 "# 1. 检查是否在 main 分支" 块之后、"# 2. 构建" 之前，插入以下内容：

```bash
# 未提交或已暂存但未 commit 的改动
if ! git -C "$PROJECT_ROOT" diff --quiet || ! git -C "$PROJECT_ROOT" diff --cached --quiet; then
  echo "BLOCKED: 有未提交的改动"
  git -C "$PROJECT_ROOT" status --short
  exit 1
fi

# 未跟踪的源文件
UNTRACKED=$(git -C "$PROJECT_ROOT" ls-files --others --exclude-standard -- apps/dashboard/src/ apps/dashboard/public/ | head -5)
if [ -n "$UNTRACKED" ]; then
  echo "BLOCKED: 有未跟踪的源文件"
  echo "$UNTRACKED"
  exit 1
fi

# 本地 HEAD 未 push 到远端
LOCAL_SHA=$(git -C "$PROJECT_ROOT" rev-parse HEAD)
REMOTE_SHA=$(git -C "$PROJECT_ROOT" rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "none")
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "BLOCKED: 本地 $CURRENT_BRANCH 和远端不同步，请先 push"
  exit 1
fi

echo "Git 检查通过 (branch: $CURRENT_BRANCH, sha: ${LOCAL_SHA:0:7})"
```

同时将脚本第一行 `set -e` 改为 `set -euo pipefail`，并在文件顶部（TARGET 之前）加颜色变量：

```bash
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
```

- [ ] **Step 2: 在 `SMOKE_URL` 配置项里加 hk 的公网地址**

在 `case $TARGET in` 的 `hk)` 块里，加一行：

```bash
SMOKE_URL="https://autopilot.zenjoymedia.media"
```

- [ ] **Step 3: 在文件末尾（======== 部署完成 ======== 之后）追加公网 smoke**

```bash
# 公网 smoke
echo ""
echo ">>> 公网 smoke..."
if curl -sf "$SMOKE_URL" --max-time 15 > /dev/null 2>&1; then
  echo -e "${GREEN}✅ 公网 smoke 通过: $SMOKE_URL${NC}"
else
  echo -e "${YELLOW}⚠️  公网 smoke 失败，检查 nginx/CDN: $SMOKE_URL${NC}"
fi
```

- [ ] **Step 4: 验证脚本语法**

```bash
bash -n deploy/deploy.sh && echo "语法 OK"
```

Expected: `语法 OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/perfect21/zenithjoy/.claude/worktrees/cp-06282251-deploy-unify
git add deploy/deploy.sh
git commit -m "fix(deploy): 补 git 安全三检 + 公网 smoke 到 deploy/deploy.sh"
```

---

### Task 2: 创建根目录 `deploy.sh` + 替换 `deploy-hk.sh`

**Files:**
- Create: `deploy.sh`（根目录）
- Modify: `deploy-hk.sh`（根目录，替换为 redirect）

- [ ] **Step 1: 创建根目录 `deploy.sh`**

```bash
cat > deploy.sh << 'EOF'
#!/bin/bash
exec "$(dirname "$0")/deploy/deploy.sh" "$@"
EOF
chmod +x deploy.sh
```

- [ ] **Step 2: 替换 `deploy-hk.sh` 为 2 行 redirect**

```bash
cat > deploy-hk.sh << 'EOF'
#!/bin/bash
exec "$(dirname "$0")/deploy/deploy.sh" hk "$@"
EOF
chmod +x deploy-hk.sh
```

- [ ] **Step 3: 验证两个 redirect 脚本语法**

```bash
bash -n deploy.sh && echo "deploy.sh 语法 OK"
bash -n deploy-hk.sh && echo "deploy-hk.sh 语法 OK"
```

Expected: 两行都输出 `语法 OK`

- [ ] **Step 4: Commit**

```bash
git add deploy.sh deploy-hk.sh
git commit -m "fix(deploy): 根目录 deploy.sh + deploy-hk.sh 改为 2 行 redirect"
```

---

### Task 3: Push + PR

- [ ] **Step 1: Push 分支**

```bash
git push -u origin cp-06282251-deploy-unify
```

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --title "fix(deploy): 统一部署入口，补 git 安全检查 + 公网 smoke" \
  --body "$(cat <<'EOF'
## Summary
- 保留 deploy/deploy.sh 为唯一实现，删除 deploy-hk.sh 重复逻辑
- 补 git 安全三检（未提交/未跟踪/未 push）
- 末尾加公网 smoke (https://autopilot.zenjoymedia.media)
- 根目录 deploy.sh + deploy-hk.sh 各改为 2 行 exec redirect

## Test plan
- [ ] bash -n 两个 redirect 脚本语法无报错
- [ ] bash -n deploy/deploy.sh 语法无报错
- [ ] CI 全绿

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
