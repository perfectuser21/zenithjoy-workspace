# Learning: 内容产出详情页 — 跨仓库改动管理 + 查看产出从内联到专页

## 背景
ZenithJoy 内容工厂的「查看产出」原为内联展开面板，图片因 URL 构造错误无法显示。需要跳转独立大页面并正确展示文章、文案和图片。

### 根本原因
1. **图片 URL 猜测失败**：原代码用关键词 slug 拼接图片路径，实际文件命名会因特殊字符处理不一致而不匹配。
2. **文章内容未读取**：output 端点只返回状态和猜测 URL，没有读取实际生成的 markdown 文件。
3. **内联展开限制**：同页展开难以展示长文章和多图布局，专页更合适。

### 解决方案
- 前端：`useNavigate` 跳转 `/content-factory/:id/output`，新 `PipelineOutputPage` 含三标签页（文章/文案/图片）+ 阶段状态侧边栏
- 后端（Cecelia Brain）：使用 `existsSync` 扫描真实文件，只返回存在的图片 URL；用 `readdirSync` 找匹配的 content-output 目录

### 下次预防
- [ ] 跨仓库任务（ZenithJoy 前端 + Cecelia Brain）需要分别在两个仓库创建 PR
- [ ] 每个仓库 PR 都需要满足各自 CI 要求（task card、DoD、learning doc）
- [ ] Cecelia `fix:` 前缀 PR 不需要测试文件，`feat:` 前缀需要
- [ ] 依赖文件系统路径的 API 必须先 `existsSync` 验证，禁止猜测文件名
