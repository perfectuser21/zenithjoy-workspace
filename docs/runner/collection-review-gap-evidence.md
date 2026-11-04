# 102维护租约断档后的新隔离证据

适用范围只有 `ys20261103235714_102` 的既有维护任务 `f10777a6-9691-4633-ac50-04c898a05ba1`。旧业务任务仍为 failed、`execution_stopped=false`；本工具不执行旧业务、不申请或释放中央租约，也不证明断档期间一直隔离。

调用形式：

```sh
python3 collection-review-maintenance-host.py plan CANDIDATE_SHA RELEASE_UUID --gap-evidence /absolute/private/authorization.json
python3 collection-review-maintenance-host.py apply CANDIDATE_SHA RELEASE_UUID --gap-evidence /absolute/private/authorization.json
```

证据目录必须归当前用户所有、权限0700，所有文件0600，不能使用软链接。它与原操作journal是两个目录。操作者在行动前使用独占创建（O_EXCL）、写完fsync文件与父目录；工具只读，不生成或修订授权。

`authorization.json` 使用排序key、无多余空白的 canonical JSON：

```json
{"version":1,"kind":"collection-review-new-isolation-after-gap-v1","scope":"替换为collection-review-maintenance.py原SCOPE对象","maintenance":"替换为原TASK对象","continuous_central_isolation_proven":false,"files":{"history-last.json":"SHA256","history-first-null.json":"SHA256","old-task.json":"SHA256","maintenance-task.json":"SHA256","locks-before.json":"SHA256","acquire-request.json":"SHA256","acquire-ack.json":"SHA256","locks-after.json":"SHA256","locks-confirm.json":"SHA256"}}
```

示例中的字符串占位必须替换为原对象和实际SHA，不是可用授权。

| 文件 | 原件内容 |
|---|---|
| history-last.json | 原 `102-central-quarantine-renewal-3-result.json` 整byte副本，固定SHA `8fc4f4c3d7e9034f0f15164083ad377ff971456aa8f950ce3f5f97f2653a7b4f` |
| history-first-null.json | 原 `root-live-recheck-20261104T063248Z.json` 整byte副本，固定SHA `4f2dc723b9166a0f015f0254f498d7680de09f8addaa8b4de98fac473b5737e1` |
| old-task.json | 新读取 `GET /api/brain/tasks/6ca6e356-d63b-4a1f-92b7-9f5a7798b916` 响应体 |
| maintenance-task.json | 新读取 `GET /api/brain/tasks/f10777a6-9691-4633-ac50-04c898a05ba1` 响应体，保持原claim |
| locks-before.json | 新申请前 `GET /api/brain/device-locks` 完整响应体，目标三个租约字段全NULL |
| acquire-request.json | 实际 `POST /api/brain/device-locks/acquire` 请求体，仅 `device_name`、`locked_by=f107...`、整数 `ttl_minutes`（1至240） |
| acquire-ack.json | 上述申请的原响应体，必须 acquired=true，含锁的数据库 locked_at/expires_at |
| locks-after.json | 成功申请后独立GET完整设备锁列表 |
| locks-confirm.json | 再次独立GET完整设备锁列表 |

新owner只允许f107。两个完整读回的目标epoch必须与ACK相同，其他设备整行与申请前一致；合法的外部心跳变化同样会拒绝，应报告后重新准备尚未使用的证据，不能覆盖他人状态。现有原子申请会保护未过期的其他owner，但这不是 expected-null CAS；两次GET也不能被称为CAS。

每次准入重新读取旧任务终态、新维护任务精确原claim、中央owner和epoch。任务heartbeat允许延长同epoch的expiry；工具只接受不小于原申请expiry且当前未过期的租约，不改写原始expiry。重新acquire会产生新locked_at，必须拒绝，不能把旧journal移植到新epoch。

授权原件SHA及全部附件SHA进入admission，由库存snapshot、pre-retirement和completion的原摘要链绑定。既有snapshot若授权、源码、epoch或库存不匹配直接拒绝；有旧意图而无snapshot直接拒绝。不重采baseline、不迁移journal、不重发未知清场动作。

本版本保留原15文件安装闭包、历史contract原件、343冻结源、1486原请求域、10个guard、精确owner/inode及全库存守恒。`plan`涉及原来允许的手机只读检查，必须先获得真实新隔离授权；离线测试不代表现场已取得授权或安全恢复。


## v2：原维护认领被清除后的正式新认领

v1继续严格接受原claim；v2只适用于固定f107曾因 `headed session stale: no initiative_runs row past grace — 降级 blocked（可恢复），非 failed` 在2026-11-04T06:35:29.529Z降为blocked、claimed_by/claimed_at清空的情形。历史 `SCOPE`、`TASK` 和14个其他工具文件保持原字节。原维护常量仅作历史身份，不代表当前授权；禁止补造旧claimed_at或修改旧运行结果。

v2 manifest把version设为2、kind设为 `collection-review-new-isolation-after-gap-v2`，其余历史scope、maintenance及continuity=false保持v1原值。files精确包含原9文件及下表8文件，总17文件；所有附件仍为独占写入、权限0600的原始body，manifest为排序key、无额外空白的canonical JSON。既有操作journal绝不能接纳新授权。

| 附加文件 | 内容 |
|---|---|
| maintenance-blocked.json | 主会话正式恢复前读取的完整blocked Task；原件 `maintenance-v2-fresh-claim-raw/blocked-task.json`，固定SHA `565f77f3b6ee1311a3470b1d8ece0c04c381dbd16cce0b1e2a740c32bee1d223` |
| maintenance-claim-request.json | `POST /api/brain/tasks/f10777a6-9691-4633-ac50-04c898a05ba1/claim` 实际body：`{"claimer":"headed-102-maintenance-resume","executor_kind":"headed-session","lease_seconds":14400}` |
| maintenance-claim-ack.json | 原响应，包含id、claimed_by、全新claimed_at、executor_kind、lease_until、lease_seconds、on_lease_expire=auto；不接受无租约或旧timestamp |
| maintenance-resume-request.json | 随后正式 `PATCH /api/brain/tasks/f10777a6-9691-4633-ac50-04c898a05ba1` 的实际body：`{"status":"in_progress"}` |
| maintenance-resume-ack.json | 实际优先路由返回的短body：success=true、task_id、status=in_progress、updated_at、started_at、completed_at=null；它不提供claimed_at，禁止补字段冒充完整Task |
| maintenance-task-confirm.json | 第二次独立GET完整Task；原9文件中的maintenance-task.json对应第一次独立GET |
| maintenance-heartbeat-request.json | 恢复成功后 `POST /api/brain/tasks/f10777a6-9691-4633-ac50-04c898a05ba1/heartbeat` 实际body：`{"claimer":"headed-102-maintenance-resume","lease_seconds":14400}` |
| maintenance-heartbeat-ack.json | 原响应：ok=true、lease_until、lease_seconds=14400、heartbeat_count为正整数；它确认新认领有真实活跃租约 |

顺序为claim → PATCH恢复 → heartbeat → 两次GET。claim本身只设置认领和租约，不会把blocked恢复为in_progress；不能省略PATCH或拿HTTP200代替success=true。新claim使用同一f107、原project、原完整payload（包括scope和headed_manual），明确记录新actor/epoch。主机每次只读GET验证当前status、claimer、claimed_at、executor_kind、project和完整payload摘要；没有只读GET lease接口，不能伪造该接口或声称读到了实时租约表。根协调者按实际heartbeat协议续租，任何409或未知结果立即停止；本次主机操作还必须在附件已证明的heartbeat lease_until之前完成，超界拒绝，不能默默重基线。

原设备acquire必须在新claim之后，仍仅允许f107持有同一设备epoch、未过期且不缩短。admission、库存snapshot、pre-retirement和completion同时记录历史maintenance及新的current_maintenance_claim、task_lease_epoch、blocked原件SHA；完整17附件摘要也由原授权摘要链绑定。phone原语中的历史maintenance字段保持原样，通过admission摘要绑定当前授权。此协议不创建initiative_runs、不启动旧Kernel、不改调度或账号，不更改旧6ca的failed/false，也不增加手机操作或释放范围。
