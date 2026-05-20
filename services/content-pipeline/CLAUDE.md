# ZenithJoy Creator

内容创作工具集

## Skills

### image-gen-workflow

通过 Mac Mini 远程控制 ChatGPT/Gemini 生成高质量配图，自动评分筛选后发送到飞书。

**触发词**: `/image-gen`, "帮我生成配图", "做一张图"

**流程**:
1. 分析参考图风格
2. 构建 prompt (参考图 + 文案 + 指令)
3. 发送到 ChatGPT/Gemini
4. 提取生成的图片
5. Claude 评分 (1-10)
6. ≥8分发送到飞书，<8分重试

**使用示例**:
```
/image-gen
参考图: /path/to/ref.png
文案: 真诚才是流量密码
发送到: 悦升云端
```

详细文档: `skills/image-gen-workflow/SKILL.md`

## 内容体系

### 目录结构

```
content/
├── short-posts/     # 短贴 - 刷存在感
├── deep-posts/      # 深度帖 - 深入分析一个问题
├── broad-posts/     # 广度帖 - 工具清单、指南、多点列举
│
├── newsletters/     # Newsletter - Deep Post 升级
├── explainers/      # 科普长文 - Broad Post 升级
├── videos/          # 视频 - 来源待定
├── audios/          # 音频 - 来源待定
└── flash-cards/     # 闪卡 - 独立类型
```

### 内容类型

| 类型 | 目录 | 说明 | 升级来源 |
|------|------|------|----------|
| **Short Post** | short-posts/ | 简短观点，刷存在感 | - |
| **Deep Post** | deep-posts/ | 深入分析，有论证过程 | - |
| **Broad Post** | broad-posts/ | 工具清单、指南 | - |
| **Newsletter** | newsletters/ | 邮件通讯，深度分发 | Deep Post |
| **Explainer** | explainers/ | 科普长文，讲清一个主题 | Broad Post |
| **Video** | videos/ | 视频成品 | Deep/Broad Post |
| **Audio** | audios/ | 音频（播客等） | Deep/Broad Post |
| **Flash Card** | flash-cards/ | 闪卡 | 独立 |

### 来源标签

每篇内容用 `source` 字段标记来源：
- `source: original` - 用户原创
- `source: ai` - AI 生成

### 数据索引

- `data/works-index.json` - 全部内容索引（自动生成）
- 运行 `python3 scripts/build-works-index.py` 更新索引

## 环境依赖

- Mac Mini (`ssh mac-mini`)
- Chrome debug 模式 (端口 9222)
- ChatGPT/Gemini 已登录
- 飞书客户端已登录
