# 小改动 PrepPRD：抖音获客线索表字段收敛 + 自有账号/视频去重过滤 + 成功触达真实校验

## 改什么

**范围：金诺租户抖音获客线索表**（base `GNuwbzY0da8GP0sv6MGcOTu9ntd`，table `tblTLFj69CflUqSr`），涉及 `services/phone-adb-controller/` 下的采集/写表/触达脚本。

### 1. 字段层（写表字段收敛）
- `push-leads.js`：删除写「抖音昵称/主页链接」合并字段（`nickLink`）；不再写「命中关键词」字段。
- `sort-comments.js`：「昵称」字段改名为「客户昵称」（保留「抖音号」「主页链接」两个独立字段不变）。
- `push-leads.js`：「评论原文」字段改名为「原始评论」。
- 新增独立字段「评论作品视频链接」：从 `harvest-keyword.sh` 已采到的 `VURL` 直接写入新字段，不再和视频标题拼接进「来源视频」文本列。
- 飞书表视图层：隐藏「业务线」列（数据仍写入，供内部过滤用，仅普通用户视图不可见）——通过飞书 Bitable API 调整视图属性完成，非仓库代码改动。
- 「搜索意图」字段不动。

### 2. 采集逻辑层（新增判定）
- 新建自有账号名单配置（文件形式，路径待定，如 `services/phone-adb-controller/config/own-accounts.json`），收敛现有 `next-outreach.js` 硬编码的两个小号 ID + 用户后续补充的完整自有账号清单。
- `harvest-keyword.sh` / `sort-comments.js` 采集时：命中自有账号名单 → 跳过，不再采集该账号的视频/评论。
- 新增「已采集视频」记录（持久化，如本地 JSON/SQLite 或复用飞书配置表记录视频 ID），采集前查重，命中同一视频 ID → 跳过，不重复抓取。
- 明确不做：「对标账号」过滤（用户确认无此需求）。

### 3. 触达层（成功触达真实校验）
- 抖音获客线索表新增「成功触达」字段。
- 判定信号：发送私信时，若界面出现「对方未添加你为好友/消息可能无法送达」类提示 → 判定触达失败，「成功触达」标红/写失败；未出现提示 → 判定触达成功。
- 该判定需同时接入：
  - 老链路 `services/phone-adb-controller/next-outreach.js`（目前只按外部脚本回传 `sent` 字符串直接标"已发送"，无此判定）
  - 新链路 `services/agent/src/handlers/douyin-dm-outreach.ts` + `apps/api/src/services/lead-writer.ts`（已有较严格的"聊天区消息气泡"检测，需要补充/确认是否已覆盖"对方未加好友"提示场景，不够则补上）
- 这是一个真机 UI 信号判定点（decisions e035dad8 判定点范畴），需要在真机上先确认该提示的实际文案/UI 特征，再落判定逻辑。
- **范围边界（设计阶段核实）**：Path 2（Chrome CDP）已有 `sent/limited/failed` 三态，`limited`（私信按钮不可点=仅互关受限）正是"对方未加好友"信号，直接映射到「成功触达」字段即可。老链路依赖的 `douyin-phone-adb` 二进制不在 zenithjoy-workspace 仓库内（真机/独立仓库产物），本仓库改不了它的探测逻辑；老链路本次只能把「成功触达」降级写"待确认"（不冒充"是"），并把设备原始输出透传进「回复结果」备注供人工核实，真正的设备侧探测留给对应仓库后续任务。

## 为什么改
用户日常核对线索表时发现：字段冗余混乱（重复列/易混淆命名）、视频溯源信息缺失、缺少自有账号排重导致误采、"已发送"和"真正送达"混为一谈导致误判触达成功率。

## 关联上下文
- 相关 Journey：智能获客 Line02（金诺租户）
- 代码位置：`services/phone-adb-controller/{push-leads.js, sort-comments.js, next-outreach.js, harvest-keyword.sh}`、`services/agent/src/handlers/douyin-dm-outreach.ts`、`apps/api/src/services/lead-writer.ts`
- 历史决策匹配：无（`decisions/match` 查询无命中）

## 影响范围
- 仅影响金诺租户线索表相关写表/采集/触达脚本，不影响悦升租户（表结构独立，本轮不动）
- 飞书表历史行的旧字段（如「抖音昵称/主页链接」「命中关键词」）会成为历史脏列，本次不做历史数据回填/清洗，只影响新采集行

## 验收标准
- [ ] 新采集的线索行：客户昵称/抖音号/主页链接三列独立、无合并列；评论作品视频链接独立成列；无命中关键词列；评论原文列已改名为原始评论
- [ ] 采集流程遇到自有账号名单命中 → 该账号不产生新线索行（regression test 覆盖）
- [ ] 采集流程遇到已记录过的视频 ID → 不重复产生线索行（regression test 覆盖）
- [ ] Path 2 触达流程遇到"对方未加好友/仅互关受限"（`limited`）→「成功触达」写"否"（regression test 覆盖）
- [ ] 老链路（真机 ADB）触达成功 → 「成功触达」写"待确认"而非"是"，且原始设备输出透传进「回复结果」备注（regression test 覆盖）
- [ ] 已为本次判定点配置 proven-to-fire 守卫（真实制造一次"未加好友"提示场景验证判定生效）
- [ ] CI 全绿
