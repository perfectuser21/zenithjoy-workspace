# Bug PrepPRD：安卓智能获客(line02) golden path smoke 六处假绿/误报问题（P1批次）

## 症状
08-04 夜连夜审计 `golden-path-2-smoke.sh` 及配套真机/CI 车道，发现六处"守卫看似存在但实际没有真正验证/误判环境为产品缺陷"的问题（P0 四条已在 PR#1604+#1605 修复合并）：
1. `golden-path-2-smoke.sh` Step 26 声称验证 error_code 落库，实际零 DB 断言。
2. `golden-path-2-smoke.sh` Step 28 声称验证离线回退 pending_dispatch，实际只测 HTTP 200。
3. `line02-android-collect-realmachine-smoke.sh` 结尾无条件宣称"Seg1-4 全通过"，即便 Seg3/4 因无 matched 视频未被触发。
4. 同脚本里 ssh hk-vps 失败会被 quality gate 悄悄吞掉，误判成"产品缺陷硬红"而非"环境未就绪"。
5. `nightly-android-fleet-pc4.yml` 设备发现阶段不去重，同一物理设备的多个 adb endpoint 各起一个 job 并发操作、互相干扰。
6. `android-agent-ci.yml` 的 Kotlin 单测 job 不在 main 的 required checks 里，`golden-path-2-smoke.sh` Step 16-21 声称"由 Kotlin 单测守"实际可被绕过。

## 根因假设
1/2. 这两个 Step 是"先写断言意图注释，后补代码时漏了实际的 DB 查询"——写的时候只验证了 API 表面响应（HTTP 200），没有回头补落库校验。
3. 脚本编写时把"正常路径全过"和"降级路径（无 matched）"两种收尾场景合并成一句话，没有按实际执行路径分支输出。
4. `checkLeadQuality([])` 对空数组返回 `passed:true` 是合理的设计（空 leads 列表不该报语义质量问题），但调用方没有先判断"空是因为真的没有 leads，还是因为上游 ssh/psql 命令本身失败导致拿到空字符串解析出空数组"——两种"空"被当成同一种情况处理。
5. pc4 手机池的无线调试端口会漂移（machines.md 已记录的已知坑），discover 阶段用裸 `adb devices` 输出的 serial 做 matrix key，没有做设备身份归一化。
6. Kotlin 单测 job 大概率是后加的、当时没有同步进分支保护规则；这类分支保护变更操作本身有风险（可能挡住不相关的历史 PR），需要先调查再决定是否落地。

## 关联上下文
- 相关 Journey：line02 智能获客（Path 2）
- 上游 PR：#1604（P0 四条已合并）、#1605（P0 handoff 镜像已合并）
- 完整审计详情见 memory `handoff_0804_gp2_android_smoke_audit_18_findings.md`

## 修法

### 1. Step 26 补 DB 断言（golden-path-2-smoke.sh）
在 26c 之后补：
- 正例：psql 查 `acquisition_collect_tasks.error_code` 确认等于 `KEYWORD_NO_RESULT`（已知合法枚举值）
- 反例：再上报一次非枚举值（如 `TOTALLY_UNKNOWN_CODE`），psql 确认被 normalize 成 `UNKNOWN`（`acquisition.ts:44-50` 已有 normalize 逻辑，直接调用同一条路径验证真实生效）

### 2. Step 28 补 DB 断言（golden-path-2-smoke.sh）
在 28c dispatch/run 200 之后补一条 psql 查询：确认离线账号对应的 `dm_assignments.status` 真的是 `pending_dispatch`（而非 `dispatched`），把当前只验证"不崩溃"升级成验证"业务语义正确"。

### 3. 收尾信息分支化（line02-android-collect-realmachine-smoke.sh）
把当前无条件的 `echo "🎉 PASS: ...Seg1-4 端到端接线全通过"`，改成依据 `MATCHED` 是否 ≥1（即是否真的走到 Seg3/4 分支）输出不同结论：Seg1-4 全验证通过 vs Seg1-2 验证通过+Seg3-4 因无 matched 未触发。

### 4. ssh 失败分级为 envfail（line02-android-collect-realmachine-smoke.sh）
在 ssh hk-vps 取 `LEADS_JSON` 之后、喂给 quality gate 之前，先校验：ssh 命令本身是否成功执行（非零退出）+ 返回内容是否为合法 JSON（避免用"parse 出空数组"掩盖"ssh 挂了"）。校验失败走 `envfail`（exit 3），不让它流入后续 `fail`（exit 1）断言逻辑。

### 5. pc4 设备发现去重调查+实现（nightly-android-fleet-pc4.yml）
调研 `adb -s <serial> shell getprop ro.serialno`（或等价稳定设备指纹）能否在 discover job 里对 `adb devices` 拿到的 serial 列表做去重，同一物理设备只保留一条进 matrix。因为要真机验证效果，本条修复范围收窄为：先落地去重逻辑本身（可静态验证——用固定 mock 输入验证去重函数行为正确），workflow 层面的效果留给下次 nightly 真机运行观察，不强求当场用真机验证。

### 6. android-agent-ci.yml required checks 调查（不代码修复，先出结论）
调研 `android-agent-ci.yml` 触发路径（`push`/`pull_request` + `paths: services/agent-android/**`）是否覆盖所有相关改动、job 名称、加入 required checks 后是否会有历史遗留红灯风险。根据调查结果判断是否落地——如果风险可控则落地，否则只记录发现，不强行改分支保护配置。

## Regression Test 计划
- 1/2（逻辑接缝）：CI test，直接在 `golden-path-2-smoke.sh` 里补 psql 断言（脚本本身就是"回归测试"载体，运行即验证）。
- 3/4（逻辑接缝）：修改后需要能在无真机的情况下验证分支逻辑本身正确——脚本主体依赖真机数据，无法完整单测，但至少保证语法正确 + 逻辑路径可推理验证（读代码确认改动后两条分支都会命中对应输出/exit）。
- 5（逻辑接缝，去重函数）：如果实现为独立可测函数，配一个用固定 mock serial 列表验证去重效果的测试；如果只能内嵌在 workflow yaml 里，退化为"语法正确性 + 人工审查逻辑正确性"，效果留给下次真机 nightly 观察。
- 6：非代码修复，无 test。

## 验收标准
- [ ] Step 26/28 补的 DB 断言先证明能捕获对应的假绿场景（如果 CI 环境允许临时验证）
- [ ] 收尾分支输出改动通过语法检查 + 逻辑路径人工确认
- [ ] ssh 失败分级改动通过语法检查
- [ ] pc4 去重逻辑通过静态/mock 测试（如实现为可测函数）
- [ ] android-agent-ci required checks 调查结论写清楚（落地或搁置，二选一，附理由）
- [ ] golden-path-2-smoke.sh 保持 32 步全绿（不能因为补断言反而引入新的假红）
- [ ] CI 全绿
