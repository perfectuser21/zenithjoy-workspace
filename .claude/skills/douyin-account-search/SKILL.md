# sop-douyin-account-search

## 技能名称
抖音对标账号筛选

## 触发词
- `/sop-douyin-account-search`
- `抖音账号筛选`
- `对标账号`
- `douyin account search`

## 描述
按 SOP 三轮关键词在抖音搜索视频，从视频结果中提取作者信息，经过初筛 + 二筛，最终收敛为 5-10 个对标账号，写入 JSON 文件。

## 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--topic` | string | `"一人公司"` | 目标人群主题，用于二筛定位匹配和输出文件命名 |
| `--round-limit` | number | `20` | 每个关键词最多采集多少个独立作者（去重前） |

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
node douyin-publisher/sop-account-search.js

# 指定 topic
node douyin-publisher/sop-account-search.js --topic "一人公司"
node douyin-publisher/sop-account-search.js --topic "电商卖家" --round-limit 15

# 指定 CDP 地址（非默认端口时）
DOUYIN_CDP_HOST=http://localhost:9222 node douyin-publisher/sop-account-search.js --topic "一人公司"
```

## SOP 关键词轮次

| 轮次 | 主题 | 关键词数量 |
|------|------|-----------|
| Round 1 | 一人创业/个人IP | 6 个 |
| Round 2 | AI工具/智能体 | 10 个 |
| Round 3 | 获客/私域运营 | 13 个 |

详见 `sop-keywords.js`。

## 搜索策略

- 排序：最多点赞（API sort_type=1）
- 时间：一周内（publish_time=1）；结果不足时可放宽到10天（仅一次）
- 通过视频搜索结果提取 author 字段，避免额外账号搜索 API

## 初筛字段

| 字段 | 说明 |
|------|------|
| round | 轮次（1/2/3） |
| keyword | 搜索关键词 |
| creatorName | 达人名字 |
| douyinId | 抖音号（unique_id） |
| profileUrl | 账号主页链接 |
| bio | 账号简介 |
| followers | 粉丝数 |
| workCount | 作品数 |
| videoUrl1 | 代表视频链接 |

## 二筛条件

1. **粉丝范围**：5000–20000（优先，非硬性淘汰）
2. **近30天更新估算**：workCount >= 15
3. **定位匹配**：bio/名字含 topic 相关词
4. **变现链路**：bio 含私域/训练营/咨询/课程等关键词

## 输出位置

```
~/.platform-data/douyin-competitor/accounts-{topic}-{timestamp}.json
```

### JSON 结构

```json
{
  "primaryScreening": [...],   // 初筛所有账号
  "secondaryScreening": [...], // 通过二筛条件的账号
  "finalPool": [...],          // 最终对标池（最多10个）
  "report": {
    "topic": "...",
    "executedAt": "...",
    "primaryCount": 0,
    "secondaryCount": 0,
    "finalCount": 0,
    "secondaryFilterCriteria": {...}
  }
}
```

## 相关文件

- 脚本：`services/creator/scripts/publishers/douyin-publisher/sop-account-search.js`
- 关键词配置：`services/creator/scripts/publishers/douyin-publisher/sop-keywords.js`
- 视频筛选 Skill：`.claude/skills/douyin-video-search/SKILL.md`
