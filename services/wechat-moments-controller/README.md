# 微信朋友圈 ADB 控制器（line04，0917 首版）

纯 ADB 外驱真机 RPA，架构照抄 `services/phone-adb-controller/douyin-phone-adb` 的现成
生产引擎（dump/等待/证据链/视觉定位/前台闸/设备锁），命令层是朋友圈专属的。两条线共用
同一张设备档案登记表（`douyin-phone-profiles.tsv`）和同一把设备锁（键=物理序列号，
不分 app），同一部手机上两条自动化互不误踩。

## 两件套清单

| 文件 | 用途 |
| --- | --- |
| `wechat-moments-adb` | 控制器本体（zsh）：微信朋友圈发布/浏览/点赞全部命令入口 |
| `moments-tick.sh` | 调度 driver：定时领单→组装内容→执行发布→核验→回报，仿 `outreach-tick.sh` |

## 坐标判定协议（核心设计，见 PrepPRD 判定点表）

坐标永远现场判定，绝不硬编码。每一步：
1. 先 `uiautomator dump`（重试 3 次）按 text/content-desc 找控件
2. dump 返回空节点/找不到 → 自动切视觉模型（截图→toapis→gemini-2.5-flash-lite→归一化坐标），重试 3 次
3. 两条路都不行 → 整条任务判 `failed`，不重试、不硬点、不转人工、不熔断账号

背景：微信在会话内累积高频操作后会对 `uiautomator dump` 持续返回空树（0917 实测，
force-stop 重启微信进程也不恢复，对照系统桌面 dump 正常——精确针对微信）。

## 命令总表（wechat-moments-adb）

- `status` — 设备与前台快照
- `open-wechat` — 起微信，过前台闸
- `open-moments` — 发现 → 朋友圈时间线
- `compose-photo-post FILENAME CAPTION_B64 EID` — 选图+填文案，停在编辑页（不发表）
- `publish EID` — 点发表（单次铁律，锁文件硬挡重复调用）
- `verify-latest-post EXPECTED_B64 EID` — 视觉核验最新动态内容是否匹配（纯读图，跟坐标定位无关）
- `open-contact-moments CONTACT_NAME EID` — 导航到指定联系人的朋友圈时间线（供点赞/跟圈判断内容用）
- `like-current-card EID` — 在已打开的动态卡片上点赞（"选哪条能点"由上层判断，本命令只管点+核验）
- `lock-acquire` / `lock-status` / `lock-release` — 设备锁（跟抖音线互认）

## 部署

1. `scp wechat-moments-adb` → xian-m1 的 `~/.local/bin/`（`chmod +x`）
2. `scp moments-tick.sh` → `~/bin-harvest/`
3. 配置 `~/.config/openclaw/moments-tick.env`（`MOMENTS_TENANT_ID` / `MOMENTS_PROFILE` 等，不进 git）
4. crontab 加一行（跟抖音线 30 分钟 tick 错峰）：`*/20 * * * * /bin/zsh ~/bin-harvest/moments-tick.sh >/dev/null 2>&1`

## 不包含（本轮 v1 范围，见 PrepPRD）

- 纯文字动态发布路径（素材库无匹配图时目前直接判 failed，不降级发纯文字——`compose-photo-post`
  只实现了图文路径）
- 点赞的"该不该点"内容安全判断、跟圈的内容源账号——这两个是上层判断逻辑，不在本控制器职责内
- 多设备/多租户扩展

## 对应立项

Brain journey `016459f9`（智能客服 GP-C 朋友圈发布）· ability `f2913c7a` · 任务 `1ca6f61a`。
真机蹚路记录见 skill `android-moments-publish` / `android-moments-interaction`。
