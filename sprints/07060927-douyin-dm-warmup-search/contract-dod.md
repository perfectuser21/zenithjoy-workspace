---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: 抖音私信触达：抖音号搜索定位 + 关注点赞热身互动

**范围**: `DouyinDmOutreachService` 私信发送前插入"精确搜索定位主页"+"关注/点赞热身互动"两段真实动作，替换现有 `openProfile()` 兜底跳转；抖音号精确匹配、按钮态判断（关注/点赞）、90 秒单 lead 超时熔断、关注/点赞每小时频控（PRD NFR：关注 ≤10 次/小时、点赞 ≤15 次/小时，1 小时滑动窗口，独立于既有私信频控）共五块逻辑抽成纯函数（无 Android 框架依赖）并写 JUnit 单测。真机搜索定位/关注/点赞/私信全链路仅人工在 Honor 真机（Tailscale 100.91.227.1）补验，不计入本次 Harness 自动裁决（PRD `target_environment_reason` 显式声明）。
**大小**: S

> 所有 [BEHAVIOR] 在 `services/agent-android` 目录跑 `gradle :app:testDebugUnitTest`。CI（`.github/workflows/android-agent-ci.yml`，`runs-on: ubuntu-latest`）runner 预装 Android SDK 自动设有 `ANDROID_HOME`，必须真跑；本地开发机缺 `ANDROID_HOME` 时该条命令降级输出 `SKIP(no ANDROID_HOME) — logic-done-pending`，不得据此直接判 done。

## ARTIFACT 条目

- [ ] [ARTIFACT] `ProfileMatchResult` 枚举 + `matchProfileByDouyinId` 纯函数在 `DouyinDmOutreachService` companion object 中定义
  Test: manual:bash -c 'f=services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt; grep -q "enum class ProfileMatchResult" "$f" && grep -q "fun matchProfileByDouyinId" "$f" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] `needsFollowClick` / `needsLikeClick` 按钮态判断纯函数定义
  Test: manual:bash -c 'f=services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt; grep -q "fun needsFollowClick" "$f" && grep -q "fun needsLikeClick" "$f" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] `isLeadTimedOut` 90 秒超时熔断纯函数定义
  Test: manual:bash -c 'f=services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt; grep -q "fun isLeadTimedOut" "$f" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] `isFollowRateLimited` / `isLikeRateLimited` 关注/点赞每小时频控纯函数定义（PRD NFR：关注≤10/h、点赞≤15/h，独立于既有私信频控）
  Test: manual:bash -c 'f=services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt; grep -q "fun isFollowRateLimited" "$f" && grep -q "fun isLikeRateLimited" "$f" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] 合同测试文件已原样复制进真实 Android 单测源码树（TDD red → green 承接）
  Test: manual:bash -c 'diff sprints/07060927-douyin-dm-warmup-search/tests/android/DouyinDmWarmupSearchLogicTest.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DouyinDmWarmupSearchLogicTest.kt >/dev/null || { echo FAIL; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR 条目（manual:bash，Android gradle 单测真跑，非 mock）

- [ ] [BEHAVIOR] 抖音号精确匹配——唯一匹配返回 UNIQUE（Golden Path Step 2）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "matches exactly one profile by exact douyin id yields UNIQUE" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 抖音号精确匹配——零匹配返回 NO_MATCH，不重试转人工核实（Golden Path Step 3）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "zero matches yields NO_MATCH" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "empty search results yields NO_MATCH" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 抖音号精确匹配——多个同名结果返回 AMBIGUOUS，不重试转人工核实（Golden Path Step 3）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "multiple identical matches yields AMBIGUOUS" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 关注按钮态判断——"关注"点击/"已关注"跳过/找不到按钮尽力而为跳过（Golden Path Step 4）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "follow button text" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "null follow button (not found) does not need click" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 点赞按钮态判断——"点赞"点击/"已赞"跳过/无作品可点赞尽力而为跳过（Golden Path Step 5）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "like button text" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "null like button (no artwork or follow-only profile) does not need click" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 90 秒超时熔断——超过 90 秒标记 timeout，边界值/未超过正常继续（Golden Path"熔断规则"）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "elapsed time over 90 seconds is timed out" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "elapsed time exactly at 90 second boundary is not timed out" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "elapsed time under 90 seconds is not timed out" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 关注每小时频控——低于/恰好/超过 10 次上限判定，窗口外历史不计入（Golden Path Step 6，PRD NFR）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "follow count under hourly limit is not rate limited" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "follow count exactly at hourly limit is rate limited" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "follow count over hourly limit is rate limited" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "follow timestamps outside 1 hour window are not counted" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 点赞每小时频控——低于/恰好/超过 15 次上限判定，窗口外历史不计入（Golden Path Step 6，PRD NFR）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "like count under hourly limit is not rate limited" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "like count exactly at hourly limit is rate limited" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "like count over hourly limit is rate limited" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "like timestamps outside 1 hour window are not counted" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 部分子串匹配不算精确命中（防止用 contains 代替 equals 导致误判 UNIQUE）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "partial substring match does not count as exact match" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 单测用例总数 ≥ 22，防止 Generator 删测试假绿通过（覆盖五块纯函数全部场景）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml; COUNT=$(grep -o "tests=\"[0-9]*\"" "$XML" | head -1 | grep -o "[0-9]*"); [ "$COUNT" -ge 22 ] || { echo "FAIL: only $COUNT tests"; exit 1; }; echo OK'
  期望: OK

## 接缝清单（人工真机补验，未验前不得标 done——详见 contract-draft.md）

1. 抖音搜索结果页无障碍树读取完整抖音号字符串 — 人工在 Honor 真机确认能读到完整字符串
2. "关注"/"已关注"、"点赞"/"已赞" 按钮文本在当前抖音版本下的稳定性 — 人工真机手动核实一次
3. 搜索定位→关注→点赞→私信发送全链路真机跑通，Dashboard 触达记录变 `sent` — 人工在 Honor 真机对一个真实测试账号跑通

## 产品风险登记（Risks，详见 contract-draft.md "产品风险登记" 段）

1. 关注/点赞超出 PRD NFR 频控上限（关注 >10/h、点赞 >15/h）触发抖音风控判定小号为营销机器人 — 本轮已修复：`isFollowRateLimited`/`isLikeRateLimited` 纯函数 + Step 6 + 上方 8 条 [BEHAVIOR] 覆盖
2. 误关注不可逆（PRD"不做取消关注机制"）— 无 mitigation，PRD 层面已拍板用户已确认接受，本条仅存档说明，不需要修复
