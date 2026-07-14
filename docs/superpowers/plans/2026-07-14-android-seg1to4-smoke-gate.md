# 安卓挖客 Seg1-4 端到端守卫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Line02 安卓挖客真机 smoke 从只守采集(Seg1)扩成守整条 Seg1-4(采集→判定→抓评论→私信)。

**Architecture:** 两个改动——① 给 `GET /collect-tasks/:id/videos` 补 `judgment_status`/`judgment_reason` 只读字段，让 smoke 纯 curl 就能读判定结果；② smoke 脚本在现有采集断言后追加 Seg2/3/4 三段轮询断言。授权失效致判定全 pending 时 Seg2 报红（handoff 风险①照妖镜）。

**Tech Stack:** Express + pg (apps/api, TypeScript, vitest + supertest, DB mock)；bash + curl + jq (真机 smoke, xian-rog self-hosted runner)。

---

## File Structure

- `apps/api/src/routes/acquisition.ts` — 修改 `GET /collect-tasks/:id/videos` handler（约 :254-286），补两个只读字段。
- `apps/api/src/routes/acquisition.test.ts` — 新增一个 vitest 断言判定字段（describe 块约 :954）。
- `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh` — 在文件末尾（现有 `🎉 PASS` 行之前）追加 Seg2/3/4 断言。

---

### Task 1: videos 端点补 judgment_status/judgment_reason 字段

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts:254-286`
- Test: `apps/api/src/routes/acquisition.test.ts:954`（describe 块内新增 it）

- [ ] **Step 1: 写 failing test**

在 `apps/api/src/routes/acquisition.test.ts` 的 `describe('GET /api/acquisition/collect-tasks/:id/videos [BEHAVIOR]')` 块内（约 :1020 那个 it 之后）新增：

```typescript
  it('videos[] 含 judgment_status/judgment_reason（Seg2 判定字段，供 smoke 断言）', async () => {
    const mod = await import('../db/connection');
    (mod.default.query as any)
      .mockResolvedValueOnce({ rows: [{ id: VALID_TASK_ID, status: 'done', error_code: null, video_count: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          video_id: '7123456789',
          task_id: VALID_TASK_ID,
          title: null,
          thumbnail_url: null,
          publish_date: null,
          comment_count: 3,
          judgment_status: 'matched',
          judgment_reason: '目标画像命中',
        }],
      });
    const res = await request(app)
      .get(`/api/acquisition/collect-tasks/${VALID_TASK_ID}/videos`)
      .set('x-test-tenant-id', 'tenant-a');
    expect(res.status).toBe(200);
    const v = res.body.data.videos[0];
    expect(v).toHaveProperty('judgment_status', 'matched');
    expect(v).toHaveProperty('judgment_reason', '目标画像命中');
  });
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts -t "judgment_status/judgment_reason"`
Expected: FAIL —— 现 map 不返回 judgment_status，`toHaveProperty('judgment_status')` 断言失败。

- [ ] **Step 3: 改实现（三处）**

在 `apps/api/src/routes/acquisition.ts` 的 `GET /collect-tasks/:id/videos` handler：

3a. 行内返回类型（约 :254-261）补两字段：
```typescript
    const { rows } = await pool.query<{
      video_id: string;
      task_id: string;
      title: string | null;
      thumbnail_url: string | null;
      publish_date: Date | null;
      comment_count: number;
      judgment_status: string;
      judgment_reason: string | null;
    }>(
```

3b. SELECT（约 :262-265）补两列：
```typescript
      `SELECT video_id, task_id, title, thumbnail_url, publish_date, comment_count, judgment_status, judgment_reason
         FROM zenithjoy.acquisition_collect_videos
        WHERE task_id = $1 AND tenant_id = $2
        ORDER BY created_at ASC`,
```

3c. map（约 :269-276）补两字段：
```typescript
    const videos = rows.map((r) => ({
      video_id: r.video_id,
      task_id: r.task_id,
      title: r.title,
      thumbnail_url: r.thumbnail_url,
      publish_date: r.publish_date ? new Date(r.publish_date).toISOString() : null,
      comment_count: r.comment_count ?? 0,
      judgment_status: r.judgment_status,
      judgment_reason: r.judgment_reason,
    }));
```

- [ ] **Step 4: 跑测试确认 pass（含既有测试不破）**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: PASS（新测试绿 + 既有 videos 端点测试全绿，向后兼容）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/acquisition.ts apps/api/src/routes/acquisition.test.ts
git commit -m "feat(line02): videos端点补judgment_status/judgment_reason字段——供Seg2 smoke断言判定翻牌"
```

---

### Task 2: smoke 脚本追加 Seg2/3/4 断言

**Files:**
- Modify: `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`（在末尾 `echo "🎉 PASS..."` 那行之前插入）

- [ ] **Step 1: 定位插入点**

打开脚本，找到现有第 4 步末尾——`ok "采集 $COUNT 个、$REAL 个真实 video_id 落库 …"` 与 `echo "🎉 PASS: agent-android 抖音采集真机端到端通过(task=$TASK)"` 两行。把新断言插在这两行之间，并把最后的 `🎉 PASS` 文案改为 Seg1-4。

- [ ] **Step 2: 插入 Seg2/3/4 断言**

在 `ok "采集 $COUNT 个…"` 之后插入：

```bash
# ── 5. Seg2 判定：轮询等判定跑起来(judged≥1)，不等"全部非pending" ──
# 判定 = agent 逐视频截图→POST /judge-video→Gemini 异步触发，依赖 MediaProjection 授权。
# 授权失效→capture_type=skipped_capture_failed→judgment_status 恒 pending(handoff 风险①:判定虚过)。
# 注意:合法留 pending 的分支不止授权失效(force_timeout/no_api_key/Gemini error),故用 judged≥1
# 且 pending 数稳定作退出,不等全部非 pending(否则某视频永久 pending 会白烧满窗口)。
JUDGED=0; MATCHED=0; LAST_PENDING=-1; STABLE=0
for i in $(seq 1 18); do   # 18×10s = 3min 上限
  VJ=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect-tasks/$TASK/videos" -H "X-Tenant-Id: $TENANT" 2>/dev/null)
  PENDING=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status=="pending")]|length' 2>/dev/null || echo "$COUNT")
  MATCHED=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status=="matched")]|length' 2>/dev/null || echo 0)
  JUDGED=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status!="pending")]|length' 2>/dev/null || echo 0)
  echo "  [判定 $i/18] judged=$JUDGED matched=$MATCHED pending=$PENDING"
  [ "${PENDING:-1}" -eq 0 ] && break
  if [ "${JUDGED:-0}" -ge 1 ]; then
    if [ "${PENDING:-1}" -eq "${LAST_PENDING:--1}" ]; then STABLE=$((STABLE+1)); else STABLE=0; fi
    [ "$STABLE" -ge 2 ] && break
  fi
  LAST_PENDING=$PENDING
  sleep 10
done
[ "${JUDGED:-0}" -ge 1 ] \
  || fail "判定链未跑:$COUNT 视频全 pending ——疑 MediaProjection 授权失效/agent 未上报 /judge-video(handoff 风险①,判定虚过)"
ok "Seg2 判定完成 judged=$JUDGED matched=$MATCHED"

# ── 6. Seg3 抓评论者→acquisition_leads(仅当有 matched,判定放行才进 Stage2) ──
if [ "${MATCHED:-0}" -ge 1 ]; then
  LEADS=0
  for i in $(seq 1 18); do   # 3min
    LC=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect/$TASK" -H "X-Tenant-Id: $TENANT" 2>/dev/null | jq -r '.data.lead_count_raw // 0' 2>/dev/null)
    echo "  [抓评论 $i/18] lead_count_raw=$LC"
    [ "${LC:-0}" -gt 0 ] && { LEADS=$LC; break; }
    sleep 10
  done
  [ "${LEADS:-0}" -gt 0 ] \
    || fail "有 $MATCHED 个 matched 但 lead_count_raw=0 ——Seg2→Seg3 接线断(Stage2 抓评论未触发/未落 acquisition_leads)"
  ok "Seg3 抓评论者 lead_count_raw=$LEADS"

  # ── 7. Seg4 私信派单→dm_assignments ──
  DISP=0
  for i in $(seq 1 12); do   # 2min
    DP=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/dispatch/plan" -H "X-Tenant-Id: $TENANT" 2>/dev/null | jq -r '.data.total // 0' 2>/dev/null)
    echo "  [私信派单 $i/12] dispatch_plan_total=$DP"
    [ "${DP:-0}" -gt 0 ] && { DISP=$DP; break; }
    sleep 10
  done
  [ "${DISP:-0}" -gt 0 ] \
    || fail "有 leads 但 dispatch/plan.total=0 ——Seg3→Seg4 接线断(buildAssignments/dispatchDue 未建私信单)"
  ok "Seg4 私信单已建 dispatch_plan_total=$DISP"
else
  echo "🟡 本轮判定全 rejected(matched=0)——Seg3/4 无匹配可验:判定链正常工作但无命中(非 bug,非红)"
fi
```

并把最后一行改为：
```bash
echo "🎉 PASS: agent-android 挖客链路 Seg1-4 端到端接线全通过(task=$TASK)"
```

- [ ] **Step 3: 语法校验（shellcheck + bash -n）**

Run: `bash -n .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh && shellcheck -S error .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`
Expected: 无 error 级输出（无语法错）。若本机无 shellcheck，至少 `bash -n` 必须过。

> smoke 是环境接缝守卫,CI 干净环境跑不出真机链路——不写单测,靠 xian-rog `workflow_dispatch` 真机跑绿证明(刀3,PR merge 后手动触发)。本 PR CI 只保语法。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh
git commit -m "feat(ci): android采集smoke扩成Seg1-4端到端——追加判定/抓评论/私信三段断言守4接线点"
```

---

## 不包含（YAGNI）
- 不改采集 Kotlin 代码（退化点已由 #1230/#1231/#1273/#1274 根治）。
- 不打开 yml 的 PR required gate（保持 nightly + workflow_dispatch，待连续数晚绿再单独 PR 打开）。
- 不做企微 Seg5。

## Self-Review
- Spec coverage：组件1=Task1、组件2=Task2；测试策略(vitest+shellcheck)覆盖；Seg2 judged≥1 退出条件已落地。✅
- Placeholder scan：无 TBD/TODO，测试与实现代码完整。✅
- Type consistency：judgment_status(string)/judgment_reason(string|null) 在类型/SELECT/map/test 四处一致。✅
