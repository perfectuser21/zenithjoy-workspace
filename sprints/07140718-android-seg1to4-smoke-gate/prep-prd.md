# 小改动 PrepPRD：安卓挖客链路守卫从「只守采集(Seg1)」扩成「守整条 Seg1-4 端到端」

## 背景 / 为什么改
安卓端挖客链路（Line02）的段间代码早已自动接线（分布式状态机：采集→判定→抓评论→私信，fire-and-forget）。
但真机守卫 `line02-android-collect-realmachine-smoke.sh` **只断言到 Seg1（采集≥2）** 就结束，后面 3 个接线点
（判定翻牌 / 抓评论者落 leads / 私信派单）没有任何 CI 守着——某段一改接线断了没人当晚知道。
本改动把这条 smoke 延长成 Seg1-4 端到端守卫，一趟车守住全链。

> 注：handoff_0713 说的采集剩件（NO_SEARCH_INPUT 复位 / SEARCH_TIMEOUT 时序 / 多卡退化）经逐行核对，
> 已由 #1230/#1231/#1273/#1274 全部根治，本刀不含采集代码改动，只做守卫扩展。

## 改什么（2 个文件）

### 文件 1：`apps/api/src/routes/acquisition.ts` — `GET /collect-tasks/:id/videos` 补判定字段
让 smoke 纯 curl 就能读到判定结果（`judgment_status` 目前无任何 GET 端点暴露，否则 smoke 得往真机 runner 塞 staging DB 凭据）。
3 处最小改动（行号基于 main 1a780fb8）：
- 行 254-261 行内类型：补 `judgment_status: string;` 与 `judgment_reason: string | null;`
- 行 262-265 SELECT：`SELECT video_id, task_id, title, thumbnail_url, publish_date, comment_count, judgment_status, judgment_reason`
- 行 269-276 map：每个 video 对象补 `judgment_status: r.judgment_status,` 与 `judgment_reason: r.judgment_reason,`
> `judgment_status` 列有 `DEFAULT 'pending'`（迁移 20260712_content_judgment_gate.sql），恒有值，无需处理 null。
> 这是纯只读加字段，不改写入方、不改判定逻辑，向后兼容（老字段全保留）。

### 文件 2：`.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh` — 追加 Seg2-4 断言
在现有「断言 collected≥2 + ≥2 真实 video_id」之后，追加以下三段（保持现有环境自检/派任务/采集断言不动）：

```bash
# ── 5. Seg2 判定：轮询等所有采集视频判定完成（judgment_status 非 pending）──
# 判定 = agent 逐视频截图 → POST /judge-video → Gemini 异步触发，依赖 MediaProjection 授权。
# 授权失效 → capture_type=skipped_capture_failed → judgment_status 恒 pending（handoff 风险①：判定虚过）。
JUDGED=0; MATCHED=0
for i in $(seq 1 18); do   # 18×10s = 3min
  VJ=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect-tasks/$TASK/videos" -H "X-Tenant-Id: $TENANT" 2>/dev/null)
  PENDING=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status=="pending")]|length' 2>/dev/null || echo "$COUNT")
  MATCHED=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status=="matched")]|length' 2>/dev/null || echo 0)
  JUDGED=$(echo "$VJ" | jq '[.data.videos[]|select(.judgment_status!="pending")]|length' 2>/dev/null || echo 0)
  echo "  [判定 $i/18] judged=$JUDGED matched=$MATCHED pending=$PENDING"
  [ "${PENDING:-1}" -eq 0 ] && break
  sleep 10
done
[ "${JUDGED:-0}" -ge 1 ] \
  || fail "判定链未跑：$COUNT 视频全 pending 3min ——疑 MediaProjection 授权失效/agent 未上报 /judge-video（handoff 风险①，判定虚过）"
ok "Seg2 判定完成 judged=$JUDGED matched=$MATCHED"

# ── 6. Seg3 抓评论者→acquisition_leads（仅当有 matched，判定放行才会进 Stage2）──
if [ "${MATCHED:-0}" -ge 1 ]; then
  LEADS=0
  for i in $(seq 1 18); do   # 3min
    LC=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/collect/$TASK" -H "X-Tenant-Id: $TENANT" 2>/dev/null | jq -r '.data.lead_count_raw // 0' 2>/dev/null)
    echo "  [抓评论 $i/18] lead_count_raw=$LC"
    [ "${LC:-0}" -gt 0 ] && { LEADS=$LC; break; }
    sleep 10
  done
  [ "${LEADS:-0}" -gt 0 ] \
    || fail "有 $MATCHED 个 matched 但 lead_count_raw=0 ——Seg2→Seg3 接线断（Stage2 抓评论未触发/未落 acquisition_leads）"
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
    || fail "有 leads 但 dispatch/plan.total=0 ——Seg3→Seg4 接线断（buildAssignments/dispatchDue 未建私信单）"
  ok "Seg4 私信单已建 dispatch_plan_total=$DISP"
else
  echo "🟡 本轮判定全 rejected（matched=0）——Seg3/4 无匹配可验：判定链正常工作但无命中（非 bug，非红）"
fi

echo "🎉 PASS: agent-android 挖客链路 Seg1-4 端到端接线全通过(task=$TASK)"
```

## 关联上下文
- 相关 Journey/Ability：Line02 智能获客（Path2）挖客链路
- 相关 handoff：handoff_0714_android_e2e_glue（本作战图）、handoff_0713_content_judgment_realmachine_3cuts（判定链）
- gate 骨架来源：#1275（真机 nightly gate）、#1276/#1278（curl -k / jq .data 修复）

## 判定点登记表（对模糊现实的判断假设）
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 判定是否"真跑过" | ①有 matched ②有非pending | 有≥1 非pending（matched或rejected） | 授权失效恒 pending，非pending 即证明截图判定真发生 | 误判轻：过严会漏放合法 rejected；过松会放过授权失效 |
| 判定全 rejected 是否算失败 | ①红 ②跳过Seg3/4 | 跳过（log 黄字，非红） | 全 rejected 是合法业务结果（视频不匹配目标画像），判定链本身正常 | 误判轻：该轮 Seg3/4 未守到，但 Seg2 已证明判定+接线活性 |
| Seg4 私信单断言精度 | ①按 task 过滤 ②租户级 total>0 | 租户级 dispatch/plan.total>0 | 无 task 级派单查询端点；total>0 证明派单链活 | 误判轻：历史遗留单可能假阳，但"派单链断"仍会被 lead_count_raw>0 却 total=0 抓到 |

## 前置工作（已确认）
- [x] staging API 可达：`https://staging-autopilot.zenjoymedia.media`（现有 smoke 已用，env `API_BASE`）
- [x] 测试租户/agent：TENANT=455a8ca9-... AGENT=a7a7b36c-...（现有 smoke 常量）
- [x] 判定字段数据源：改用新增的 videos 端点 judgment_status，**不需要** runner psql/DB 凭据
- [x] 真机设备 xian-rog：ANGYVB4311010223，adb WinGet scrcpy 版（现有 gate 已配）
- [⚠] MediaProjection 授权：真机判定截图前置——若失效则 Seg2 断言故意报红（这是本 smoke 的价值，不是阻塞项）

## 影响范围
- videos 端点加字段：纯增量，现有前端/调用方不受影响（多返回两个字段）
- smoke 脚本：现有 nightly + workflow_dispatch 不变；yml 的 PR required gate 仍保持注释关闭（待连续数晚绿再打开，本刀不打开）

## Regression 守卫（proven-to-fire）
- videos 端点加字段 → vitest 断言响应含 `judgment_status`（逻辑接缝，进 CI）
- smoke Seg2-4 断言 → 环境接缝守卫，靠真机 workflow_dispatch 跑绿证明（刀3，PR merge 后手动触发）
- proven-to-fire：真机跑时若判定全 pending 应看到 Seg2 fail 报红（授权失效照妖镜验证）

## 验收标准
- [ ] vitest：`GET /collect-tasks/:id/videos` 响应 videos[] 含 judgment_status 字段（failing test 先行）
- [ ] smoke 脚本 Seg2-4 断言逻辑就位（shellcheck 通过，无语法错）
- [ ] CI 全绿（vitest + lint + 现有 gate 不破）
- [ ] （刀3，merge 后）xian-rog 真机 workflow_dispatch 跑扩展后 gate 一趟：Seg1-4 全绿
