# 抖音获客 ADB 控制器(最强版,0914 六刀融合)

纯 ADB 外驱真机 RPA:skill 层判据焊死为确定性命令,融合 Kotlin RPA(NodeAwait/DouyinCollectService)教义——等待用条件、坐标从树取、失败必归因。

## 五件套清单

| 文件 | 用途 |
| --- | --- |
| `douyin-phone-adb` | 控制器本体(zsh):设备锁/前台闸/证据链/搜索/评论采集/身份验证/触达全部命令的唯一入口 |
| `harvest-keyword.sh` | 采收 driver:按关键词跑「搜索→视频tab→逐卡开视频→开评论→采评论」全链,接 lock-refresh 心跳与原爆款作品地址 |
| `refill-profile-links.sh` | 主页直链回填:对缺 profile_url 的线索逐条走分享名片取主页直链(通杀企业号) |
| `push-leads.js` | 飞书写表:把分拣后的线索 TSV(含 11/12 列 purl 主页直链)写入飞书线索 Bitable |
| `update-profile-links.js` | 直链回写:把 refill 产出的主页直链批量回写到飞书表已有行 |

## 六刀融合表

| 刀 | 内容 |
| --- | --- |
| 刀1 | 删烂死死函数 `ui_evidence_retry`(0914 已删,smoke 层3b 防复活) |
| 刀2 | 剪贴板 COPY_STALE 守卫(抄 Kotlin `clearClipboardBaseline` 教义:先记基线再复制,回读相同=陈旧即报错) |
| 刀3 | 触达命令适配 Lynx(首卡固定位+抖音号强校验,防把私信发给同名人) |
| 刀4 | `foreground_gate` 前台闸(插屏弹窗白名单点掉,「允许」永不入白名单——授权类弹窗必须人裁) |
| 刀5 | `die` 三态归因 `failure_class=NO_ROOT/WRONG_FOREGROUND/TARGET_ABSENT`,上层不再猜根因 |
| 刀6 | `lock-refresh` 活锁心跳(长任务续锁,防锁过期被并发抢占) |
| 刀7 | 先探后睡(500ms 步进探前台,状态到了立即走,不再盲 sleep) |

## 命令总表(douyin-phone-adb)

### 状态/诊断
- `status` — 设备与前台快照
- `diagnose` — agent 诊断行(排障第一现场)
- `preflight` — 开工前四项检查
- `foreground` — 读当前前台包名/Activity
- `telecom` — 通话状态(idle/ringing/offhook)
- `window` — 窗口焦点信息
- `refresh` — 刷新设备状态缓存

### 设备锁
- `lock-acquire` — 拿设备锁(带持有者/TTL)
- `lock-status` — 查锁归属
- `lock-refresh` — 活锁心跳续期(刀6)
- `lock-release` — 释放锁

### 基础操控
- `wake` / `unlock` — 亮屏/解锁
- `open-app` / `close-app` — 起停指定应用
- `tap` / `swipe` / `back` — 裸点/滑/返回
- `tap-snapshot` / `swipe-snapshot` / `back-snapshot` — 操作后带截图
- `tap-evidence` / `swipe-evidence` / `back-evidence` — 操作后带截图+UI树全证据

### 证据链
- `screencap` — 截屏
- `pull` — 拉取设备文件
- `snapshot` / `snapshot-evidence` — 截图快照(裸/带证据编号)
- `ui-evidence` — UI 树证据落盘
- `evidence-bundle` — 按前缀打包一次动作的全部证据

### 搜索/发现
- `open-search` — 打开抖音搜索入口
- `search-time-layer` — 按时间层+排序+时长筛搜索(six_months/most_liked 等)
- `search-video-tab` — 搜索结果切「视频」tab(综合 tab 永不 idle,必切)
- `search-video-cards` — 读视频 tab 静态网格,输出可点卡片 TSV
- `open-video` — 用 deeplink 确定性直开指定视频详情页

### 评论采集
- `open-comments` — 树优先取坐标打开评论面板(零评论拦截)
- `collect-comments` — 读评论面板输出 TSV(昵称/正文/日期/地区/头像tap坐标/b64)
- `commenter-identity` — 按头像坐标进主页验出抖音号身份
- `commenter-card-link` — 他人主页分享名片取主页直链(sec_uid,通杀企业号)
- `current-video-link` — 取当前视频分享链接(原爆款作品地址)

### 账号/触达
- `account-current` — 读当前登录账号
- `account-switch` — 切换到指定抖音号
- `private-message-send` — 私信触达(见下方安全声明,默认关闸)

### 播放/录制
- `set-playback-speed` — 设播放倍速
- `record-start` / `record-status` / `record-stop` — 录屏起/查/停
- `record-extract-audio` — 从录屏抽音轨(喂 ASR)

### 视觉兜底
- `locate` — 视觉模型定位元素坐标
- `locate-tap` — 定位并点击

## 部署三步

1. `scp douyin-phone-adb` → xian-m4 / M1 的 `~/.local/bin/`(`chmod +x`)
2. `scp harvest-keyword.sh refill-profile-links.sh` → `~/bin-harvest/`
3. `docker cp push-leads.js update-profile-links.js` → us-vps `openclaw-gateway:/root/.openclaw/`

## 安全声明

触达命令 `private-message-send` 机械已修,但 `outreach_policy.enabled=false`(默认关闸)。真实发送需主理人批话术、批发送账号、批频控,AI 不得自行触发。

## 守卫

`.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`(已在 Smoke Glob Gate 基线内):五件套存在性+zsh/node 语法闸+六刀签名存在性+烂死模式检测(变量展开尸块/死函数复活),proven-to-fire 验证过报红能力。
