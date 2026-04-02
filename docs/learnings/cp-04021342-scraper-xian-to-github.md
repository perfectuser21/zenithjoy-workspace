# Learning: scraper-xian-to-github — 西安本地版替换旧版 + ingestToUS

**Branch**: cp-04021342-scraper-xian-to-github  
**PR**: #114  
**Date**: 2026-04-02

## 做了什么

xian-mac 有8个本地修改的爬虫脚本，从未提交到 GitHub（功能比 GitHub 版更强：有 daily_stats/trends）。
用西安本地版替换 GitHub 旧版，并在每个脚本末尾加 ingestToUS 调用（http + Tailscale）。

## 关键发现

### 1. 两条并行开发线是根本原因
- GitHub 版：早期版本，有 ingestToUS 但功能简单
- xian-mac 本地版：功能更强（daily_stats/trends），但从未 push

症状：PR #113 修了 GitHub 版的 https→http，但 xian-mac 根本不用那些脚本。
正确做法：用西安本地版覆盖 GitHub 版，这样 git pull 后 xian-mac 能拿到有 ingestToUS 的版本。

### 2. content_id 映射策略
各平台 content_id 来源不同：
- douyin: `item.aweme_id`（API 原生 ID）
- kuaishou: `item.workId`
- weibo: `item.weiboId`
- zhihu: `item.id`
- toutiao/wechat/channels/xiaohongshu: `hash(title+publishTime)`（无原生 ID）

### 3. xian-mac bare repo 需要手动从美国 push
xian-mac 的 git remote 指向本机 bare repo（无 GitHub remote）。
更新流程：
```bash
# 美国机器 push 到 xian-mac bare repo
git -C /path/to/zenithjoy push ssh://xian-mac/Users/jinnuoshengyuan/perfect21/zenithjoy-bare main
# 然后 xian-mac git pull
ssh xian-mac "cd ~/perfect21/zenithjoy && git pull origin main"
```

### 4. douyin 脚本收集每日历史数据，ingestToUS 用当前快照
douyin xian-mac 版做的是 per-day analytics（历史数据），
但 ingestToUS 发送的是 items 数组的当前总 stats（play_count/digg_count 等），
这是正确的：两套数据各司其职，互不冲突。
