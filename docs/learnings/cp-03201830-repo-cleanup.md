---
branch: cp-03201830-repo-cleanup
created: 2026-03-20
type: learning
---

# Learning: 仓库垃圾文件清理

## 发现
monorepo 合并后，仓库中积累了 152 个不属于代码的文件：
- 137 个 heartbeat 运行日志（docs/heartbeat/）— Brain 数据库已有副本
- dev 运行报告、调试截图、过期 PRD/功能清单等

## 根因
1. repo-lead agent 生成 heartbeat 日志时直接写入 git 追踪目录并提交
2. monorepo 合并时带入了旧仓库的临时文件
3. .gitignore 规则不够完善，未阻止这些文件被提交

## 改进
1. .gitignore 已更新，新增 `docs/heartbeat/`、`.security/`、过期文档等忽略规则
2. 未来 heartbeat 报告应只通过 API 发送给 Brain，不写入 git 追踪的目录
