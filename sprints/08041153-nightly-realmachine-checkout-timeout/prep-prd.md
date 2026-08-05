# Bug PrepPRD：nightly-real-machine-staging.yml 三个 job 的 checkout 步骤在 xian-rog 上因出境网络问题失败

## 症状
`nightly-real-machine-staging.yml`（真机夜间回归，刀A）连续多晚（07-30~08-03）失败：
- `account-scan` job 08-02/08-03 明确报 `fatal: unable to access '...': Failed to connect to github.com port 443`（checkout 步骤间歇性连不上）
- `wechat-bubble`/`douyin-read` job 另有独立根因（微信会话 flaky / smoke 脚本吞错误），本 PrepPRD 不覆盖，已登记等待后续处理

## 根因
xian-rog 到 github.com 的出境网络存在与 pc4（`nightly-android-fleet-pc4.yml`）完全相同的两层独立问题，已在 08-03 该车道的 PR#1590/#1592 验证并修复：
1. 出境带宽限速（GFW 统计限速），全量 checkout 31MB 仓库在此带宽下容易超时
2. 间歇性 TCP 连接失败（"Failed to connect...port 443"），3 次内置重试全部落空，sparse-checkout 也解决不了这层

xian-rog 本身已装 Tailscale 且在线（`rog-xian` 100.98.253.95），可复用 PC4 已验证的 HK exit-node 临时开关方案。

## 修法
对 `nightly-real-machine-staging.yml` 的三个 job（wechat-bubble / douyin-read / account-scan）的 checkout 步骤：
1. checkout 前加一步临时开 HK exit-node（`--exit-node-allow-lan-access` 保证真机 USB/网络访问不受影响）
2. `actions/checkout@v4` 加 `sparse-checkout`，按各 job 实际需要的最小路径：
   - wechat-bubble → `services/agent/tools`
   - douyin-read → `.github/workflows/scripts/smoke`
   - account-scan → `.github/workflows/scripts/smoke`
   （已逐个 grep 确认三个脚本均无 repo 内其他路径依赖）
3. checkout 后加一步关闭 exit-node（`if: always()`，不常驻占用）

## 关联上下文
- 相关 Issue：`9b6d49a7`（CI失明族: 夜间三闸从未绿，P0 In progress）——本 PrepPRD 只解决其中 account-scan 的网络子问题，issue 本身留 open 等 wechat-bubble/douyin-read 两个独立根因处理完再关
- 相关历史修复：PR#1590（sparse-checkout）、PR#1592（exit-node）——pc4 车道已验证生效的同源修法，本次是同一坑在另一台 runner 上的复现

## Regression Test 计划
CI checkout 网络问题无法用逻辑 test 复现（环境接缝），守卫改为运行时证据：下一次 schedule 触发（每晚北京 03:00）观察 account-scan job 的 checkout 步骤是否不再出现 `Failed to connect to github.com` — 已在 issue 9b6d49a7 留言跟踪，连续 2 晚 checkout 成功即视为验证通过。

## 验收标准
- [ ] 三个 job 的 checkout 步骤加上 exit-node 开关 + sparse-checkout
- [ ] workflow_dispatch 手动跑一次验证 checkout 步骤本身不再报网络错误（不要求三个 job 全绿，wechat-bubble/douyin-read 的独立根因不在本次范围）
- [ ] CI 全绿（workflow 自身的 lint）
