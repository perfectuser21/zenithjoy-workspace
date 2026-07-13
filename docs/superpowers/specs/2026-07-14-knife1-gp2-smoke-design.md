# 刀1 设计：铁律扩展 + golden-path-2-smoke 8步本地版（handoff 0714）

## 背景
真机发现不回流 + golden-path-2-smoke.sh 停在 05-26 测已删除的飞书流程（与 decision 431acd2c「去飞书改本地」打架 46 天）。

## 变更
1. `.claude/CLAUDE.md`：铁律1 扩展为「推进其声明的 Path 对应 smoke 至少多过一关或保持全绿」；新增铁律5「真机 bug 修复 PR 必须把复现判据回流进对应 golden-path smoke（真机不可及步骤允许 API 层等价断言，须注明）」。
2. `golden-path-2-smoke.sh` 重写为 8 步本地版，全部真链路断言（详见脚本头注释）：注册自动建 tenant → agent register → x-agent-id 真实调用方 shape（#1267 路径 + 无 header 401 反向断言）→ 3 张本地表 → PATCH config 画像 → account-scan-result role=burner → burner/sessions 登录态 → collect/start → report-videos → judge-video 真调 LLM 判定（禁 force_*）。
3. `ci-l4-e2e-smoke.yml`：job env 注入 `TOAPIS_API_KEY`（secret 已配）；gp2 step 去 fake-feishu env。nightly 由该 workflow 既有 cron（北京 02:30）覆盖，PR 上同跑。
4. 真机段：TODO(android-evaluator-channel) 标记，Android 通道（另线建设）落地后在 xian-rog e2e-line02-android-collect.yml 复跑全链路。

## 测试策略
E2E 档：smoke 脚本本身即 E2E（commit-1）；CI ci-l4-e2e-smoke job smoke-api-contract 真跑验收（PR + nightly）。无新增 src 代码，无 unit 层。

## 未覆盖真实链路清单（规则C）
- 对标视频手填 URL 的 dashboard 端点尚未建设
- Step 8 采集之后的触达段（回评+私信→企微 webhook→Lead 落表）未接入本 smoke
- Android 真机段（装 APK/真机登录/真机截图上报）待 Android evaluator 通道
