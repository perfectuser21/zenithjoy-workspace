# 小改动 PrepPRD：crontab 获客流水线补账本+阶段工件+续跑，承认为编排器（基座 1/7）

task: b4b09cdd-00d3-413e-925b-b3ccf892ee82 · 决策 adf7d620（不需要 n8n）· GP-Anchor: line02/keyword_acquisition keep-green

## 前提纠正
escort 召唤/注销生产已有（harvest-cron.sh L44-56，#1911 已迁 MMV）；锁 TTL、RAM 盘清理已有。本任务剩：①账本 ②阶段工件+哈希 ③断点续跑 + manifest/n8n 标记。

## 改什么
| 项 | 落点 | 约定 |
|---|---|---|
| run/attempt | harvest-cron.sh L10 | run_id=social-keyword-leadgen-crontab-$TAG；进入 batch2 才计 attempt |
| task_request_hash | L111 取词单后、L139 batch2 前 | sha256(profile|sorted(词单)|six_months|most_liked|unlimited|PUSH|SERIAL)，不含 TAG，透传 env |
| 账本 | init/set/finalize(trap) | ledger.mjs，xian-m4 ~/.config/zenithjoy/ledger/<run_id>.json（不放 RAM 盘） |
| 阶段工件 | preflight=起跑；discovery+collection=每词；delivery=push 后；cleanup=trap | <run_id>__a1.<stage>.<n>.worker-result.json，本地落 + best-effort scp MMV workflow-runs |
| WORKER_RESULT | 每次写 | schema_version:2, run_id, attempt_id, stage_id, stage_attempt, task_request_hash, status, evidence[≥1], metrics(4通用+闭集), recommended_next_action |
| 断点续跑 | 起跑读账本 | 同 TAG discovery 已 completed 的词跳过；attempt+1 |
| escort 加固 | 起跑 | 30s 后 cron list 复核真活；先清前批孤儿 escort-$HOSTKEY-* |
| manifest / n8n | zenithjoy-skills / hk-vps | orchestrator.type: commander；V4 inactive（复核发布版≠草稿） |
诚实项：qualification/scoring 在 crontab 路径不发生 → 工件 status=blocked, summary=not_in_profile。

## 影响范围
只动独立副本 *-v4.sh，影子跑 2 晚通过后切 crontab；新增 leadgen-scripts/ledger.mjs + workflow-result.sh；不碰 douyin-phone-adb / outreach-tick.sh / push-*.js。

## 错误路径
账本/工件写失败=open(warning 继续)；escort 拉起失败=open(已有重试→escalate)；注销失败=open(起跑清孤儿)；hash 不一致=closed(blocked+escalate 停)；坏账本=open(a1 重跑)；RAM 盘满=失败记录存 raw errno；scp 失败=open(本地留下批补)。

## 判定点（已写 decisions category=judgment）
一次夜批算跑完=账本 cleanup=completed ⚠️ · escort 真活=cron list 命中+findings 新增 · 工件写成功=文件在且 jq 过 · blocked/failed 按出口码映射 ⚠️

## 守卫（各弄坏一次看报红）
WORKER_RESULT 形状 CI test · hash CI test · pipefail 假绿(grep||true + lint-smoke-mock-honesty) · escort 真活 30s 复核→escalate · 工件落地收工自检 · 孤儿 escort 起跑清扫+值守清 >3h

## 验收
- [ ] 影子跑 2 晚：账本 5 阶段 completed + 2 阶段 not_in_profile；工件含 hash+schema_version=2+evidence≥1
- [ ] 当晚 MMV escort-findings 新写入 + 30s 复核日志命中
- [ ] 影子晚 LEAD ≥ 近7天均值(≈120/晚)
- [ ] 6 守卫各报红一次（证据进 PR）
- [ ] manifest 切型 + n8n V4 inactive 回读
- [ ] CI 全绿

主理人拍板(0921)：①5+2 验收 ②进入 batch2 才计 attempt ③影子跑 2 晚。路径 B。
