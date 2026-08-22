# Red 证据 —— 路③ Sprint E · rollup/lookup 聚合（TDD Red 阶段）

合同测试已随 GAN 分支 import 存在于当前分支（relay 常态 TESTS_ALREADY_PRESENT=true）。
Red 阶段：临时还原实现（去掉 rollup 类型登记 + /rollups 端点 + rollup 读服务）后跑合同 4 测试文件，
证明「实现不存在时全红」。跑库 = 本地 zenithjoy_rollup_e2e（全套 migration，含 rollup CHECK）。

```
命令: npm run test:workbench-rollup --workspace apps/api （实现已还原）

 ❯ rollup-degrade.test.ts        (3 tests | 3 failed)
 ❯ rollup-type-check-ddl.test.ts (7 tests | 2 failed，另 5 为「否定断言 400」——
                                   字段类型被整体拒时恰过，属合同测试写法，非实现)
 FAIL rollup-aggregate.test.ts   > A37 聚合值正确性（beforeAll 建 rollup 字段 400 → 全红）
 FAIL rollup-isolation.test.ts   > A38 聚合隔离（/rollups 端点不存在 → 全红）

 Test Files  4 failed (4)
      Tests  5 failed | 5 passed | 10 skipped (20)
```

suite 级 4/4 全红成立：核心行为（聚合值 / org 隔离 / 失效降级 / 正向建字段 / options 落库）全红。
少数 A40 否定断言（期望 400）在字段类型被 normalizeFields 整体拒时恰过，属合同测试断言形态，非实现存在。

## Green（实现完成后）

```
命令: npm run test:workbench-rollup --workspace apps/api （实现完整）

 ✓ rollup-aggregate.test.ts     (7 tests)
 ✓ rollup-isolation.test.ts     (3 tests)
 ✓ rollup-degrade.test.ts       (3 tests)
 ✓ rollup-type-check-ddl.test.ts (7 tests)

 Test Files  4 passed (4)
      Tests  20 passed (20)
```
