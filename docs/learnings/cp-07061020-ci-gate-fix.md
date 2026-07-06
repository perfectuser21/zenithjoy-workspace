# CI 可信化修复：坏 YAML 两年身份 + 真机闸 required 化（2026-07-06，PR #1129）

## 任务简述
两个 workflow（agent-preflight-hardening-e2e / cleanup-merged-artifacts）YAML 结构坏死导致每次 push 秒红无人管；WeChat 真机闸 40+ 次连红但非 required，所有 PR 顶红合并。PR #1129 修复并把 `WeChat CS Gate Passed` 设为第 6 个 required context。

### 根本原因
1. **YAML block scalar 顶格行**：`run: |` 块里 PowerShell here-string 内容/多行 commit message 写在列 0 → 跳出块缩进 → GitHub 无法解析 → run 无 job、以文件路径为名、paths 过滤失效，每 push 一个红。here-string 的正解是内容与 `"@` 终结符都放在**块基准缩进列**（YAML strip 后回行首，PowerShell/python 双约束同时满足），不必消灭 here-string。
2. **红着的非 required workflow = 没有闸**：40+ 次连红没有任何机制把人叫回来；#1105/#1107 顶红合并。闸必须 required 或接告警，二选一，否则等于装饰。
3. **死掉的 workflow 会掩护断言漂移**：它坏死期间产品演化（start.bat preflight 改非阻塞、路由重排、preflight 局部 import），修活后一次性爆出 4 个内容性失败。守卫失效的时间越长，复活成本越高。
4. **required context + paths 过滤不兼容**：required check 必须每个 PR 出结论 → 去 paths 过滤、内部 changes 检测（**三点 diff** `$BASE...$HEAD`，两点会把落后 main 的无关 PR 误判）+ 聚合 job success|skipped 放行。

### 下次预防
- [x] L1 新增 `Lint — Workflow YAML Parse`（required 链内）：所有 workflow 必须可解析，坏 YAML 在 PR 阶段拦死。
- [x] `WeChat CS Gate Passed` 已进 branch protection required contexts（共 6 个，strict=true 保留）。
- [ ] 写 pwsh here-string 进 YAML：内容行放块基准缩进列；f-string 里不用 `\"`（py3.11 反斜杠语法错，bash 会剥、pwsh 不剥）。
- [ ] 新增/修改 `services/agent/wechat-rpa/**` 文件必须同步 rsync `build-modules/line04/wechat-rpa/`（L4 Runtime Gate 有 diff -r 闸）。
- [ ] 改 branch protection 前先读回 `strict` 原值再 PATCH（本次曾误把 strict=true 覆盖成 false，已立即恢复）。
- [ ] 后续 PR（issue e6203ac4）：listen_chat「进程在但主窗口找不到」分支加自愈重启——rog UIA 死区挂 40h 是这次 CI 连红的机器侧根因。
