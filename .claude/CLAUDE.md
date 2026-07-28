# ZenithJoy 开发指南

## 产品分类 SSOT

**产品 App / Line / Golden Path 的分类事实存放在 `product-map/product-map.yaml`，不在本文件中。**

查阅当前分类：
```
product-map/generated/product-map.md
```

校验分类是否漂移：
```bash
npm run product-map:check
```

如需更新分类，修改 `product-map/product-map.yaml` 后运行 `npm run product-map:generate`。

---

## 第零纪律：Walking Skeleton 优先（CRITICAL）

**产品的颗粒度是"用户路径（Journey）"，不是 feature 列表**。所有开发对照 Path 作战图推进。

- Path 作战图见 Notion（链接在 `product-map/generated/product-map.md`）
- 所有 Path 的步骤定义和状态以生成投影为准

### 5 条铁律（违反 = PR 被拒）

1. **每个 PR 必须推进其声明的 Path 对应 golden-path-N-smoke.sh 至少多过一关，或保持其全绿**。
2. **多 Path 可并行启 sprint，但每个 sprint 必须显式声明推进哪条 Path 的哪些 Step**。
3. **新 Feature 默认 thin**。要建 medium/thick 必须通过 /dev 路径C 走 harness 加厚流程。
4. **加厚是"先减肥再增肌"**：升级 thickness 必须两段式 commit。
5. **真机 bug 修复 PR 必须回流 smoke**。

### 调用 harness-planner 前必填 6 问

```
1. 本 sprint 推进哪条 Journey？
2. 涉及几个角色？
3. 推进哪些 Feature？
4. Feature 0 端到端 smoke 跑到哪步？
5. 涉及几种设备/操作系统类型？
6. 是否新增/修改常驻桌面 UI？
```

---

## 开发原则

### 代码质量
- 所有代码必须通过 ESLint 和 TypeScript 检查
- 保持代码简洁、可读、可维护
- 遵循 DRY（Don't Repeat Yourself）原则

### 安全第一
- 永远不要在代码中硬编码敏感信息
- 使用环境变量管理配置
- 所有 API 端点必须有适当的认证和授权

### 性能优化
- 避免不必要的重新渲染
- 优化数据库查询
- 实施适当的缓存策略

---

## 开发工作流

### 功能开发
```bash
git checkout -b feature/your-feature-name
git add .
git commit -m "feat: your feature description"
git push origin feature/your-feature-name
```

### Bug 修复
```bash
git checkout -b hotfix/bug-description
```

---

## API 规范

### RESTful 设计
```
GET    /api/resources
POST   /api/resources
PUT    /api/resources/:id
DELETE /api/resources/:id
```

### 响应格式
```json
{
  "success": true,
  "data": {},
  "message": "操作成功"
}
```

---

## E2E-First 开发规则（CRITICAL）

先定义"完成"长什么样子，再写实现。

- commit-1：写失败的 E2E/smoke test
- commit-2：写实现，让 E2E 通过

---

## 测试要求

- 目标覆盖率: 80%
- 关键业务逻辑: 100%
- 新功能必须先有 E2E，再有实现

---

最后更新: 2026-07-28
版本: 2.0.0（thin bootstrap — 分类事实已迁移至 product-map/product-map.yaml）
