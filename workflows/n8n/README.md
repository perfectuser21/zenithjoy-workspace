# N8N 已迁移

N8N 基础设施和 workflow 模板已迁移到 zenithjoy-core。

## 新位置

```
zenithjoy-core/
├── infra/n8n/docker-compose.yml     ← 容器配置
└── data/n8n-templates/              ← Workflow 模板
    ├── cecelia/
    ├── dashboard/
    └── scraper/
```

## 启动 N8N

```bash
cd /home/xx/dev/zenithjoy-core/infra/n8n
docker-compose up -d
```

---
*迁移日期: 2026-01-22*
