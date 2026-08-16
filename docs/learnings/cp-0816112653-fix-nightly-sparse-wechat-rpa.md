## nightly 真机 wechat-bubble 车道连红 17 晚——sparse-checkout 漏拉 sys.path 依赖目录（2026-08-16）

### 根本原因
PR#1596（07-30）为解决 rog 出境网络（~10KB/s + 间歇建连失败）把 `nightly-real-machine-staging.yml` 的 `wechat-bubble` job 改成 `sparse-checkout: services/agent/tools`，只看了"要跑的脚本在哪个目录"，没看脚本 `services/agent/tools/selfcheck_bubbles.py:28-30` 自己把 `../wechat-rpa` 插进 `sys.path` 并 `import listen_chat / find_weixin`。目录没拉下来 → 每晚 `ModuleNotFoundError("No module named 'listen_chat'")`（rog `C:\Users\Public\zj-bubble-gate.json` 实录），07-30 起连红 17 晚、每晚自动开一个 [nightly-red] issue（#1628~#1639），没人把"ModuleNotFoundError"和"07-30 改了 checkout 方式"对上——因为 `Write-Error` 把报错截成 `ModuleNotFoundError("No mo`，GHA 日志里看不到模块名，只有上 rog 读 json 才看得全。这段时间 Line04 真机健康信号（也是 GP-B 被动接待唯一的夜间真机门）完全是盲的。

### 下次预防
- [x] 守卫：`lint-nightly-sparse-checkout-deps.sh` 机械对账"脚本 `os.path.join(_HERE, ...)` 依赖目录 ⊆ 该 job sparse 列表"，接进 ci-l1 required gate；含变异测试（单/双引号、`|-` 块标量、守卫解析不到时自报红）——守卫失明必须报红而不是放行。
- [ ] 改 checkout 方式（sparse / 换目录 / 换 runner）的 PR，PR body 必须写清"被执行脚本的仓内依赖清单"，reviewer 对着依赖清单核 sparse 列表——不是只核"入口脚本在不在"。
- [ ] nightly-red issue 自动化文案：连续 ≥3 晚同一 job 红时，把失败 step 的最后 20 行原始 stdout（不是 PowerShell `Write-Error` 截断后的）贴进 issue，避免"No mo"这种残缺报错让人放弃归因。
- [ ] 每周 ci-patrol 把"required nightly 连红 ≥3 晚"列为硬伤，而不是当噪音。
