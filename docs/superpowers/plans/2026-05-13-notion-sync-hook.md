# Notion Sync Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions hook 在 PR merge to main 后, 解析 PR body trailer 并 PATCH Notion Sprint DB (Status=done + PRs append) 与 Component DB (Last Changed Sprint)。

**Architecture:** 单 workflow yml 触发, 单 Node 20 脚本执行, 无外部依赖, dry-run flag 支持 smoke 真验证。错误处理铁律: 永远 exit 0, hook 不阻塞 merge。

**Tech Stack:** GitHub Actions, Node 20 native `fetch`, Notion REST API v1, bash smoke.

**Branch:** `cp-0513214511-notion-sync-hook`
**Worktree:** `/Users/administrator/worktrees/zenithjoy/notion-sync-hook`
**Brain Task:** `c80af602-25a4-452c-80c2-86b5338f5990`

---

## File Structure

| 文件 | 职责 | 行数预算 |
|---|---|---|
| `.github/workflows/scripts/smoke/notion-sync-smoke.sh` | 3 case E2E smoke (trailer / no-trailer / not-found) | ~70 |
| `.github/scripts/notion-sync-on-merge.js` | 解析 trailer + Notion API + dry-run | ~140 |
| `.github/workflows/notion-sync.yml` | PR merge trigger + Node 20 + env wiring | ~30 |
| `docs/superpowers/specs/2026-05-13-notion-sync-hook-design.md` | spec (已 commit `ca87ca4`) | — |

---

## Task 1: 写 fail smoke + 空 skeleton (commit 1)

**Files:**
- Create: `.github/workflows/scripts/smoke/notion-sync-smoke.sh`
- Create: `.github/scripts/notion-sync-on-merge.js` (空 skeleton, console.log exit 0)

- [ ] **Step 1: 写 smoke 脚本**

写入 `.github/workflows/scripts/smoke/notion-sync-smoke.sh`:

```bash
#!/usr/bin/env bash
# Smoke for .github/scripts/notion-sync-on-merge.js
# 3 case:
#   1. PR body 含 Notion-Sprint trailer + 真 sprint 名 → dry-run 输出 "found sprint" + "would PATCH"
#   2. 无 trailer → "no Notion-Sprint trailer" + exit 0
#   3. 不存在的 sprint 名 → "sprint not found" warning + exit 0

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT="$REPO_ROOT/.github/scripts/notion-sync-on-merge.js"

[ -f "$SCRIPT" ] || { echo "FAIL: $SCRIPT 不存在"; exit 1; }

if [ -z "${NOTION_API_KEY:-}" ] && [ -f "$HOME/.credentials/notion.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.credentials/notion.env"
fi

if [ -z "${NOTION_API_KEY:-}" ]; then
  echo "SKIP: NOTION_API_KEY 未配置"
  exit 0
fi

PASS=0
FAIL=0
assert_contains() {
  if echo "$1" | grep -qF "$2"; then
    echo "  PASS: $3"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $3"; echo "    expected: $2"; echo "    got: $1"; FAIL=$((FAIL + 1))
  fi
}

echo "=== Case 1: 含 trailer + 真 sprint → dry-run PATCH 计划 ==="
OUT1=$(NOTION_API_KEY="$NOTION_API_KEY" PR_NUMBER=99999 \
  PR_TITLE="chore: smoke fake" PR_URL="https://github.com/test/repo/pull/99999" \
  PR_BODY=$'## Summary\n\nfake.\n\nNotion-Sprint: Sprint 2.1f 产品级容错' \
  node "$SCRIPT" --dry-run 2>&1)
echo "$OUT1" | sed 's/^/    /'
assert_contains "$OUT1" "found sprint" "Case 1: 找到 sprint"
assert_contains "$OUT1" "DRY-RUN" "Case 1: dry-run 标记"
assert_contains "$OUT1" "would PATCH" "Case 1: PATCH 计划"

echo ""
echo "=== Case 2: 无 trailer → 静默退出 ==="
OUT2=$(NOTION_API_KEY="$NOTION_API_KEY" PR_NUMBER=99998 \
  PR_TITLE="chore: no trailer" PR_URL="https://github.com/test/repo/pull/99998" \
  PR_BODY=$'## Summary\n\n没 trailer' \
  node "$SCRIPT" --dry-run 2>&1)
echo "$OUT2" | sed 's/^/    /'
assert_contains "$OUT2" "no Notion-Sprint trailer" "Case 2: 识别无 trailer"

echo ""
echo "=== Case 3: 不存在 sprint 名 → warning + exit 0 ==="
OUT3=$(NOTION_API_KEY="$NOTION_API_KEY" PR_NUMBER=99997 \
  PR_TITLE="chore: fake sprint" PR_URL="https://github.com/test/repo/pull/99997" \
  PR_BODY=$'## Summary\n\nNotion-Sprint: 不存在的 Sprint XYZ-99999' \
  node "$SCRIPT" --dry-run 2>&1) && EC=$? || EC=$?
echo "$OUT3" | sed 's/^/    /'
assert_contains "$OUT3" "sprint not found" "Case 3: 报告找不到"
if [ "${EC:-0}" -eq 0 ]; then
  echo "  PASS: Case 3 exit 0 (不阻塞)"; PASS=$((PASS + 1))
else
  echo "  FAIL: Case 3 exit $EC (应该 0)"; FAIL=$((FAIL + 1))
fi

echo ""
echo "Smoke: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
```

设 executable: `chmod +x .github/workflows/scripts/smoke/notion-sync-smoke.sh`

- [ ] **Step 2: 写空 impl skeleton**

写入 `.github/scripts/notion-sync-on-merge.js`:

```javascript
#!/usr/bin/env node
console.log('notion-sync-on-merge skeleton (impl pending)');
process.exit(0);
```

- [ ] **Step 3: 跑 smoke 确认 fail**

```bash
bash .github/workflows/scripts/smoke/notion-sync-smoke.sh
```

Expected: 7+ FAIL (因为 skeleton 不输出 "found sprint" / "no Notion-Sprint trailer" / "sprint not found")。最后 "PASS=X FAIL=Y" 里 FAIL>0。

- [ ] **Step 4: Commit 1 (fail test)**

```bash
chmod +x .github/workflows/scripts/smoke/notion-sync-smoke.sh
git add .github/workflows/scripts/smoke/notion-sync-smoke.sh .github/scripts/notion-sync-on-merge.js
git commit -m "test(notion-sync): smoke E2E for PR merge hook (fails until impl)

3 cases: trailer + real sprint / no trailer / sprint not found.
Skeleton impl 故意空, smoke 失败证明 test 真在测东西。

Brain task c80af602-25a4-452c-80c2-86b5338f5990
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 实现 notion-sync-on-merge.js (commit 2)

**Files:**
- Modify: `.github/scripts/notion-sync-on-merge.js`

- [ ] **Step 1: 用完整实现替换 skeleton**

完整替换 `.github/scripts/notion-sync-on-merge.js`:

```javascript
#!/usr/bin/env node
/**
 * Notion sync on PR merge.
 *
 * 触发: GitHub Actions, PR closed + merged to main.
 * 行为:
 *   - 解析 PR body 里 `Notion-Sprint: <name>` 和 `Notion-Components: <a>, <b>` trailer
 *   - PATCH Sprint Registry 行: Status=done + PRs append `#<n> <url>`
 *   - PATCH Component Registry 行: Last Changed Sprint = <sprint name>
 * 铁律: 永远 exit 0。PR 已 merge, hook 不能阻塞。
 */

const SPRINT_DB = '35ec40c2-ba63-8113-9016-dd4acad35c5c';
const COMPONENT_DB = '35ec40c2-ba63-815a-b75b-deb3c45d717b';
const NOTION_VERSION = '2022-06-28';

const DRY_RUN = process.argv.includes('--dry-run');
const {
  NOTION_API_KEY,
  PR_NUMBER = '?',
  PR_TITLE = '',
  PR_BODY = '',
  PR_URL = '',
} = process.env;

function log(...args) { console.log('[notion-sync]', ...args); }
function warn(...args) { console.log('[notion-sync] WARN:', ...args); }

if (!NOTION_API_KEY) {
  warn('NOTION_API_KEY missing — skipping');
  process.exit(0);
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Notion ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function parseTrailers(body) {
  const sprintMatch = body.match(/^Notion-Sprint:\s*(.+?)\s*$/m);
  const compsMatch = body.match(/^Notion-Components:\s*(.+?)\s*$/m);
  return {
    sprint: sprintMatch ? sprintMatch[1].trim() : null,
    components: compsMatch
      ? compsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [],
  };
}

async function findPageByName(dbId, name) {
  const data = await notion('POST', `/databases/${dbId}/query`, {
    filter: { property: 'Name', title: { equals: name } },
    page_size: 5,
  });
  if (!data.results || data.results.length === 0) return null;
  if (data.results.length > 1) {
    warn(`name "${name}" matches ${data.results.length} rows in ${dbId}; taking first`);
  }
  return data.results[0];
}

function readRichText(prop) {
  if (!prop || !prop.rich_text) return '';
  return prop.rich_text.map(r => r.plain_text || '').join('');
}

async function patchSprintDone(page, prRef) {
  const existingPRs = readRichText(page.properties.PRs);
  const newPRs = existingPRs ? `${existingPRs}\n${prRef}` : prRef;
  const body = {
    properties: {
      Status: { select: { name: 'done' } },
      PRs: { rich_text: [{ type: 'text', text: { content: newPRs.slice(0, 2000) } }] },
    },
  };
  if (DRY_RUN) {
    log('DRY-RUN: would PATCH sprint', page.id, '→ Status=done, PRs:', JSON.stringify(newPRs));
    return;
  }
  await notion('PATCH', `/pages/${page.id}`, body);
  log('patched sprint', page.id, '→ Status=done, PRs appended', prRef);
}

async function patchComponentLastSprint(page, sprintName) {
  const body = {
    properties: {
      'Last Changed Sprint': { rich_text: [{ type: 'text', text: { content: sprintName } }] },
    },
  };
  if (DRY_RUN) {
    log('DRY-RUN: would PATCH component', page.id, '→ Last Changed Sprint=', sprintName);
    return;
  }
  await notion('PATCH', `/pages/${page.id}`, body);
  log('patched component', page.id, '→ Last Changed Sprint =', sprintName);
}

async function main() {
  log(`PR #${PR_NUMBER}: ${PR_TITLE}`);
  if (DRY_RUN) log('DRY-RUN mode');

  const { sprint, components } = parseTrailers(PR_BODY);

  if (!sprint) {
    log('no Notion-Sprint trailer in PR body — nothing to sync');
    return;
  }

  const prRef = `#${PR_NUMBER} ${PR_URL}`;

  // Sprint
  try {
    const sprintPage = await findPageByName(SPRINT_DB, sprint);
    if (!sprintPage) {
      warn(`sprint not found in Notion: "${sprint}" — leaving untouched`);
    } else {
      log('found sprint:', sprint, '→', sprintPage.id);
      await patchSprintDone(sprintPage, prRef);
    }
  } catch (e) {
    warn('sprint sync failed:', e.message);
  }

  // Components
  for (const comp of components) {
    try {
      const compPage = await findPageByName(COMPONENT_DB, comp);
      if (!compPage) {
        warn(`component not found: "${comp}" — leaving untouched`);
        continue;
      }
      log('found component:', comp, '→', compPage.id);
      await patchComponentLastSprint(compPage, sprint);
    } catch (e) {
      warn(`component "${comp}" sync failed:`, e.message);
    }
  }

  log('done');
}

main().catch(e => {
  warn('unexpected error:', e.message);
}).finally(() => process.exit(0));
```

- [ ] **Step 2: 跑 smoke 确认 pass**

```bash
bash .github/workflows/scripts/smoke/notion-sync-smoke.sh
```

Expected: 7 PASS / 0 FAIL, 最后 "PASS=7 FAIL=0", exit 0。

如有 FAIL, 看哪一 case 出问题:
- Case 1 FAIL: 检查 "Sprint 2.1f 产品级容错" 在 Sprint DB 是否真存在
- Case 2 FAIL: trailer 解析 regex 错
- Case 3 FAIL: 找不到分支误抛错

- [ ] **Step 3: Commit 2 (impl pass test)**

```bash
git add .github/scripts/notion-sync-on-merge.js
git commit -m "feat(notion-sync): implement PR merge → Sprint/Component PATCH

Parser:
  - Notion-Sprint: <name>       (required, no trailer = no-op)
  - Notion-Components: a, b, c  (optional)

Sprint DB: Status=done + PRs rich_text append '#N URL'
Component DB: Last Changed Sprint rich_text = sprint name

铁律 exit 0: try/catch 全部 swallow + main().finally exit。
DRY-RUN flag: smoke 真查 Notion 但不 PATCH。

Smoke 7/7 PASS。

Brain task c80af602-25a4-452c-80c2-86b5338f5990
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: 加 workflow yml (commit 3)

**Files:**
- Create: `.github/workflows/notion-sync.yml`

- [ ] **Step 1: 写 workflow**

写入 `.github/workflows/notion-sync.yml`:

```yaml
name: Notion Sync on PR Merge

# 触发: PR 合到 main 之后, 把 PR body 里的 Notion-Sprint / Notion-Components
# trailer 同步到 Notion DB。永远不阻塞 (脚本 exit 0)。
#
# Required secret: NOTION_API_KEY (Lead 用 gh secret set 一次性配)

on:
  pull_request:
    types: [closed]
    branches: [main]

permissions:
  contents: read

concurrency:
  group: notion-sync-${{ github.event.pull_request.number }}
  cancel-in-progress: false

jobs:
  sync:
    name: Notion Sync
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run notion sync
        env:
          NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_URL: ${{ github.event.pull_request.html_url }}
        run: node .github/scripts/notion-sync-on-merge.js
```

- [ ] **Step 2: yaml lint**

```bash
node -e "const yaml=require('js-yaml');console.log(yaml.load(require('fs').readFileSync('.github/workflows/notion-sync.yml','utf8')))" 2>&1 | head -5
```

如果 js-yaml 不在 root node_modules, 用 Python:

```bash
python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/notion-sync.yml'));print('YAML OK')"
```

Expected: 输出 `YAML OK` 或 JS dump。

- [ ] **Step 3: Commit 3 (workflow)**

```bash
git add .github/workflows/notion-sync.yml
git commit -m "ci(notion-sync): add workflow trigger on PR merge to main

pull_request closed + merged == true → run node script.
permissions: contents: read (收窄, 与 ci-l*.yml 风格一致).
concurrency 锁 PR number 避免重复触发, cancel-in-progress: false 保完整。

Required secret: NOTION_API_KEY.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: 本地真 smoke + push + 开 PR (commit 4 if needed)

**Files:** 无新文件, 只跑 + push。

- [ ] **Step 1: 本地真 smoke 最后一遍**

```bash
cd /Users/administrator/worktrees/zenithjoy/notion-sync-hook
bash .github/workflows/scripts/smoke/notion-sync-smoke.sh
```

Expected: PASS=7 FAIL=0。

- [ ] **Step 2: push 分支**

```bash
git push -u origin cp-0513214511-notion-sync-hook
```

Expected: branch 推上 GitHub, output 含 "new branch ... -> cp-0513214511-notion-sync-hook"。

- [ ] **Step 3: 开 PR (title 含 [CONFIG] tag, body 含 trailer 自指)**

```bash
gh pr create --title "[CONFIG] ci(notion-sync): PR merge → Sprint/Component auto-update" --body "$(cat <<'EOF'
## Summary

新建 GitHub Actions hook, PR merge 到 main 后自动 PATCH Notion 6 DB 里的 Sprint Registry + Component Registry, 减少 Lead 手动维护 Notion。

## What

- Sprint 行 Status → done, PRs 字段 append \`#<n> <url>\`
- 命中的 Component 行 Last Changed Sprint → 该 Sprint 名

## How

PR body 加 trailer 触发 (本 PR 自指作为第一例):
- \`Notion-Sprint: <name>\` (必填, 无 = 静默 exit 0)
- \`Notion-Components: a, b\` (选填)

铁律: 永远 exit 0, hook 不阻塞 merge。

## Spec / Plan

- Spec: \`docs/superpowers/specs/2026-05-13-notion-sync-hook-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-13-notion-sync-hook.md\`

## Test plan

- [x] 本地 smoke 7/7 PASS (Case 1/2/3)
- [ ] PR merge 后看 GitHub Actions logs 验 workflow 起效
- [ ] Notion Sprint Registry 出现新行 \`#<this PR>\` (本 PR 自身做第一次 e2e)

## Required Lead 动作 (合并前)

\`gh secret set NOTION_API_KEY --repo perfectuser21/zenithjoy-workspace\` 一次性配凭据。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Notion-Sprint: Sprint B-1 Path 2 评论挖客 thin
Notion-Components: Notion Sync Hook
EOF
)"
```

Expected: 输出 PR URL。

注: trailer 写 "Sprint B-1 Path 2 评论挖客 thin" 是为了第一次合并验证 (该 Sprint 已存在并 done)。如果该名字在 Notion 不存在, 改成任意已知存在的 Sprint 名。

- [ ] **Step 4: 通知 Lead 配 secret**

输出给 Lead:

```
PR 已开。合并前请配 GitHub repo secret:

  gh secret set NOTION_API_KEY --repo perfectuser21/zenithjoy-workspace
  # 粘贴 ~/.credentials/notion.env 里 NOTION_API_KEY= 后面的值

不配的话 workflow 跑会 "NOTION_API_KEY missing — skipping" 静默退出,
不阻塞 merge 但同步不会真发生。
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| §2 trailer 约定 | Task 2 step 1 (parseTrailers) |
| §3 架构 | Task 2 + Task 3 |
| §4.1 yml | Task 3 |
| §4.2 worker | Task 2 |
| §4.3 smoke | Task 1 |
| §5 错误处理 (永远 exit 0) | Task 2 main().catch().finally |
| §6 测试策略 | Task 1 smoke 3 case |
| §7 CI lint 兼容 | (无任务, 设计层面豁免, 见 spec) |
| §8 secret 部署前置 | Task 4 step 4 通知 Lead |
| §9 上线后验证 | Task 4 step 3 PR body trailer 自指 + test plan |
| §10 out of scope | (无任务) |

**Placeholder scan:** 无 TBD/TODO, 所有 step 含具体 shell/JS/YAML 代码。

**Type consistency check:** SPRINT_DB / COMPONENT_DB / NOTION_VERSION 常量在 Task 2 内一致。`findPageByName` 函数签名 `(dbId, name)` Task 2 内部 2 处调用一致。

无 issue。
