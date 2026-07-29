# PrepPRD：GP锚定闭环 刀5 — ci-patrol棘轮 + 历史无锚PR归户

> 范围与边界已在 `docs/superpowers/specs/2026-07-28-gp-anchor-enforcement-design.md` §5/§6/§7/§8 拍板，本 PrepPRD 是该设计的落地执行单，不重新展开对抗式深挖（设计文档已走过对抗审查）。

## 本次对话涵盖的所有事项
- [x] 本次做：GP无smoke覆盖计数脚本 + 接入 ci-patrol 日报棘轮指标（report-only，非CI硬闸）
- [x] 本次做：近40个合并PR一次性人工归户台账 + 欠smoke回流的 Brain Issue
- [ ] 另立 Sprint（本次不做）：step粒度smoke断言映射（非目标②）、历史PR git记录迁移（非目标④）、hotfix旁路（非目标②）

## Journey 当前状态
- ✅ 刀1-4（product-map SSOT + CI硬闸 + skill层三处接线 + Brain层锚校验）已合并
- 🔄 刀5（本次）：patrol棘轮 + 历史归户

## 本次要做的

### Part A：ci-patrol 棘轮指标
计算 `product-map/generated/product-map.json` 里 `golden_paths[]` 中 `smoke_files` 为空/缺失的条目数，暴露为可执行脚本供 ci-patrol 日报调用，输出行 `GP 无 smoke 覆盖步骤数: N`。Report-only（不新增CI硬闸，避免与刀2 lint-gp-anchor重复拦截）。

### Part B：历史无锚PR归户
对近40个已合并PR做一次性人工归户：按 line_id（line00-line04）分类，或标 `none(backlog)`。staff-hub 飞书登录7连修等归 line00。产出 markdown 台账，欠回流 smoke 的开一条 Brain Issue 追踪债务。

## Golden Path
1. 开发者/ci-patrol日报生成 → 系统计算GP无smoke覆盖计数 → 日报展示该棘轮指标
2. 主理人查看归户台账 → 确认约40个历史PR的line归属 → 欠smoke的debt作为Issue可追踪

## 涉及的 Ability / Feature
- GP锚定校验（journey_features id 97400e37-3558-4db7-990e-98c3f2634cc8，status planned/thin）— 本刀完成后可推进为 done

## 不包含
- step粒度smoke断言映射
- 历史PR git记录迁移/重写
- 新增CI硬闸（本刀是report-only）

## 判定点登记表
（本任务无接缝判定点，N/A——PR line归属由人工判断，非系统自动推断外部真实状态）

## 前置工作
- [x] product-map/generated/product-map.json 已存在（刀1产出）
- [x] ci-patrol skill 文件路径：~/.claude/skills/ci-patrol/SKILL.md（本地文件，非zenithjoy-skills仓库跟踪——已知drift，本刀不解决，仅追加棘轮段落）
- [x] gh CLI 可用，可查 `gh pr list --state merged --limit 40`

## 验收标准
- [ ] `node scripts/product-map/gp-smoke-ratchet.mjs` 输出 JSON 含 `gp_no_smoke_count` + `gp_no_smoke_ids`
- [ ] 单元测试覆盖：无smoke_files的GP被计入、有smoke_files的GP不被计入
- [ ] ci-patrol SKILL.md 新增调用该脚本并展示棘轮指标的步骤
- [ ] docs/gp-anchor-orphan-ledger-cut5.md 归户台账产出，覆盖近40个合并PR
- [ ] 欠smoke回流的 Brain Issue 已创建（至少覆盖 staff-hub 飞书登录7连修一例）
- [ ] CI 全绿
