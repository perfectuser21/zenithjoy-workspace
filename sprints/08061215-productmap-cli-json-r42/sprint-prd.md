# Sprint PRD — product-map CLI 增加 --json 输出模式

## OKR 对齐

- **对应 KR**：未提供（Brain context 无活跃 KR）
- **当前进度**：待定
- **本次推进预期**：交付可供 CI 与 Brain 直接解析的 check 结论

## 背景

`scripts/product-map/cli.mjs` 的 `check` 当前只输出人类可读文本；CI 与 Brain 解析 stdout 文本较脆弱，需要 `--json` 稳定机器接口，同时保持既有使用方式零回归。

## Golden Path（核心场景）

运维/CI 从 `node scripts/product-map/cli.mjs check --json` 入口 → product-map CLI 完成同一套分类合同检查并输出单个 JSON 对象 → 调用方用 `jq` 读取 `ok` 与 `errors`，并继续依赖原有退出码判定通过或失败。

具体：
1. 运维/CI 执行 `check --json`，stdout 仅得到一个合法 JSON 对象。
2. 对象至少包含布尔值 `ok` 与字符串数组 `errors`；无问题时 `errors` 为空数组。
3. 检查通过时退出码为 0，失败时退出码非 0。
4. 不带 `--json` 时，人类可读输出与当前版本逐字一致。

## 边界情况

- `product-map.json` 不存在或不可解析时，`--json` 仍输出 `ok=false` 的合法 JSON，`errors` 含具体原因，stdout 不出现未捕获异常文本。
- `--json` 与既有参数并存时互不干扰。
- 多个检查问题分别进入 `errors`，每项均为字符串。

## 范围限定

**在范围内**：`scripts/product-map/` 下 `check --json` 行为、退出码兼容性及对应单测。

**不在范围内**：修改 product-map 数据、改变其他子命令、改变无 `--json` 时的文本或退出码语义。

## 假设

- [ASSUMPTION: Brain context 未返回活跃 KR，因此本 sprint 不虚构 KR 编号或进度。]
- [ASSUMPTION: PrepPRD 未锚定 Journey Step，因此 step_id 记为 none。]

## 预期受影响文件

- `scripts/product-map/cli.mjs`：承载 `check --json` 的用户可见行为。
- `scripts/product-map/` 下现有或新增单测文件：先覆盖 JSON 成功、JSON 失败及文本兼容 smoke，再交付行为。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: stdout 在 `--json` 模式必须始终可被 JSON 解析；具体错误通过 `errors` 暴露。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 id 合并去重；下列为 69 条 area 铁律的紧凑语义投影 -->
- [铁律01] 常驻服务不得误放无效 LaunchAgents 域（来源: area）
- [铁律02] 状态枚举变化须全仓复查硬编码断言（来源: area）
- [铁律03] 未授权不得修改共享 CI 基础设施（来源: area）
- [铁律04] 判变端与终验端须统一同一语义（来源: area）
- [铁律05] Test Contract 表格保持固定解析格式（来源: area）
- [铁律06] 新建或复用表前须核对全部写入方 schema（来源: area）
- [铁律07] 新增后台 job 必须声明真实消费方（来源: area）
- [铁律08] 提前合并时须核对 verdict 与合并 SHA 一致（来源: area）
- [铁律09] git ref 存在性须用 verify commit 语义（来源: area）
- [铁律10] smoke 铁律（来源: area）
- [铁律11] 服务存活须由进程状态与端口双信号判定（来源: area）
- [铁律12] headed relay 点火须提供可反查仓库与任务锚点（来源: area）
- [铁律13] 跨模块时间常数大小关系须显式断言（来源: area）
- [铁律14] evaluator 临时脚本须使用会话独享路径（来源: area）
- [铁律15] 接缝须在真实目标环境验证才算 done（来源: area）
- [铁律16] brain 变更提交前须带齐 smoke 登记（来源: area）
- [铁律17] relay 长等待期间须持续写心跳（来源: area）
- [铁律18] 后台 job 吞错路径须有失败指标与告警（来源: area）
- [铁律19] 依赖审计翻红先按 fixAvailable 处理（来源: area）
- [铁律20] PII 与隐私内容不得明文写日志（来源: area）
- [铁律21] 测试毕业后 push 前须跑入册与覆盖检查（来源: area）
- [铁律22] smoke 铁律（来源: area）
- [铁律23] API 端点必须鉴权（来源: area）
- [铁律24] smoke 铁律（来源: area）
- [铁律25] 涉及租户的测试默认验证至少两个租户隔离（来源: area）
- [铁律26] 新 cron 功能须接 scheduler-jobs 正式入口（来源: area）
- [铁律27] secrets 不硬编码、不进 git、不进日志（来源: area）
- [铁律28] watchdog never_started 分类不得覆盖已有失败真相（来源: area）
- [铁律29] 判变基准须用生产实体自报对账 origin/main（来源: area）
- [铁律30] 成功判定须检查接口语义字段（来源: area）
- [铁律31] journey_feature 停滞须作为漏 report 探针（来源: area）
- [铁律32] 新 task_type 须完成全链路接线清单（来源: area）
- [铁律33] 环境假设值不得写死，须推导或真机校准（来源: area）
- [铁律34] smoke 铁律（来源: area）
- [铁律35] watchdog 失败恢复须经外部真相核查（来源: area）
- [铁律36] lint 测试源码读取须走异步函数（来源: area）
- [铁律37] smoke 使用真实 worktree 前须隔离生产副作用（来源: area）
- [铁律38] 租户查询与写入必须 scope 到当前租户（来源: area）
- [铁律39] 复活退役功能前须读取删除历史与原代码（来源: area）
- [铁律40] PR 冲突时先解冲突再等待 CI（来源: area）
- [铁律41] headed relay 子 shell 所需环境须显式 export（来源: area）
- [铁律42] Red commit 只能精确暂存测试路径（来源: area）
- [铁律43] 单 slot 任务串行，写代码实现者同刻唯一（来源: area）
- [铁律44] 守卫自产数据须标记并从统计排除（来源: area）
- [铁律45] urgent 建任务前须按根因锚点查重（来源: area）
- [铁律46] 复用历史合同前须核对本次真实执行路径（来源: area）
- [铁律47] 多设备类型须完整覆盖展示与验收（来源: area）
- [铁律48] 部署失败不得 warning 降级，须非零退出并告警（来源: area）
- [铁律49] 环境白名单断言须覆盖 headed 人工接管（来源: area）
- [铁律50] smoke 铁律（来源: area）
- [铁律51] 新常驻服务须登记 launchd-patrol manifest（来源: area）
- [铁律52] 周期扫描须覆盖不重置状态的真实多轮测试（来源: area）
- [铁律53] theater 关键字与目标环境须语义一致（来源: area）
- [铁律54] 调度接线可用零 mock 源码检查验证（来源: area）
- [铁律55] relay 各阶段须写 phase-event 推进 run.phase（来源: area）
- [铁律56] 探针时间窗口须使用确定性日历窗口（来源: area）
- [铁律57] 无天然上限的写入值须适配字段长度（来源: area）
- [铁律58] node -e 命令须在批准前用目标解释器真跑（来源: area）
- [铁律59] 窄触发路径的替代验证须如实标注覆盖余留（来源: area）
- [铁律60] Brain judge 结果须含规定顶层与行为证据字段（来源: area）
- [铁律61] 周期重扫引入付费调用时须先做已处理检查（来源: area）
- [铁律62] 使用 agents 表字段前须核对真实 schema（来源: area）
- [铁律63] generator 不得自行 merge PR（来源: area）
- [铁律64] harness 完成须核验 report 产出物而非仅看进程退出码（来源: area）
- [铁律65] 返回 false/null 的失败契约须有显式失败分支（来源: area）
- [铁律66] 退役判断须基于生产数据与消费方证据（来源: area）
- [铁律67] 合同批准前须记录 manual oracle 真实退出码（来源: area）
- [铁律68] 数据库 smoke 写入与校验须共用 DB_NAME 解析（来源: area）
- [铁律69] target_environment 须由 Brain task payload 提供（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：先以 smoke test 证明 check --json 在成功与损坏输入时均输出单个可被 jq 解析的对象，断言 ok/errors 与退出码；再断言不带 --json 的 stdout 逐字兼容。
```

## journey_type: autonomous
## journey_type_reason: 该 Golden Path 是无 UI 的本地 CLI 检查行为，由 CI/运维自主调用。
## target_environment: local_api
## target_environment_reason: ZenithJoy task payload 已显式指定 local_api，执行目标为本地 CLI/Node 环境。
## journey_id: bb50964c-f8f7-4843-87da-7148a2611d80
## step_id: none（PrepPRD 未锚定）
