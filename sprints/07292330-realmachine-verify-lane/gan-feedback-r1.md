# GAN Feedback — Round 1（Reviewer）

## VERDICT: REVISION_NEEDED

Round 1，阈值固定 7/10（不随 round 衰减）。7 维中 2 维 < 7：内部一致（4分）、Verification Oracle 完整性（5分）。其余 5 维均 ≥ 7，方向正确，问题集中且可定位，不建议推翻重来。

## 收敛状态（Round 1）
- 上轮我提的阻塞问题：N/A（首轮）
- 本轮新增阻塞问题：2 个（均为 PRD 核心诉求未被字面兑现，非"可以更严谨"类锦上添花）
- 合同行数：283 行（contract-draft.md）+ 97 行（contract-dod.md），对本 sprint 复杂度（CI 三层机制）而言合理，未见膨胀迹象

## RUBRIC SCORES

```json
{
  "dod_machineability": 8,
  "scope_match_prd": 9,
  "test_is_red": 9,
  "internal_consistency": 4,
  "risk_registered": 8,
  "verification_oracle_completeness": 5,
  "ci_workflow_alignment": 8
}
```

- **DoD 机检性 = 8**：contract-dod.md 全部 `[BEHAVIOR]`/`[ARTIFACT]` 条目都是 `manual:bash -c` 或 `node -e` 真实 exit code 断言，无 echo/自然语言级弱检查。扣 2 分：INV-6（禁止无条件 `exit 0`）用 tail -1 拿最后一行做启发式判断，边界情况（脚本最后一行恰好是普通注释）可能误判，但不影响 APPROVED 门槛。
- **Scope 匹配 PRD = 9**：Golden Path 6 步与 PRD 6 步逐条对应，未发现范围蔓延。已核实 PRD"不在范围内"三项（agent 心跳 last_seen/last_heartbeat_at 双字段修复、Path2 golden_path/journey_features 结构化记录 issue cbe9ed30、真机 OTA 自更新）均未被合同触碰——判定点登记表里"设备真实 agent_id 定位"一条虽提及 last_heartbeat_at 已知缺陷，但明确"单独处理，不阻塞本 sprint"，只做兜底不做修复，未越界。
- **Test 真红 = 9**：三份 tests/ 文件（envfail/lint-smoke-mock-honesty/realmachine-unverified-ratchet）路径明确，Generator 落地前必然因文件不存在/函数未导出而 FAIL，Test Contract 表逐条写明预期红证据。
- **内部一致 = 4**：**发现真实矛盾**，见下方问题 1（env var 命名分裂：`SMOKE_DIR_OVERRIDE` vs `REALMACHINE_SMOKE_DIR`/`REALMACHINE_NIGHTLY_YML`）。这不是吹毛求疵——Generator 严格按合同实现时，final-e2e 脚本和 DoD BEHAVIOR 测试必然有一个跑不通。
- **风险登记 = 8**：判定点登记表（agent_id 定位误判后果"⚠️ 高"）+ 失败语义声明表（license 被占、runner 掉线等）覆盖了本任务真实存在的风险点，每条都有应对（兜底/降级策略），无凑数条目。
- **Verification Oracle 完整性 = 5**：**发现真实矛盾**，见下方问题 2（Step 4 核心断言"退化"风险——这正是本 sprint 要修的病，见 review_focus #3）。PRD 用粗体明确"`status='done'` 且 `account_ids` 非空"是缺一不可的两段式核心断言，但合同 Step 4 展示的"验证命令"代码块只做了 `account_ids` 检查，完全没有对 `status` 字段的独立查询或断言；"硬阈值"栏声明的两段式要求和实际展示的验证代码不一致。
- **CI Workflow 内容对齐 = 8**：已用 Bash 工具实读 `nightly-real-machine-staging.yml`（确认 `wechat-bubble`/`douyin-read` 现有 job 跑在 `runs-on: [self-hosted, wechat-capable]`，刀D 沿用同一 runner 标签的设计与现状一致，且现有 job 均为真实设备操作，无 `MOCK_*` 注入）、`ci-l1-process.yml`（确认可挂载新 lint job 到 `l1-passed` 聚合 gate 的 `needs` 列表模式）、`ci-smoke-glob-runner.yml`（确认 DENYLIST 机制真实存在，`line02-android-collect-realmachine-smoke.sh` 确为先例，合同要求"account-scan-realmachine-smoke.sh 加入 DENYLIST"与现有模式完全吻合）。三份 workflow 内容与合同 BEHAVIOR 断言语义一致。未审 `e2e-wechat-rpa.yml`——已确认该文件与本合同引用的三个 workflow 无关（本 sprint 不涉及微信 RPA 断言），故不适用该文件的强制审查规则，不因此扣分。

## 需要 Proposer 修的（只列 block 项）

### 问题 1（维度：内部一致，当前 4 分，目标 ≥ 7）

**描述**：`realmachine-unverified-ratchet.mjs` 的"测试期覆盖临时目录"这一同一个能力，在合同的两处出现了两套不同的环境变量接口：

- `contract-draft.md` 第 257 行（final-e2e 脚本 ③ 部分）：`SMOKE_DIR_OVERRIDE="$TMPSMOKE" node scripts/product-map/realmachine-unverified-ratchet.mjs`（只传一个变量，没有 nightly yml 路径覆盖）
- `contract-dod.md` 第 87、95 行（BEHAVIOR 条目）：`REALMACHINE_SMOKE_DIR="$TMPD" REALMACHINE_NIGHTLY_YML=.github/workflows/nightly-real-machine-staging.yml node scripts/product-map/realmachine-unverified-ratchet.mjs`（传两个不同名变量）

这两处对同一个 CLI 工具的调用契约互相矛盾。Generator 只能选择实现其中一套接口名，另一处的验证命令必然因读不到环境变量而拿到与真实仓库同值的结果（不会真正覆盖临时目录），导致该处的 proven-to-fire 断言变成空跑通过或错误失败。

**修复**：单源 SSOT——在 `contract-draft.md`"已知约束"或 Step 6 段落里明确声明该 CLI 唯一支持的环境变量名（建议统一为 `REALMACHINE_SMOKE_DIR` + `REALMACHINE_NIGHTLY_YML`，因为 DoD 侧已经是两个独立可覆盖的输入维度，更完整），然后把 `contract-draft.md` 第 257 行的 final-e2e 脚本同步改成这两个变量名，删除 `SMOKE_DIR_OVERRIDE` 这个不存在第二处引用、且信息不完整（缺 nightly yml 覆盖）的命名。

### 问题 2（维度：Verification Oracle 完整性，当前 5 分，目标 ≥ 7）

**描述**：这正是本 sprint 要修的病根——PRD 原文用粗体强调"job 断言 **`status='done'` 且 `account_ids` 非空**（真读到账号）→ 绿；任何非 done → 红"，明确这是不可分割的两段式判据，防止退化回"服务器有回就算过"的假绿老路（Step30 的历史 bug 就是断言退化成自我实现的假测试）。

但合同 Golden Path Step 4 的"验证命令"代码块：

```bash
RESP=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -c \
  \"SELECT response FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'\"")
echo "$RESP" | jq -e '.account_ids | length > 0'
```

只查询了 `response` 字段并断言 `account_ids` 非空，**没有任何一行代码单独查询或断言 `status` 字段的值**。"硬阈值"栏文字声称"`status='done'` AND `account_ids` 数组长度 ≥ 1"，但展示的代码没有兑现前半句。

进一步看 Step 3 的验证命令，只是 `SELECT status ...` 拿到一个 `$STATUS` 变量，既没有展示轮询循环的终止条件判断代码，也没有把 `$STATUS != 'done'` 时的分支处理（跳去读 error_code 判断 fail/超时）写出来。Step 3 和 Step 4 之间"status 已确认是 done 才去检查 account_ids"这个隐含前提，全靠读者脑补两步之间的时序衔接，合同里没有一处显式的联合断言（例如 `[ "$STATUS" = "done" ] && [ "$(echo "$RESP"|jq '.account_ids|length')" -ge 1 ]`）。

对应地，`contract-dod.md` 的 `[ARTIFACT]` 检查（第 42 行）只 grep 脚本源码里是否含有字符串 `'publish_tasks'`、`'account_ids'` 等关键字，同样没有要求脚本必须显式判断 `status === 'done'` 才进入 account_ids 校验分支——这意味着 Generator 完全可能写出"只要 `response.account_ids` 非空就判定成功、完全不管 status 字段"的实现，且能通过合同现有全部 DoD 条目，恰好复刻了 PRD 想根治的那类"字段读到就算过"的假绿模式（只是从"读自己发的 payload"退化成"读 account_ids 长度"，退化点不同但退化的性质相同）。

**修复**（二选一，任选其一即可解决）：
1. 把 Step 4 的验证命令改为联合查询/联合断言，如：
   ```bash
   ROW=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -F'|' -c \
     \"SELECT status, response FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'\"")
   STATUS="${ROW%%|*}"; RESP="${ROW#*|}"
   [ "$STATUS" = "done" ] && echo "$RESP" | jq -e '.account_ids | length > 0'
   ```
   并在 `contract-dod.md` 对应 `[ARTIFACT]`/`[BEHAVIOR]` 条目里 grep 脚本源码同时含 `status.*done`（或等价字面量）与 `account_ids` 的联合判断逻辑，而不是分别 grep 两个关键字存在与否。
2. 或至少在合同里显式声明"Step 3 的轮询循环只在 `STATUS == 'done'` 时才跳出并进入 Step 4；`STATUS` 为其他终态（`failed`/超时）时直接判定该次运行为红，不进入 Step 4 的 account_ids 检查"，并在 DoD 里补一条 `[BEHAVIOR]` 明确验证"`status != 'done'`（如 `failed`）即使 `account_ids` 恰好非空（脏数据/上次运行残留），脚本仍必须判红"——这是最接近 PRD 原始 bug 场景的回归用例，当前合同完全没有覆盖这个反例。

## 非阻塞观察（仅供 proposer 参考，不构成 REVISION 理由）

- Step 6 的 `realmachine-unverified-ratchet.mjs` 硬阈值写"对当前仓库真实状态跑出 `realmachine_unverified_count = 0`"，这依赖 Step 1（DENYLIST 接入）+ Step 5（标记齐全）都已落地——三步之间存在隐式的实现顺序依赖，建议 Generator 落地时最后统一跑一次全量校验，但合同已经在 Test Contract 表和 E2E 脚本③里覆盖了这一点，不算漏项。
