# Bug PrepPRD：nightly 真机 wechat-bubble 车道 sparse-checkout 漏 services/agent/wechat-rpa，气泡门连红 17 晚

## 症状
`nightly-real-machine-staging.yml` 的 `wechat-bubble` job 自 2026-07-30 起每晚 failure（上次绿 07-22），每晚自动开 [nightly-red] issue（#1628~#1639）；同 workflow 后续 douyin-read / account-scan 因 `needs: [wechat-bubble]` 全部 cancelled → **Line04 真机健康自 07-30 起完全盲**。rog `C:\Users\Public\zj-bubble-gate.json` 实录：`{"ok":false,"err":"ModuleNotFoundError(\"No module named 'listen_chat'\")","bubble_count":0}`。

## 根因（已确诊）
PR#1596（07-30）为解决 rog 出境网络慢把该 job 的 checkout 改成 sparse-checkout，列表只有 `services/agent/tools`；而 `services/agent/tools/selfcheck_bubbles.py:28-30` 把 `../wechat-rpa` 插进 `sys.path` 并在 328-329 行 `import listen_chat / find_weixin`（其依赖 config/panel/overlay/pii_filter/send_chat/rate_limiter/auto_reply/cs_config_gate/wechat_update_lock 全在 `services/agent/wechat-rpa/` 内）。该目录未 checkout → 脚本必炸 → 与微信/产品无关的 CI 配置回归。

## 关联上下文
- Journey/GP：智能客服 · GP-B 被动接待（passive_reception），锚 `line04/passive_reception keep-green`
- Issue：GitHub #1639（根因已评论）；Brain task 3cec9be4
- 历史决策：PR#1596 决策"真机夜间车道 checkout 加 HK exit-node + sparse-checkout"（保留其意图：只多拉一个目录，不回退整仓 checkout）

## 修法
1. `.github/workflows/nightly-real-machine-staging.yml` wechat-bubble job 的 `sparse-checkout` 增加 `services/agent/wechat-rpa`。
2. 守卫（逻辑接缝 → CI lint）：新增 `.github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh`：解析该 job 的 sparse-checkout 列表，解析 `selfcheck_bubbles.py` 里所有 `sys.path.insert(... "..", "<dir>")` 依赖目录，断言每个依赖目录被 sparse 列表覆盖；接进 `ci-l1-process.yml`。
3. 守卫测试 `.github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh`：用临时 fixture 复现"列表缺 wechat-rpa → lint 红"和"补齐 → 绿"（proven-to-fire）。

## Regression Test 计划
- commit-1（Red）：新增 lint 脚本 + 其 test；lint 对当前 yml 判红（缺 wechat-rpa）。
- commit-2（Green）：yml 补目录 → lint 绿；ci-l1-process.yml 接线。

## 验收标准
- [ ] commit-1 lint 对修前 yml 报红（亲眼见红）
- [ ] commit-2 后 lint 绿、__tests__ 绿、CI 全绿
- [ ] 合并后下一晚 nightly wechat-bubble 不再因 ModuleNotFoundError 失败（或手动 workflow_dispatch 一次验证到 bubble gate 真跑）
