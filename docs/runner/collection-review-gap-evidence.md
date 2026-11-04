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
