# Red 证据 — 路③ Sprint D · S4 关联连得上

TDD Red 阶段：本刀 4 个合同测试文件真被 vitest 收集、真连 Postgres（`zenithjoy_e2e`，base=Sprint A/B/C 已迁移）、真跑，因 relation 字段类型与两个新端点尚未实现而**真红**。

```
$ E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenithjoy_e2e \
    npx vitest run --config vitest.workbench-relations.config.ts --reporter=dot   # (cwd: apps/api)

 Test Files  4 failed (4)
      Tests  12 failed | 2 passed | 5 skipped (19)
```

## 红在哪、为什么是真红（非环境红）

- **relations-field-and-build.test.ts**：`addRelationField` → `POST /tables/:id/fields {field_type:"relation"}` 当前被 `normalizeFields` 判「不在八类之内」返 400，beforeAll `expect(201)` 失败 → relation 字段类型未登记。
- **relations-bidirectional.test.ts**：`GET .../relation-candidates` 与 `GET /rows/:id/backrefs` 路由未注册 → 404 → `body.data` undefined。
- **relations-isolation-enum.test.ts**：候选端点缺 → 反枚举/读路径二次校验断言拿不到 `data.candidates`；A29② 反向面板端点缺 → 404；导出内联对方标题。
- **relations-integrity.test.ts**：`db_fields.deleted_at` 列未加、字段软删端点 `DELETE /tables/:id/fields/:fieldId` 未实现 → A30 三级全红。
- **2 passed**：`information_schema 里零 %relation% 物理表`（本就该 0，常绿守卫「不新建关联表」不变式）+ 无运行时 DDL 快照（尚无 relation 写入路径，schema 自然不变）。

均为「实现缺失」型红，非「连不上库/夹具签发失败」型红：4 个文件全部成功 import app、成功连 PG、成功签发双企业会话（否则会红在 beforeAll 的 seedTwoTenants 而非业务断言）。

## Green 判据（generator commit-2 后应全绿）

实现 relation 字段类型（migration CHECK + db_fields.deleted_at + FIELD_TYPES + cellTypeError）、两个只读端点、字段软删端点、组织隔离三向、引用完整性三级后，`npm run test:workbench-relations` 应 4 文件全绿、≥18 用例、0 失败。
