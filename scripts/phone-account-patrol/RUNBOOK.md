# 手机账号巡查维护手册

维护负责人：主理人。计划时间：每天北京时间22:00（Asia/Shanghai）。

## OpenClaw 原生领跑入口

最终入口：中央 Brain 定时生成 `qiumi_task`，通过独立 OpenClaw agent 调度通道直接召唤 `infra`（OPC 运维官）。infra 在 MMV 使用实际工具调用 `openclaw_native.py enqueue`，只登记一个冻结源 `script_run` 代码批次。代码批次再登记每部手机任务；M4 的 Python、ADB、Vision OCR、原生设备锁与账号写回继续纯代码。整体是 AI 领跑加代码执行，AI 领跑任务与代码任务分开记账。

计划目标为每天北京时间 22:00 领跑、22:45 只读复核。既有每 30 分钟纯代码维护检查继续运行。是否正式启用与部署验收，以中央 registry、recurring-tasks 和真实任务读回为准；本次原生领跑自动运行与正式复核尚需真实验收，不以静态测试或历史手机验收代替。

### infra 使用步骤

1. 通过本轮官方 `session_status` 获取 `agent:infra:<run_id>`，在 MMV 调用 `openclaw_native.py resolve-task --session-key <真实sessionKey>`。它完整分页读取中央任务，唯一匹配同项目、运行中、qiumi/infra、`payload.run_id` 一致的真实领跑者；没有唯一匹配即停止，禁止猜最新任务。
2. 对 22 点巡查领跑，调用 `openclaw_native.py enqueue --leader-task-id <真实中央ID>`。helper 校验父任务、项目、Workflow 与双源身份，使用稳定 `OpenClaw:infra:<leader>:batch` 幂等键登记代码批次，并 GET 读回真实父子/源码/流程/routing receipt 身份。返回 queued 仅表示登记成功，不表示手机完成。
3. 对只读维护领跑，调用 `openclaw_native.py inspect --review-leader-task-id <真实中央ID>`。默认目标只取经过核验的 native 最新登记，并回读真实领跑父任务的正式计划及北京时间当天 22 点时段。`--batch-task-id` 仅用于明确指定实际验收批次；也须核验来源及孩子身份。

enqueue、inspect 与 resolve-task 不调用模型、OpenClaw CLI 或手机。持续维护只登记补查任务；recovery-phone 在执行前重新核验需求、任务与设备，再委托冻结单手机 runner。控制代码不修改手机部署指针、生产配置或账号，不发送外部消息。父任务必须明确 `qiumi_route.source=explicit`。复核保留 failed、waiting、unknown、deferred 及各 task/run/exit；非零退出码优先失败，completed/deferred 必须对应真实 Run 与退出码 0，缺证据为 unknown；手机离线或被人占用按真实状态记录。维护负责人仍是主理人。

本机私有证据：`native-launch-<leader>.json`、`native-openclaw.latest.json`、`native-review-<review>.json`，权限 600。领跑源码 `source_revision` 与手机固定源 `phone_source_revision` 分别登记；正式代码批次的 `source_revision` 为冻结手机源。代码批次复制已核验领跑任务的定时计划与时段，既有 runner monitor 可读到实际代码批次。中央 registry 是调度和部署真身，Notion 页面为查看入口。

`openclaw_commander.py` 保留为共享真实性验证库，提供冻结八文件哈希、UUID、真实父子/设备/来源核验、私有原子保存及中央恢复需求协调（POST/PATCH）；不启动Agent或直接操作手机。部署 native helper 时共享库必须在同一目录，手机固定 release 不改。

## 正式登记与执行

- 单手机流程：`66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff`（single-phone-account-patrol，0.1.1）。
- 批次流程：`7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70`（phone-account-patrol-batch，0.1.1）。
- 维护流程：`e4d2030f-129f-4668-95dd-4a6d880493a8`（phone-account-patrol-maintenance，0.1.0）。
- 定时任务：`421eb084-1624-4e0f-af4e-8aabf66b23a8`，cron `0 22 * * *`、显式Asia/Shanghai。
- 维护定时任务：`3c25817f-8b3d-40ce-86b9-8a927d4e6d61`，cron `*/30 * * * *`、显式Asia/Shanghai。
- 运维登记：`1d7335b8-fdfe-4c7f-b246-52180c03339a`，负责人、版本、调度和验收证据均在metadata。
- 项目：`8386209b-ed0f-4f0f-a1f0-9ddf1bddbff6`。

中央Brain定时器生成 qiumi_task 领跑任务，OpenClaw infra 经 MMV 实际工具登记固定源的 script_run 代码批次。批次读取设备清单，为每个启用手机登记单手机任务。每部手机在M4通过原生设备锁、ADB和Vision OCR逐平台检查，再写回账号登录明细；设备镜子更新页面。手机巡查不调用大模型，不切换账号、不登录、不发布；领跑与复核使用 AI。

批次完成只表示子任务已排队。每部手机是否巡查完成，以该子任务及独立task_runs为准；占用跳过不是完成巡查，未知记待确认，离线和写回失败返回非零。定时器last_run_at只是建单时间，不能拿它证明手机已经执行。

## 怎么查看

Notion入口：

- [代码运行记录](https://app.notion.com/p/3f5c40c2ba6381d4bb03e18fcb566f2c)：中央`task_runs`的正式投影，每个手机独立一条Run；查看任务ID、Run ID、状态、开始/结束时间和退出码。四台手机的手动验收Run已逐页核对；自动定时验收需另核实际定时实例。
- [设备清单](https://app.notion.com/p/3d4c40c2ba63816db72dd520f2cd090a)：打开手机页面，查看八个平台及视频号的当前状态、账号身份和实际核验时间。
- [Workflows总库](https://app.notion.com/p/3d9c40c2ba638145bfa8f4c0c006e0af)：单手机、批次及维护流程均已同步，4+3+3个Activity页和流程关联已逐一核对。

通过Brain API读取，不能直写SQL或修改Notion投影：

- `GET /api/brain/registry/1d7335b8-fdfe-4c7f-b246-52180c03339a`：实际部署和维护状态。
- `GET /api/brain/recurring-tasks`：找到上述调度ID，查看is_active、next_run_at和时区。
- `GET /api/brain/tasks/<任务ID>`：实际状态、script.run_id、exit_code、stdout和证据。
- `GET /api/brain/tasks/<批次ID>/chain`：项目任务链；具体子任务结果逐条读回。
- 本机私有证据：`~/.local/share/phone-account-patrol`，勿把截图、账号原始观测或凭据提交Git。

固定源四台手机中央真实验收任务：

| 手机 | 任务ID | 结果 |
|---|---|---|
| 小白 | `3c4de20f-c232-4f56-9ce3-d466c70a64c7` | 完成，知乎待确认 |
| 小彩 | `80ae4786-473c-4c20-af5f-31884f28a116` | 完成，八平台及视频号均已登录 |
| 小黄 | `44a58e21-8fd5-4b79-ab64-38b329088a88` | 完成，抖音/头条已登录；其他未登录或待确认 |
| 小蓝 | `e2b1a491-35bb-4dc9-b252-b707d70cc84a` | 完成，抖音/快手已登录；其他未登录、未安装或待确认 |

上述为历史固定手机源的真实手动巡查验收，不证明本次原生 OpenClaw 领跑已完成部署或自动验收；均有独立script Run、exit 0、账号写回及设备镜子JSON回执。批次 `c3526656-1443-4ce5-af6c-1402fb08bf57` 与独立实际重放 `67d31662-6108-457c-8622-c1e4a055b494` 返回完全相同的四个子任务ID；批次通过不替代自动单手机运行证明。

## 部署门槛与当前状态

MMV与M4固定运行源码为`4f899cab6425341646e27c5fca20979b8ac42be7`，两端部署文件已逐个核对哈希；三个流程和两项中央计划已正式登记。静态手册不代替实时状态：是否启用、下次运行时间及正式发布证据，以中央registry和recurring-tasks读回为准。

启用门槛：正式源码CI与代码审查通过、纯代码中央自动派发实测通过、Notion代码运行记录读回真实Run。启用时在巡查template写activated_at，不追责停用期间的历史漏跑；同时通过账号工作面正式维护入口仅更新调度标签，保留真实账号核验时间。

不得绕过CI、管理员强行合并、直接SQL注册、另开本机隐藏定时器，或把未部署版本标成已部署。完整验收后才通过Brain recurring-tasks API启用。独立 OpenClaw agent 通道和代码执行队列的排队均可能延后执行，22:00是计划时间；排队必须可见并记录异常。

监控自身异常也必须留下中央失败Run。巡查失败、排队超时、漏跑或设备占用由主理人查看维护任务和运行记录；代码修复走Git PR、测试、固定版本部署和正式定义更新。

## 持续恢复：失败不结束需求

沿用原30分钟维护计划，目标入口为 openclaw_native.py maintain --execution-script "$0"，不新增有效 timer。是否正式启用以中央计划和registry读回确认。maintain保留冻结runner monitor的原批次健康，并独立推进持续恢复；原monitor故障显示partial_failure，仍尝试读取中央需求，不伪称健康。

每个未完成正式手机任务对应中央 blocked project需求，blocked_until为空；维护负责人主理人，commander为OpenClaw:infra。固定原任务/批次/计划/slot/serial/source放payload，变量仅进result.recovery。完整分页读取activated_at之后的正式22点slot，跨日持续；旧failed任务和Run不改。结清或取消需求不重建；后续正式巡查或已授权人工补查可凭真实完成证据覆盖旧需求。

补查是需求下独立script_run，稳定需求+generation幂等，POST丢回执先读中央记录，不盲重建。新任务只用original_schedule_id/original_slot，不带主计划recurring_task_id。同设备已有正式/恢复任务时延后；退避15/30/60分钟后每小时继续，由实际30分钟维护轮检查到期。超过3次真实失败只登记一条blocked人工维护任务，需求仍未完成。设备停用、需求明确终止时停止；当前身份、指纹或迁移不符合合同则待维护，不盲执行。

执行包装器重读需求取消、设备enabled/宿主、scope、command和控制源码哈希，再由冻结控制器仲裁原生手机锁。phone source_revision仍为4f，控制包装另记control_source_revision/control_sha256。attempt预算1500秒，内部phone调用1150秒；超时不声称远端动作已取消。

只有正式冻结手机子任务或核验过的补查任务，具备规范Run、exit0、完整九平台及写回/镜子证据、同serial/source/workflow和真实时间窗口，才结清completed_no_pr。原需求时间取原任务/slot，且不早于被采用成功任务created_at；不会因晚建账强制重复已完成人工补查。不同slot的后继证据记明实际task/run/slot，inspect追加recovery_demands但不覆盖原children和原failure。

私有native-maintenance-<任务ID>.json只是执行回执，需求真身始终是中央Tasks。正式入口、真实补查及取消守卫仍须部署后验收，不以静态回归替代。
