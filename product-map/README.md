# Product Map — 贡献者指南

## 所有权（Ownership）与核心概念

`product-map/product-map.yaml` 是 ZenithJoy 产品分类的**唯一手写来源（SSOT）**。
产品分类由四个正交维度组成：**App**（应用）/ **Line**（业务线）/ **Surface**（平台渠道）/ **Edition**（版本通道）。
Golden Path（黄金路径）归属于特定 App 和 Line，可跨多个 Surface 运行，并可指定适用的 Edition。

所有 App、Line、Surface、Edition、Golden Path 的新增、修改、废弃，必须且只能通过修改此文件来完成。

**不允许**在以下位置手写分类 ID 或名称：
- `AGENTS.md`、`.claude/CLAUDE.md`、`DEFINITION.md`（bootstrap 文件）
- 任何应用代码、配置文件、文档

---

## 变更工作流（7 步）

1. **确认变更类型**：新增 GP / 修改状态 / 废弃 Line / 新增 App 等
2. **修改 `product-map/product-map.yaml`**：遵循 GP 准入规则（见下节）
3. **运行 schema 和关系校验**：`npm run product-map:validate`
4. **重新生成投影**：`npm run product-map:generate`
5. **确认无漂移**：`npm run product-map:check`（应输出 PASS）
6. **提交变更**：包含 `product-map.yaml`、`product-map/generated/` 目录下的两个生成文件
7. **PR 审核**：描述变更原因，CI `product-map-contract` Job 必须通过

---

## Golden Path 准入规则

新增 GP 到 `product-map.yaml` 前，必须满足以下 4 个必要条件：

1. **有明确的 app_id 和 line_id**：GP 必须归属于已定义的 App 和 Line
2. **status 经过评审确认**：`proposed` 表示待验证，`active` 须经过 Sprint 验收通过
3. **不包含已验证范围外的 required_surfaces 或 edition**：只引用 `surfaces` 和 `editions` 列表中已存在的值
4. **`smoke_files` 若声明，路径必须真实存在于仓库**（GP锚定闭环刀1新增）：`product-map-contract` CI job 会校验 `smoke_files` 声明的每个路径存在且非空占位；未声明该字段的历史条目不受影响（grandfather）

---

## Surface vs Line 区别

**Surface**（平台/渠道）表示**技术分发渠道**（如 `web`、`android`、`windows`、`api`），
描述"在哪里运行"。

**Line**（业务线）表示**业务领域划分**，描述"服务哪个用户群体的哪类需求"。

两者正交：一个 Golden Path 可以跨多个 Surface 运行，但只属于一条 Line。
混淆两者会导致 GP 分类错误，请在 PR 审核时检查。

---

## Edition vs Line 区别

**Edition**（版本/通道）表示**集成或部署变体**（如 `personal_wechat`、`wecom`），
描述"面向哪种接入方式"。

**Line**（业务线）描述业务领域，与接入方式无关。

同一条 Line 下的 GP 可能在不同 Edition 中有不同行为，但 Line 本身不因 Edition 而分裂。

---

## 生成文件

机器生成的投影文件（**不要手工编辑**）：

- `product-map/generated/product-map.md` — 人类可读的分类总览
- `product-map/generated/product-map.json` — 程序消费的结构化数据（含 SHA-256 digest）

两个文件均包含相同的 digest，CI `product-map-contract` Job 会在每次 push 时校验两文件与 YAML 的一致性。

---

## 快速命令

```bash
# 校验 YAML 是否符合 schema + 关系约束
npm run product-map:validate

# 重新生成 JSON 和 MD 投影
npm run product-map:generate

# 检测生成文件是否与 YAML 一致（漂移检测）
npm run product-map:check

# 运行单元测试（7 个）
npm run test:product-map
```

---

## 常见错误处理

| 错误信息 | 原因 | 修复方式 |
|---------|------|---------|
| `drift detected` | 修改了 YAML 但未重新生成 | 运行 `npm run product-map:generate` |
| `references unknown app` | GP 的 app_id 不存在 | 检查 YAML 中 apps 列表 |
| `references unknown surface` | GP 的 required_surfaces 含未定义 surface | 检查 surfaces 列表 |
| `duplicate golden_path id` | 两个 GP 使用了相同 id | 重命名其中一个 |
| `duplicates Product Map fact` | bootstrap 文件含分类词汇 | 从 bootstrap 文件中删除分类 ID |
