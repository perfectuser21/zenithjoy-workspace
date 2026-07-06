# Sprint PRD — 机器管理：安卓设备账号模型

## OKR 对齐

- **对应 KR**：客户智能获客路径（Line02）— 机器管理能力加厚
- **当前进度**：机器管理 Feature 现状 medium（仅支持 Web 端 cookie/session 模型）
- **本次推进预期**：新增安卓专属账号识别模型，机器管理仍为 medium，覆盖范围扩展到 Android 设备

## 背景

抖音私信主动触达（Android 执行路径）与客户智能获客采集闭环已落地在 Android agent 上，但机器管理 Feature 目前只认 Web 端 cookie/session，不知道 Android 手机上实际登录了哪些抖音号。派发任务时可能把任务派给手机上已登出的账号。本次给机器管理加一段账号扫描能力，让中台感知 Android 设备当前登录状态。

## Golden Path（核心场景）

1. 用户在安卓手机上用抖音 App 登录了 N 个账号（系统无感知，手机自己的事）
2. Android agent 低频（30-60 分钟一次）尝试扫描当前登录账号列表 → 扫描前检查全局互斥锁，若采集/触达任务正在跑则本轮跳过，等下一个周期
3. 扫描时打开抖音"切换账号"界面读取账号列表 → 无论成功/失败/异常中断，扫描流程结束时必须确保退出该界面，不留在半开状态（超时强制退出兜底）
4. 系统把扫描结果（账号列表，绑定当前 agent 的 tenant_id）写回 `agent_platform_sessions`（新增 `device_type='android'` + 账号列表相关字段），标记本次扫描时间
5. 若扫描发现某账号不再登录该设备 → 标记该记录离线；若发现某账号新出现在这台设备但已绑定在另一台安卓设备上 → 以后上报者为准覆盖，旧设备记录标为失效并写日志告警
6. 用户在 Dashboard 机器管理页看到这台安卓设备当前登录的账号列表（跟 Web 小号在同一个列表里，用 `device_type` 标签区分）
7. 派发采集/触达任务时，若执行中发现目标账号在手机上未登录（跟中台记录不一致）→ 立即触发一次实时重新扫描更新状态，不等下个周期，该次任务按未登录处理转失败/人工核实

## 边界情况

- Step 3 无障碍服务读不到账号列表 → 保留上一次已知列表并标记 stale，不用空值覆盖
- Step 3 扫描过程中 App 崩溃/无障碍服务超时/手机锁屏 → 超时强制退出兜底，避免切换账号弹窗卡在半开状态污染后续采集/触达操作
- Step 2 全局互斥锁长期被占用（比如触达任务本身卡住）→ 账号扫描持续跳过不阻塞，只影响账号新鲜度，不影响主流程

## 范围限定

**在范围内**：
- 扩展 `agent_platform_sessions` 表加 `device_type` + 账号列表相关字段
- 账号去重/双端冲突覆盖判定的纯函数 + 单元测试
- tenant_id 绑定逻辑的纯函数 + 单元测试
- 下线判定 + 立即重扫触发逻辑的纯函数 + 单元测试
- 全局互斥锁判定逻辑的纯函数 + 单元测试
- Dashboard 机器管理页 `device_type` 标签展示

**不在范围内**：
- Web 端 cookie/session 模型本身的任何改动
- 历史脏数据迁移（现状 Android 在该表零数据，无需迁移）
- 人工审核双端登录冲突（本次走自动覆盖+告警，不做人工审批流程）

## 假设

- [ASSUMPTION: 无障碍服务读取账号列表技术可行性未最终确认，若真机验证发现读不到，需降级为"主动打开切换账号弹窗扫描"，两种方案的判定/去重/冲突处理逻辑相同，不影响本次可测试范围]
- [ASSUMPTION: 本 Sprint 只做纯逻辑抽函数 + 单元测试级验收，无障碍服务真实读取的可行性由人工在 Honor 真机（Tailscale IP 100.91.227.1）补验]

## 预期受影响文件

- `agent_platform_sessions` 相关 schema/migration：新增 `device_type` 字段 + 账号列表字段
- 机器管理后端逻辑：账号去重/双端冲突覆盖判定、tenant_id 绑定、下线判定+重扫触发、全局互斥锁判定，均抽成纯函数
- Dashboard 机器管理页组件：新增 `device_type` 标签展示

## NFR 约束

<!-- 来源: decisions 表 category=nfr 查询为空（/tmp/nfr_decisions.json、/tmp/nfr_feature.json 均为空数组），以下为 PrepPRD + 本次对话拍板值，PrepPRD/拍板值优先 -->
- 扫描频率：低频 30-60 分钟一次（拍板值）
- 并发控制：全局互斥锁，采集/触达任务运行中账号扫描本轮跳过，等下一周期（拍板值）
- 下线感知：账号离线 → 立即触发一次实时重新扫描更新状态，不等下个周期（拍板值）
- 双端登录冲突：以后上报者为准覆盖，旧设备记录标为失效并写日志告警（拍板值）
- 超时兜底：扫描流程无论成功/失败/异常中断，必须确保退出"切换账号"界面，超时强制退出（PrepPRD）
- 数据保鲜：读取失败时保留上一次已知列表并标记 stale，不用空值覆盖（PrepPRD）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（/tmp/inv_area.json，共 7 条，step/journey_feature 级均为空数组）-->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串，让隔离漏洞当场暴露（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算 done；未真验的只能标 logic-done-pending（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/368c40c2-ba63-8120-86a9-c8739cde0d2a/golden-paths 查询返回空数组（本 journey 尚无已完成/进行中 ability 挂 golden_path 记录）-->
（本 line 暂无历史）

## E2E 验收

> 本 Sprint target_environment=local_api，无障碍服务真实读取由人工在 Honor 真机补验，不进本次自动化 E2E。以下为期望验收点的自然语言描述，最终可执行脚本由 proposer 在 GAN 阶段按 local_api 模板（curl + psql / 单测运行）产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest/jest 单测 + psql 校验 schema 字段）
# 期望验收点（自然语言）：
# 1. 账号去重/双端冲突覆盖判定纯函数单测全绿（同设备内去重、跨设备覆盖后旧记录失效）
# 2. tenant_id 绑定纯函数单测全绿（账号列表跟随 agent 的 tenant_id，且多租户场景互不串）
# 3. 下线判定 + 立即重扫触发纯函数单测全绿
# 4. 全局互斥锁判定纯函数单测全绿
# 5. `agent_platform_sessions` schema 已扩展 device_type 字段，可用 psql 查到
# 6. CI 全绿
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 涉及机器管理后端纯逻辑（去重/冲突判定/tenant绑定/下线判定）与 agent_platform_sessions 表结构，不涉及 apps/dashboard 前端交互验收、不涉及远端 agent 协议验收，命中"纯后端"分支
## target_environment: local_api
## target_environment_reason: PrepPRD 已显式拍板 target_environment=local_api（本 sprint 只做代码/单元测试级验收，真机无障碍服务可行性另由人工在 Honor 真机补验）
## journey_id: 368c40c2-ba63-8120-86a9-c8739cde0d2a
## step_id: 0caea4c4-4bec-4f4d-8c5b-8701be13431c（机器管理 Feature，本次继续加厚新增账号扫描步骤）
