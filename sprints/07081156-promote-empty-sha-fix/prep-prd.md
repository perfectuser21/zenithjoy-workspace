# Bug PrepPRD：promote-prod.yml 留空 sha（文档默认用法）时假成功，实际从未部署

## 症状
2026-07-08 触发 promote-prod.yml（sha 留空，走文档写明的默认用法："留空=用常驻 staging 当前 sha"），
workflow 报告 success，但 rog 真机 20+ 分钟后仍是旧版本 v1.0.110，没有拉到 1.0.112。
查看完整 run log 发现：SSH 连上后立刻 `bash: line 2: $1: unbound variable`，remote 脚本
从未真正执行到 `blue_green_deploy`，生产从未被真正 promote 过。

## 根因假设
`ssh ... bash -s -- "$INPUT_SHA" << 'REMOTE_EOF'`：当 `$INPUT_SHA` 为空字符串时，SSH 把
本地 argv 拼接成远端命令行发送，空字符串参数在拼接过程中被吞掉——远端 `bash -s --` 实际
收到零个位置参数，heredoc 脚本里 `INPUT_SHA="$1"` 在 `set -u` 下直接因未绑定变量报错退出。
同时外层 GitHub Actions `run:` 脚本没有 `set -e`，SSH 调用失败后仍继续执行到最后一行
`rm -f "$KEY_FILE"`（该命令本身成功），step 整体退出码 = 0，被判定 success——两层问题
叠加导致这个 workflow 对"留空 sha"这个文档写明的默认/最常见用法从未真正工作过，且从未
被发现（因为一直误报成功）。

## 修法
1. `.github/workflows/scripts/deploy-lib.sh` 新增可单测函数 `resolve_promote_target_sha`，
   把"输入为空 → 回退读 staging 软链 sha；输入非空 → 直接用；两者都拿不到 → 报错"的逻辑
   收口成一个纯函数，用 `${1:-}` 而非 `$1` 容忍零参数调用。
2. `promote-prod.yml` 的 remote heredoc 改调用这个新函数，不再自己内联复制一份逻辑。
3. 外层 `run:` 脚本顶部加 `set -e` + 用 `trap 'rm -f "$KEY_FILE"' EXIT` 替代脚本末尾裸
   `rm -f`，确保 SSH 失败时 step 真的报红，不再被最后一条无关命令的退出码掩盖。

## Regression Test 计划
`deploy-lib.test.sh` 新增测试：
- Case P：`resolve_promote_target_sha` 零参数调用（模拟 SSH 吞空参数）+ 有效 staging 软链
  → 正确回退到软链指向的 sha，不崩溃
- Case Q：`resolve_promote_target_sha` 传入显式 sha → 直接返回该 sha，忽略软链
- Case R：`resolve_promote_target_sha` 零参数 + 无 staging 软链 → 返回非 0（报错，不能悄悄用空字符串当 sha）

> ⚠️ 环境接缝：SSH 参数丢失这个具体行为是 ssh 协议层拼接语义，CI test 测不到"真实 SSH 命令行
> 到底怎么拼"这件事本身——但把逻辑收口进纯函数 + 用 `${1:-}` 后，无论 SSH 层怎么丢参数，
> 远端脚本都不会再因为 `set -u` 直接崩溃，从行为上根治了这一类问题，不依赖"预测 SSH 到底
> 会不会丢空参数"这个环境细节。

## 验收标准
- [ ] failing test 先 commit（函数不存在 → Case P/Q/R 报错）
- [ ] 实现后 3 个 case 全绿
- [ ] promote-prod.yml 改用新函数 + 外层脚本 set -e + trap 清理
- [ ] CI 全绿
