# 安全漏洞记录

## 当前 Moderate 级别漏洞（2026-02-13）

### 1. esbuild <=0.24.2
- **严重性**: moderate
- **问题**: esbuild 允许任何网站向开发服务器发送请求并读取响应
- **影响**: 开发环境安全风险
- **GitHub Advisory**: https://github.com/advisories/GHSA-67mh-4wv8-2f99
- **影响包**: `apps/dashboard/node_modules/esbuild`

### 2. vite 0.11.0 - 6.1.6
- **严重性**: moderate (依赖有漏洞的 esbuild)
- **问题**: 依赖上述 esbuild 漏洞版本
- **影响**: 开发环境安全风险
- **影响包**: `apps/dashboard/node_modules/vite`

## 修复建议

```bash
npm audit fix --force
```

**注意**: 修复会安装 vite@7.3.1，这是一个破坏性变更，需要单独的 PR 进行测试和验证。

## 检查日期

- 记录日期: 2026-02-13
- 检查命令: `npm audit --audit-level=moderate`
- 总漏洞数: 2 个 moderate 级别
