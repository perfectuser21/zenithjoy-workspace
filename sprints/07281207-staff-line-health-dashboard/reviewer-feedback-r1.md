# GAN Reviewer 第1轮反馈（verdict=REVISION）

## rubric_scores
完整性(dod_machineability)=9, scope_match_prd=6, test_is_red=10, internal_consistency=7, risk_registered=6, verification_oracle_completeness=4, ci_workflow_alignment=8

## 必须修复的问题

1. 【环境状态数据源，internal_consistency+risk_registered】
   Proposer rationale 声称"团队未见 develop/release 分支使用痕迹"，经 git log 核实为事实错误：
   origin/develop（末次提交2026-03-07，落后main 1266 commit）与 origin/release/cs-stable
   （末次提交2026-06-23，落后main 554 commit）均真实存在。按当前拍板方案（分支存在性+
   GitHub commits API path过滤），实现后 dev/staging 会显示 "active" 状态并带数月前的陈旧
   commit_date，且无陈旧标注——比自评的"至多 not_deployed"更具误导性。
   要求：① 订正 rationale 文本为准确表述；② 二选一：(a) 加陈旧阈值判定（commit_date 超过
   N 天则单独标注 stale/inactive，不与"刚部署"混为一谈），(b) 在合同 Notes 显式登记为已知
   技术债，同时补一条可控场景断言（mock GitHub commits 返回陈旧日期，断言不误报为"最新"）。
   当前测试对 environments[].status 只做了枚举成员检查，没有测试三态判定逻辑本身。

2. 【GitHub数据缓存TTL，scope_match_prd】
   PrepPRD 判定点6（GitHub数据缓存5分钟）是 sprint-prd.md 明确列出的 NFR，但合同零机检覆盖，
   且未提供替代验证方案。要求补至少一条断言：短时间内两次调用，断言底层 GitHub 抓取函数
   调用次数不随第二次请求增加（vitest spy 计数，不需要真实等待5分钟）。

3. 【recent_commit 字段零覆盖，verification_oracle_completeness】
   contract-draft.md 定义了 data.recent_commit（复用 environments[production] 项），但
   DoD/tests 无任何断言覆盖其存在性/与 production 项的一致性。要求补断言。

4. 【禁用字段反向检查不完整，verification_oracle_completeness】
   deployment 端点声明禁用 deploy_version/version，abilities 端点声明禁用 features，但只有
   顶层 /line-health 做了反向检查。要求 deployment 和 abilities 各补一条禁用字段反向检查。

## 非阻塞建议
5. apps/staff-hub 当前无 @playwright/test 依赖/配置，DoD ARTIFACT 清单未把"是否具备可运行
   Playwright 环境"列为独立检查项，建议补上避免留到 final-e2e 才暴雷。
