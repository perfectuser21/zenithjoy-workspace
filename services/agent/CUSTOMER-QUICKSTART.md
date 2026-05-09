# ZenithJoy Agent — 客户快速上手

> Sprint 2.1e 起改用 install pack 一键体验。本文件保留为 backstage doc。

## 启动方式（推荐）

下载 install pack（dashboard https://autopilot.zenjoymedia.media/dashboard/agent 的"下载完整安装包"按钮）→ 解压 → 编辑 .env 填 license → 双击 `start.bat`。

详见 install pack 内的 `README-1分钟跑通.txt`。

## 高级（开发者本地跑）

```bash
git clone <repo> && cd services/agent
npm install
npm run build
node dist/index.js
```

需要 Node 20+，环境变量同 install pack 的 .env.template。
