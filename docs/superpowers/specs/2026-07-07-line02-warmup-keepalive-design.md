# 设计：Line02 养号+验活合一 pass（每天1次）

- Journey：客户智能获客路径（Line02, afa6abca-53c0-4815-8594-b7fb81ca547f）
- Decision：92f2c9e5 / ba59f8b7
- Thickness：thin 第一刀

## 核心洞察
小号掉线特征 = **切进去就没了/进不去**（不是弹重登页）。故验活不等信号弹窗，用"切进去+做只有真登着才做得成的动作"反证。小号最怕闲置掉线 → "切进去做自然浏览"本身同时**保活+验活**，合成一件事。

## Golden Path
1. flow=warmup 触发 → 拉起抖音（NEW_TASK|CLEAR_TOP 回主页 feed + delay 沉降）
2. 开切换账号面板 → 读本机登录号昵称列表（tv_nickname）
3. 逐号：点该昵称行切进 → 回主页 feed → 刷 2-3 视频（坐标上滑，每个停 3-5s，纯浏览）
4. 切我页 → 读 昵称 + "N粉丝" → 对得上=在线；读不到粉丝/切完还原成别号/登录注册页=掉线
5. 全号过完 → 中台下发 operator_nickname 则切操作号，未下发则跳过 → 上报整轮 per-account 结果

## 架构（三块，隔离清晰）

### 1. DeviceAccountModel（新增纯判定函数，JVM 单测 = TDD 核心）
- `parseFollowerCount(text): Long?` — 解析"4768粉丝"/"1.2万粉丝"/"1196 粉丝"；无法解析返回 null
- `enum Liveness { ALIVE, OFFLINE }` + `data class LivenessVerdict(alive, reason)`
- `judgeAccountLiveness(readNickname, targetNickname, followerCount, sawLoginPage): LivenessVerdict`
  判据：sawLoginPage=true → OFFLINE("login_page")；followerCount==null → OFFLINE("no_follower_count")；readNickname != targetNickname → OFFLINE("account_reverted")；否则 ALIVE
- `data class WarmupAccountResult(nickname, alive, followers, reason)`
- `aggregateWarmupReport(results): WarmupReport(total, aliveCount, offlineCount, results)`

### 2. DeviceAccountWarmupPass.kt（新文件，纯编排，依赖 UiaOps 接口 → fake 可 JVM 测）
- `interface DouyinUiaOps`：暴露复用原语——launchAndSettle()/openSwitchAccountPanel()/readAccountNicknames()/switchToAccountByNickname(nick)/swipeUpFeed()/readMyProfile(): Pair<nick,followersText>?/detectLoginPage(): Boolean/switchToOperator(nick)/forceClosePanel()
- `suspend fun run(targetNicknames, operatorNickname): WarmupReport`：逐号编排 + 每号异常隔离（单号失败记 error 继续下一号），收尾切 operator（空则跳过）
- DeviceAccountScanService 实现 DouyinUiaOps（把现有 private helper 提成 internal + 新增 swipeUpFeed/switchToAccountByNickname/readMyProfile）

### 3. 触发线
- DebugE2ERouter：加 `Route.Warmup(requestId, deviceId, operatorNickname)`（flow="warmup"）
- DeviceAccountScanService：加 ACTION_ACCOUNT_WARMUP_TASK + dispatchWarmupTask(operatorNickname) + warmup 触发分支（走 ScanMutex 互斥，与 scan 同锁）
- 结果 broadcast 扩 per-account 数组（nickname/alive/followers/reason）

## 频率/频控
默认 1次/天（中台调度，本刀不实现定时器）；号间留间隔 ≥数秒；每号刷 2-3 视频每个停 3-5s；纯浏览不点赞不关注不评论。

## 验收（Final E2E）
- 纯判定函数 failing 单测先行（commit-1），实现变绿（commit-2）
- WarmupPass 编排用 fake UiaOps 单测（逐号/单号失败隔离/收尾切号/operator 空跳过）
- 真机 flow=warmup：logcat 见逐号切进→每号刷2-3视频→读昵称+粉丝→上报 per-account alive=true（2活号判在线）
- 中台未下发 operator_nickname 收尾不切号不崩
- CI 全绿

## 不包含
角标UI / 多号矩阵 / 频率面板 / 主动点赞关注评论 / 定时调度器
