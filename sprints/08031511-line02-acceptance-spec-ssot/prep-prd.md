# PrepPRD：客户智能获客路径（line02） — 验收规程 SSOT 文件（发版验收双表 刀1）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：新建 `acceptance-spec/line02-android.yaml`（52格逐格规程 SSOT）+ 生成脚本把员工验收网页从该文件生成，消除"网页即规程"双写
- [ ] 另立 Sprint（本次不做）：刀2 evaluator 发版验收模式机器打表、刀3 对比页+report复活、刀4 稳定性档（随机扰动）——均在 `docs/superpowers/specs/2026-08-03-line02-release-acceptance-dual-table-prd.md` 里已规划，依赖本刀先完成
- [ ] 待讨论：无

## Journey 当前状态（journey afa6abca，"客户智能获客路径"）
- ✅ 8步基础链路（注册/装客户端/Agent连中台/账号扫描/采集/判定/评论/私信）— done
- ✅ golden-path-2-smoke.sh 32步服务端段 — 现全绿
- ✅ 员工验收网页（docs.zenjoymedia.media/line02-android-acceptance-sop/，14步×4格+症状选择题）— 已上线，本次要改的正是它的数据来源
- 🔄 机器管理（客户机器+抖音号绑定）— working（不相关，同 journey 下其它能力，不动）

## 本次要做的
把员工验收网页背后的判据从"硬编码在网页 JS 里"改成"从仓库里一份结构化 YAML 文件生成"，让规程有唯一真相源，为后续机器（evaluator）打同一张表打好接口。

## Golden Path（维护者/主理人操作流程）

1. 研发在 `acceptance-spec/line02-android.yaml` 里定义或修改一格判据（52 格中的一格）→ 生成脚本 `scripts/gen-line02-acceptance-page.js` 读取该文件 → 产出员工验收网页 HTML
2. 主理人打开验收网页（docs.zenjoymedia.media/line02-android-acceptance-sop/）→ 页面上的判据文字、症状选择题选项与 yaml 文件内容逐字一致 → 确认规程来源可追溯（不再是网页作者凭记忆写的）
3. 员工打开网页打勾验收，产出结果 → 结果里每格带 yaml 定义的稳定编号（如 `S07-C1`）→ 该编号可被刀2 的机器表引用对比（本刀不实现对比，只保证编号存在且稳定）

**错误路径**：yaml 缺字段或格式错误 → 生成脚本报错并列出具体缺失字段（如"S05-C3 缺 t 字段"）→ 不会静默发布一个数据缺失的错误页面到文档中心。

## 客户视角
本刀不改变客户/员工可感知的验收网页外观和交互——网页看起来和现在一样。变化在"背后"：判据来源从网页代码变成仓库里可版本管理、可被机器复用的结构化文件。

## 完成后用户能
1. 主理人：改一格判据只需编辑一份 yaml 文件，不用再直接改网页 HTML/JS
2. 主理人：能拿着 yaml 文件核对"网页上写的判据到底对不对"，不用逐行读网页源码
3. （为下一刀铺垫）刀2 的 evaluator 发版验收模式能直接读同一份 yaml，不用另开一套判据定义

## 涉及的 Ability / Feature
- 新增 Feature：`验收规程SSOT(line02安卓)` — thin — 挂 journey afa6abca

## 不包含
- evaluator 机器打表（刀2）
- 对比页、report 复活（刀3）
- 随机扰动稳定性档（刀4）
- 员工验收网页的交互形态/外观改动（本刀网页最终产出应与当前版本视觉/交互一致，只是数据源变了）
- 安卓真机驱动、AI 接管真机段（明确非目标，PRD 已排除）

## 判定点登记表
（本任务无接缝判定点，N/A——纯确定性文件生成，不涉及对模糊现实的判断假设）

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] 不涉及（本刀纯仓库文件 + 静态页面生成，无需登录任何外部账号）

### API 与凭据
- [x] 文档中心部署凭据 — 1Password CS Vault「ZenithJoy 文档中心 (HK docs)」，本会话已验证可用
- [x] hk-vps SSH（发布落位用）— 本会话已实测连通（Tailscale 节点密钥过期已修复，2026-08-03）

### E2E 测试账号
- [x] 不涉及

### 测试 Fixture
- [x] 不需要外部素材；52 格的判据内容来自本会话已产出的员工验收网页现有 14步×4格+症状清单内容，逐格迁移进 yaml 即可（有据可查，非凭空编写）

### 基础设施
- [x] Node.js（生成脚本运行环境）— 仓库已有
- [x] `/data/docs/line02-android-acceptance-sop/` 落位路径 — 已存在且当前版本正常运行

## 验收标准（Final E2E）
- [ ] `acceptance-spec/line02-android.yaml` 存在，含 52 格定义，每格有稳定编号 + 判据原文 + `verifiable_by`（`machine_db` | `machine_visual` | `human_only`）三值枚举之一 + 症状选项数组（不通过时可选的典型症状，沿用当前网页已有的 69 条真实症状清单）
- [ ] 生成脚本存在（`scripts/gen-line02-acceptance-page.js` 或等价），跑一次能从 yaml 产出与当前文档中心页面**内容等价**的 HTML（14 步、4 格、症状选择题、证据快捷键、判定汇总逻辑全部保留）
- [ ] 生成脚本对缺字段的 yaml 输入能明确报错（而不是生成半残页面）——单测覆盖至少 1 个"缺字段"负例
- [ ] 生成出的 HTML 通过 `node --check` 语法自检 + 可见文本无英文残留自检（复用本会话已验证过的两条自检脚本逻辑）
- [ ] 生成出的 HTML 部署到 `docs.zenjoymedia.media/line02-android-acceptance-sop/` 后，公网真实可访问（401 无凭据 / 200 带凭据）且核心交互（判定按钮点击、状态汇总、生成结论文字）用真实浏览器点击验证通过
- [ ] CI 全绿
