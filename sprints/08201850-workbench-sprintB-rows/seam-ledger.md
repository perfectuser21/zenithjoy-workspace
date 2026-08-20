# 接缝台账 —— 路③ Sprint B（S2 数据进得来）

合同 `## 接缝清单` 的落地记录。**未在真目标上转绿的接缝一律标 `logic-done-pending`，不得标 `done`**：
linux job 的 CI 绿只证明"逻辑对"，证明不了"真浏览器里对"。

| 接缝 | 碰真实世界在哪 | 真目标验证方式 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| S2-1 行级 `version` 乐观锁的并发语义 | Postgres 的 `UPDATE ... WHERE version = $n` 原子性 + 两个真会话真并发 | ① linux job `--a13-only`：两个真 cookie 后台并行发出，断言恰一个 200 一个 409、库值 = 先提交者、version 恰 +1；② windows job 真浏览器里同事改同格 → 冲突提示可见且自己打的内容仍在编辑器 | logic-done-pending | 变异 `A13-version-nocheck` 施加后 `--a13-only` exit=1（`并发结果不是恰一 200 一 409（200 / 200）`）；windows job 判据 = 该 job conclusion == success |
| S2-2 写回失败时前端保留用户输入 | 真浏览器的网络失败（`context.setOffline(true)`）+ React 状态 | windows job 内 Playwright 真断网 → 断言单元格错误态可见且编辑器 DOM 取值逐字等于用户所打内容 → 恢复网络就地重试成功 | logic-done-pending | 本地 chromium 已真跑通过（`@rows-offline`），但**正式判据是 windows job 的 conclusion**，宿主机跑绿不算数 |
| S2-3 AG Grid 32.2.1 在 staff-hub 的渲染/编辑 | 真浏览器 DOM + 真 CSS 主题 | windows-latest 干净 VM 真浏览器跑完整 grid 交互链（编辑 / 冲突 / 断网 / 粘贴 / 行详情 / 上限硬拦） | logic-done-pending | 本地已实证一个**只有真浏览器才照得出**的问题：AG Grid 接管表格 Tab 导航，光靠 `onBlur` 存在"按了 Tab 焦点没离开、于是压根没写回"的死角，编辑器已补 Enter/Tab 提交 |

## 状态口径

- `done` —— 已在**真目标环境**（windows job 真浏览器 / 真 Postgres）转绿，且有可复查的机器判据
- `logic-done-pending` —— 逻辑完成、本地或 linux 车道已验，真目标未转绿
- `logic-done-pending-offsite` —— 真目标在本仓 CI 之外（如生产机），需另行取证

三条接缝的 `logic-done-pending` 由本刀 PR 的 `e2e-knowledge-hub-path3.yml` 跑绿后统一改判，
改判依据是那个 **windows job 的 conclusion**，不是 workflow 总结论（总结论会被 linux job 拉绿）。
