# PrepPRD：工厂 · F1 开发闭环 — GP锚定闭环 刀1（product-map SSOT扩展）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：product-map schema/数据扩展、GP自身注册（gp_anchor_enforcement）、变异测试smoke、相关既有测试同步改写
- [ ] 另立 Sprint（本次不做）：刀2（lint-gp-anchor.sh CI硬闸+PR模板）、刀3（skill层三处接线）、刀4（Brain层tasks API锚校验+evaluator判据+report回写）、刀5（patrol棘轮+历史PR归户）
- [ ] 待讨论：assertBootstrapParity从未在CI里用真实文件跑过的缺口（Challenger发现，非刀1认领范围，需另开Issue跟踪）；line01/02现有smoke脚本从未进smoke-baseline.txt强制棘轮（已知落差，本PR只注明不修）

## Journey 当前状态
- Journey：工厂 · F1 开发闭环（`e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`，maturity=mvp）
- journey_features 下当前无任何登记项（本次为该journey首次登记Ability）
- ⬜ GP锚定校验（GP-Anchor Enforcement）— planned，本次刀1建thin骨架

## 本次要做的
把「.claude/CLAUDE.md 手写的 Path 步骤定义」和「PR 该挂哪条 GP 才算数」这两件事，从口头约定升级成 product-map SSOT 里机器可查、CI 可校验的结构化数据，作为后续四把刀（CI硬闸/skill接线/Brain层/patrol）共同依赖的地基。

## Golden Path（开发者/AI-agent 操作流程）

1. 开发者/AI 在 `product-map.yaml` 的某条 GP 条目下补充 `steps`（`id`+`name`+可选`status`的业务步骤数组）和 `smoke_files`（字符串数组，指向仓库内一个或多个 smoke 脚本路径）→ 运行 `npm run product-map:validate` → schema 校验通过（字段格式合法）或报错（附具体字段名+合法取值示例，而非笼统"additional property"）
2. 开发者运行 `npm run product-map:generate` → 重新生成 `product-map/generated/product-map.json` + `.md`，MD 投影同步渲染 steps/smoke_files 两列
3. 开发者运行 `npm run product-map:check` → 确认无漂移，且每条设置了 `smoke_files` 的条目，其路径必须在仓库中真实存在**且内容非空占位**（复用 `lint-feature-has-smoke.sh` 同款"≥5行+≥1条真实命令"判据，防 `touch stub.sh` 过关）→ 缺失/为空则报错并列出具体路径 + 一条现有合法条目作范例
4. 开发者提交 PR → CI `product-map-contract` job（`ci-l2-consistency.yml`）自动重跑上述校验 → 通过则允许合并；不通过则 CI 红且日志带结构化前缀（如 `::error::GP-SMOKE-MISSING <gp_id> <path>`），供未来 ci-patrol 机械识别
5.（本次新增自验）`line00/gp_anchor_enforcement` 这条 GP 自身被注册进 `golden_paths`，`status=proposed`（机制本身还没建完，不自称active），`smoke_files` 指向新写的 `golden-path-f1-anchor-smoke.sh`
6. `golden-path-f1-anchor-smoke.sh`（零网络、零DB依赖，纯读取 product-map.json/schema.json 本地文件）验证刀1自己交付的三件事：① schema 校验逻辑对格式错误正确判红 ② smoke_files 存在性+非空校验正确触发 ③ `gp_anchor_enforcement` 自身注册数据正确（这是本轮变异测试的完整范围——不测 lint-gp-anchor.sh 或 Brain API 400，那两项依赖刀2/刀4尚不存在的交付物，留给对应刀落地时追加断言到本文件）

### 错误路径
- Step 1-失败：字段拼写错/格式非法 → schema error 报出具体字段名和合法枚举值，不是笼统 ajv 消息
- Step 1-失败：YAML 语法错误（缩进等）→ 包一层 try/catch，转成 `FAIL: YAML syntax error at line X`，不让 Node 裸堆栈崩溃
- Step 3-失败：`smoke_files` 声明的路径不存在或存在但是空文件 → 报错列出缺失路径 + 现有合法条目范例，开发者能在 10 秒内定位改哪一行
- Step 4-失败：`product-map-contract` job 本身因供应链问题（如 ajv 版本升级导致 strict 模式行为变化）误判 → `test:product-map` 新增一条"schema 自身能被当前 ajv 成功 compile"的冒烟断言，让版本漂移在改依赖的那个 PR 上第一时间暴露，不拖到下一个偶然碰 product-map 的 PR

## 客户视角
本次无终端客户可感知变化——这是 dev_pipeline 内部机制，"客户"是提交 PR 的开发者/AI-agent。

## 完成后开发者/AI能
1. 在 product-map 里查到 line01/02/04 三条客户 Golden Path 的机器可读业务步骤 + 权威 smoke 路径
2. 写错 `smoke_files` 路径时，10 秒内从报错信息定位到具体哪一行、该抄哪个正确路径
3. 确认这套锚定机制自身（`gp_anchor_enforcement`）已经有了可验证的地基，为刀2起的 CI 硬闸提供真实可查的锚点数据源

## 涉及的 Ability / Feature
- GP锚定校验（GP-Anchor Enforcement）— 新增，thin，journey=工厂·F1开发闭环

## 不包含
- CI lint 硬闸本身（`lint-gp-anchor.sh`，刀2）
- skill 层接线（/dev入口检查、6问第1问、contract模板，刀3）
- Brain tasks API 锚校验、evaluator判据、report回写（刀4）
- ci-patrol棘轮、历史无锚PR归户（刀5）
- Path4 业务步骤审计（按用户拍板，刀1按CLAUDE.md现有"6步"原样搬，不做业务模型重新核实；product-map里显式注明"smoke内部步数(golden-path-4-smoke.sh实测17步)与此处业务step数不对齐，属已知记录"）
- 补齐 `skill_acceptance` 历史缺口的专属smoke文件（按用户拍板，只对刀1新增条目强制smoke_files，历史条目grandfather，开Issue跟踪）
- `assertBootstrapParity` 接入真实CLAUDE.md内容跑CI（Challenger发现的独立缺口，开Issue跟踪，不在刀1范围）
- line01/02现有smoke脚本纳入smoke-baseline.txt强制棘轮（现状即"存量债"，本次只在PR描述里注明落差，不修复）

## 判定点登记表
（本任务无接缝判定点，N/A——纯静态数据结构+CI脚本，无对真实世界模糊状态的判断假设）

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] 不涉及，纯仓库内数据/CI改动

### API 与凭据
- [x] 不涉及外部API

### E2E 测试账号
- [x] 不涉及

### 测试 Fixture
- [x] 复用仓库内已存在的 `golden-path-1/2/4-smoke.sh` 等真实文件作为正向fixture；负向fixture用一个不存在的虚构路径

### 基础设施
- [x] Node/npm 环境已就绪（仓库现有 `scripts/product-map/` 工具链）
- [x] Brain API `localhost:5221` 已确认可用（本次会话已验证）

## 验收标准（Final E2E）
- [ ] `npm run product-map:validate` 对新增三条客户线GP + gp_anchor_enforcement条目 PASS
- [ ] `npm run product-map:generate && npm run product-map:check` PASS，MD投影正确渲染steps/smoke_files
- [ ] 故意造一条 smoke_files 路径不存在的条目 → `product-map:check` 必须报错（proven-to-fire）
- [ ] 故意造一条 smoke_files 指向空文件的条目 → 必须报错（proven-to-fire）
- [ ] `scripts/product-map/__tests__/product-map.test.js` 与 `sprints/07280933-product-map-ssot-claude/tests/contract.test.js` 里"line01/02/04须无GP"断言已同步改写，且全绿
- [ ] `golden-path-f1-anchor-smoke.sh` 新建，已加入 `.github/workflows/scripts/smoke-baseline.txt`，CI 中真实跑通
- [ ] CI 全绿
