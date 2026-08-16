# 设计：nightly 真机 wechat-bubble 车道 sparse-checkout 依赖守卫

- 日期：2026-08-16
- 类型：bug fix（路径 A）+ 逻辑接缝守卫
- GP 锚：`line04/passive_reception keep-green`
- Brain task：3cec9be4；decision：0affa301；GitHub issue：#1639

## 问题
`nightly-real-machine-staging.yml` 的 `wechat-bubble` job 自 PR#1596（07-30）起用 `sparse-checkout` 只拉 `services/agent/tools`，而它执行的 `services/agent/tools/selfcheck_bubbles.py:28-30` 把 `../wechat-rpa` 插入 `sys.path` 并 `import listen_chat / find_weixin`（其本地依赖 config/panel/overlay/pii_filter/send_chat/rate_limiter/auto_reply/cs_config_gate/wechat_update_lock 全部在 `services/agent/wechat-rpa/` 内，零向上引用）。目录未 checkout → 每晚 `ModuleNotFoundError: No module named 'listen_chat'`（rog `C:\Users\Public\zj-bubble-gate.json` 实录），连红 17 晚，Line04 真机健康信号自 07-30 起全盲。

最小复现：`git archive origin/main services/agent/tools` 单独导出后 import → 报 `listen_chat` 缺失；再导出 `services/agent/wechat-rpa` → `import ok`。

## 方案（选 A）
- A（采用）：sparse 列表增加 `services/agent/wechat-rpa`，保留 PR#1596 的出境网络修法（HK exit-node + sparse），只多拉一个目录。
- B（否）：回退整仓 checkout——重新暴露 rog 出境 ~10KB/s 的 checkout 超时。
- C（否）：把依赖搬进 tools/——破坏 wechat-rpa 单一来源。

## 组件
1. **修复**：`.github/workflows/nightly-real-machine-staging.yml` wechat-bubble job `sparse-checkout` 加一行 `services/agent/wechat-rpa`。
2. **守卫（逻辑接缝 → CI lint）**：`.github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh`
   - 输入：workflow 路径（默认上面那个）、脚本路径（默认 `services/agent/tools/selfcheck_bubbles.py`）。
   - 解析 workflow 里 `wechat-bubble` job 的 `sparse-checkout: |` 块得到目录列表（照 `lint-orphan-gate-alwayson.sh` 的内嵌 python 缩进解析，不依赖 pyyaml）。
   - 解析脚本里所有 `os.path.join(_HERE, "..", "<dir>")` 形态的 sys.path 依赖 → 相对仓根的目录（`services/agent/<dir>`），外加脚本自身目录。
   - 断言每个依赖目录被 sparse 列表某一项前缀覆盖；否则 `::error file=<workflow>::` + 解释 + exit 1。
   - 退出码 0/1，`✅/❌` 输出，失败时打印规则存在原因（PR#1596 / issue #1639）。
3. **守卫测试（proven-to-fire）**：`.github/workflows/scripts/__tests__/lint-nightly-sparse-checkout-deps.test.sh`，照 `lint-smoke-mock-honesty.test.sh` 的 `run_case` 结构：
   - case 1：fixture workflow 只含 `services/agent/tools` + fixture 脚本含 `.. / wechat-rpa` 依赖 → 期望 lint 红。
   - case 2：fixture 列表含 `services/agent/wechat-rpa` → 期望绿。
   - case 3：真实仓库文件（修后）→ 期望绿。
4. **接线**：`ci-l1-process.yml` 三处——新增 job `lint-nightly-sparse-checkout-deps`（照 `lint-wechat-rpa-runner` 块）；加进 `l1-passed.needs`；加进 gate 汇总块。测试加进 `test-realmachine-verify-lane` 的显式列表（该列表除 account-scan 通配外全是硬写，漏加即孤儿测试）。

## 数据流
PR 触发 ci-l1 → lint 读 workflow + 脚本 → 目录集合比对 → 红/绿。nightly 侧无逻辑变化，仅多 checkout 一个目录（约 150 文件，sparse 非 cone 模式前缀匹配含子目录）。

## 错误处理
- workflow/脚本文件不存在 → lint 红（防止有人改名后守卫静默失效）。
- 找不到 `wechat-bubble` job 或其 sparse 块 → lint 红并提示。

## 测试策略
逻辑接缝 → CI test（lint + .test.sh），无环境接缝（真机脚本/PsExec 路径不变）。TDD：commit-1 提交 lint + test（此时对真实 workflow 判红，case3 红）；commit-2 改 workflow + 接线（全绿）。

## 不做
- 不改 selfcheck_bubbles.py 逻辑；不改另两个 job 的 sparse 列表（研究确认它们跑的是真机已装 agent 脚本，不依赖仓内目录）；不处理 rog 上 anaconda python 的 pywinauto 安装状态（既有状态，与本 bug 无关）。

## 验收
- commit-1 后本地跑 lint 对真实 workflow 报红（亲眼见红）；commit-2 后 lint 绿、test 3 case 绿、CI 全绿。
- 合并后 `gh workflow run nightly-real-machine-staging.yml` 一次，wechat-bubble job 不再出现 ModuleNotFoundError（进入真正的气泡门逻辑，成败以真机为准）。
