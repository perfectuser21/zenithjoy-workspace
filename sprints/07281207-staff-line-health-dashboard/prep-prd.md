# PrepPRD：ZenithJoy 运营中枢 — 业务线健康看板（GP3 / Line 健康度看板）

## 本次对话涵盖的所有事项
- [x] 本 PrepPRD 包含：总览页（业务线卡片列表）+ 详情页（部署/能力两个 tab）
- [ ] 另立 Sprint（本次不做）：line01/line02 在 Brain 里补齐真实 journey 结构；product-map 补充 `owned_paths` 字段后再做精确的"关联 PR"筛选；按角色的查看权限
- [ ] 待讨论：各环境 `/version` 健康检查端点（若未来要读真实运行版本而非"最近相关提交"，需要另立技术债）

## Journey 当前状态（ZenithJoy 运营中枢，`636a918c-8b23-4df5-baec-b1eb3308fffb`）
- ✅ 员工工具中心(Staff Tools Hub) — ability，thin，done（`16ac50db-bbc1-4b08-b922-97e251eb57f3`）
- ✅ Dashboard 运营中枢状态矩阵 — feature，thin，done
- ✅ 9平台+3API Session健康全覆盖 — feature，thin，done
- ✅ Product Map SSOT（Ability Acceptance Phase 0A）— feature，PR #1486 已合并
- ➕ **业务线健康看板** — 本次新增 feature，thin

## 本次要做的
给 Staff Hub 加一个新页面：员工一眼看清公司 3 条对外业务线（客户首次成功/客户智能获客/客户私域AI接管）各自的健康状况、部署环境状态、版本、内部能力完成度。业务线清单读权威的 `product-map/generated/product-map.json`（不再自行猜测"有几条线"）。

## Golden Path

1. 员工在 Staff Hub 导航栏点开"业务线健康"总览页 → 系统调用 `GET /api/staff/line-health`，读 `product-map.json` 里 `customer_app` 下的 3 条 line，逐条聚合 Brain journey_features 数据 → 展示 3 张卡片（GP2 PathHealthPage 同款风格）：maturity + done/total + smoke 状态
   - 加载态：3 个骨架卡片占位
   - 边界（line01/line02 在 Brain 里无对应 journey）：卡片显示专门的"未接入 Brain 数据"灰色徽章，**不显示 0/0**（避免员工误读成"做了但零进展"）
   - 失败（单条线 Brain 查询 5xx/timeout）：该卡片单独标"数据暂不可达"，其余线正常展示（沿用 PathHealthPage 现有 per-line 独立降级模式）
   - 失败（product-map.json 缺失/解析错误）：全页降级用代码内置的 3 条线兜底清单渲染 + 顶部 banner 提示
2. 员工点击某条线卡片 → 跳转 `/line-health/:lineKey` 详情页，默认打开「部署」tab → 调用 `GET /api/staff/line-health/:lineKey/deployment`，展示 dev/staging/production 三环境状态 + 按该线相关代码路径过滤出的最近一次 commit sha（UI 文案如实写"最近相关提交"，不写"当前部署版本"）+ 关联 PR 清单（按 PR 标题关键词匹配，清单可能稀疏，为空时显示"暂无标题匹配的近期 PR"而非空白）
   - 边界（点击"未接入"状态的线）：详情页仍可进入，两个 tab 显示"该业务线尚未接入 Brain 数据，暂无法展示"空态
3. 员工切到「能力」tab → 调用 `GET /api/staff/line-health/:lineKey/abilities`，展示该线下 golden path/ability 清单（thickness + status），tab 间错误互相隔离
4. 员工点返回 → 复用总览页已有数据即时展示，后台静默刷新

## 客户视角
员工打开 Staff Hub，点"业务线健康"，一眼看到公司现在 3 条对外业务线分别处于什么阶段、上线到哪个环境、最近谁在改、内部有哪些能力做完了哪些还没做——不用再去问各条线负责人或翻 GitHub。

## 完成后用户能
- 一页看清 3 条对外业务线的整体健康状态
- 点进任意一条线看到部署环境状态 + 最近相关改动
- 看到该线内部能力（ability/golden path）的完成度清单

## 涉及的 Ability / Feature
- 业务线健康看板（新增，thin）— 挂在"员工工具中心(Staff Tools Hub)"ability 下

## 不包含
- line01/line02 在 Brain 里补真实 journey（技术债，另立）
- 按角色的查看权限分级
- 真实运行时版本（`/version` 端点），本次只做"最近相关提交"近似值
- "关联 PR"精确路径过滤（等 product-map 补 `owned_paths` 字段后再加厚）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| line01/02 无 Brain 数据时 UI 状态 | 0/0 显示 / 专门"未接入"态 / 隐藏卡片 | 专门"未接入"态 | 用户拍板：不能报错不能空白，要让员工知道这条线数据没接通 | 0/0 会让员工误读为"完成度0%" |
| Brain 不可达原因判断 | 统一按"暂不可达" / 区分404(无数据)与5xx/timeout(故障) | 区分 | 两者含义完全不同，合并会让员工无法判断该不该报障 | 合并处理会把合法的"未接入"和真故障混淆 |
| "版本"定义 | 全局HEAD / 按线相关路径过滤最近commit / 各环境/version端点 | 按路径过滤最近commit，UI标注"最近相关提交" | 用户拍板 | 用全局HEAD会让三条线数值相同，字段无意义 |
| "关联PR"筛选规则 | 按PR文件路径匹配 / 标题关键词匹配 | 标题关键词匹配（接受稀疏结果） | 用户拍板：product-map当前无owned_paths字段，不做重复维护的本地路径映射 | 漏检率高，但成本可控，且已在UI文案里如实说明"暂无标题匹配" |
| 降级粒度 | 整页失败 / 整卡失败 / 按字段独立 | 按字段独立（commit/PR/smoke各自独立try/catch） | 复用PathHealthPage现有per-line独立降级模式，防止一处GitHub限流拖垮全页 | 粒度太粗会让一次限流拖垮整个面板 |
| GitHub数据缓存 | 不缓存 / 按资源类型分TTL | 按资源类型分TTL（GitHub数据5分钟，Brain数据不缓存或1分钟） | GitHub REST API未认证60次/小时限额，多员工同开会打满 | 不缓存可能导致全公司看不到数据 |
| 查看权限 | 分角色 / 沿用现有白名单 | 沿用现有 staffGuard 白名单，不分角色 | 只读监控页，分角色是本次范围外的额外基建投入 | N/A（低风险，后续可加厚） |

## 前置工作（已核对，无 TBD）

### API 与凭据
- [x] GitHub Actions/REST API — `apps/api/src/routes/staff.ts` 已在用，凭据已就绪
- [x] Brain journey_features API（`localhost:5221/api/brain/journey_features`）— 已就绪，PathHealthPage 同款调用模式可直接复用

### 数据源
- [x] `product-map/generated/product-map.json`（PR #1486 已合并）— 已就绪，作为 3 条业务线清单的权威来源

### 基础设施
- [x] Staff Hub 前端路由体系 — 已就绪，`/line-health/:lineKey` 为新增路由，风格照抄 PathHealthPage 所在体系
- [x] staffGuard 权限中间件 — 已就绪，本次直接复用

## 验收标准（Final E2E）
- [ ] `GET /api/staff/line-health` 返回 3 条业务线（line01/line02/line04），line01/line02 因无 Brain 数据显示"未接入"状态而非报错或空数组
- [ ] `GET /api/staff/line-health/:lineKey/deployment` 对 line04 返回非空 commit sha + 三环境状态
- [ ] `GET /api/staff/line-health/:lineKey/abilities` 对 line04 返回 GP-A~F 六条 ability 及各自 thickness/status
- [ ] 总览页 Playwright E2E：加载 3 张卡片，点击一张进入详情页，两个 tab 均可切换且各自独立渲染数据
- [ ] product-map.json 缺失场景下的降级路径有测试覆盖
- [ ] CI 全绿
