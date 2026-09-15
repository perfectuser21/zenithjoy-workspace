# 触达出单三刀设计：链接直达 + 缺链接上游闸 + 执行内密集重试

决策依据: c5e600a4 + c5828297(主理人0915两轮拍板) | Brain task 0899d39c | GP-Anchor: line02/keyword_acquisition#step4

## 背景
0915 Manager 首轮对账: 触达 1✅/6❌(14.3%)。3/6=字母号搜索不可达(37/99单已带主页直链却未被使用);2/6=restore_ime 瞬时报错一次判死;1/6=AdbIME 波动(09:24失败09:36同机成功)。

## 刀1: 链接直达路线

**next-outreach.js**(选单器):
- 解析「抖音昵称/主页链接」第三段(parts[2]),以 `https://` 开头即为 profile_url
- next 输出 JSON 增加 `profile_url` 字段(base64 不需要——URL 无需转义,但含 `/` 需 shell 安全,输出原文由 tick 用 python json 提取,与现有字段同路)

**douyin-phone-adb `private-message-send`**:
- 签名扩展: `private-message-send SENDER TARGET_ID MSG_B64 EVIDENCE_ID [PROFILE_URL]`(第5参可选,保持向后兼容)
- 有 PROFILE_URL → 链接路线: `am start -a android.intent.action.VIEW -d "$profile_url" com.ss.android.ugc.aweme`(package 钉死抖音,防浏览器接管;v.douyin.com 短链/www.douyin.com/user 长链抖音 App 均原生处理重定向)→ 等待落页 → 读树
- **强校验闸原样保留**: 主页「抖音号：」必须 == TARGET_ID,不匹配 die TARGET_ABSENT(认错人绝不发)。链接路线不做搜索兜底——有链接搜索就是被否掉的路线(决策c5828297),链接打不开/校验不过=受阻类,人工看链接质量
- 无 PROFILE_URL → 现有搜索路线原样(手动调用兼容)
- 落页后复用现有序列: DM按钮/更多面板 → chat → IME 注入 → 送达气泡回读,零改动

**outreach-tick.sh**: 从选单 JSON 取 profile_url,传给发送命令第5参

## 刀2: 缺链接上游闸

**next-outreach.js** pending 过滤追加: parts[2] 非 `https://` 开头 → 不出单,且对该行执行一次性标记(状态→`待补链`;bitable 写新 select 值自动建选项,写失败则降级为在「回复结果」追加 `[待补链]` 不阻塞)。已标记过的行跳过重复写。
- dyid 合法性要求保留(强校验闸需要 dyid);有链接无 dyid 的行同样待补链(补链+补号同工序,refill-profile-links.sh 是既有回补工具,本单不改它)
- next 输出统计行到 stderr: `gated_no_link=N`(Manager 日报可见)

## 刀3: 执行内密集重试

**outreach-tick.sh**:
- 新增 tick 互斥锁(flock 非阻塞,`/tmp/outreach-tick.lock`): 重试拉长运行时长后防 30min 后下一 tick 重入;占用即安静退出
- 发送尝试循环: 最多 10 次,失败输出命中**瞬时类正则**(`AdbIME|input method|original_ime|restore_ime|foreground|前台`)→ sleep 60-120s 随机后重试;非瞬时类(TARGET_ABSENT/校验失败/其它)→ 立即按现有 failed 处理不重试
- 总时长护栏: 循环累计超 22 分钟(cron 周期 30min 留余量)→ 停止重试按瞬时耗尽处理
- 瞬时耗尽 → `done <rid> requeue_transient <note>`

**next-outreach.js** done 模式新增 `requeue_transient`:
- 该行「回复结果」不含 `[瞬时败]` → 状态=待触达 + 回复结果=`[瞬时败1轮]<note>`(回队,下一 tick 自然重选=第二轮)
- 已含 `[瞬时败]` → 状态=触达受阻 + 回复结果追加(两轮共20次机会用尽才判死)
- 现有 `requeue`(锁忙)语义不变

## 测试策略(四档: E2E/integration/unit/trivial)
- **unit(CI)**: 新增 `services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs` —— 把选单过滤/URL解析/requeue_transient 状态机抽为纯函数 `next-outreach-lib.mjs`(next-outreach.js require 之),node --test 跑: ①带链单出单含 profile_url ②无链单被闸+只标记一次 ③requeue_transient 一轮回队/二轮受阻 ④瞬时正则分类
- **integration(CI smoke 扩展)**: `phone-adb-controller-smoke.sh` 追加签名存在性: `PROFILE_URL`、`requeue_transient`、`flock`、瞬时正则;zsh -n 语法闸覆盖 outreach-tick.sh(现缺,补上)
- **E2E(真机,lead 自验,合并后)**: ①字母号单(P0ten/LHJ20001024)经链接路线送达(send_status=sent+气泡回读+现场三件套) ②临时 `ime disable` 注入一次性 IME 故障→就地重试成功不进受阻 ③无链接单被闸,表上出现待补链
- proven-to-fire: 每条 smoke 新签名先注释掉目标代码跑红一次再恢复(commit 顺序内完成)

## 不做
- restore_ime trap bug 本体(独立任务 523d64ab,避免同文件冲突本单只把它的报错归入瞬时类)
- 企业号昵称校验路线(无 dyid 单仍待补链)
- refill-profile-links.sh 补链工序增强
- 话术表开闸(主理人手动)

## 部署
merge 后六副本同步: M4/M1 `~/.local/bin/douyin-phone-adb`+`~/bin-harvest/outreach-tick.sh`、网关 `/opt/openclaw/state/next-outreach.js`、clawd-media skills 副本;同步后真机 E2E,通过后报主理人开闸。
