# Bug PrepPRD：line02 获客真机 smoke 的假红守卫（12 晚连红全是误报）

Brain task: cae22392-66ae-4e73-a63f-3fc3fe73b5cd（已 claim，executor_kind=headed-session）
分支: cp-route-api-b6d8ae9c ｜ GP-Anchor: line02/keyword_acquisition keep-green
base_sha: 5b303ba7a8ded21c510d238accfce701c4e54ce1

## 症状
e2e-line02-android-collect nightly 自 08-05 起连红 12+ 晚（08-05/07/08/09/10/11/12/13/14/15/16 全 failure），
全部停在环境检查 exit 3，从没跑到业务逻辑。真业务问题（判定链 flaky，0816 记录"未挖"）被埋 12 天。
用户质疑「时好时坏怎么能过 CI」——答案是它 push/pull_request 触发被注释掉了，不是 required check，
夜车连红一个 PR 都拦不住（PR #1648 实跑的 26 个 check 全是 lint/typecheck/CodeQL 类，没有一条碰真机）。

## 根因（5 处，均 0817 实测确诊）

1. line02-android-collect-realmachine-smoke.sh:68 — 用易失 logcat 历史日志判断持久状态
   LIVE_AGENT=$("$ADB" logcat -d | grep -oE 'agent started — agentId=[a-f0-9-]{36}' | tail -1 ...)
   第四台实测 uptime 11 天 / load avg 11.6 / logcat main 16MB 环形缓冲但 98MB readable（高速滚动）
   → 启动日志早被冲掉 → 必然误报「设备可能从没跑完 initAgent」，而 Agent 实际健康
   （pid 在、中台心跳 online、无障碍已授权）。设备跑越久越必然误报。

2. 同上 + dm-send-realmachine-smoke.sh:88 — adb 调用不带 -s
   adb server 每次重启会通过 mDNS 自动再连一个 transport，同一台手机同时出现
   192.168.1.96:5555 与 adb-<序列号>-xxxx._adb-tls-connect._tcp
   → 无 -s 调用返回 "more than one device/emulator" → grep 拿到空 → 误报「包 e2e 未安装」
   （实测包装着且进程在跑）。实测会持续复发：清理后几分钟自己回来。

3. e2e-line02-android-collect.yml collect job → dm job 无状态隔离
   采集真跑完把抖音留在 com.ss.android.ugc.aweme/...ChatRoomActivity，dm job 相隔约 1 分钟
   从脏状态起步 → 瞬间 outcome=FAILED。
   决定性证据：force-stop 抖音后手跑 dm smoke → NONE×4 → SENT，EXIT_CODE=0，私信链路本身健康。
   08-16 dm job 之所以 success，恰因 collect 死在环境闸没碰抖音——两个 job 从未真正连续成功过。

4. line02-keyword-comment-smoke.sh:70 — set -euo pipefail 下命令替换静默杀脚本
   KW_OUT=$("$NODE_EXE" "$KW_SCRIPT" "$SMOKE_KW" 2>&1) → node 非 0 退出直接终止脚本
   → :73 的 fail「完整输出」与 :80 的 DOUYIN_SESSION_EXPIRED 优雅 skip 分支永远执行不到
   → exit 1 且零诊断。手动跑 node 才看到真因：
   {"ok":false,"error":"NO_HEADFUL_CHROME: 无 ZJ_MAIN_DATA_DIR（请先绑定抖音小号）"}

5. PR #1312（07-15 开、33 天未动、未合）里的 MediaProjection 自动授权从未上线
   它已实现：uiautomator dump 找 agent MainActivity「授权截屏」按钮取 bounds → input tap 点中心
   → 再 dump 系统弹框匹配「立即开始/允许/Allow/Start now」再 tap；并把 AGENT_ID 默认值更新为
   e017953c-bc65-47e0-913e-a2ed5eb54993（第四台真实 agent_id，与 0817 实测一致）。
   ⚠️ 这推翻了「MediaProjection 必须人点弹窗、adb 无解」的判断。该 PR CI 有 4 个 fail
   （API Test / L1 Process Gate / L4 Runtime Gate / Verify /dev Workflow 分支名检查）、代码从未真机验证。

## 关联上下文
- 撞车（Phase 2.5 查得）：PR #1312 改同一文件 → 主理人已拍板：内容并入本次 PR，关闭 #1312 并评论指向新 PR
- 0816 handoff 已记录「判定链时好时坏(0/3 全pending vs 1/2 matched，服务端 judge-video，未挖)」
- decisions/match 与 Brain issues 均无匹配记录（这批缺陷此前从未立项）

## 修法
1. 判据换成不依赖易失日志（pidof + 中台心跳）
2. 所有 adb 调用加 -s "$ANDROID_ADB_ENDPOINT"（env 已有此变量）；考虑 runner 设 ADB_MDNS_AUTO_CONNECT=0
3. dm smoke 开头加 am force-stop com.ss.android.ugc.aweme
4. KW_OUT=$(...) || true 后再判断，放行下面的诊断/skip 分支
5. 并入 #1312 的 MediaProjection 自动授权 + AGENT_ID 更新，真机实测后采用

## Regression Test 计划
沿用现成框架：source "$SCRIPT" --source-only + mock 数据变异测试（.github/workflows/scripts/__tests__/）。
- dm-send-realmachine-smoke.sh 已支持 --source-only，可直接加测试
- line02-android-collect-realmachine-smoke.sh / line02-keyword-comment-smoke.sh 不支持，需先补
- 新测试必须加进 ci-l1-process.yml:326 的显式清单，否则就是该 job 注释自己骂的
  「孤儿测试——守卫写了但从不 fire」

## 验收标准
- [ ] commit-1 先提 failing test，commit-2 才是实现（TDD 铁律）
- [ ] 变异测试证明：双 transport 存在时脚本仍正确工作
- [ ] 变异测试证明：logcat 无历史启动日志时不再误报
- [ ] 变异测试证明：抓评论失败时打印 NO_HEADFUL_CHROME 而非零输出
- [ ] 新测试已进 ci-l1-process.yml 清单（[CONFIG] 类改动）
- [ ] 每个守卫 proven-to-fire（亲眼看它报红过一次）
- [ ] CI 全绿

## 不包含
- 判定链 flaky 本身（3 视频全 pending / media_projection null）→ 单独立项
- 抓评论的抖音小号绑定（NO_HEADFUL_CHROME）→ 需人工在 rog 上登录 Chrome
- 打开 push/pull_request 触发升级为 required gate → 等判定链真稳了再做（workflow 注释写明此顺序）
