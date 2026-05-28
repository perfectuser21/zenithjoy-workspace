---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: Agent qr-bind-operator handler

**范围**: 新建 `services/agent/src/handlers/qr-bind-operator.ts`（8 平台统一 handler，CDP 19222，storageState 抓取，5min 超时，POST upload-cookies）；注册 qr_bind/{platform} × 8 到 `services/agent/src/index.ts`
**大小**: M（~165 行净增，2 文件）
**依赖**: Workstream 4 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/src/handlers/qr-bind-operator.ts` 存在且导出 handleQrBindOperator 函数
  Test: bash -c 'grep -qE "export (function|const|async function) handleQrBindOperator\|exports\.handleQrBindOperator" services/agent/src/handlers/qr-bind-operator.ts && echo OK || { echo "FAIL: handleQrBindOperator 未导出"; exit 1; }'

- [ ] [ARTIFACT] handler 含 8 平台 creator URL 映射（douyin/kuaishou/xiaohongshu/shipinhao/toutiao/weibo/zhihu/gongzhonghao）
  Test: bash -c 'F="services/agent/src/handlers/qr-bind-operator.ts"; for p in douyin kuaishou xiaohongshu shipinhao toutiao weibo zhihu gongzhonghao; do grep -q "$p" "$F" || { echo "FAIL: handler 缺平台 $p 映射"; exit 1; }; done; echo OK'

- [ ] [ARTIFACT] dispatcher index.ts 已导入 qr-bind-operator handler
  Test: bash -c 'grep -qE "qr-bind-operator|handleQrBindOperator" services/agent/src/index.ts && echo OK || { echo "FAIL: dispatcher 未导入 qr-bind-operator"; exit 1; }'

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] handler 含 CDP 端口 19222 连接逻辑
  Test: manual:bash -c 'F="services/agent/src/handlers/qr-bind-operator.ts"; grep -q "19222" "$F" || { echo "FAIL: handler 缺 CDP 19222 端口"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] handler 含 5 分钟（300000ms）超时保护
  Test: manual:bash -c 'F="services/agent/src/handlers/qr-bind-operator.ts"; grep -qE "300000|5.*60.*1000|5.*minute|timeout.*300" "$F" || { echo "FAIL: handler 缺 5min(300000ms) 超时保护"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] handler 调用 POST upload-cookies（POST 到 ZENITHJOY_API_BASE/api/operator/sessions/upload-cookies）
  Test: manual:bash -c 'F="services/agent/src/handlers/qr-bind-operator.ts"; grep -qE "upload-cookies|upload_cookies" "$F" || { echo "FAIL: handler 缺 upload-cookies POST 调用"; exit 1; }; grep -q "platform" "$F" || { echo "FAIL: handler POST body 缺 platform 字段"; exit 1; }; grep -qE "cookies|storageState" "$F" || { echo "FAIL: handler POST body 缺 cookies/storageState"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] dispatcher index.ts 注册至少 douyin/kuaishou 两个 qr_bind/ 路由分发
  Test: manual:bash -c 'F="services/agent/src/index.ts"; grep -c "qr_bind" "$F" | { read n; [ "$n" -ge 2 ] || { echo "FAIL: dispatcher qr_bind 路由数=$n 期望 ≥2"; exit 1; }; echo OK; }'
  期望: OK

- [ ] [BEHAVIOR] 超时后 handler 返回包含 ok:false 和 error 字段（禁止返回 ok:true 假阳性）
  Test: manual:bash -c 'F="services/agent/src/handlers/qr-bind-operator.ts"; grep -qE "ok.*false|ok:.*false|\"ok\":.*false" "$F" || { echo "FAIL: handler 超时路径缺 ok:false 响应"; exit 1; }; grep -qE "timeout\|超时" "$F" || { echo "FAIL: handler 缺超时判断逻辑"; exit 1; }; echo OK'
  期望: OK
