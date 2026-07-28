# Agent Policy — Provider-Neutral Guidelines

## 概述

本文档定义 ZenithJoy 系统中 AI Agent（包括 Claude Code、AGENTS.md 描述的自动化 Agent）在处理产品分类相关任务时的行为规范。

## 产品分类访问策略

### 唯一来源原则

任何需要引用产品 App / Line / Golden Path 的 Agent 操作，必须从机器生成的投影读取，不得从内存、上下文或手写文档中提取分类 ID。

**正确做法**：
```bash
# 读取最新分类
cat product-map/generated/product-map.md

# 或以程序方式
node --input-type=module -e "
import { loadAndValidateProductMap } from './scripts/product-map/lib.mjs';
const { map } = await loadAndValidateProductMap();
console.log(JSON.stringify(map, null, 2));
"
```

**禁止做法**：在 prompt、配置或代码中硬编码分类 ID 字面量（如 App ID、Line ID、GP ID）。

### 漂移检测

Agent 在执行依赖分类的任务前，应先执行漂移检测：
```bash
npm run product-map:check
```

若退出码非 0，说明生成文件与 YAML 不一致，应先运行 `npm run product-map:generate`。

## 分类变更流程

见 `product-map/README.md` 的"变更工作流（7 步）"章节。

## Provider 中立性

本系统的 Agent 策略不绑定任何特定 AI Provider。分类结构、验收规则、CI 门禁均以 YAML/JSON 表达，可被任意符合 MCP 或标准工具调用协议的 Agent 消费。

---

最后更新: 2026-07-28
