---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 只验证三个 payload 权威字段与冻结 base/目标 PR/GP 的审计绑定。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `validate-fleet-payload.mjs` 提供严格 payload 校验与 JSON receipt，且不含固化角色 UUID
  Test: node -e "const fs=require('fs');const p='sprints/08042230-kernel-pr1581-fleet-validation-r33/validate-fleet-payload.mjs';const c=fs.readFileSync(p,'utf8');if(!c.includes('target_head_sha')||!c.includes('gp_anchor')||/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 正确 payload 原样绑定三个权威字段
  动作: 将 PRD 指定的 repo、完整 target SHA、base SHA 与 GP anchor 交给真实 CLI。
  预期观察: receipt 返回 ok=true，字段逐字一致且 failure_class=none。
  等待预算: 0s
  留证: CLI JSON stdout 与 evaluator receipt SHA-256
  Test: manual:bash -c 'node sprints/08042230-kernel-pr1581-fleet-validation-r33/validate-fleet-payload.mjs --payload-json '"'"'{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}'"'"' --offline | jq -e '"'"'.ok==true and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class=="none"'"'"''

- [ ] [BEHAVIOR] [L2] B-02: 缺失或错误 base_repo 必须拒绝
  动作: 先删除 base_repo，再改成其他仓库调用真实 CLI。
  预期观察: 两次均非零退出，JSON 为 ok=false 且 failure_class 非 none。
  等待预算: 0s
  留证: 两次拒绝 JSON stdout
  Test: manual:bash -c 'for p in '"'"'{"base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}'"'"' '"'"'{"base_repo":"perfectuser21/other","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}'"'"'; do f=$(mktemp); node sprints/08042230-kernel-pr1581-fleet-validation-r33/validate-fleet-payload.mjs --payload-json "$p" --offline >"$f" && exit 1; jq -e '"'"'.ok==false and .failure_class!="none"'"'"' "$f" || exit 1; rm -f "$f"; done'

- [ ] [BEHAVIOR] [L2] B-03: 非完整 target_head_sha 不得回退当前 HEAD
  动作: 将 target_head_sha 篡改为字符串 HEAD 后调用真实 CLI。
  预期观察: CLI 非零退出并分类 payload_invalid，输出不含 ok=true。
  等待预算: 0s
  留证: invalid-sha JSON stdout
  Test: manual:bash -c 'f=$(mktemp); node sprints/08042230-kernel-pr1581-fleet-validation-r33/validate-fleet-payload.mjs --payload-json '"'"'{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"HEAD","gp_anchor":"line02/keyword_acquisition#step7"}'"'"' --offline >"$f" && exit 1; jq -e '"'"'.ok==false and .failure_class=="payload_invalid"'"'"' "$f"; rm -f "$f"'

- [ ] [BEHAVIOR] [L2] B-04: 错误 gp_anchor 不得猜测 Step 7
  动作: 将锚点改成同一 GP 的 step6 后调用真实 CLI 与真实 product-map。
  预期观察: CLI 非零退出并分类 target_mismatch，不产生成功 receipt。
  等待预算: 0s
  留证: wrong-anchor JSON stdout
  Test: manual:bash -c 'f=$(mktemp); node sprints/08042230-kernel-pr1581-fleet-validation-r33/validate-fleet-payload.mjs --payload-json '"'"'{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step6"}'"'"' --offline >"$f" && exit 1; jq -e '"'"'.ok==false and .failure_class=="target_mismatch"'"'"' "$f"; rm -f "$f"'

- [ ] [BEHAVIOR] [L2] B-05: 真实 GitHub 与 GP SSOT 对账成功 [接缝×2]
  动作: 连续两次查询 PR #1581，并读取真实 product-map 精确解析 Step 7。
  预期观察: 两次 repo/head/base 相同，GP Step 7 唯一存在。
  等待预算: 30s
  留证: 两次 GitHub JSON 摘要与 product-map jq 输出
  Test: manual:bash -c 'for n in 1 2; do gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -e '"'"'.head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .base.sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .head.repo.full_name=="perfectuser21/zenithjoy-workspace"'"'"' || exit 1; done; jq -e '"'"'.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition") | [.steps[] | select(.id=="step7")] | length==1'"'"' product-map/generated/product-map.json'

## Invariant 映射

- INV-01 本机常驻服务/LaunchAgent：N/A，本 sprint 不安装服务。
- INV-02 status 枚举：N/A，本 sprint 不改 status 枚举。
- INV-03 共享 CI 基础设施禁区：Generator 不得修改 `.github/workflows/**` 或 smoke allowlist。
- INV-04 同义语义同策略：判变与终验都以 payload+GitHub 为准，禁止 HEAD 回退。
- INV-05 Test Contract 四列：由 contract-draft 的四列表机检保留。
- INV-06 表认领/后台 job/cron/DB 字段与租户隔离：N/A，本 sprint 不建表、不写 DB、不建 job。
- INV-07 PR 提前合并与 verdict SHA：receipt 必须绑定 target SHA，合并态不改变校验对象。
- INV-08 ref 验证：必须执行 `git rev-parse --verify '<sha>^{commit}'`。
- INV-09 smoke/服务双信号/launchd patrol：N/A，不涉及服务生命周期。
- INV-10 headed relay payload：本 sprint 直接验证 base_repo/target_head_sha/gp_anchor 不可缺失。
- INV-11 跨模块时间常数/多轮扫描/探针日历窗：N/A，无扫描器或时间常数。
- INV-12 evaluator 临时文件：必须使用含当前 attempt 的 `mktemp -d` 独享路径。
- INV-13 真机/生产接缝：GitHub 接缝须真实重复两次；无真机接缝。
- INV-14 catch 失败指标/dep-audit/部署 fail 变量：N/A，不改后台 job、依赖或部署。
- INV-15 PII/secrets：receipt 不记录 token、cookie、PII；只记录冻结对象与 provenance。
- INV-16 API auth/双租户：N/A，不新增 API 或租户数据路径。
- INV-17 watchdog/relay 状态机/phase event/收账：N/A，不改调度与状态机。
- INV-18 通知语义字段：N/A，不发通知。
- INV-19 GP 产品分类：必须从 product-map SSOT 精确解析，不手写分类事实替代校验。
- INV-20 新 task_type 七点接线/generator merge 权：N/A，不新增 task_type，Generator 只推 branch。
- INV-21 屏幕坐标/OS 多端/Android theater：N/A，无 UI 或设备执行。
- INV-22 smoke worktree 生产资源/Red 精确 add/slot 串行：测试仅读仓库与 GitHub，提交只 add 本 sprint 精确路径。
- INV-23 判断生产实体自报：PR head 取 GitHub API，不以工作区 diff 代替。
- INV-24 共享前缀探针/capture 去重/journey_features 陈旧探针：N/A，无探针自产数据。
- INV-25 历史合同执行路径：以本次 PRD 与真实 PR #1581 派发对象为准，不复制历史假设。
- INV-26 新字段语义重叠：三个 key 为 PRD 字面字段，不引入同义 key。
- INV-27 manual oracle：Evaluator 必须记录真实 exit code，且 Node/JQ/GH 均真实启动。
- INV-28 DB_NAME 同源/agents 列名/表长度：N/A，不访问数据库。
- INV-29 外部付费调用去重/cortex 低频路径：N/A，无付费或低频业务路径。
- INV-30 Judge 证据格式：Evaluator 证据须提供顶层 exit_code、log_tail 与 behavior_tests；Judge 引用其 SHA-256。
- INV-31 null/false 契约失败分支：CLI 对所有失败显式非零退出并输出 failure_class。
- INV-32 退役判断/复活旧功能/冲突 PR：N/A，不退役功能、不解决目标 PR 冲突。
- INV-33 其余重复的 smoke 铁律：N/A，本 sprint 不修改 smoke 资产；`npm run product-map:check` 必须保持通过。
