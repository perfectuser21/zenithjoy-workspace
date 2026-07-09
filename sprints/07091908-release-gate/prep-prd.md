# 小改动 PrepPRD：刀C — Release Gate（promote 前机器查证据 + 打 release tag）

## 改什么
`promote-all-prod.yml` 加三块（6站2轨模型第⑤站 Release 落地）：
1. **release-gate job**（新，最前）：confirm=PROMOTE 人工确认后，机器查证据——
   - 证据①：deploy-us-vps + deploy-dashboard-staging 最近一次完成 run 必须 success
   - 证据②：nightly-real-machine-staging 最近 2 次完成 run 全 success 且最新 <36h（防 nightly 停摆后拿旧绿放行）
   - `waive_nightly` input：填理由可豁免证据②（纯云轨改动/引导期），豁免大字记入 summary，谁豁免谁负责
2. **promote-backend 加 needs: [release-gate]**——没绿不让点
3. **release-tag job**（新，promote 全成后）：打 `release-YYYYMMDD-N` tag + GitHub Release（--generate-notes 自动含本次 PR 清单）= 回滚锚 + 上线记录

## 为什么改
Release 概念原缺失：promote 是"人工点一下推 staging 最新"，没版本、没证据检查、没记录、回滚无锚。人工放行保持不变（仍须手输 PROMOTE），机器只负责"没绿不让点"。

## 关联上下文
- Brain task 0024b1a1 · decision 待写 · Notion CI 指南 v3 第⑤站
- 依赖刀A（nightly 已上线，首跑绿）——证据②的数据源

## 影响范围
只动 promote-all-prod.yml（dispatch-only，无自动触发），不动单边 promote-prod/promote-dashboard-prod。加 permissions: contents:write(建 release)+actions:read(查 run)。旧 confirm 步骤保留在 promote-backend（双保险）。

## 验收标准
- [ ] yaml 语法有效
- [ ] PR 标题带 [CONFIG]
- [ ] CI 全绿
- [ ] proven-to-fire：merge 后 dispatch 一次 confirm 填错 → gate 拒绝；（真 promote 留给用户下次放行时自然验证）
