# Contract — devalue 安全依赖

任务 ddd77603-db31-4b1e-bf8d-b9b2eff2e686。target_environment: local_api。journey_type: dev_pipeline。

## 批准范围

仅root package-lock.json既有devalue节点version/resolved/integrity三字段更新5.8.1→5.9.3，永久真实Buffer/解析/npm audit测试、smoke/baseline及原生合同工件。保Astro ^5.6.2、原audit-gate/allowlist、业务与生产字节。Buffer池保护不等同于普通显式TypedArray backing裁剪。

## E2E 验收（target_environment: local_api）

```bash
set -euo pipefail
bash .github/workflows/scripts/smoke/devalue-security-smoke.sh
bash .github/workflows/scripts/audit-gate.sh
```

通过标准：安装版本与lock一致且排除<=5.9.2官方受影响范围；Buffer单/嵌套视图输出只含自身字节，普通TypedArray及文本/Date/Map/fullArrayBuffer兼容；真正npm audit无devalue high/critical；原全局audit-gate通过。CI/native/正常merge另行留痕，不以本地替代。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 原生入口 | `sprints/10020145-devalue-security/tests/devalue-security.test.mjs` | `native entry verifies patched devalue and actual Buffer serialization` | 最终同fixture对d782 lock与实际5.8.1公平RED9项3pass6fail；/tmp/devalue-security-permanent-red-final.log。初TypedArray裁剪误设与对象表达式括号已纠正，不以夹具假错误充缺陷 |
