# Bug PrepPRD：current_video_link 恢复守卫只验包名，后续视频全在错页面上空转

## 症状

0921 夜批 `auto09212230`：12 词 0 LEAD。唯一走通筛选的 w12 里，v1 取到链接后，
v2/v3/v4 三个视频**全部「评论区打不开」**。

## 根因（真机证据已钉死，非推断）

`current_video_link` 取完链接后，对 video 类型的收尾是用 deep link 重开视频：

```zsh
"$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "snssdk1128://aweme/detail/$content_id"
wait_ms 900
[[ "$(foreground_package)" == *"$DOUYIN_PACKAGE"* ]] || die "resolved content did not restore to Douyin" WRONG_FOREGROUND
```

守卫**只验包名**。deep link 未生效时，人仍停在「暂存搜索页」——那是复制链接后
用来粘贴解析的搜索框页，**它也是抖音包名**，于是守卫放行、函数返回成功。

调用方 `harvest-keyword.sh` 据此以为已回到视频页，`back` 一次后落到搜索输入页；
此后每个视频的 `tap-evidence` 坐标都打在错的页面上，评论区自然永远打不开。

### 证据

| 证据 | 内容 |
|---|---|
| `auto09212230-w12-v2-oc-before.xml` | 搜索框 `et_search_kw` 里躺着 v1 的复制口令：`9.76 复制打开抖音…https://v.douyin.com/hoZAsb98YwY/`，`focused="true"` |
| `auto09212230-w12-v3/v4-oc-before.xml` | 「猜你想看 / 展开更多历史 / 删除历史」= 搜索输入页 |
| `auto09212230-w12-v4-oc-icon2-l1-locate.png` | 定位评论图标时的截图，画面就是搜索输入页，根本没有评论图标 |
| `night-auto09212230.log` | `视频已处理过,跳过` → v2/v3/v4 连续三次「评论区重试仍打不开」 |

### 为什么此前没被发现

- 它被上游的「筛选失败」长期掩盖：w3–w11 九个词全部卡在视觉定位那步，根本走不到这里。
  换 UI-TARS 修好定位后（w12 首次筛选成功），这个下游缺陷才第一次暴露。
- 本机手动复现时 deep link 生效（回到 `DetailActivity`），说明它是**间歇性**的，
  固定 `wait_ms 900` 不够稳。

## 关联上下文

- 相关 Journey/Ability：line02 / keyword_acquisition
- 相关铁律：`93ed0761`（RPA 现场三件套：动手前先拿前台包名+诊断行+截图）、`761f242b`（原子判态）
- 同源判例：0821 私信排查——「真凶是点完之后前台被抢走」，当时也是猜着改白费三轮

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 视频详情页是否已恢复 | ①只验包名（现状，已证伪）②验前台 Activity 含 `detail` ③验 UI 树无 `et_search_kw` ④②+③双判据 | **④ 正向+负向双判据** | 真机实证存在两种详情 Activity（`detail.ui.DetailActivity` / `detail.ultra.ui.UltraDetailActivity`），硬编码单个必漏；暂存搜索页唯一稳定特征是 `et_search_kw` | 判错为"已恢复"= 本 bug（后续视频全灭）；判错为"未恢复"只丢当前视频。**故意选偏安全方向** |

## 修法

1. 新增纯判定原语 `detail_restored <foreground> <ui_xml>`：前台 Activity 含 `detail`
   **且** 树中无 `et_search_kw` 才算已恢复。同时暴露成子命令 `detail-restored`，
   排障时能手工验，也让判定逻辑可被 CI 测到（逻辑接缝 → CI test）。
2. `current_video_link` 的恢复段改为**轮询验证**（固定 900ms 改成最多 N 次、每次真验），
   未恢复则重试一次 `am start`。
3. 仍未恢复 → **先把现场恢复到结果页再 die**（带错误码），绝不静默返回成功。
   宁可丢当前这一个视频，也不能污染后续所有视频。

## Regression Test 计划

`services/phone-adb-controller/__tests__/video-link-restore.test.mjs`，用假 registry
（`DOUYIN_PHONE_REGISTRY`，沿用 device-job-claimer.test.mjs 的既有手法）调 `detail-restored` 子命令：

- 暂存搜索页（含 `et_search_kw` + 复制口令）→ 判未恢复 ← **这条就是本 bug 的复现**
- 包名是抖音但页面是搜索输入页 → 判未恢复（证明"只验包名"不够）
- `detail.ui.DetailActivity` + 正常视频树 → 判已恢复
- `detail.ultra.ui.UltraDetailActivity` + 正常视频树 → 判已恢复（覆盖两种详情 Activity）
- 前台不是抖音 → 判未恢复

## 守卫 proven-to-fire

按「哨兵死规矩」：把判定改回"只验包名"，上面第 1、2 条测试必须报红——亲眼看它红过才算数。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 变异验证：判定退回只验包名 → 测试报红
- [ ] CI 全绿
