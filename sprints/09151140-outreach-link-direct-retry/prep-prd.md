# 小改动 PrepPRD：触达出单三刀——链接直达 + 缺链接上游闸 + 执行内密集重试

GP-Anchor: line02/keyword_acquisition#step4

## 改什么（三刀,主理人 0915 两轮拍板定稿,决策 c5e600a4 + c5828297,Brain task 0899d39c）

**刀1 链接直达**
- `services/phone-adb-controller/next-outreach.js`: 选单 JSON 增加 `profile_url` 段（取「抖音昵称/主页链接」第三段 http 链接）
- `services/phone-adb-controller/douyin-phone-adb`: `private-message-send` 支持链接路线——有主页链接时用 deeplink/浏览器打开主页直达（不走搜索），进主页后走既有「更多面板→发私信」序列；保留主页「抖音号:」强校验闸防认错人（链接路线下校验目标 dyid 或昵称匹配）
- `services/phone-adb-controller/outreach-tick.sh`: 有 profile_url 传给发送命令走链接路线,无链接回落搜索路线

**刀2 缺链接上游闸（防错前移）**
- `next-outreach.js` 选单过滤: 无主页链接(第三段非http)的单不出单,标「待补链」（写回线索表状态或备注）,不再送去搜索路线撞墙
- 例外: 有合法抖音号且此前搜索路线可达的单是否放行——按保守做: 无链接一律待补链(主理人拍板"必须有链接")

**刀3 执行内密集重试**
- `outreach-tick.sh`（或 controller 内部）: 瞬时失败(AdbIME cannot be enabled / restore_ime 报错 / 前台被抢 FOREGROUND 类)就地重试:间隔 60-120s,总上限 10 次(前 5 分钟密集);全部用尽 → done requeue 回队列;线索行记重试计数,回队列后再败才转「触达受阻」

## 为什么改
0915 Manager 首轮对账送达率 14.3%(1✅/6❌): 3/6=字母号搜索不可达(LHJ20001024/P0ten,而 37/99 单已带 card-link 主页直链却被扔掉); 2/6=restore_ime 瞬时报错被一次判死; 1/6=AdbIME 波动(09:24失败/09:36同机成功实证)。

## 关联上下文
- Journey: line02 智能获客 / keyword_acquisition step4(私信触达)
- 决策: c5e600a4(初版) + c5828297(修订:上游闸+执行内重试节奏)
- 关联 bug 任务: 523d64ab(restore_ime trap bug,独立修,不在本单)

## 影响范围
- 三个文件均为获客触达链路专用,不影响采收/分拣/发布线
- 机器副本需同步: M4/M1 ~/.local/bin/douyin-phone-adb、~/bin-harvest/outreach-tick.sh、网关 /opt/openclaw/state/next-outreach.js、clawd-media skills 副本(六副本铁律)
- 话术表当前停用(已拉闸),修完真机验证后由主理人开闸——本单不碰话术表

## 接缝清单与守卫
| 接缝 | 类型 | 守卫 |
|---|---|---|
| 选单过滤/profile_url解析/重试计数 | 逻辑 | CI regression test(vitest/bats),proven-to-fire |
| deeplink 打开主页(真机) | 环境 | 真机 smoke: 字母号单经链接路线送达(send_status=sent+气泡回读),现场三件套(invariant 93ed0761) |
| IME 瞬时失败重试 | 环境 | 真机注入一次性 IME 故障(临时 ime disable),验证就地重试成功且不进受阻 |

## 验收标准
- [ ] commit-1: failing tests 先行(选单 profile_url/缺链闸/重试分类) → commit-2: 实现转绿
- [ ] 字母号单(LHJ20001024 或 P0ten)经链接路线真机送达
- [ ] 注入一次性 IME 故障 → 就地重试后成功,单不进受阻
- [ ] 无链接单被闸住不出单,线索表标「待补链」
- [ ] CI 全绿; 六副本同步 + 受阻单复活(字母号走链接,IME 单回队)
