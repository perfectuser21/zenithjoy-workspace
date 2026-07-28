# AGENTS.md — ZenithJoy Provider Bootstrap

## 产品分类 SSOT

**所有 App / Line / Golden Path 的分类事实存放在 `product-map/product-map.yaml`，不在本文件中。**

查阅当前分类：
```
product-map/generated/product-map.md
```

校验分类是否漂移（每次启动前执行）：
```bash
npm run product-map:check
```

如需更新分类，修改 `product-map/product-map.yaml` 后运行 `npm run product-map:generate`。

---

## 系统概述

ZenithJoy 是一个综合性的业务管理和自动化平台。技术栈详见各子目录 README 和 `DEFINITION.md`。

## Agent 工作原则

1. **分类事实不手写**：任何需要引用产品 App/Line/Golden Path 的地方，从 `product-map/generated/product-map.md` 读取，不复制词汇到本文件。
2. **E2E-First**：每个功能先写 smoke test，再写实现。
3. **Walking Skeleton 优先**：所有开发对照 Path 作战图推进。

## 关键文件路径

| 文件 | 用途 |
|------|------|
| `product-map/product-map.yaml` | 产品分类唯一手写源 |
| `product-map/generated/product-map.md` | 机器生成的分类投影（可读） |
| `product-map/generated/product-map.json` | 机器生成的分类投影（程序消费） |
| `.github/workflows/ci-l2-consistency.yml` | L2 一致性门禁（含 product-map-contract Job） |
| `test-registry.yaml` | 测试注册表 |

## CI 门禁

本仓库的 CI 分 4 层（L1-L4）。分类合同检查在 **L2 product-map-contract** Job 中运行。

---

最后更新: 2026-07-28
