# Learning: cp-04021911-deploy-hk-vps

## 任务总结

新增 `.github/workflows/deploy.yml`，合并到 main 后自动部署 Dashboard 到香港 VPS。

## 关键决策

**自托管 Runner 直接部署**：`hk-zenithjoy-workspace` Runner 本身运行在 HK VPS 上（root 用户），无需 SSH 密钥，直接 rsync 到本地目录。

**Runner 重启**：Runner 于 2026-03-18 停止运行，需要手动 `systemctl start` 恢复。已设置 `enabled`，重启后自动启动。

## 意外问题：macOS-generated package-lock.json 缺少 Linux native 包

### 根本原因

根 `package-lock.json` 在 macOS M4 (arm64) 上生成，缺少 Linux x64 平台特定的 optional native packages：
- `@rollup/rollup-linux-x64-gnu` （rollup/vite 需要）
- `lightningcss-linux-x64-gnu` （lightningcss/tailwindcss 需要）
- `@tailwindcss/oxide-linux-x64-gnu` （@tailwindcss/vite 需要）

这些包在 `package-lock.json` 的 packages 部分没有 `node_modules/` 条目，所以 `npm ci` 不安装它们。

### 解决方案

在 CI 的 `npm ci` 之后，一次性安装所有 3 个缺失包：
```bash
npm install --no-save @rollup/rollup-linux-x64-gnu lightningcss-linux-x64-gnu @tailwindcss/oxide-linux-x64-gnu
```

**lightningcss 特殊处理**：`lightningcss/node/index.js` 通过相对路径 `../lightningcss.linux-x64-gnu.node` 加载 binary，不是通过 require package 名。需要手动复制：
```bash
cp node_modules/lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node node_modules/lightningcss/
```

### 陷阱

- 分两步安装（先 rollup 后 lightningcss）会互相覆盖（npm install 会重新解析 dep tree）。必须合并为一条命令。
- 根 package-lock.json 生成在 macOS → 后续在任何 Linux CI 环境都会复现此问题。长期修复是在 Linux 上重新生成 lock file 或把这些修复固定在 CI 中。

## 产物

- `.github/workflows/deploy.yml`：自动部署 workflow
- `.github/workflows/ci-l3-code.yml`：GeoAI Build 修复
- `.github/workflows/ci-l4-runtime.yml`：Dashboard Test/API Test rollup 修复

## PR

[perfectuser21/zenithjoy-workspace#120](https://github.com/perfectuser21/zenithjoy-workspace/pull/120)
