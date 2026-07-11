# 设计：抖音采集取链改剪贴板路线（bug C 续刀）

- Brain task: 9a4d611f-bd97-4645-a856-63ddbebd6ce6
- 决策: 33bbdc22（用户拍板剪贴板路线）
- 上一刀: PR#1226（share-intent 路线，真机证伪）
- PrepPRD: sprints/07110900-collect-clipboard-sharelink/prep-prd.md（在 pr1223-review worktree，内容已并入本 spec）

## 问题

真机实证：抖音自家定制分享面板**无系统分享入口、无第三方 ACTION_SEND 目标**（面板全项=站内转发+工具项），`findShareTargetForThisApp` 永远失败，Stage1 三卡全 ALL_SHARE_FAILED。share-intent 路线不存在，非定位问题。

手动已验证的替代路：面板「分享链接」→ 口令文案（含 v.douyin.com 短链）进系统剪贴板 → 短链 302 → `iesdouyin.com/share/video/<真实19位id>`，服务端 resolver 白名单/正则均匹配。

## 方案选择

- A（选定）：剪贴板路线——点「分享链接」+ 透明 Activity 获前台焦点读剪贴板。改动最小，复用 ShareIngestActivity/ShareLinkExtractor/deliverShareText 通道与服务端 resolver，手动全链已验证。
- B（否决）：OCR/节点树抓口令文案——面板不渲染完整短链，不可行。
- C（否决）：协议逆向取 id——违反最小侵入且脆弱。

## 架构改动（仅 agent 端 Kotlin，服务端零改动）

### 1. ShareIngestActivity 改造（保留 ACTION_SEND 兼容，新增剪贴板模式）

新增内部启动模式：`EXTRA_MODE=read_clipboard` + `EXTRA_TOKEN=<自增long>`。

- **读取时机死规矩**：只在 `onWindowFocusChanged(hasFocus=true)` 后读 `ClipboardManager.primaryClip`（Android 10+ 剪贴板访问判据=窗口焦点；onCreate/onResume 读必 null）。
- 读到 null/不匹配 → 100ms 间隔轮询 ≤10 次；整体 3s 自杀超时（严格小于服务侧等待预算，保证 Activity 先放弃）。
- 每次 onCreate 置静态回执标志 `launchEcho`（带 token），供服务侧判定拉起成功。
- 新增 `EXTRA_MODE=clear_clipboard`：获焦后 `clearPrimaryClip()`，回投 CLEAR_DONE 哨兵。
- manifest：追加 `android:launchMode="singleTask"`；现有 Translucent/excludeFromRecents/taskAffinity="" 保留。

### 2. 新增 ClipboardCaptureGate（纯 Kotlin object，可 JVM 单测）

集中放可测判定逻辑（不碰 Android API）：

- `isFresh(clipTimestamp, clickTimestamp)`：clip 时间戳必须晚于点「分享链接」时刻
- `isDuplicate(url, seenShareUrls)`：任务内去重
- `matchShareLinkLabel(text, contentDesc)`：别名表 `[分享链接, 复制链接, 口令]` text+desc 双通道前缀匹配
- `isSharePanel(nodeTexts)`：面板内容锚点判定（含「取消」/「发送给朋友」或 ≥2 别名命中）
- `acceptDelivery(deliveryToken, expectedToken)`：token 校验

### 3. DouyinCollectService.captureShareUrlForCard 重写

每卡流程：

1. 重抓卡 → tapNodeCenter → 详情页 → 找「分享」按钮（不变）
2. 点分享 → **面板出现判定用 `isSharePanel` 内容锚点**（每 300ms 重试，总窗 ~2s），不用裸 root
3. **清基线**：拉起透明 Activity(clear_clipboard, token) → 等 CLEAR_DONE（≤2s）；失败该卡跳过
4. 面板子树内 `matchShareLinkLabel` 找「分享链接」；找不到滚功能排 ≤3 次；仍无 → 该卡跳过并记录面板可点击节点摘要（截断 500 字符）
5. 记 `clickTimestamp` → 点「分享链接」→ 拉起透明 Activity(read_clipboard, token+1)
6. `startActivity` 后 500ms 查 `launchEcho`：无回执 → 该卡立即 fail，errorDetail=`ACTIVITY_LAUNCH_BLOCKED`（区分环境阻断，不烧满超时）
7. 等 deliverShareText 回投（token 校验）→ `isFresh` + `isDuplicate` 三层新鲜度全过才收；否则该卡跳过
8. BACK 回搜索结果页：现有锚点 + **搜索关键词回显二次消歧**；BACK 前若前台包名非抖音先等 1 个 NAV 延迟
9. 失败照旧跳过不造假；**连续 2 卡失败提前中断上报**（快速失败）；全失败 ALL_SHARE_FAILED 附最后一次脱敏样本（仅 URL+长度）
10. `PER_CARD_TIMEOUT_MS` 15s→25s，分段计时日志（点卡/面板/剪贴板三段）
11. 等待期监听非抖音/非本 app 的窗口态变化，节点树含「剪贴板」+「允许」自动点允许（荣耀提醒弹层兜底）

### 4. deliverShareText 通道升级

`pendingShareCapture: CompletableDeferred<String?>` → `Pair<Long /*token*/, CompletableDeferred<String?>>`；回投带 token，不符 drop（防超时边界跨卡串号）。ACTION_SEND 旧路径投递视为 token 豁免（兼容保留）。

### 5. 版本

versionCode 4→5，versionName 2.1.0→2.1.1。

## 错误路径清单（对抗审查收敛，全部有对策落进上文）

后台拉起受限 / 焦点时序 / 剪贴板残留串号 / 按钮文案变体 / 荣耀提醒弹层 / 抖音被挤后台返回路径 / 空剪贴板与正则过时 / 面板出现慢 / 回投竞态 / 频控与超时预算——详见 PrepPRD 判定点登记表（6 条已入 Brain decisions）。

## 测试策略

- **unit（JVM，commit-1 先红）**：
  - `ClipboardCaptureGateTest`：isFresh（早于点击→拒）、isDuplicate、matchShareLinkLabel（别名/desc 通道/不命中）、isSharePanel（详情页节点集→false）、acceptDelivery（token 不符→拒）
  - `ShareLinkExtractorTest` 增 `/i/xxxx` 路径变体样本（正则同步放宽 `v\.douyin\.com/[A-Za-z0-9/]+`→ 具体见实现，服务端 extractShareUrl 同步）
- **integration**：无（Android 无障碍链路 CI 无法仿真）
- **E2E（真机守卫，repo 外验收）**：Stage1 真机采到 ≥1 条真实短链且服务端解析出 ≥10 位 id；proven-to-fire=已亲眼见 ALL_SHARE_FAILED 报红（任务 0b1a35a2）
- **哨兵**：环境接缝守卫=ACTIVITY_LAUNCH_BLOCKED 独立错误码上报（环境阻断在服务端可见，不伪装成超时）

## 实现注意点（Research 审查补充，必须遵守）

1. **ShareIngestActivity finish 时机按 mode 分流**：ACTION_SEND 旧路径保持即收即 finish；read_clipboard/clear_clipboard 模式必须活到 `onWindowFocusChanged(true)` 之后再干活，超时自杀。
2. **正则放宽收敛写法**：`https?://v\.douyin\.com/(?:i/)?[A-Za-z0-9]+/?`（禁用 `[A-Za-z0-9/]+` 贪婪吞路径）。**服务端 `apps/api/src/services/douyin-share-resolver.ts:48` extractShareUrl 必须同步同一写法**——resolveShareToMedia 会对上报 URL 再跑一次 extractShareUrl，旧正则会把 `/i/AbC123/` 截断成 `/i/` 导致 HEAD 错误 URL。两侧测试样本同步加。白名单不动。
3. **EXTRA 常量命名**：DouyinCollectService companion 已有 `EXTRA_MODE="mode"`；ShareIngestActivity 用独立常量 `EXTRA_INGEST_MODE`/`EXTRA_INGEST_TOKEN`。
4. **launchEcho 判定放宽**：500ms 单点改为轮询补查（总 ≤1s）再判 ACTIVITY_LAUNCH_BLOCKED，防慢机型误判。
5. **token 豁免定死**：ACTION_SEND 旧路径豁免 token 约定值（如 -1L）写进 acceptDelivery 单测样本。
6. **ClipboardCaptureGate 禁用 android.util.Log**（JVM 单测 not mocked）。

## 不包含

- 服务端 resolver/report-videos 改动（除 ShareLinkExtractor 若放宽正则需服务端 extractShareUrl 同步一处）
- note 图文深链验证（真机验证阶段单独做）
- Windows agent / OTA
