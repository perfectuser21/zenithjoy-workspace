# Learning: scraper 采集数据关联 work_id

**分支**: cp-03171116-scraper-work-id  
**日期**: 2026-03-17

## 背景
Brain 任务：将 scraper 采集的指标直接通过 platform_post_id 关联到 zenithjoy.publish_logs，实现精确关联（替代原先的标题模糊匹配）。

### 根本原因
原 scraper 已采集 platform_post_id（workId），但只写 social_media_raw，与 works 体系断连。sync-scraper-to-works.sh 的标题模糊匹配精确度低。

### 解决方案
在 scraper 中新增 ceceliaClient 连接 cecelia DB，在每次保存完 social_media_raw 后，对非空 workId 查询 zenithjoy.publish_logs，找到匹配则更新 response.metrics。

### 下次预防
- [ ] cecelia DB 连接使用环境变量覆盖，默认值为 `cecelia` 用户（无密码）
- [ ] DB 连接失败不阻塞主流程（try/catch 隔离）
- [ ] 当 zenithjoy 在非本机运行时，需确保 CECELIA_DB_HOST 等环境变量正确设置
