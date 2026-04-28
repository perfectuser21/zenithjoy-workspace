# ZenithJoy CI 补全设计 — 测试质量 lint 门禁 + 部署告警

**日期**：2026-04-27  
**状态**：APPROVED  
**范围**：2 个 PR，仅改 `.github/` 下 workflow 文件和 scripts

---

## 问题

ZenithJoy 当前 CI 缺失三块：

1. **测试质量 lint 门禁全无**：无 feat/test 配对检查、无 TDD 提交顺序检查、无假测试拦截，代码可以不写测试直接合入
2. **部署失败无告警**：`deploy.yml` 挂了没有飞书通知、没有 Brain P0 任务
3. **deploy runner 已失效**：`self-hosted, hk-vps` — HK VPS 8 个 runner 已全部禁用（2026-03-17），部署 CI 实际上永远卡死

---

## 方案

**方案 A（选用）**：复用 Cecelia 的 5 个 lint 脚本，适配 ZenithJoy 路径后集成。

不选方案 B（从头重写）：Cecelia 脚本已生产验证，重写风险大收益小。  
不选方案 C（只加 2 个）：半开门禁制造假安全感。

---

## 实现范围

### PR 1：测试质量 lint 门禁

**新增文件**：
- `.github/workflows/scripts/lint-test-pairing.sh`
- `.github/workflows/scripts/lint-test-quality.sh`
- `.github/workflows/scripts/lint-tdd-commit-order.sh`
- `.github/workflows/scripts/lint-no-fake-test.sh`
- `.github/workflows/scripts/lint-feature-has-smoke.sh`

**修改文件**：
- `.github/workflows/ci-l1-process.yml`：追加 5 个 lint job

**适配说明**：
- 路径：`packages/brain/src` → `apps/api/src` + `apps/dashboard/src`
- 扩展名：`.js` → `.ts`
- lint-test-pairing：ZenithJoy 有顶层 `apps/api/tests/` 目录（区别于 Cecelia 的 `src/__tests__/`），需同时检查两种布局
- lint-feature-has-smoke：smoke 脚本约定路径 `.github/workflows/scripts/smoke/`

**各 lint job 作用**：

| job | 拦什么 |
|-----|--------|
| lint-test-pairing | 新增 `apps/*/src/*.ts` 必须配套同名 `.test.ts` |
| lint-test-quality | 新增 test 文件必须有真行为调用（非纯 readFileSync grep） |
| lint-tdd-commit-order | 含 `apps/*/src/*.ts` 的 commit 之前必须有 `.test.ts` commit |
| lint-no-fake-test | 测试文件不能全是 `.skip` 或空 |
| lint-feature-has-smoke | `feat:` PR 触及 `apps/*/src/` 必须新增 `scripts/smoke/*.sh` |

### PR 2：deploy 修复 + 失败告警

**修改文件**：
- `.github/workflows/deploy.yml`

**改动**：
1. `runs-on: [self-hosted, hk-vps]` → `runs-on: ubuntu-latest`
2. 新增 `on_deploy_failure` job（`if: failure()`）：
   ```
   POST http://38.23.47.81:5221/api/brain/tasks
   {priority: P0, title: "ZenithJoy 部署失败", task_type: "dev"}
   ```
   Brain 地址用公网 IP（`ubuntu-latest` runner 无法访问 localhost）
3. 加 `if: ${{ secrets.DEPLOY_TOKEN != '' }}` guard，无 secret 时 skip 而非 fail

---

## 不在范围内

- Playwright E2E（ZenithJoy dashboard 有页面，但作为独立后续 PR）
- 测试覆盖率门禁（已有 vitest coverage，暂不加阈值）
- deploy.yml 回滚逻辑（超出本次范围）

---

## 测试策略

| 组件 | 测试类型 | 验证方式 |
|------|----------|----------|
| 5 个 lint 脚本 | trivial（纯 bash 逻辑） | 每个配 `.test.sh`，测试"有 test 文件配对通过"和"无 test 文件失败"两个边界 |
| ci-l1-process.yml 新 job | E2E | 真 PR 上触发验证，本地 `act` 补充 |
| deploy.yml runner 迁移 | E2E | 推 PR 后验证 job 能成功 pick up |
| on_deploy_failure smoke | trivial | `.github/workflows/scripts/smoke/deploy-failure-gate-smoke.sh` 验证 yml 含 `on_deploy_failure` 和 Brain 地址 |

---

## DoD

- [ ] [ARTIFACT] `.github/workflows/scripts/lint-test-pairing.sh` 存在
- [ ] [ARTIFACT] `.github/workflows/scripts/lint-test-quality.sh` 存在
- [ ] [ARTIFACT] `.github/workflows/scripts/lint-tdd-commit-order.sh` 存在
- [ ] [ARTIFACT] `.github/workflows/scripts/lint-no-fake-test.sh` 存在
- [ ] [ARTIFACT] `.github/workflows/scripts/lint-feature-has-smoke.sh` 存在
- [ ] [BEHAVIOR] 新 lint jobs 在 ci-l1-process.yml 中可见
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci-l1-process.yml','utf8');if(!c.includes('lint-test-pairing'))process.exit(1)"`
- [ ] [BEHAVIOR] deploy.yml runner 已改为 ubuntu-latest
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/deploy.yml','utf8');if(c.includes('hk-vps'))process.exit(1)"`
- [ ] [BEHAVIOR] deploy.yml 含 on_deploy_failure job
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/deploy.yml','utf8');if(!c.includes('on_deploy_failure'))process.exit(1)"`
