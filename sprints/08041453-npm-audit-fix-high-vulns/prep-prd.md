# Bug PrepPRD：npm audit gate 全仓库拦截 PR 合并（fast-uri/ip-address/undici 新高危漏洞）

## 症状
`Security Audit`（L3 Code Gate 必需子项，`if: always()` 无条件依赖）失败，报 3 个 allowlist 外的 high 漏洞：`fast-uri`、`ip-address`、`undici`。L3 Code Gate 是分支保护必需 check，此闸红即全仓库任何 PR 都合不进（发现于 PR#1596 的 CI 运行，与该 PR 本身改动无关）。

## 根因
- `fast-uri`、`ip-address`：npm 漏洞库新公布的 CVE，`npm audit fix`（非 --force）即可干净修复，无 semver-major
- `undici`：`node_modules/miniflare/node_modules/undici`，是已在 allowlist 里的 astro→miniflare→wrangler 依赖链的一部分（08-04 npm 漏洞库新公布），修复需 wrangler@4.35.0 semver-major，不能盲升

## 修法
1. `npm audit fix`（非 force）→ 干净解决 fast-uri / ip-address，只改 package-lock.json
2. `undici` 补进 `audit-gate.sh` 的 ALLOWLIST，归入已有的 astro/miniflare/wrangler 升级链条注释，不单独新开 issue（本来就该随 astro 7.x 升级一起解决）

## 关联上下文
- 相关 Issue：npm audit gate 相关 P0（07-27 立案，"新增23个未在allowlist的high漏洞，阻塞全仓库PR合并"，In progress）——本次是同一闸门的最新一批新增漏洞，不是新问题
- 影响面：解除后不仅本 PR，全仓库所有待合并 PR 都会一并解锁

## Regression Test 计划
`bash .github/workflows/scripts/audit-gate.sh .` 本地已验证转绿（见 PR 描述），CI 侧即该脚本本身跑一遍，无需额外测试文件（allowlist 是配置数据不是逻辑代码）。

## 验收标准
- [x] `npm audit fix` 干净修复 fast-uri/ip-address（无 semver-major）
- [x] undici 补进 allowlist，注释说明依赖链和后续删除条件
- [x] 本地跑 audit-gate.sh 验证转绿
- [ ] CI 全绿
