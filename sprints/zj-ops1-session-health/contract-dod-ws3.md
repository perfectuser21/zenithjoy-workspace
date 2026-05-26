---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Operator Dashboard Tab 1（8×4 状态矩阵 + is_operator 守卫）

**范围**: 新建 `apps/dashboard/src/pages/OperatorPage.tsx`（8 平台行 × 4 账号列状态矩阵，每格显示 在线/离线/未配置 + 上次同步时间，is_operator 权限守卫，"立即同步"按钮）；`apps/dashboard/src/config/navigation.config.ts` 注册 /operator 路由
**大小**: M（~180 行净增）
**依赖**: Workstream 2 完成后（Dashboard 读取的数据格式与 WS1/WS2 一致）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/OperatorPage.tsx` 文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/OperatorPage.tsx')" && echo OK

- [ ] [ARTIFACT] OperatorPage.tsx 包含 8 个平台的定义（中文平台名或对应英文标识符）
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/pages/OperatorPage.tsx','utf8'); const p=['抖音','快手','小红书','视频号','头条','微博','知乎','公众号']; const miss=p.filter(x=>!s.includes(x)); if(miss.length>0){console.error('FAIL: 缺平台',miss);process.exit(1)}; console.log('OK: 8 平台存在')"

- [ ] [ARTIFACT] OperatorPage.tsx 包含 4 账号列类型（MAIN/SUB_1/SUB_2/SUB_3）
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/pages/OperatorPage.tsx','utf8'); ['MAIN','SUB_1','SUB_2','SUB_3'].forEach(a=>{if(!s.includes(a)){console.error('FAIL: 缺账号类型',a);process.exit(1)}}); console.log('OK: 4 账号类型覆盖')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 包含 /operator 路由注册
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8'); if(!s.includes('/operator')&&!s.includes('operator')){console.error('FAIL: 未注册 /operator');process.exit(1)}; console.log('OK: /operator 路由已注册')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] OperatorPage.tsx 包含 is_operator 权限守卫逻辑（通过 email 或 role 判断）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\"); if(!s.match(/is_operator|isOperator|operator.*email|xuxiao21xx/)){console.error(\"FAIL: 无 is_operator 权限守卫\");process.exit(1)}; console.log(\"OK: is_operator 守卫存在\")"'
  期望: OK: is_operator 守卫存在

- [ ] [BEHAVIOR] 非 operator 用户访问时有 redirect 或 403 处理
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\"); if(!s.match(/redirect|navigate|403|Unauthorized|未授权/i)){console.error(\"FAIL: 无未授权处理（redirect/403）\");process.exit(1)}; console.log(\"OK: 未授权处理存在\")"'
  期望: OK: 未授权处理存在

- [ ] [BEHAVIOR] 页面含"立即同步"按钮（触发手动 sync）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\"); if(!s.match(/立即同步|手动同步|sync.*button|SyncButton/i)){console.error(\"FAIL: 无立即同步按钮\");process.exit(1)}; console.log(\"OK: 立即同步按钮存在\")"'
  期望: OK: 立即同步按钮存在

- [ ] [BEHAVIOR] 页面含状态图标或标识（在线/离线/未配置三态显示）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\"); const hasStatus=s.match(/ok|expired|missing|在线|离线|未配置|green|red|gray/i); if(!hasStatus){console.error(\"FAIL: 无状态三态显示\");process.exit(1)}; console.log(\"OK: 状态显示逻辑存在\")"'
  期望: OK: 状态显示逻辑存在

- [ ] [BEHAVIOR] OperatorPage.tsx 导出默认组件（可被路由加载）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\"); if(!s.match(/export\s+default\s+/)){console.error(\"FAIL: 无 export default\");process.exit(1)}; console.log(\"OK: export default 存在\")"'
  期望: OK: export default 存在

- [ ] [BEHAVIOR] error path — 非 operator 用户被拦截（文件中 operator email 检查存在）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\"); if(!s.match(/xuxiao21xx|is_operator|isOperator/)){console.error(\"FAIL: operator 身份验证缺失\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，windows_cloud final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 运营员完整走完 /operator Golden Path（screenshots 验证）
  Screenshots:
    - ws3-01-initial.png     期望：/operator 页面加载完成，8×4 状态矩阵可见，平台名称列显示正确
    - ws3-02-matrix.png      期望：矩阵格子显示状态标识（在线🟢/离线🔴/未配置⚫），上次同步时间可见
    - ws3-03-sync-btn.png    期望："立即同步"按钮可见且可点击，is_operator 用户未被重定向
  期望：所有截图与期望描述一致，Claude Read 图自验通过
