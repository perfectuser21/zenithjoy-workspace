# 获客业务数据 PG → Notion 镜像（任务 f6ad056e，决策 a029a7a7）

## 做了什么
- `services/phone-adb-controller/pg-notion-mirror-lib.js`：通用 PG→Notion 单向镜像引擎（建库/认领 + 补列 + 源ID 认页 + 指纹增量 + 去重/孤儿归档 + 致命错停批）。
- `services/phone-adb-controller/leadgen-notion-mirror.js`：获客三表列合同（获客·视频 / 获客·评论 / 获客·线索），MMV launchd 每 5 分钟一轮。
- 飞书写入（push-videos / push-raw-comments / push-leads / next-outreach）原样保留，给客户交付。

## 为什么跑在 MMV 而不是 Brain
- hk-vps 的 zenithjoy PG 只监听 127.0.0.1；us-vps Brain 没有到它的隧道，本机也没有 zenithjoy 库（`ZENITHJOY_DB_NAME=zenithjoy` 指向 localhost 实际不存在）。
- 给 hk-vps PG 开 tailnet 端口或在 us-vps 加隧道 = 网络配置变更（危险操作）；MMV 已有常驻隧道 `com.zenithjoy.pg-tunnel-hk` 和获客脚本运行目录，零新通道。

## 为什么映射放在 Notion「源ID」列，不在 PG 加 notion_page_id
- 生产 zenithjoy 库迁移要走 promote-prod-hk 人工放行闸；镜子不该卡在那。
- 每轮先读库内现存页按源ID建索引：建页后崩溃，下一轮也能认回，不会重复建页；同源ID多页自动留一归档其余。

## 坑
- Notion url 列不收空串，必须写 null。
- select 选项名不能含英文逗号，替换成中文逗号。
- PG 读回 0 行时不能做孤儿归档，否则一次查询出错会把整个镜子清空。
