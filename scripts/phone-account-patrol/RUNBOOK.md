# 手机账号巡查维护手册

维护负责人：主理人。计划时间：每天北京时间22:00（Asia/Shanghai）。

## 正式登记与执行

- 单手机流程：`66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff`（single-phone-account-patrol，0.1.1）。
- 批次流程：`7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70`（phone-account-patrol-batch，0.1.1）。
- 维护流程：`e4d2030f-129f-4668-95dd-4a6d880493a8`（phone-account-patrol-maintenance，0.1.0）。
- 定时任务：`421eb084-1624-4e0f-af4e-8aabf66b23a8`，cron `0 22 * * *`、显式Asia/Shanghai。
- 维护定时任务：`3c25817f-8b3d-40ce-86b9-8a927d4e6d61`，cron `*/30 * * * *`、显式Asia/Shanghai。
- 运维登记：`1d7335b8-fdfe-4c7f-b246-52180c03339a`，负责人、版本、调度和验收证据均在metadata。
- 项目：`8386209b-ed0f-4f0f-a1f0-9ddf1bddbff6`。

中央Brain定时器生成script_run批次，MMV代码执行器读取设备清单，为每个启用手机登记单手机任务。每部手机在M4通过原生设备锁、ADB和Vision OCR逐平台检查，再写回账号登录明细；设备镜子更新页面。执行不调用大模型，不切换账号、不登录、不发布。

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

上述为真实手动巡查验收，均有独立script Run、exit 0、账号写回及设备镜子JSON回执。批次 `c3526656-1443-4ce5-af6c-1402fb08bf57` 与独立实际重放 `67d31662-6108-457c-8622-c1e4a055b494` 返回完全相同的四个子任务ID；批次通过不替代自动单手机运行证明。

## 部署门槛与当前状态

MMV与M4固定运行源码为`4f899cab6425341646e27c5fca20979b8ac42be7`，两端部署文件已逐个核对哈希；三个流程和两项中央计划已正式登记。静态手册不代替实时状态：是否启用、下次运行时间及正式发布证据，以中央registry和recurring-tasks读回为准。

启用门槛：正式源码CI与代码审查通过、纯代码中央自动派发实测通过、Notion代码运行记录读回真实Run。启用时在巡查template写activated_at，不追责停用期间的历史漏跑；同时通过账号工作面正式维护入口仅更新调度标签，保留真实账号核验时间。

不得绕过CI、管理员强行合并、直接SQL注册、另开本机隐藏定时器，或把未部署版本标成已部署。完整验收后才通过Brain recurring-tasks API启用。中央自动派发池满可能延后执行，22:00是计划时间；排队必须可见并记录异常。

监控自身异常也必须留下中央失败Run。巡查失败、排队超时、漏跑或设备占用由主理人查看维护任务和运行记录；代码修复走Git PR、测试、固定版本部署和正式定义更新。
