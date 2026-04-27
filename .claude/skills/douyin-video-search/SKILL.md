# sop-douyin-video-search

## 技能名称
抖音对标视频筛选

## 触发词
- `/sop-douyin-video-search`
- `抖音视频筛选`
- `对标视频`
- `douyin video search`

## 描述
按 SOP 三轮关键词在抖音搜索视频（最多点赞、一周内），经过初筛去重 + 四维评分二筛，最终收敛为 10-15 条高质量对标视频，每条附 replicablePoints（可复刻要点）和 fitReason（入选理由），写入 JSON 文件。

## 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--topic` | string | `"一人公司"` | 目标人群主题，用于二筛评分和输出文件命名 |
| `--round-limit` | number | `30` | 每个关键词最多采集多少条视频 |

## 前提条件

1. Chrome 已以调试模式启动并监听 19222 端口：
   ```bash
   open -a "Google Chrome" --args --remote-debugging-port=19222
   ```
2. 浏览器已登录抖音（脚本会自动检测，未登录会等待手动登录）
3. 已安装依赖：
   ```bash
   cd services/creator/scripts/publishers
   npm install
   ```

## 用法示例

```bash
cd services/creator/scripts/publishers

# 默认 topic（一人公司）
node douyin-publisher/sop-video-search.js

# 指定 topic
node douyin-publisher/sop-video-search.js --topic "一人公司"
node douyin-publisher/sop-video-search.js --topic "电商卖家" --round-limit 20

# 指定 CDP 地址（非默认端口时）
DOUYIN_CDP_HOST=http://localhost:9222 node douyin-publisher/sop-video-search.js --topic "一人公司"
```

## SOP 关键词轮次

| 轮次 | 主题 | 关键词数量 |
|------|------|-----------|
| Round 1 | 一人创业/个人IP | 6 个 |
| Round 2 | AI工具/智能体 | 10 个 |
| Round 3 | 获客/私域运营 | 13 个 |

详见 `sop-keywords.js`。

## 搜索策略

- 排序：最多点赞（sort_type=1）
- 时间：一周内（publish_time=1）；结果不足时脚本会提示放宽到10天
- 内容类型：综合搜索（type=0）

## 初筛字段

| 字段 | 说明 |
|------|------|
| round | 轮次（1/2/3） |
| keyword | 搜索关键词 |
| creatorName | 达人名字 |
| profileUrl | 账号主页链接 |
| videoTitle | 视频标题（desc字段） |
| videoUrl | 视频链接（share_url 或构造） |
| publishTime | 发布时间（ISO格式） |
| duration | 时长（秒） |
| contentType | 内容形式（口播/字幕/对话/图文/混剪/其他） |
| diggCount | 点赞数 |
| commentCount | 评论数 |
| notes | 备注（初始为空，人工或AI后续补填） |

## 去重逻辑

按 `videoUrl` 优先去重；videoUrl 缺失时用 `creatorName + videoTitle + publishTime` 组合键。

## 二筛评分维度（每项 0-2 分，满分 8 分）

| 维度 | 说明 |
|------|------|
| audienceMatch | 目标人群匹配（标题/作者含 topic 相关词） |
| replicability | 可复刻性（钩子→痛点→方案→案例→行动号召结构关键词数） |
| monetizationFit | 承接明确（私域/咨询/训练营等关键词） |
| aiAlignment | 与智能体能力契合（AI/自动化/文案/选题等关键词） |

**进入最终池阈值**：totalScore >= 3/8

## 最终输出字段

除初筛字段外，二筛后每条视频额外附：
- `scores`：各维度得分 `{ audienceMatch, replicability, monetizationFit, aiAlignment }`
- `totalScore`：总分（0-8）
- `replicablePoints`：可复刻要点（自动生成，可人工修正）
- `fitReason`：入选理由（自动生成，可人工修正）

## 输出位置

```
~/.platform-data/douyin-competitor/videos-{topic}-{timestamp}.json
```

### JSON 结构

```json
{
  "primaryScreening": [...],  // 初筛所有视频（含原始字段）
  "dedupPool": [...],         // 去重后视频
  "finalPool": [...],         // 最终对标池（最多15条，含评分和 replicablePoints/fitReason）
  "report": {
    "topic": "...",
    "executedAt": "...",
    "rawCount": 0,
    "dedupCount": 0,
    "secondaryCount": 0,
    "finalCount": 0,
    "scoringDimensions": [...],
    "deduplicationNote": "..."
  }
}
```

## 相关文件

- 脚本：`services/creator/scripts/publishers/douyin-publisher/sop-video-search.js`
- 关键词配置：`services/creator/scripts/publishers/douyin-publisher/sop-keywords.js`
- 账号筛选 Skill：`.claude/skills/douyin-account-search/SKILL.md`
