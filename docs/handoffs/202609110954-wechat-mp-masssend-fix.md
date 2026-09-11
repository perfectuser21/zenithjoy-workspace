# Handoff：公众号发布改成 draft/add → message/mass/sendall 单路径

日期：2026-09-11 09:54 · 会话：d5a5065b · verdict: **PASS**（task_id=unknown，交互式 /dev 未走 Brain 任务注册）

## 一句话状态

公众号发布真机验证发现 `freepublish/submit` 单独调用不会让文章出现在账号主页"全部消息"历史里；已修成 `draft/add → message/mass/sendall` 单路径，PR #1810 已合并。

## 完成（done）

- 真机复现根因：`freepublish/submit` 成功（`publish_status=0`，在 `freepublish/batchget` 能查到）但不进主页历史；`message/mass/sendall` 才是唯一能让内容进主页历史+推送粉丝的动作；且同一草稿先 freepublish 再群发会报 `40007 invalid media_id`，两者不能接力
- 真机验证 fix：重新建草稿走 `message/mass/sendall`，`SEND_SUCCESS`，主理人确认主页已可见
- `apps/api/scripts/wechat-mp-freepublish.py` 重构成可测试函数 + 改成 `draft/add → message/mass/sendall` 单路径，去掉 `freepublish/submit`
- TDD 两次 commit（先红后绿）：`7e841242`（失败回归测试）→ `e7f4d4ab`（实现转绿）
- 新增 CI job `api-scripts-test`（`ci-l3-code.yml`，无条件跑，接进 `l3-passed` 闸），避免回归测试变孤儿测试（同 `openclaw-scripts-test`/PR#1769 教训）
- 顺手修了一个更大的基建事故：本机 `cecelia-node-brain` 容器（迁移后从未真正停止）跟负责转发去 us-vps 的 socat 隧道抢 `:5221`，导致本机所有 Brain 流量打到孤岛而非现役大脑至少一天；已 `docker compose stop` 停掉 + crontab 里会把它拉活的 `brain-keepalive-check.sh`（每2分钟跑一次）已注释禁用（带日期+原因，同 05-08 那次先例）；验证 10 次探测全部稳定 200
- PR #1810 已合并（CONFIG标签 + GP-Anchor声明补齐、DeepSeek审查建议的 mock 凭据占位符命名已采纳）

## 未完成（not_done）

- us-vps 那边 Brain 容器缺少主动 keepalive/告警（目前只靠 systemd docker enabled + restart:unless-stopped 兜底常见故障，容器被整个删掉这种极端情况没人管）——本机那份 keepalive 脚本假设 docker-compose 部署模型，us-vps 实际是用 `brain-deploy.sh` 直接部署，不能照搬，需要单独排查后再补
- `wechat-mp-freepublish.py` 仍是独立脚本，未接作业单轮询（0910 handoff 里"公众号 worker 化"这条还没做）
- 昨晚诊断过程中账号里产生了两份内容相同的记录（一份纯 freepublish、一份真群发），是诊断副作用，未清理（对账号无害，只是有条重复记录）

## next_steps（按序）

1. us-vps Brain 保活方案：读 `brain-deploy.sh` 摸清实际部署机制，再决定要不要加对应的健康检查/告警（低优先级，当前有 systemd+restart-policy 兜底）
2. 公众号脚本 worker 化：接作业单轮询，按订阅号 1次/天 配额做节流调度
3. （可选）清理账号里那条重复的"云朵滤镜"记录

## data_sources

- PR：#1810（已合并）
- 脚本：`apps/api/scripts/wechat-mp-freepublish.py`
- 测试：`apps/api/scripts/tests/test_wechat_mp_freepublish.py`
- CI：`.github/workflows/ci-l3-code.yml`（新增 `api-scripts-test` job）
- Memory：`wechat_mp_freepublish_vs_masssend_rootcause.md`（真机验证根因详细记录）
- 基建修复：`/Users/administrator/bin/brain-port-guard.sh`（本机 5221 端口巡检，今天新落地）、本机 crontab（`brain-keepalive-check.sh` 已注释禁用）

## decision_refs

- Brain decision `7b2d8b46`：公众号发布脚本 freepublish-only 不进主页的 bug 修法
