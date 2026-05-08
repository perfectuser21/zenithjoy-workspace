---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: 扫码绑个微 + 飞书 4 表 + Dashboard 入口 + 8 fixture script

**范围**: Python qr_bind.py（PC 微信扫码，--dryrun 在 Mac mini 跑通）+ feishu-bitable.ts createPath4Bitables 4 张表（客户档案/营销画像/内容排期/互动记录）+ Dashboard AgentMachines 绑微信按钮 + 通道下拉 + playwright e2e + 8 个 fixture script（全 --help）
**大小**: L
**依赖**: ws1

## ARTIFACT 条目

- [ ] [ARTIFACT] qr_bind.py 存在 + 支持 --dryrun + --simulate-no-wechat
  Test: test -f services/agent/wechat-rpa/qr_bind.py && grep -E "argparse|dryrun|simulate-no-wechat" services/agent/wechat-rpa/qr_bind.py | wc -l | awk '{ exit ($1 < 2) }'

- [ ] [ARTIFACT] services/agent/wechat-rpa/__init__.py 含 __all__ 严格白名单
  Test: grep -E "__all__.*=.*\[.*qr_bind.*listen_chat.*send_chat.*send_moment.*rate_limiter.*find_weixin" services/agent/wechat-rpa/__init__.py

- [ ] [ARTIFACT] feishu-bitable.ts 含 createPath4Bitables + getPath4BitableSchema
  Test: grep -E "export.*(createPath4Bitables|getPath4BitableSchema)" apps/api/src/services/feishu-bitable.ts | wc -l | awk '{ exit ($1 < 2) }'

- [ ] [ARTIFACT] Dashboard AgentMachines 含'绑定微信'按钮 + 通道下拉
  Test: grep -E "绑定微信|wechat-bind" apps/dashboard/src/pages/AgentMachines.tsx

- [ ] [ARTIFACT] playwright spec 含 visible/happy/disabled 3 case
  Test: grep -cE "test\(.*visible|test\(.*happy|test\(.*disabled" apps/dashboard/e2e/wechat-bind-button.spec.ts | awk '{ exit ($1 < 3) }'

- [ ] [ARTIFACT] 8 个 fixture script 全部存在
  Test: for s in seed-feishu-customer seed-feishu-profile seed-feishu-schedule update-feishu-schedule count-feishu-interaction count-feishu-schedule get-feishu-interaction get-feishu-schedule; do test -f apps/api/scripts/${s}.js || exit 1; done

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/qr-bind.test.ts`、`tests/ws2/feishu-4-tables.test.ts`、`apps/dashboard/e2e/wechat-bind-button.spec.ts`，覆盖：

- python3 qr_bind.py --dryrun 在本机 Mac mini 跑通 → JSON {ok:true, dryRun:true, wechat_id, nickname}
- python3 qr_bind.py --simulate-no-wechat → JSON {ok:false, reason:'wechat_not_running'}
- createPath4Bitables({appId, appToken}) → 4 张表全部创建（缺一张 fail）
- getPath4BitableSchema() 4 表字段全（客户档案 5 字段/营销画像 3/内容排期 5/互动记录 6）
- Dashboard playwright case 1（visible）：按钮真渲染可见可点
- Dashboard playwright case 2（happy）：点击触发 POST /api/wechat/qr-bind → 200 + task_id
- Dashboard playwright case 3（disabled）：企微选项 disabled 显示"加厚阶段开放"
- 8 fixture script 全部支持 --help 显示 usage
