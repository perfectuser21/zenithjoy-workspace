# Bug PrepPRD：真机车道假绿根治——刀D 摸不到 adb + envfail 被包装成绿

Brain task: 3e6a9041-01d2-49a8-9eba-0f4fe6c07cab ｜ decision: 2f11ae25(invariant) ｜ 拍板: 方案B(promote证据②改job粒度)

## 症状
nightly 真机回归安卓刀D（account-scan）自 07-30 接线起从未真正摸到手机：checkout 失败或报"无 Android 设备在线"后被包装成 job success（infra-skip），5 天车道瘫痪零报警。

## 根因（已实锤，08-03 真机对照验证）
1. Bug1：`.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh` 默认裸 `adb`，rog runner PATH 无 adb，`adb devices 2>/dev/null` 静默失败 → 误报"无设备在线"。同机（xian-rog-wechat runner 宿主）手动指定 scrcpy adb 全路径后整条链全绿（装 2.1.19/versionCode23 → 扫描 done → account_ids=2，11:52 北京时间）。
2. Bug2：`nightly-real-machine-staging.yml` 刀D step 把 envfail(exit 3) 映射成 exit 0（job success），nightly-report 不计红不开 issue。已被 decision 2f11ae25（invariant，用户拍板）推翻：envfail 必须红+报警。

## 修法（含 GAN 对抗审查修正）
1. smoke 脚本 ADB 探测：glob `/c/Users/*/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_*/scrcpy-*/adb.exe` 优先（`sort -V | tail -1` 取最新），`command -v adb` 兜底（照抄 e2e-line02-android-collect.yml:115-117 已验证顺序）；无论显式/探测，设备检查前统一 `"$ADB" version` 可用性校验。三种 envfail 文案：找不到 adb / adb 不可用(带stderr) / 无设备在线。
2. workflow 刀D：删 exit3→exit0 包装（保留 set +e 捕获 + outputs.code 写入 + exit "$CODE"），envfail 直接 job failure；同步删改 job 头部 infra-skip 设计注释与 nightly-report 相关注释。
3. nightly-report：code=3 时标签改"envfail(环境未就绪)"；红判定继续 key 在 result=failure（容忍 code 为空：checkout失败/timeout）。
4. promote-all-prod.yml 证据②改 job 粒度（用户拍板方案B）：微信/抖音/安卓各看各自 job 最近2晚绿，安卓 envfail 红只卡安卓相关 promote，不连坐全线。
5. PR 描述注明 supersede sprint 07292330 合同"infra-skip 不计红绿"条款，引用 decision 2f11ae25。

## Regression Test 计划（commit-1，永久留 CI）
- `__tests__/account-scan-realmachine-smoke.adb-discovery.test.sh`：静态断言探测逻辑存在、glob 优先于 command -v、三种文案区分、探测先于设备检查（抄 envbind.test.sh 静态断言模式，规避 ubuntu runner 自带 adb 干扰）。
- `__tests__/account-scan-realmachine-smoke.envfail-red.test.sh`：解析 workflow 刀D run 块，断言无"code=3→exit 0"分支；前缀命名自动进 ci-l1 glob。
- promote 证据② job 粒度改造的断言测试（若 promote-all-prod 已有测试模式则跟随，无则静态断言）。
- proven-to-fire：每个守卫注入坏 fixture 亲眼看红一次（变异自证），记录在 PR。

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| adb 可用性与设备在线的判定 | ①裸 adb devices 静默失败当无设备 ②探测+`adb version`校验+三种文案分层 | ② | ①已实锤误报5天；②同机真机验证可行 | 误判→车道瘫痪被当环境噪音，修复验证无限延误 |
| envfail 的红绿归属 | ①infra-skip 不计红绿(07292330合同旧条款) ②envfail=红+报警 | ②(decision 2f11ae25 supersede) | 旧条款实际效果=瘫痪静默 | 假绿掩盖车道瘫痪 |

## 验收标准
- [ ] failing test 先 commit（commit-1），修复变绿（commit-2）
- [ ] 手动触发 nightly workflow：刀D 在 rog 真正摸到手机跑通（对照 08-03 11:52 手动全绿基线）
- [ ] envfail 路径变异验证会红（proven-to-fire 记录）
- [ ] CI 全绿
