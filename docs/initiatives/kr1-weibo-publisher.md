---
id: init-kr1-weibo-20260319
kr_code: KR1
title: KR1 子项：微博平台发布自动化
description: 实现 zenithjoy 内容到微博的自动化发布。微博发布接口已通过 Playwright CDP 方案接通，需要在生产环境验证稳定性并集成到内容工厂。
owner: repo-lead:zenithjoy
status: decomposing
priority: P0
created_at: 2026-03-19T04:25:00Z
deadline: 2026-03-25T16:00:00Z
acceptance_criteria:
  - 微博发布接口通过 Playwright 自动化验证可靠性 (成功率 ≥95%)
  - 内容工厂 /publish 端点支持微博发布，10 条测试内容成功发出
  - 图片/文本混合内容支持
  - 发布失败重试机制完整
estimated_effort_days: 4
---
