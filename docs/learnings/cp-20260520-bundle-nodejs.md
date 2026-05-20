## 打包内置 Node.js + hyperframes 到 agent install pack（2026-05-20）

### 根本原因

1. **L4 Runtime Gate 从未报告**：`ci-l4-runtime.yml` 中 `l4-passed` job 的 `needs` 列表引用了不存在的 `agent-test` job，导致工作流在 parse 阶段就失败（0s），check 永远不上报，导致 branch protection required check 永远不满足。

2. **agent/package-lock.json 未提交**：根 `.gitignore` 中有 `package-lock.json`，而 `services/agent/package-lock.json` 从未 force-add，CI 里 `npm ci` 因找不到 lockfile 报 EUSAGE 失败。

3. **Publisher 测试需要 Chrome CDP**：`publishers/**/` 下的 `.test.cjs` 文件在 CI（无 Chrome）下全部失败。需要在 CI job 里限定只跑 `src/` 目录。

4. **PR 标题缺 `[CONFIG]` tag**：修改了 `.github/workflows/` 文件但 PR 标题没带 `[CONFIG]`，触发 CI Config Audit 失败。

5. **test-registry.yaml 未同步**：新增 `ensure-hyperframes.test.ts` 没有注册进 `test-registry.yaml`，触发 Orphan Test Check 失败。

### 下次预防

- [ ] 新增 CI job 时，先在本地验证 `needs` 引用的 job 名称全部存在于同一 YAML 文件
- [ ] `services/agent/` 新建或改动后，立即 `git add -f services/agent/package-lock.json` 并检查其是否已提交
- [ ] CI 新增 test job 时，先跑 `vitest run <scope>` 确认本地通过，再限定 CI scope 排除需要真实 Chrome 的 publisher 测试
- [ ] 任何改动 `.github/workflows/` 的 PR 必须在标题加 `[CONFIG]`
- [ ] 新增 `*.test.ts` 文件必须同步更新 `test-registry.yaml`（与 Orphan Test Check lint 联动）
