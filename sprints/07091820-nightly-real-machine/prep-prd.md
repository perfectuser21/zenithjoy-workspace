# 小改动 PrepPRD：刀A — nightly-real-machine-staging 真机每晚回归闸

## 改什么
新增 `.github/workflows/nightly-real-machine-staging.yml`：
- schedule 每晚北京 03:00（UTC 19:00）+ workflow_dispatch
- job1 真微信气泡门 full check（复用 wechat-cs-e2e job3 的 PsExec -i 1 范式，真发 marker 到文件传输助手）
- job2 真抖音 keyword→comment 读侧（复用 line02 smoke；DPAPI 解不开时 SKIPPED 自报不算红）
- 同机串行（needs + if always）防桌面争用
- job3 汇总：红→自动开 `[nightly-red]` Issue（同日去重），处理约定写进 Issue body

## 为什么改
6站2轨 CI/CD 模型（2026-07-09 定稿）第④站真机轨空白：真机能力无常态回归（只有 path-aware 改到才跑），staging 真机验证靠出版本人肉复测。本刀一箭双雕：nightly = 真机每日回归 + RPA staging 验证自动化，并为刀C Release Gate 提供「最近2晚 nightly 绿」证据源。

## 关联上下文
- Brain task：450b4500 · journey Line04（bfeed805）
- Notion：CI 指南 v3（6站2轨 + Release + Nightly 定义）
- 复用现成真机脚本，零新增测试逻辑——本刀是调度接线，非新能力

## 影响范围
纯新增 workflow，不动任何现有 workflow/代码。schedule 只在 main 上生效。跑在 ROG self-hosted（已有 runner），每晚 <25 分钟。

## 验收标准
- [ ] yaml 语法有效
- [ ] PR 标题带 [CONFIG]
- [ ] CI 全绿
- [ ] merge 后 workflow_dispatch 手动点一次 proven-to-fire（真机真跑通或真报红开 Issue）
