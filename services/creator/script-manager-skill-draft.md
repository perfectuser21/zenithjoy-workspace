---
id: script-manager
version: 1.0.0
created: 2026-01-30
updated: 2026-01-30
changelog:
  - 1.0.0: 初始版本
---

# Script Manager - 脚本归属管理

全局 Skill，引导脚本放置位置，管理 HR (Cecelia-OS) 和业务 repo 之间的脚本归属。

**触发词**: `/script-manager`, "创建脚本", "迁移脚本到HR"

## 核心原则

```
┌─────────────────────────────────────────┐
│           HR (Cecelia-OS)               │
│  存放：被 N8N/Agent 调用的脚本            │
│  路径：scripts/{repo-name}/xxx.py       │
└─────────────────────────────────────────┘
                    │ 调用
                    ▼
┌─────────────────────────────────────────┐
│           业务 Repo                      │
│  存放：开发工具、临时脚本、未成熟脚本      │
│  路径：scripts/xxx.py                   │
└─────────────────────────────────────────┘
```

## 判断标准

| 问题 | 是 → HR | 否 → 业务 Repo |
|------|---------|---------------|
| 会被 N8N workflow 调用吗？ | ✅ | |
| 会被 Agent (Cecelia/Caramel) 调用吗？ | ✅ | |
| 是通用能力（多个 repo 可用）吗？ | ✅ | |
| 需要定时/自动执行吗？ | ✅ | |
| 只是临时/调试用？ | | ✅ |
| 只在开发时手动运行？ | | ✅ |

## 命令

### /script-manager create
引导创建新脚本，询问归属后在正确位置创建。

### /script-manager migrate <script_path>
将业务 repo 的脚本迁移到 HR。

```bash
/script-manager migrate scripts/sync-notion.py
```

执行：
1. 检测当前 repo 名称
2. 创建 HR 目标目录：Cecelia-OS/scripts/{repo-name}/
3. 复制脚本到 HR
4. 在原位置留下迁移说明
5. 输出 N8N 中应使用的脚本路径

### /script-manager list
显示脚本分布：本地 vs HR

### /script-manager status <script_path>
检查脚本状态和建议

## 路径配置

```
HR_REPO_PATH=/home/xx/dev/Cecelia-OS
HR_SCRIPTS_PATH=$HR_REPO_PATH/scripts
```

## 迁移后结构

```
# 业务 Repo (迁移后)
zenithjoy-creator/
└── scripts/
    └── sync-notion.py.migrated  # 说明文件

# HR Repo
Cecelia-OS/
└── scripts/
    └── zenithjoy-creator/
        └── sync-notion.py       # 实际脚本
```

## 迁移说明文件模板

```markdown
# 此脚本已迁移到 HR (Cecelia-OS)

原脚本：sync-notion.py
迁移时间：2026-01-30
新位置：/home/xx/dev/Cecelia-OS/scripts/zenithjoy-creator/sync-notion.py

## 调用方式

N8N 路径：/home/xx/dev/Cecelia-OS/scripts/zenithjoy-creator/sync-notion.py
```

## 注意事项

1. **数据路径**：迁移后调整为绝对路径
2. **依赖**：确保 HR 环境有所需依赖
3. **权限**：HR 脚本可能需要访问业务 repo 数据
4. **Git**：两个 repo 都要提交
