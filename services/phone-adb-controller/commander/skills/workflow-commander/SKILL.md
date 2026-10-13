---
name: workflow-commander
description: "通用 Commander：接收 Brain 原始 JSON 调度单，核对冻结合同与部署，正式派发 Codex 子会话，持续监督同 run、恢复清理和回执，直到独立核验完成。"
---

# Workflow Commander

同一个 work-commander 贯穿本次目标的启动、执行监督、恢复和核验回流。新工作全部使用 `commander-v2`。角色不变，流程由冻结合同定义；不自行选机器、手机或账号，不修改现场代码，不把一个节点失败当作目标完成。

## 1. 接收原始信封并验证部署

调度单是 Brain 已登记并绑定 run 的**原始JSON信封**，不是预先存在的文件。字段包括 protocol、task_id、run_id、workflow_key、attempt、owner_epoch、deadline_at、cleanup_deadline_at、input、input_sha256、definition、contract、recovery。不得删字段、重构输入、改身份或延长预算。

1. 先用 hostname 核实工具所在机器。在 MMV（网关机 `administrator@100.71.151.105`）执行运行端工具。若当前工具位于其他跑场机，通过已有通道回调 MMV；不能在 Brain 服务器运行重活。
2. 使用**结构化文件工具**把完整信封原样写入本 run 独享的绝对路径，例如 `/Users/administrator/wf-agent-inputs/<task_id>/<run_id>.json`。写后重新读取，核对全部 JSON 值，保留中文、换行、空数组及所有扩展字段。同路径已有内容时只接受相同信封，冲突不能覆盖。禁止用 echo、shell 插值或自由文本拼命令写业务输入；凭据不得进入信封。
3. 正式调用 `session_status` 取得当前 `agent:work-commander:…` session key，后续 parent_session_key 必须是它。不能伪造其他父会话。
4. 调 `~/.openclaw/commander/wf-launch.sh --ready`，经 stdin 传结构化 `{definition,workflow_key}`。只有 ready=true，且返回的 release_id、snapshot_sha256、runtime_snapshot_sha256 与本次绑定一致，才能启动。该接口实际校验整包文件与加载的工作区；半上线、缺映射或漂移都不能起跑或降级旧协议。
5. 读取信封内冻结 contract；commander_skill 非空则核对指定名称和版本并加载，版本不符要记录阻塞。不得拿最新合同替换冻结合同。`resources={}` 是正常非手机流程，不增加或伪造 serial/profile/biz。

## 2. 正式启动、唯一 spawn 与绑定

```bash
~/.openclaw/commander/wf-launch.sh --envelope <绝对JSON路径> --parent-session <本轮正式session_key>
```

退出码0只代表入口受理，未查回实际状态前禁止说「预检已过」。业务文本始终留在 JSON 文件中。返回 JSON 的 action 决定下一步：

| action | 执行 |
|---|---|
| wait | 外壳正在准备，读 `wf-status.sh <run_id>`；尚未完成准备不能派业务 |
| claim_spawn | 按下面顺序领取、派发、核对模型并绑定 |
| await | 已有 child，仅续官方等待；绝不再次 spawn |
| cleanup | 业务已停，继续状态读回以恢复仅清理worker，不再派业务 |
| blocked | 查现有归属、原回执和恢复条件；不猜死、不重派 |
| awaiting_verify | 执行交付已齐，继续追踪独立核验，不自行宣告目标完成 |

领取命令：`python3 ~/.openclaw/commander/wf-v2.py claim-spawn <run目录>`。它会持久保存本 run 唯一 spawn 权，返回 request 和 message。核对 request 的 run_id、task_id、parent_session_key、nonce 与本单一致，且未过 expires_at。已领取但缺绑定时，只能找回原 spawn 回执。

用当前官方 `sessions_spawn` **一次**创建业务子会话：agentId=request.agent_id（当前授权 `skill-factory`），mode=run，context=isolated，cleanup=keep，completionTarget=parent；taskName 使用 run_id（超长时使用 task_id 前8位）。runTimeoutSeconds 不得超过 request.expires_at 的剩余秒数；不能重新给固定完整预算。task 原样包含 message 和完整 request，不 fork Commander 历史、不设置模型覆盖或 fallback。

子会话开始任何业务动作前必须读取本 run 的 `agent-binding.json`，确认 parent/run/task/nonce 与 request 一致、childSessionKey 是自己；最多在剩余执行预算内等绑定。存在 `handoff-closed.json` 或身份不符时立即停止，不能触发业务副作用。可通过实际可用文件工具或已有 SSH 通道读取；不指定子会话未暴露的工具。

解析官方 spawn receipt（若工具返回 JSON 字符串先 JSON.parse），核对 childSessionKey、runId、resolvedProvider、resolvedModel。当前授权为 `openai/gpt-6.1-sol`，fallbacks 为空；缺字段或模型不符，精确取消该 child并读回终止，禁止绑定或重派。将完整原 receipt 存为 run目录 `spawn-receipt.json`。

组合 request 的 run_id/task_id/parent_session_key/nonce 与 receipt 的 childSessionKey→child_session_key、runId→child_run_id，经 stdin 交给 `wf-agent-handoff.py bind <run目录>`。结构化传入，不插值 shell。bind失败时取消刚创建的确切 child，并独立核实终止。

## 3. 持续等待与同 run 恢复

前台调用 `python3 ~/.openclaw/commander/wf-agent-handoff.py await <run目录>`，工具超时时间依据剩余预算设置；若工具返回进程 session，继续等待该进程。不调用 sessions_yield，也不通过 CLI agent、sessions.send 或删除来源标记替代正式归属。

helper 使用官方 `agent.wait` 读取绑定 child 的确切 run，校验 runId、endedAt 和 terminalReceipt 的实际 Codex 模型，保存 terminalReply.text 全文。不得从 history 摘写或改写结果。子会话 error/timeout 不能因文本自称成功变成成功。

- 掉线后，重复相同 `wf-launch` 只续接原 run、nonce、attempt 和 deadline。活 child 或活性未知只等待/读回；spawn 权已领取时绝不重新领取。
- `wf-status.sh <run_id>` 返回真实 execution_stopped、state、delivery 与持久 events。已有绑定而监督进程退出时，状态入口只恢复本地监督 worker，不创建新业务 child。
- 执行 deadline 到达后，外壳对绑定 child 的 `sessions.abort` 与终态读回独立进行；一次 RPC 失败不能阻止另一项。终止未知就保持未知，不自行放锁或重复发布。
- `cleanup_pending` 表示业务已停止、收尾未齐。剩余 cleanup 预算内重入只补精确放锁、原证据和清理回执，不再 prepare、不执行业务。取证异常仍尝试释放本 run 精确 owner 的锁；未完成的清理不得报成功。
- 手机准备和业务使用 execution deadline；只有清理可使用 cleanup_deadline_at。两个截止时间跨重入保持不变。

## 4. 活动事实、交付与反馈

活动key先经冻结 activity_bindings 映射，再与 definition.expected_path 的 reference_id/activity_id/step_id 对照；缺映射立即报告，不按数组位置猜。preflight/cleanup 由外壳保存 controller 原始回执并发活动及step终态事实，业务子会话只上报 by=agent 的实际动作；清理中间失败只记录 blocked 与独立归档原件，活动最终完成才发唯一终态。每个实际完成的activity与step都逐项发activity_completed，必须有started_at、ended_at、outcome和真实evidence；不能只发最外层activity，不能凭delivery自述补造步骤证据。经 `wf-v2.py event <run目录>` stdin 传 `{type:'activity_started|activity_completed',data:{reference_id,activity_id,step_id,started_at,ended_at,outcome,evidence}}`；不编 ID，不用执行者自述代替实际证据。

业务最后一行输出 `WF_DELIVERY` 加完整 JSON：status 为 completed/failed/blocked，带 outputs、evidence、effects、failure。effects 每项 `{key,status,receipt}`，status 只允许 none/committed/compensated/unknown；key 基于任务目标和活动，不用 run_id 作为唯一外部幂等键。外部发布结果不明先读回，禁止重复动作。

外壳交付保留全部 input、definition、outputs、evidence、effects 和真实 cleanup 回执。大产物写运行目录，交付引用与 hash，不截断原内容。Brain 依据冻结 output_schema 检查成功输出，违约会派生失败并保留原文。

`wf-v2.py replay <run目录>` 按持久 seq 重放；已提交反馈不能改写。内部凭据默认只读本人0600的 `~/.credentials/cecelia-internal.env` 中 CECELIA_INTERNAL_TOKEN，也可用 WF_INTERNAL_TOKEN_FILE 指向纯 token 的0600缓存；不得放入信封、消息、日志或产物。缺凭据或网络失败保留原事件，状态读回可以补账。

## 5. 独立核验与原任务恢复

执行交付完成后只进入 awaiting_verify。Brain 创建独立核验任务，核验者按固定合同重读原始来源与真实产物，不能接受执行者自述。只有 PASS 且 cleanup 证据通过才完成原目标。

FAIL/INCONCLUSIVE 返回断言、证据和恢复条件。下个获准 attempt 的 `recovery.previous_attempt` 包含 run_id、attempt、failure、verification 的 verdict/assertions/evidence 与 diagnostic_sha256；子会话先看这些结构化失败材料，必要时按 task/run 回查完整原始证据。只修冻结合同允许的产物问题，不改现场代码。

新 attempt、实现版本切换、恢复授权和剩余预算由 Brain 的冻结恢复政策决定。未知副作用先独立读回；没有兼容且已验证的部署时，保持同任务 blocked 并明确恢复条件，不能伪造回退版本。汇报使用查回事实、证据和 actor，不以退出码零代替目标完成。

## 旧在途兼容边界

旧五参数入口只用于既有历史调度兼容；历史在途运行继续按原外壳收尾。新 JSON 信封不得转换为旧参数。全部入口共用部署 admission；部署期间不启动旧外壳，也不创建历史看护角色。部署和代码变更由版本化发布流程处理。
