# Bug PrepPRD：AI on-call 定位缓存把"AI答错"也当"验证通过"钉死，同格子永久重放错误答案

## 症状
0824凌晨真机强制失败闭环复测（HONOR ANY-AN00，抖音40.1.0，scan_me_tab 步骤）：故意让"我"tab
的原生查找失效，逼 AI on-call 出手。AI 两次分别给出两个不同的错误候选（未读角标 id=1u_、
以及一条无关的评论文案 id=zuu），两次都因为该 view_id 确实存在于当前树里（node != null）
被立即标记 verified=true 写入缓存，此后同一 (step, device_model, os_version, douyin_version)
格子永久重放这个错误答案，账号扫描任务连续两轮分别以 OPEN_PANEL_FAILED / SCAN_TIMEOUT 失败。

## 根因假设
`DeviceAccountScanService.tryLocatorAssist()` 在拿到 AI 候选、按 view_id/bounds 在树里查到
对应 node 后，立即调用 `LocatorAssistClient.reportVerifiedBlocking(httpBase, aid, node != null)`
把 verified 上报为 true——但"node 存在于树里"只证明"AI 指认的东西确实是树里某个真实节点"，
不证明"点它真的达成了这一步该做的事"。AI 完全可能在一堆无关节点里选中一个恰好存在的
错误目标（未读角标、feed 里的评论文本），这类"答错但存在"的候选会被这段代码误判为验证
通过，从而钉进 `zenithjoy.rpa_locator_assist` 缓存表——`lookupCache()` 的过滤条件
`verified IS NOT FALSE` 会一直命中这条被误标的记录，永久重放错误答案，直到人工手动
UPDATE 该表清掉 verified 标记。

## 关联上下文
- 相关 PR：#1725（bounds 兜底修复）、#1726（STEP_KNOWLEDGE + gpt-5.4-mini 切换）——都已合并
  promote 到生产，但本次真机复测证实这两个修复不能覆盖本 bug（缓存poisoning发生在答案
  生成之后，与答案生成质量无关）
- 相关表：`zenithjoy.rpa_locator_assist`（`verified` 字段、`cache_hit` 字段）
- decisions/match 未命中已有相关决策记录（本次是新发现）

## 修法
`DeviceAccountScanService.kt` 的 `tryLocatorAssist()` 不再在"node 找到"时立即上报
verified=true——只把 node/assistId/httpBase 打包返回给调用方，调用方等真正知道这一步是否
达成目的（`scan_me_tab` 场景下 = 后续"切换账号"面板 `switchEntry` 是否真的出现）才上报
真实结果。"node 确实为 null"（AI 指认的东西压根不在树里）仍是可信的强负信号，照旧在
`tryLocatorAssist` 内部立即上报 false，不改。

范围限定在 `scan_me_tab` 这一个已用真机证据复现的调用点（`DeviceAccountScanService.kt`），
不在本次顺带重构 `scan_switch_account_row` 及另外两个 Service（`DouyinCollectService`/
`DouyinDmOutreachService`）里结构相同的其余 ~9 个调用点——那些调用点的"真实成功信号"
各不相同且未逐一验证过，留作后续技术债跟进，避免在未经真机验证的情况下大范围改动
造成新的回归。

## Regression Test 计划
仓库无 Mockito/Robolectric，沿用本文件既有测试风格（`DeviceAccountScanServiceMeTabLocateTest.kt`
一类的源码锚点静态检查）：断言 `tryLocatorAssist` 函数体内不再对"node found"分支调用
`reportVerifiedBlocking(...,  true)`／不再传 `node != null` 作为 verified 参数；断言
`scan_me_tab` 调用点在拿到 `switchEntry` 真实结果后才调用 `reportVerifiedBlocking`。

> 本 bug 命中的是"缓存表里的历史脏数据 + 真实设备状态判定"这类环境接缝，静态源码锚点
> test 只能守住"代码结构没有再退回旧写法"，守不住"生产历史脏数据"这类运行时状态——
> 已通过直接 UPDATE 生产 `rpa_locator_assist` 表清除本次复现出的两条脏记录处理，非本次
> 代码修复范围。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿
