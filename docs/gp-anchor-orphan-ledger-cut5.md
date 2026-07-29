# GP-Anchor 历史无锚 PR 归户台账（刀5，一次性）

- 日期：2026-07-29
- 范围：GP-Anchor 硬闸（`lint-gp-anchor.sh`，PR #1514）上线前最后约 40 个合并 PR（#1445 ~ #1503，2026-07-21 ~ 2026-07-28）
- 性质：人工一次性归户台账，**不做批量数据迁移、不改历史 git 记录**（设计文档 §6/§7 已拍板边界）。准确性以主理人抽查为准。
- 方法：按 PR 标题 + 改动主题人工判断归属 `line_id`；纯 docs/config/test-infra 类归 `none(docs)` / `none(config)` / `none(infra)`。

## 归户结果

| PR | 标题 | 归属 |
|---|---|---|
| #1445 | feat(xian-runner-fleet): runner扩容+一键装清+机器管理双维度展示 | none(infra) |
| #1448 | feat: Staff Hub 员工中心第一刀（Skill验收迁移+Path健康分析） | line00 |
| #1449 | docs(harness): checklist 增加第6问 | none(docs) |
| #1450 | fix(api): Path2触达链路串台/重复触达P0修复 | line02 |
| #1451 | fix(staff-hub): 飞书登录改打白名单路由，修真实权限漏洞 | line00（⚠️飞书登录7连修①） |
| #1452 | [CONFIG] feat(deploy): Staff Hub生产部署——独立容器绑Tailscale IP | line00（⚠️飞书登录7连修②） |
| #1453 | fix(staff-hub): 飞书登录redirect_uri不再强制转https | line00（⚠️飞书登录7连修③） |
| #1456 | [CONFIG] feat(path2): Android Agent 信号上报能力建设 | line02 |
| #1457 | docs(agent-panel): 作战窗全局AI状态面板设计方案落盘 | none(docs) |
| #1458 | fix(staff-hub): 飞书二维码登录补postMessage监听 | line00（⚠️飞书登录7连修④） |
| #1459 | fix(api): feishu-login加日志，定位真机登录失败具体原因 | line00（⚠️飞书登录7连修⑤） |
| #1460 | fix(staff-hub): 飞书授权URL加scope，修email字段为空 | line00（⚠️飞书登录7连修⑥） |
| #1461 | fix(staff-hub): 飞书邮箱字段兼容 enterprise_email 兜底 | line00（⚠️飞书登录7连修⑦） |
| #1462 | fix(staff-hub): 员工登录/鉴权新增 open_id 白名单兜底 | line00（⚠️飞书登录7连修⑧，实数超7仍归同簇） |
| #1463 | fix(api,agent-android): Path2安卓Agent信号上报能力建设 | line02 |
| #1464 | [CONFIG] feat(staff-hub): 加域名访问，隔离模型不变 | none(infra) |
| #1465 | fix(staff-hub): 域名HTTPS端口改9443 | none(infra) |
| #1467 | fix(agent): setup-reset.ps1打包+接线缺口(issue 73a75417) | line02 |
| #1469 | [CONFIG] fix(agent): CI×常驻监听桌面静默握手，消除真机 gate 竞态 | line04 |
| #1478 | fix(agent-ws): 修复安卓Agent WS重连401死循环(Path2验收阻塞) | line02 |
| #1481 | [CONFIG] test(agent): add ROG setup-reset acceptance Harness | none(infra) |
| #1482 | docs: 安卓智能获客设备/系统版本兼容现状清单 | none(docs) |
| #1483 | test(agent): isolate ROG pytest from real desktop | none(infra) |
| #1484 | fix(acquisition): 采集失败原始错误码留证 | line02 |
| #1486 | [INFRA] feat(product-map): 建立版本化机器可验证 Product Map SSOT | none(infra) |
| #1487 | fix(staff): Path4「智能客服」查询改指向整合后的 journey | line00 |
| #1488 | [CONFIG] feat(agent-panel): 作战窗 Agent Panel 刀1 | line00 |
| #1489 | docs(handoffs): 作战窗刀1 handoff 镜像文件 | none(docs) |
| #1490 | fix(zenithjoy): 安卓获客失败路径服务端零留痕 | line02 |
| #1491 | [CONFIG] ci(agent-panel-host): 补windows-latest编译检查 | none(infra) |
| #1492 | docs: handoff for 安卓获客失败路径服务端零留痕修复 | none(docs) |
| #1493 | [CONFIG] feat(ability-acceptance): Staff Hub Ability 验收端到端首刀 | line00 |
| #1494 | [CONFIG] feat(staff): Staff Hub 业务线健康看板（GP3 / line_health） | line00 |
| #1495 | docs: add learning for cp-07281207-staff-line-health-dashboard | none(docs) |
| #1496 | docs: handoff for Staff Hub 业务线健康看板 | none(docs) |
| #1497 | fix(agent-panel): 装机包接线 + 补托盘图标 | line00 |
| #1498 | docs: handoff for 装机包接线+托盘图标 | none(docs) |
| #1499 | [CONFIG] ci(staff-hub): 补齐 staging/production 对称部署 | none(infra) |
| #1500 | fix(api): Dockerfile 拷 product-map/generated 进生产镜像 | none(infra) |
| #1501 | fix(agent-panel): 修复WebView2加载打包网页CORS死角 | line00 |
| #1502 | docs: handoff for WebView2 CORS死角修复+真机验证 | none(docs) |
| #1503 | fix(agent-panel): 收起态灯带补实际颜色 | line00 |

## 归户小结

- line00（工厂/Staff Hub/作战窗）：18 条
- line02（客户智能获客）：9 条
- line04（客户私域客服）：2 条
- none(infra/docs/config)：13 条

## 欠回流 smoke 的债务

`飞书登录7连修`（#1451/#1452/#1453/#1458/#1459/#1460/#1461/#1462，实数8条，归同一簇）是设计文档 §1 点名的典型孤儿案例：连续 8 个真机 bug 修复 PR，没有一条回流 smoke（违反铁律5「真机 bug 修复 PR 必须回流 smoke」）。已开 Brain Issue 追踪该债务：`59e87658-2f7e-4e2e-87f0-5bb13027b388`（`[smoke-debt] staff-hub 飞书登录8连修未回流smoke`）。

其余分类为 line02/line04 的 PR 是否各自回流了对应 golden-path smoke，本次台账不逐条核实（超出刀5工作量边界，见设计文档§6：只做一次性台账+一条债务Issue，不做批量核实）。

## 数据源

`gh pr list --repo perfectuser21/zenithjoy-workspace --state merged --limit 100 --json number,title,mergedAt,url` 过滤 `mergedAt < 2026-07-28T12:00:00Z`（GP-Anchor 硬闸 PR #1514 生效前）。
