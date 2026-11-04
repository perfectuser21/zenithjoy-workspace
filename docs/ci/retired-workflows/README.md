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


2026-11-04 再核实并停用七个仅留在 GitHub 服务端的旧记录。停用仅关闭旧入口，历史 run 与源码仍可按 SHA 恢复，不删除当前测试、历史产物或业务数据。两次读取均无未结束的运行；对应旧 PR 已关闭或合并，当前 main 无这些 workflow 文件。

| GitHub workflow ID | 旧入口 | 当前消费者或清退依据 |
|---|---|---|
| 311803993 | agent-line-module-build-pr.yml | 现役 L3 的四 Line 构建矩阵和 required 聚合承担相同构建命令 |
| 311805377 | ci-line-modules-build.yml | 同上，旧脚本缺失时还可跳过；现役矩阵必须真构建 |
| 273311176 | lint-feature-has-smoke.yml | 原注释明确是为 sprint 词形合同建立的影子；现役 L1 真执行同一 lint |
| 269751773 | ci-l4-playwright.yml | 旧入口调用已不存在的 test:e2e；当前各 UI 合同分别登记接线，关闭旧记录不删除任何 spec，也不宣称全量 UI 已被等价替代 |
| 301204823 | e2e-line04-cs-work-stats.yml | 现役 e2e-line04-cs-stats.yml 执行同一 cs-work-stats.spec.ts 及新增 daily-report；后端独立真实 DB smoke 保留 |
| 325332514 | e2e-acquisition-config-validation.yml | 旧 sprint 包装已迁现役 acquisition 配置合同；Smoke Glob 自起 API/DB 的完整 PUT、无效 partial 拒绝且 DB 不变、合法 partial 持久化继续执行 |
| 255256704 | cleanup-merged-artifacts.yml | 原来删除的是跟踪的 .prd-*/.task-* 源文件，并非 Actions artifact；无未履行的 artifact 清理义务。当前开发审阅/历史合同保留，不恢复自动向 main 删除与推送的旧壳 |

历史源码 refs（顺序按表）：`2a860739bc983c776fe351ecb02d245aaa6e7122`、`e39f14737d1cd53a73d1a80b1ea14c813f6145d7`、`9f53e53bc152047a8dccedfe32d1ec98f7caf939`、`9feba26207cc80578f44276db2d407a3aacea5fe`、`0521cd43fab860246ad17813486f181e7ed55959`、`9519991224f250c95fb743cbd848bdf31796e994`、`b441c5def8350619c3880dfedd5b58dd95c3b76e^`。详情及 API 读回保存在本次 CI 审计证据目录。
