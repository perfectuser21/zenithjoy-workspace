# 手机账号巡查维护手册

维护负责人：主理人。计划时间：每天北京时间22:00（Asia/Shanghai）。

## 正式登记与执行

- 单手机流程：`66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff`（single-phone-account-patrol，0.1.0）。
- 批次流程：`7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70`（phone-account-patrol-batch，0.1.0）。
- 定时任务：`421eb084-1624-4e0f-af4e-8aabf66b23a8`，cron `0 22 * * *`、显式Asia/Shanghai。
- 运维登记：`1d7335b8-fdfe-4c7f-b246-52180c03339a`，负责人、版本、调度和验收证据均在metadata。
- 项目：`8386209b-ed0f-4f0f-a1f0-9ddf1bddbff6`。

中央Brain定时器生成script_run批次，MMV代码执行器读取设备清单，为每个启用手机登记单手机任务。每部手机在M4通过原生设备锁、ADB和Vision OCR逐平台检查，再写回账号登录明细；设备镜子更新页面。执行不调用大模型，不切换账号、不登录、不发布。

批次完成只表示子任务已排队。每部手机是否巡查完成，以该子任务及独立task_runs为准；占用跳过不是完成巡查，未知记待确认，离线和写回失败返回非零。定时器last_run_at只是建单时间，不能拿它证明手机已经执行。

## 怎么查看

通过Brain API读取，不能直写SQL或修改Notion投影：

- `GET /api/brain/registry/1d7335b8-fdfe-4c7f-b246-52180c03339a`：实际部署和维护状态。
- `GET /api/brain/recurring-tasks`：找到上述调度ID，查看is_active、next_run_at和时区。
- `GET /api/brain/tasks/<任务ID>`：实际状态、script.run_id、exit_code、stdout和证据。
- `GET /api/brain/tasks/<批次ID>/chain`：项目任务链；具体子任务结果逐条读回。
- 本机私有证据：`~/.local/share/phone-account-patrol`，勿把截图、账号原始观测或凭据提交Git。

小白中央真实验收：`e1b931d4-2d04-4f36-8835-d35548d7d42d`；批次验收：`8df4065c-5e1a-4cfe-be25-caa6fee48709`。批次真实重放后四个子任务ID完全一致。

## 部署门槛与当前状态

截至2026-10-10验收，两个正式流程已经登记读回；固定部署commit为`1033a5a1bf24da727fbf6123205fda91a99f64a1`。源码PR #2104包含后续漏跑守卫修正，尚未成为上述0.1.0部署的一部分。

**调度目前停用。** 仍需补齐Implementation impact映射与base/head定义证据、通过自动代码审查、部署Notion代码运行记录入口并读回真实Run，再更新正式定义与固定部署版本、注册中央维护检查调度。启用时必须在巡查template写activated_at，用于不追责停用期间的历史漏跑；同时通过账号工作面正式维护入口更新调度标签，不能伪造新的账号核验时间。

不得绕过CI、管理员强行合并、直接SQL注册、另开本机隐藏定时器，或把未部署版本标成已部署。完整验收后才通过Brain recurring-tasks API启用。中央自动派发池满可能延后执行，22:00是计划时间；排队必须可见并记录异常。

监控自身异常也必须留下中央失败Run。巡查失败、排队超时、漏跑或设备占用由主理人查看维护任务和运行记录；代码修复走Git PR、测试、固定版本部署和正式定义更新。
