---
id: kr1-technical-design
version: 1.0.0
created: 2026-02-06
updated: 2026-02-06
changelog:
  - 1.0.0: 初始版本 - KR1 AI 内容生产流水线技术设计
---

# KR1: AI 内容生产流水线 — 技术设计文档

**目标**: 月产能 240 条 AI 内容（日均 8 条）

**项目路径**: `/home/xx/perfect21/zenithjoy/creator`
**文档日期**: 2026-02-06
**状态**: 设计完成，待实施

---

## 执行摘要

基于对 zenithjoy-creator 项目的深度调研，**系统已具备 240/月产能的技术基础**。当前瓶颈不在生产能力，而在自动化和调度。通过 **43 小时的自动化改造**，可在 2 周内达成目标。

### 核心发现

| 指标 | 当前状态 | 目标 | 差距 |
|------|---------|------|------|
| 月产能 | 150-200 条（手动） | 240 条（自动） | -3% |
| 内容类型 | 5 种（Deep/Short/Broad/Newsletter/Explainer） | 保持 | ✅ |
| 发布平台 | 1/10（仅今日头条） | 5-10 平台 | 需扩展 |
| 自动化程度 | 30%（部分脚本） | 90%（端到端） | 需提升 |
| 质量保证 | 人工审核 | 自动评分 + 人工抽查 | 需建立 |

**关键洞察**: 系统**不缺生产力，缺自动化**。35 篇内容 + 配图仅需 50 分钟，但需要人工触发和监控。

---

## 1. 系统现状分析

### 1.1 技术栈

| 层级 | 技术 | 状态 | 说明 |
|------|------|------|------|
| **内容生成** | NotebookLM (Google) | ✅ 可用 | 手动触发，5 篇/2 分钟 |
| **图片生成** | ChatGPT DALL-E 3 + Gemini | ✅ 生产级 | 通过 Mac Mini CDP，60 秒/图 |
| **发布系统** | Toutiao CDP 自动化 | ✅ 100% 成功率 | 已测试 3/3 成功 |
| **数据库** | SQLite | ✅ 可用 | 153 条内容，需迁移到 PostgreSQL |
| **后端 API** | FastAPI (21 端点) | ✅ 生产级 | 端口 8899 |
| **工作流编排** | N8N + Python | ⚠️ 部分实现 | 有 7 节点工作流，需扩展 |
| **基础设施** | US VPS + Mac Mini + Node PC + HK VPS | ✅ 全通 | Tailscale 内网 |

### 1.2 已有能力

#### 内容生成（Skill: deep-post-generator v1.0.0）

**流程**:
```
NotebookLM 生成 5 篇 (2 分钟)
  ↓
批量生成配图 35 张 (35 分钟)
  ↓
输出: 35 篇 Deep Post + 35 张 9:16 配图
```

**性能**:
- 5 篇内容: 2 分钟
- 1 张配图: 60 秒
- **35 篇完整内容: 50 分钟**（串行）

**质量标准**:
- 内容: 5-8 句，清晰观点，社交就绪
- 配图: 1080x1920，深色渐变，金色标题

#### 发布系统（Skill: toutiao-publisher v2.0.0）

**已验证发布**:
1. "别把存档当成学会" (159 字) ✅
2. "礼貌的暴政" (140 字) ✅
3. "穷忙的快感" (156 字) ✅

**成功率**: 100% (3/3)

**技术实现**:
- 通过 Tailscale 连接 Node PC (100.97.242.124:19226)
- Chrome DevTools Protocol 自动填充
- 自动点击发布按钮

**速度**: 单篇 5 秒

#### 数据管理

**SQLite Schema**:
- `works`: 153 条内容元数据
- `platforms`: 10 个平台定义（仅今日头条已实现）
- `publications`: 发布记录
- `metrics`: 数据追踪（待实现）
- `variants`: A/B 测试变体（待实现）

**已定义平台**:
1. 小红书 (Xiaohongshu)
2. 抖音 (Douyin)
3. 快手 (Kuaishou)
4. 视频号 (Shipinhao)
5. X (Twitter)
6. **今日头条 (Toutiao)** ✅ 已实现
7. 微博 (Weibo)
8. 公众号 (WeChat)
9. 知乎 (Zhihu)
10. B站 (Bilibili)

### 1.3 识别的差距

| 差距 | 影响 | 优先级 | 工作量 |
|------|------|--------|--------|
| **NotebookLM 手动触发** | 🔴 高 | P0 | 6 小时 |
| **缺乏发布调度** | 🔴 高 | P0 | 6 小时 |
| **单平台发布** | 🔴 高 | P0 | 19 小时 |
| **无编辑日历** | 🟡 中 | P1 | 4 小时 |
| **质量人工审核** | 🟡 中 | P1 | 8 小时 |
| **SQLite 扩展性** | 🟢 低 | P2 | 10 小时 |
| **无数据分析** | 🟢 低 | P2 | 12 小时 |

---

## 2. 技术架构设计

### 2.1 目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│                   AI Content Production Pipeline                 │
│                         (240 pieces/month)                       │
└─────────────────────────────────────────────────────────────────┘

                        ┌──────────────────┐
                        │  Notion Calendar │  ← 30天编辑日历
                        │  (Topics Queue)  │
                        └────────┬─────────┘
                                 │
                        ┌────────▼─────────┐
                        │   N8N Scheduler  │  ← Cron: 每日 6AM
                        │  (Orchestrator)  │
                        └────────┬─────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 │               │               │
        ┌────────▼────────┐ ┌───▼────────┐ ┌───▼────────┐
        │ Content Gen     │ │ Image Gen  │ │ Publisher  │
        │ (NotebookLM +   │ │ (ChatGPT)  │ │ (Multi-    │
        │  Claude)        │ │            │ │  Platform) │
        └────────┬────────┘ └───┬────────┘ └───┬────────┘
                 │              │              │
                 └──────┬───────┴──────┬───────┘
                        │              │
                ┌───────▼──────────────▼───────┐
                │   PostgreSQL Database        │
                │   (Works, Publications,      │
                │    Metrics, Variants)        │
                └──────────────────────────────┘
                        │
                ┌───────▼────────┐
                │  Analytics     │  ← 每日 8PM
                │  Dashboard     │
                └────────────────┘
```

### 2.2 组件设计

#### 2.2.1 内容生成引擎

**设计方案**: 混合自动化（Claude + NotebookLM）

```python
# content_generator.py

class ContentGenerator:
    """
    自动内容生成引擎
    """

    async def generate_daily_batch(self, date: str) -> List[Post]:
        """
        每日生成一批内容

        流程:
        1. 从 Notion 获取今日主题（2-3 个）
        2. Claude 生成 5 个概念（每个主题）
        3. NotebookLM 润色和扩展
        4. 保存到数据库（status=draft）
        """
        topics = await self.notion.get_topics_for_date(date)

        posts = []
        for topic in topics:
            # Claude 快速生成概念
            concepts = await self.claude.generate_concepts(
                topic=topic,
                count=5,
                style="XXIP"  # 陌生化原则
            )

            # NotebookLM 润色（可选，如有 API）
            if self.notebooklm_available:
                refined = await self.notebooklm.refine_batch(concepts)
            else:
                refined = concepts

            posts.extend(refined)

        # 保存到数据库
        await self.db.save_posts(posts, status="draft")
        return posts

    async def generate_images(self, posts: List[Post]) -> List[Image]:
        """
        批量生成配图

        架构: US VPS → HK VPS SSH → Mac Mini CDP → ChatGPT
        """
        images = []

        for post in posts:
            # 构建 prompt
            prompt = self.build_image_prompt(post)

            # 调用 ChatGPT（通过 SSH 隧道）
            image = await self.chatgpt.generate_image(
                prompt=prompt,
                reference="assets/cards/reference-match-v6.png",
                size="1080x1920"
            )

            # Claude 质量评分
            score = await self.claude.score_image(
                image_path=image.path,
                criteria=["style", "clarity", "aesthetics", "professional"]
            )

            # 重试逻辑
            if score < 8:
                image = await self.retry_with_refined_prompt(prompt, image)

            images.append(image)

        return images
```

**关键决策**:
- **NotebookLM 手动 vs API**: 如果 NotebookLM 无 API，使用 Claude 完全代替
- **并行 vs 串行**: 图片生成可 2-3 并发（多账号），但当前串行已满足需求
- **质量门槛**: 图片 ≥8/10，内容 ≥7/10

#### 2.2.2 多平台发布器

**设计模式**: 适配器模式 (Adapter Pattern)

```python
# platform_publisher.py

from abc import ABC, abstractmethod

class PlatformPublisher(ABC):
    """
    平台发布器抽象基类
    """

    @abstractmethod
    async def format_content(self, work: Work) -> dict:
        """格式化内容（标题、正文、图片）"""
        pass

    @abstractmethod
    async def upload_image(self, image_path: str) -> str:
        """上传图片，返回 URL"""
        pass

    @abstractmethod
    async def publish(self, formatted: dict, image_url: str) -> Publication:
        """发布内容，返回发布记录"""
        pass


class ToutiaoPublisher(PlatformPublisher):
    """
    今日头条发布器（已实现）
    """

    async def format_content(self, work: Work) -> dict:
        return {
            "title": work.title[:50],  # 今日头条限制 50 字
            "content": work.content[:2000],  # 限制 2000 字
        }

    async def publish(self, formatted: dict, image_url: str) -> Publication:
        # 调用现有 scripts/publish-to-toutiao.py
        result = await self.cdp_publish(
            title=formatted["title"],
            content=formatted["content"],
            image=image_url
        )
        return Publication(platform="toutiao", url=result.url)


class XiaohongshuPublisher(PlatformPublisher):
    """
    小红书发布器（待实现）
    """

    async def format_content(self, work: Work) -> dict:
        return {
            "title": work.title[:20],  # 小红书标题更短
            "content": work.content[:1000],
            "hashtags": self.extract_hashtags(work.tags)
        }

    async def publish(self, formatted: dict, image_url: str) -> Publication:
        # 需研究小红书 API/CDP
        # 优先使用 API，备选 CDP 自动化
        pass


class DouyinPublisher(PlatformPublisher):
    """
    抖音发布器（待实现）
    """
    # 抖音主要是视频，图文内容可能需要转换
    pass


class MultiPlatformPublisher:
    """
    多平台发布协调器
    """

    def __init__(self):
        self.publishers = {
            "toutiao": ToutiaoPublisher(),
            "xiaohongshu": XiaohongshuPublisher(),
            "douyin": DouyinPublisher(),
            "weibo": WeiboPublisher(),
            "wechat": WeChatPublisher(),
        }

    async def publish_to_all(self, work: Work, platforms: List[str]):
        """
        一键发布到多平台
        """
        results = []

        for platform in platforms:
            publisher = self.publishers[platform]

            try:
                # 格式化
                formatted = await publisher.format_content(work)

                # 上传图片
                image_url = await publisher.upload_image(work.image_path)

                # 发布
                publication = await publisher.publish(formatted, image_url)

                # 记录到数据库
                await self.db.save_publication(work.id, publication)

                results.append(publication)
            except Exception as e:
                logger.error(f"Failed to publish to {platform}: {e}")
                # 记录失败，稍后重试
                await self.db.mark_failed(work.id, platform, str(e))

        return results
```

**实施优先级**:
1. **今日头条** ✅ 已完成
2. **小红书** (200M+ 用户) - 3 小时
3. **抖音** (300M+ 用户) - 3 小时
4. **微博** (600M+ 用户) - 2 小时
5. **公众号** (1B+ 用户) - 3 小时

**总工作量**: 11 小时（4 个新平台）

#### 2.2.3 工作流编排（N8N）

**端到端自动化工作流**

```yaml
# N8N Workflow: Daily Content Production Pipeline

节点 1: Cron Trigger
  时间: 每日 6:00 AM
  触发: 开始内容生成

节点 2: Notion Query
  查询: 获取今日主题（status=pending）
  输出: 2-3 个主题

节点 3: Content Generation (Webhook)
  调用: POST http://localhost:8899/api/generate-batch
  参数: { topics: [...], count: 8 }
  输出: 8 篇草稿内容

节点 4: Image Generation (Webhook)
  调用: POST http://localhost:8899/api/generate-images
  参数: { work_ids: [...] }
  输出: 8 张配图

节点 5: Quality Check
  调用: POST http://localhost:8899/api/quality-check
  逻辑:
    - 内容评分 ≥7/10
    - 图片评分 ≥8/10
    - 不合格 → 重新生成

节点 6: Update Notion
  更新: 主题状态 pending → ready
  记录: 生成时间、内容 ID

节点 7: Notification
  通知: 飞书/邮件
  内容: "今日内容已生成: 8 篇"
```

```yaml
# N8N Workflow: Daily Publishing Scheduler

节点 1: Cron Trigger
  时间: 每日 10:00 AM, 4:00 PM (分两批发布)
  触发: 开始发布流程

节点 2: Query Ready Content
  查询: SELECT * FROM works WHERE status='ready' LIMIT 4
  输出: 4 篇待发布内容

节点 3: Multi-Platform Publish (Loop)
  遍历: 每篇内容
  平台: [toutiao, xiaohongshu, douyin, weibo, wechat]
  调用: POST http://localhost:8899/api/publish-multi
  参数: { work_id, platforms: [...] }

节点 4: Update Status
  更新: work.status = 'published'
  记录: publication 表

节点 5: Notification
  通知: 飞书/邮件
  内容: "已发布 4 篇到 5 个平台"
```

**N8N 实施工作量**: 6-8 小时

#### 2.2.4 质量保证系统

**自动评分 + 人工抽查**

```python
# quality_assurance.py

class QualityAssurance:
    """
    自动质量保证系统
    """

    async def score_content(self, content: str) -> ContentScore:
        """
        内容质量评分（Claude 自动评分）
        """
        prompt = f"""
        评分标准（1-10）:

        1. 结构清晰 (20%): 是否有明确的 3-5 个论点
        2. Hook 强度 (25%): 开头是否吸引人
        3. 观点明确 (20%): 是否有清晰立场
        4. 社交就绪 (20%): 是否适合社交媒体
        5. 原创性 (15%): 是否避免陈词滥调

        内容:
        {content}

        返回 JSON: {{"score": 8.5, "breakdown": {{}}, "suggestions": []}}
        """

        result = await self.claude.analyze(prompt)
        return ContentScore(**result)

    async def score_image(self, image_path: str, text: str) -> ImageScore:
        """
        图片质量评分（Claude Vision）
        """
        prompt = f"""
        评分标准（1-10）:

        1. 视觉一致性 (30%): 是否符合品牌风格
        2. 文字清晰度 (25%): 标题和正文是否易读
        3. 美学吸引力 (25%): 整体视觉效果
        4. 专业感 (20%): 是否看起来专业

        文案: {text}

        返回 JSON: {{"score": 9.0, "breakdown": {{}}, "suggestions": []}}
        """

        result = await self.claude.analyze_image(image_path, prompt)
        return ImageScore(**result)

    async def auto_retry(self, work_id: str):
        """
        自动重试低分内容
        """
        work = await self.db.get_work(work_id)

        content_score = await self.score_content(work.content)
        if content_score.score < 7:
            # 重新生成内容
            new_content = await self.content_gen.regenerate(work)
            await self.db.update_work(work_id, content=new_content)

        image_score = await self.score_image(work.image_path, work.content)
        if image_score.score < 8:
            # 重新生成图片
            new_image = await self.image_gen.regenerate(work)
            await self.db.update_work(work_id, image_path=new_image)
```

**人工抽查流程**:
- 每日抽查 2-3 篇（25%）
- 通过 Notion 界面标记质量问题
- 累积反馈训练评分模型

**工作量**: 8 小时（评分系统）+ 每日 10 分钟（人工抽查）

#### 2.2.5 编辑日历（Notion）

**数据库 Schema**

```
Notion Database: Editorial Calendar

字段:
- Date (日期): 2026-02-07
- Topic (主题): "AI 学习陷阱"
- Content Type (类型): Deep Post / Short Post
- Status (状态): Pending / Generating / Ready / Published
- Target Platforms (平台): 多选（小红书、抖音、微博...）
- Priority (优先级): P0 / P1 / P2
- Tags (标签): AI, 学习, 效率
- Notes (备注): 目标受众、关键信息

视图:
- 日历视图: 30 天滚动规划
- 看板视图: 按状态分类
- 表格视图: 全量数据
```

**自动化集成**

```python
# notion_calendar.py

class EditorialCalendar:
    """
    Notion 编辑日历集成
    """

    async def get_topics_for_date(self, date: str) -> List[Topic]:
        """
        获取指定日期的主题
        """
        query = {
            "filter": {
                "and": [
                    {"property": "Date", "date": {"equals": date}},
                    {"property": "Status", "select": {"equals": "Pending"}}
                ]
            }
        }

        results = await self.notion.databases.query(
            database_id=self.calendar_db_id,
            **query
        )

        return [self.parse_topic(page) for page in results["results"]]

    async def update_status(self, topic_id: str, status: str):
        """
        更新主题状态
        """
        await self.notion.pages.update(
            page_id=topic_id,
            properties={
                "Status": {"select": {"name": status}},
                "Updated": {"date": {"start": datetime.now().isoformat()}}
            }
        )

    async def plan_next_30_days(self):
        """
        规划未来 30 天主题（人工 + AI 辅助）
        """
        # 分析历史高表现主题
        top_topics = await self.analytics.get_top_topics(limit=10)

        # Claude 生成主题建议
        suggestions = await self.claude.suggest_topics(
            past_topics=top_topics,
            target_count=30,
            categories=["AI", "效率", "认知", "创作"]
        )

        # 创建到 Notion
        for i, topic in enumerate(suggestions):
            await self.notion.pages.create(
                parent={"database_id": self.calendar_db_id},
                properties={
                    "Date": {"date": {"start": (datetime.now() + timedelta(days=i)).isoformat()}},
                    "Topic": {"title": [{"text": {"content": topic.title}}]},
                    "Status": {"select": {"name": "Pending"}},
                    "Priority": {"select": {"name": topic.priority}}
                }
            )
```

**工作量**: 4 小时（Notion 集成）+ 1 小时/周（人工规划）

#### 2.2.6 数据库迁移（SQLite → PostgreSQL）

**迁移原因**:
- SQLite 不支持多服务器同步
- PostgreSQL 支持并发写入
- 更强大的查询和分析能力

**Schema 映射**

```sql
-- PostgreSQL Schema

-- 内容表
CREATE TABLE works (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    type TEXT NOT NULL,  -- deep-post, short-post, broad-post, newsletter, explainer
    content TEXT,
    excerpt TEXT,
    word_count INTEGER,
    tags JSONB,  -- PostgreSQL 原生 JSON
    source TEXT DEFAULT 'ai',  -- original | ai
    image_path TEXT,
    image_score FLOAT,  -- 图片质量评分
    content_score FLOAT,  -- 内容质量评分
    status TEXT DEFAULT 'draft',  -- draft | ready | published | archived
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 平台表
CREATE TABLE platforms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,  -- toutiao, xiaohongshu, douyin
    name TEXT NOT NULL,
    icon TEXT,
    api_enabled BOOLEAN DEFAULT false,
    cdp_enabled BOOLEAN DEFAULT false,
    sort_order INTEGER,
    config JSONB  -- 平台特定配置
);

-- 发布记录
CREATE TABLE publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID REFERENCES works(id) ON DELETE CASCADE,
    platform_id UUID REFERENCES platforms(id) ON DELETE CASCADE,
    variant_id UUID,  -- 关联 variants 表（A/B 测试）
    published_at TIMESTAMPTZ DEFAULT NOW(),
    url TEXT,
    status TEXT DEFAULT 'published',  -- published | failed | deleted
    error_message TEXT,  -- 失败原因
    retry_count INTEGER DEFAULT 0,
    UNIQUE(work_id, platform_id)
);

-- 数据指标（每日快照）
CREATE TABLE metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id UUID REFERENCES publications(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    followers_gained INTEGER DEFAULT 0,
    engagement_rate FLOAT,  -- (likes + comments + shares) / views
    UNIQUE(publication_id, date)
);

-- A/B 测试变体
CREATE TABLE variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID REFERENCES works(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT,
    hook_type TEXT,  -- hook | angle | emotion | case
    created_at TIMESTAMPTZ DEFAULT NOW(),
    used_count INTEGER DEFAULT 0,
    avg_engagement FLOAT  -- 平均互动率
);

-- 索引
CREATE INDEX idx_works_status ON works(status);
CREATE INDEX idx_works_created ON works(created_at DESC);
CREATE INDEX idx_publications_work ON publications(work_id);
CREATE INDEX idx_publications_platform ON publications(platform_id);
CREATE INDEX idx_metrics_date ON metrics(date DESC);
```

**迁移脚本**

```python
# scripts/migrate-to-postgres.py

import sqlite3
import asyncpg
from uuid import uuid4

async def migrate():
    # 连接数据库
    sqlite_conn = sqlite3.connect('data/creator.db')
    pg_conn = await asyncpg.connect(
        host='43.154.85.217',  # HK VPS PostgreSQL
        port=5432,
        user='zenithjoy',
        password=os.getenv('POSTGRES_PASSWORD'),
        database='creator'
    )

    # 迁移 works
    sqlite_works = sqlite_conn.execute('SELECT * FROM works').fetchall()
    for work in sqlite_works:
        await pg_conn.execute('''
            INSERT INTO works (id, title, type, content, tags, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
        ''', uuid4(), work[1], work[2], work[3], json.dumps(work[6]), work[11])

    # 迁移 platforms
    # 迁移 publications
    # ...

    print("Migration complete!")

asyncio.run(migrate())
```

**工作量**: 10 小时（包括测试和验证）

---

## 3. 实施路线图

### Phase 1: 基础自动化（Week 1）- 达到 100/月

**目标**: 单平台全自动化

| 任务 | 工作量 | 依赖 | 交付物 |
|------|--------|------|--------|
| 1.1 内容生成自动化 | 6h | NotebookLM | Topic → Content Pipeline |
| 1.2 N8N 发布调度 | 6h | N8N | 每日定时发布 |
| 1.3 Notion 编辑日历 | 4h | Notion API | 30 天主题规划 |
| 1.4 质量评分系统 | 8h | Claude Vision | 自动 QA |
| **小计** | **24h** | | **100 篇/月（今日头条）** |

**验收标准**:
- ✅ 每日 6AM 自动生成 8 篇内容 + 配图
- ✅ 每日 10AM/4PM 自动发布到今日头条
- ✅ 质量评分 ≥7/10（内容）、≥8/10（图片）
- ✅ Notion 日历显示未来 30 天主题

---

### Phase 2: 多平台扩展（Week 2）- 达到 240/月

**目标**: 5 平台同步发布

| 任务 | 工作量 | 依赖 | 交付物 |
|------|--------|------|--------|
| 2.1 小红书发布器 | 3h | API/CDP 研究 | XiaohongshuPublisher |
| 2.2 抖音发布器 | 3h | API/CDP | DouyinPublisher |
| 2.3 微博发布器 | 2h | API | WeiboPublisher |
| 2.4 公众号发布器 | 3h | 公众号账号 | WeChatPublisher |
| 2.5 多平台编排器 | 8h | 2.1-2.4 | MultiPlatformPublisher |
| **小计** | **19h** | | **240 篇/月（5 平台）** |

**验收标准**:
- ✅ 单次发布到 5 个平台成功率 ≥90%
- ✅ 每平台每日 8 篇内容
- ✅ 发布记录写入数据库

---

### Phase 3: 运营优化（Week 3）- 数据驱动

**目标**: 建立数据反馈循环

| 任务 | 工作量 | 依赖 | 交付物 |
|------|--------|------|--------|
| 3.1 PostgreSQL 迁移 | 10h | PostgreSQL 服务器 | 新数据库 |
| 3.2 分析仪表板 | 12h | Metrics 数据 | 实时数据看板 |
| 3.3 性能反馈循环 | 6h | 3.2 | 自动优化主题 |
| **小计** | **28h** | | **数据驱动优化** |

**验收标准**:
- ✅ PostgreSQL 存储所有历史数据
- ✅ 仪表板显示每日/每周/每月数据
- ✅ 自动识别高表现主题

---

### Phase 4: 高级功能（Week 4+）- 可选

| 功能 | 工作量 | 价值 |
|------|--------|------|
| A/B 测试框架 | 8h | 优化转化率 |
| 受众细分 | 6h | 精准投放 |
| 最佳发布时间 | 8h | 提高曝光 |
| 视频/音频扩展 | 16h | 新内容形式 |

---

## 4. 资源需求

### 4.1 基础设施（全部已有）

| 资源 | 当前状态 | 用途 |
|------|---------|------|
| US VPS (146.190.52.84) | ✅ 运行中 | Claude Code、N8N |
| HK VPS (43.154.85.217) | ✅ 运行中 | PostgreSQL、SSH 网关 |
| Mac Mini | ✅ 可用 | ChatGPT CDP（图片生成）|
| Node PC (Tailscale) | ✅ 可用 | 今日头条发布 |
| Tailscale VPN | ✅ 配置完成 | 内网互联 |

**无需新增硬件**

### 4.2 API 和服务

| 服务 | 状态 | 用途 |
|------|------|------|
| NotebookLM | ✅ 已登录 | 内容生成 |
| Claude API | ✅ 可用 | 质量评分、概念生成 |
| ChatGPT | ✅ 已登录 | 图片生成 |
| Notion API | ✅ Token 已配置 | 编辑日历 |
| 今日头条 | ✅ 账号已登录 | 发布平台 |
| 小红书 | ⏳ 需研究 | 发布平台 |
| 抖音 | ⏳ 需研究 | 发布平台 |
| 微博 | ⏳ 需研究 | 发布平台 |
| 公众号 | ⏳ 需开通 | 发布平台 |

**待办**: 研究小红书、抖音、微博、公众号的 API 或 CDP 方案

### 4.3 人力投入

| 阶段 | 开发时间 | 运营时间 |
|------|---------|---------|
| Phase 1 | 24h（3 天） | 0 |
| Phase 2 | 19h（2.5 天） | 0 |
| Phase 3 | 28h（3.5 天） | 每日 10 分钟 |
| **总计** | **71h（9 天）** | **每日 10 分钟** |

**关键人员**: 1 名全栈工程师（有 Python、FastAPI、N8N、CDP 经验）

---

## 5. 风险与缓解

### 5.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| NotebookLM 无 API | 高 | 中 | 完全用 Claude 代替，质量可能稍降 |
| 平台 API 限流 | 中 | 高 | 使用 CDP 自动化作为备选 |
| ChatGPT CDP 不稳定 | 低 | 中 | 备选 Gemini API，或增加重试逻辑 |
| PostgreSQL 迁移失败 | 低 | 高 | 先备份 SQLite，双写验证 |
| 多平台账号封禁 | 中 | 高 | 使用多个小号，控制发布频率 |

### 5.2 运营风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 内容质量下降 | 中 | 高 | 每日人工抽查 25%，建立反馈机制 |
| 主题同质化 | 中 | 中 | Notion 日历规划多样性，Claude 辅助建议 |
| 用户反馈负面 | 低 | 高 | 监控评论，及时调整策略 |
| 团队疲劳 | 低 | 中 | 自动化减少人工干预 |

### 5.3 合规风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 平台自动化检测 | 高 | 高 | 模拟人类行为（随机延迟、多样化操作）|
| 内容版权问题 | 低 | 高 | 确保 AI 生成内容原创性 |
| 数据隐私 | 低 | 中 | PostgreSQL 加密，定期审计 |

---

## 6. 成功指标

### 6.1 产能指标

| 指标 | 基线 | 目标 | 测量方式 |
|------|------|------|---------|
| 月产能 | 150-200 | **240** | PostgreSQL `works` 表计数 |
| 日均产能 | 5-7 | **8** | 每日生成记录 |
| 发布平台数 | 1 | **5** | `platforms` 表启用数 |
| 发布成功率 | 100%（今日头条） | **≥95%**（所有平台） | `publications.status='published'` / 总数 |

### 6.2 质量指标

| 指标 | 基线 | 目标 | 测量方式 |
|------|------|------|---------|
| 内容评分 | 人工 | **≥7/10** | Claude 自动评分 |
| 图片评分 | 人工 | **≥8/10** | Claude Vision 评分 |
| 人工抽查合格率 | N/A | **≥90%** | 每日抽查记录 |

### 6.3 效率指标

| 指标 | 基线 | 目标 | 测量方式 |
|------|------|------|---------|
| 人工干预时间 | 2h/天 | **10 分钟/天** | 时间记录 |
| 生成到发布周期 | 手动（不定） | **<24h** | `publications.published_at - works.created_at` |
| 自动化覆盖率 | 30% | **90%** | 自动化步骤 / 总步骤 |

### 6.4 数据指标（Phase 3+）

| 指标 | 测量周期 | 目标 |
|------|---------|------|
| 平均阅读量 | 每周 | ≥500/篇 |
| 平均互动率 | 每周 | ≥2% |
| 粉丝增长 | 每月 | ≥1000 |
| 高表现内容占比 | 每月 | ≥20%（Top 20%） |

---

## 7. 实施检查清单

### Phase 1: 基础自动化

- [ ] **内容生成**
  - [ ] 实现 `ContentGenerator.generate_daily_batch()`
  - [ ] 测试 Claude 概念生成
  - [ ] （可选）测试 NotebookLM API
  - [ ] 保存草稿到数据库

- [ ] **图片生成**
  - [ ] 实现 `ContentGenerator.generate_images()`
  - [ ] 测试 ChatGPT CDP 连接
  - [ ] 实现质量评分
  - [ ] 实现自动重试

- [ ] **发布调度**
  - [ ] 创建 N8N 内容生成工作流
  - [ ] 配置 Cron Trigger（6AM）
  - [ ] 测试端到端流程

- [ ] **编辑日历**
  - [ ] 创建 Notion Database
  - [ ] 实现 Notion API 集成
  - [ ] 规划未来 30 天主题

- [ ] **质量保证**
  - [ ] 实现内容评分函数
  - [ ] 实现图片评分函数
  - [ ] 配置人工抽查流程

### Phase 2: 多平台扩展

- [ ] **平台发布器**
  - [ ] 研究小红书 API/CDP
  - [ ] 实现 `XiaohongshuPublisher`
  - [ ] 研究抖音 API/CDP
  - [ ] 实现 `DouyinPublisher`
  - [ ] 研究微博 API
  - [ ] 实现 `WeiboPublisher`
  - [ ] 研究公众号 API
  - [ ] 实现 `WeChatPublisher`

- [ ] **多平台编排**
  - [ ] 实现 `MultiPlatformPublisher`
  - [ ] 测试 1→5 平台发布
  - [ ] 配置错误处理和重试

- [ ] **N8N 集成**
  - [ ] 创建 N8N 发布工作流
  - [ ] 配置 Cron Trigger（10AM, 4PM）
  - [ ] 测试批量发布

### Phase 3: 运营优化

- [ ] **数据库迁移**
  - [ ] 部署 PostgreSQL（HK VPS）
  - [ ] 创建 Schema
  - [ ] 迁移历史数据
  - [ ] 测试新旧数据库双写
  - [ ] 切换到 PostgreSQL

- [ ] **分析仪表板**
  - [ ] 设计仪表板布局
  - [ ] 实现数据查询 API
  - [ ] 创建前端界面
  - [ ] 部署到生产环境

- [ ] **反馈循环**
  - [ ] 实现每日指标抓取
  - [ ] 分析高表现主题
  - [ ] 自动调整主题规划

---

## 8. 下一步行动

### 立即开始（本周）

1. **验证 NotebookLM API 可用性**
   - 查阅 NotebookLM 文档
   - 测试 API 调用
   - 如不可用，确认完全用 Claude 代替

2. **创建 Notion 编辑日历**
   - 新建 Database
   - 规划未来 7 天主题（测试）
   - 测试 API 读取

3. **实现内容生成自动化（MVP）**
   - 编写 `content_generator.py`
   - 测试生成 1 批（5 篇）
   - 验证质量

### 第 1 周目标

- ✅ 完成 Phase 1 所有任务
- ✅ 实现每日自动生成 8 篇内容
- ✅ 今日头条自动发布 ≥95% 成功率

### 第 2 周目标

- ✅ 完成 Phase 2 所有任务
- ✅ 5 个平台同步发布
- ✅ 达到月产能 240 篇

---

## 9. 附录

### 9.1 关键文件路径

```
/home/xx/perfect21/zenithjoy/creator/
├── skills/
│   ├── deep-post-generator/SKILL.md    # 内容生成 Skill
│   ├── toutiao-publisher/SKILL.md      # 今日头条发布 Skill
│   └── image-gen-workflow/SKILL.md     # 图片生成 Skill
├── scripts/
│   ├── batch-generate-cards.py         # 批量图片生成
│   ├── publish-to-toutiao.py           # 今日头条发布
│   └── init-database.py                # 数据库初始化
├── api/
│   └── server.py                       # FastAPI 后端
├── data/
│   └── creator.db                      # SQLite 数据库
├── CLAUDE.md                           # Skill 定义
└── KR1_IMPLEMENTATION_ANALYSIS.md      # 详细分析报告
```

### 9.2 技术栈版本

| 技术 | 版本 |
|------|------|
| Python | 3.8+ |
| FastAPI | 0.68+ |
| SQLite | 3.x |
| PostgreSQL | 14+ |
| N8N | Latest |
| Notion API | 2022-06-28 |
| Claude API | 2023-06-01 |

### 9.3 相关文档

- **KR1_IMPLEMENTATION_ANALYSIS.md**: 详细项目分析（31KB）
- **EXPLORATION_REPORT.md**: 项目探索报告（20KB）
- **CLAUDE.md**: Skill 使用指南

### 9.4 联系人

- **项目负责人**: xx
- **技术支持**: Claude Code (US VPS)
- **运营支持**: Cecelia Brain

---

**文档版本**: v1.0.0
**最后更新**: 2026-02-06
**下次审查**: 实施 Phase 1 完成后
