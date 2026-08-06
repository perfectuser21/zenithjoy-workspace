contract_branch: cp-harness-propose-r3-a29c526c-r00cb3413-a18
sprint_dir: sprints/08061215-productmap-cli-json-r42

# Contract DoD — product-map CLI `check --json`

- [x] [ARTIFACT] `scripts/product-map/cli.mjs` 实现 JSON 模式且单测位于 PRD 允许的 `scripts/product-map/` 范围
- [x] [ARTIFACT] 只修改 PRD 允许的 CLI/测试范围
- [x] [BEHAVIOR] [L2] B-01: JSON 成功结论可被调用方直接解析
- [x] [BEHAVIOR] [L2] B-02: 缺失生成 JSON 返回结构化失败
- [x] [BEHAVIOR] [L2] B-03: 损坏生成 JSON 不泄漏裸异常
- [x] [BEHAVIOR] [L2] B-04: 多个检查问题被完整聚合
- [x] [BEHAVIOR] [L2] B-05: 默认文本输出零回归
- [x] [BEHAVIOR] [L2] B-06: 既有 check 位置参数与新增 JSON 选项并存
