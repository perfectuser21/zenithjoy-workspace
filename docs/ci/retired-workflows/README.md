# 已退出 GitHub 调度的历史工作流

`ai-acceptance-capture.yml` 于 2026-11-04 归档。原 owner task
`557c8bf4-b873-41f6-8ea8-c1d983da0a8f` 已于 2026-08-07 完成；当前 UI、服务与
Brain queued/in_progress/pending 任务未发现其调用者。该旧 workflow 是唯一接线，调用的
`judge.mjs` 从未交付，且使用云 runner 无法访问的 `host.docker.internal:5221`。
保留文件用于历史审阅，不再暴露一个可先点火采集、后必失败的 GitHub 入口。

采证 CLI `scripts/acceptance-spec/ai-run/capture.mjs`、安全边界测试、历史证据包与 Brain
AI 专用兼容接口保留。截图判官/AI 列自动回写未完成，不能把其他验收当作它的交付。
今天员工验收入口是 Staff Hub `/acceptance`、`/acceptance-history`；zip 技能验收入口
为 `/skill-eval`。这些分别有人审、技能评测合同，与旧 36 格截图 AI 列并非等价。

旧 Path4 `tests/ws3/4/a-route-guardrail.test.ts` 已退出清单：聊天待审限制已被无审批
自动回复替代，当前 `tests/services/wechat-draft.test.ts` 验证群/黑名单/失败不发送；
朋友圈仍待审、approval_source=null、画像缺失及当日去重也由同一真实服务测试兑现。
主动会话限制仍由 `path4-sprint-1-ws3-smoke.sh` 扫描真实 RPA 脚本。
`tests/ws6/{ci-workflow,smoke-shape,evidence-strict}.test.ts` 是已完成 sprint 的排除项，
只约束旧 CI 形态/源文件长度/旧飞书回执模板，当前真实主 smoke 与 required gate 接替其
执行义务。历史合同、`.agent-knowledge` 证据、数据库兼容字段和回执均保留。
