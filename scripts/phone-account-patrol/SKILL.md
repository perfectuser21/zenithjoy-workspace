---
name: phone-account-patrol
description: 检查一台已登记安卓手机八大平台的当前账号与登录状态，或排入一批手机巡查任务；维护巡查部署、调度和故障记录时使用。
---

执行入口是本目录的 `runner.py`，由中央 Brain 的 `script_run` 执行器启动，不调用大模型。

- `phone --serial <设备标识> --execution-script "$0"`：单手机巡查。宿主与连接 profile 从 `/api/brain/phone-registry` 获取。
- `batch --execution-script "$0"`：为所有启用手机登记子任务后返回“已排队”，子任务各有独立运行记录。
- `monitor`：检查定时漏跑及近期手机失败；异常进维护任务账，不发送外部消息。
- `self-check`：检查部署文件指纹；M4 `preflight.py --serial <设备标识>` 检查真实依赖和连接。

只核验当前账号。其他保存账号不代表登录有效，不能主动切换、登录、发布或发送消息。
设备忙时跳过，不抢锁。未知保留为待确认；写回失败返回非零，不把批次排队成功视为手机巡查成功。

维护负责人：主理人。每日巡查时间：22:00，Asia/Shanghai。调度配置以 Brain recurring_tasks 为准，禁止另装独立定时器。
源码真身在 ZenithJoy 仓库本目录，部署版本与流程ID读取 `deployment.json`。账号台账写回既有账号登录明细工作面；设备页面交给原有镜子更新。
