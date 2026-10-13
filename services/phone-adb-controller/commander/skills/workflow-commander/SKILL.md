---
name: workflow-commander
version: 2.0.2
description: "通用 Commander：接收 Brain 原始 JSON 调度单，核对冻结合同与部署，正式派发 Codex 子会话，持续监督同 run、恢复清理和回执，直到独立核验完成。"
---

# Workflow Commander

同一个 work-commander 贯穿本次目标的启动、执行监督、恢复和核验回流。新工作全部使用 `commander-v2`。角色不变，流程由冻结合同定义；不自行选机器、手机或账号，不修改现场代码，不把一个节点失败当作目标完成。

## 1. 接收原始信封并验证部署

调度单是 Brain 已登记并绑定 run 的**原始JSON信封**，不是预先存在的文件。字段包括 protocol、task_id、run_id、workflow_key、attempt、owner_epoch、deadline_at、cleanup_deadline_at、input、input_sha256、definition、contract、recovery。不得删字段、重构输入、改身份或延长预算。

1. Codex 的模型本机 shell 可能位于 `/Users/Shared/openclaw-workspaces`，不等于 MMV。先用 `gateway_exec` 执行 hostname 核对网关宿主。本文所有 `~/.openclaw/commander`、run目录、报告helper及文件读写都在 MMV（`administrator@100.71.151.105`），必须用 `gateway_exec`；不要假造 MMV 的 node_exec 节点。手机动作才使用冻结资源对应跑场通道。
2. 使用明确面向 MMV 的**结构化文件工具**，或下方已验证的 `gateway_exec.env` 桥，将完整信封原样写入本 run 独享路径。模型本机写出的文件不能当成远端文件。固定脚本从结构化 env 取 JSON，独占创建、0600写入，再重新解析比较；同路径相同信封可重入，冲突拒绝。禁止把业务值插进 command、echo 或自由文本 shell；凭据不得进入信封。
3. 正式调用 `session_status` 取得当前 `agent:work-commander:…` session key，后续 parent_session_key 必须是它。不能伪造其他父会话。
4. 调 `~/.openclaw/commander/wf-launch.sh --ready`，经 stdin 传结构化 `{definition,workflow_key}`。只有 ready=true，且返回的 release_id、snapshot_sha256、runtime_snapshot_sha256 与本次绑定一致，才能启动。该接口实际校验整包文件与加载的工作区；半上线、缺映射或漂移都不能起跑或降级旧协议。
5. 读取信封内冻结 contract；commander_skill 非空则核对指定名称和版本并加载，版本不符要记录阻塞。不得拿最新合同替换冻结合同。`resources={}` 是正常非手机流程，不增加或伪造 serial/profile/biz。

`gateway_exec` 参数为 `{command:string,title:string,env:Record<string,string>,timeoutSeconds:number,yieldMs:number}`。command 固定；env 每个值是字符串，信封/事件先 JSON.stringify 后作为一个 env 值传入。下面是实际可执行模板，替换 env 值即可；不能把业务字符串替换进 command。

<!-- gateway-envelope-write -->
```json
{
  "command": "python3 - <<'PY'\nimport hashlib,json,os,re\nfrom pathlib import Path\nraw=os.environ['WF_ENVELOPE_JSON']\ne=json.loads(raw)\ncanonical=lambda v:json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'))\nassert len(raw.encode())<=180000, 'envelope too large'\nassert re.fullmatch(r'[0-9a-f-]{36}', e['task_id']), 'invalid task'\nassert re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', e['run_id']), 'invalid run'\nroot=Path.home()/'wf-agent-inputs'/e['task_id']\nroot.mkdir(parents=True,exist_ok=True,mode=0o700)\npath=root/(e['run_id']+'.json')\ntry:\n fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\nexcept FileExistsError:\n assert canonical(json.loads(path.read_text()))==canonical(e), 'frozen envelope conflict'\nelse:\n with os.fdopen(fd,'w') as f:\n  f.write(raw);f.flush();os.fsync(f.fileno())\nassert canonical(json.loads(path.read_text()))==canonical(e), 'readback mismatch'\nprint(json.dumps({'envelope_path':str(path),'verified':True,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}))\nPY",
  "title": "在MMV独占保存并读回Commander信封",
  "env": {
    "WF_ENVELOPE_JSON": "<完整原始JSON字符串；通过工具env字段传入>"
  },
  "timeoutSeconds": 30,
  "yieldMs": 10000
}
```

后续命令同样交给 `gateway_exec`，把已核对路径、session及JSON置于对应结构化 env。工具无 stdin 参数，用固定 Python 从 env 生成管道输入；先保存并读回完整 spawn receipt，再组合绑定 JSON。ready命令的env继续使用同一原始信封：

```bash
python3 -c 'import os,json; e=json.loads(os.environ["WF_ENVELOPE_JSON"]); print(json.dumps({"definition":e["definition"],"workflow_key":e["workflow_key"]}))' | bash "$HOME/.openclaw/commander/wf-launch.sh" --ready
```

绑定命令的env为 `WF_BINDING_JSON=JSON.stringify(按request及receipt组合的完整绑定对象)`、`WF_RUN_DIR=启动回执的run目录`：

```bash
python3 -c 'import os; print(os.environ["WF_BINDING_JSON"])' | python3 "$HOME/.openclaw/commander/wf-agent-handoff.py" bind "$WF_RUN_DIR"
```

活动事件同理从 `WF_EVENT_JSON` 经固定 Python 输出到 `wf-v2.py event "$WF_RUN_DIR"`。receipt或交付文件也必须在网关写入并读回，不能把模型本机路径当成MMV路径。

## 2. 正式启动、唯一 spawn 与绑定

```bash
bash "$HOME/.openclaw/commander/wf-launch.sh" --envelope "$WF_ENVELOPE_PATH" --parent-session "$WF_PARENT_SESSION"
```

在 `gateway_exec.env` 传已读回的 WF_ENVELOPE_PATH 与 session_status 的 WF_PARENT_SESSION。退出码0只代表入口受理，未查回实际状态前禁止说「预检已过」。业务文本始终留在 JSON 文件中。返回 JSON 的 action 决定下一步：

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

通过 MMV `gateway_exec` 前台调用 `python3 ~/.openclaw/commander/wf-agent-handoff.py await <run目录>`，timeoutSeconds 依据剩余预算设置；若返回后台进程 session，使用 `gateway_process` 持续读回该进程。不调用 sessions_yield，也不通过 CLI agent、sessions.send 或删除来源标记替代正式归属。

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

冻结 recovery.improvement_after_failures=5 表示同版本同类失败在真实运行账累计达到5次时只提出决定建议，不自动创建编码任务；累计次数不是重试发布次数，不扩大本次 max_attempts 或重置预算。
