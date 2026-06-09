# Sprint PRD — Agent 系统 hardening：模块级 preflight blocking + 全用户健康状态可见

## OKR 对齐

- **对应 KR**：Line04 客户私域 AI 接管 — Agent 系统 hardening（journey 57df0a2e）
- **当前进度**：skeleton
- **本次推进预期**：thin — preflight blocking 就绪 + 健康状态全用户可见

## 背景

客户在 Windows 机器运行 Agent 后，Line04（微信 AI 客服）依赖特定微信版本和环境配置。当前 preflight 失败仅 warn 不阻断，导致"装好了但没反应"。模块健康看板限超管，运营无法自助查看机器状态。

## Golden Path（核心场景）

用户/系统从 [客户双击 start.bat] → 经过 [line04-preflight 逐项检测 + Dashboard 状态可见] → 到达 [全部通过则 Agent 启动 / 任一失败则 cmd 显示原因退出]

具体：
1. 客户双击 `start.bat`，Agent 执行 line04-preflight
2. preflight 按序检测：微信版本 → 四层版本锁 → pywinauto → UIA → 中台连通
3. 任一项 failed → `start.bat` 退出码非 0，cmd 窗口显示具体失败项及修复提示，Line04 不启动
4. 全部通过 → Agent 启动，Line04 激活，检测结果上报中台
5. 客户打开 Dashboard「微信 AI 客服」设置页 → 顶部「本机环境状态」卡片显示各项 ✅/❌
6. 运营打开 `/module-health` → 普通账号直接可见所有机器状态，无需超管权限

## 边界情况

- 多台机器：设置页卡片展示最近活跃的一台机器的 preflight 状态
- 无数据（Agent 未连）：卡片显示「Agent 未连接或尚未上报」
- 微信版本已是 4.1.8 且四层锁完整：preflight 通过，不重复操作
- 微信版本 ≥4.1.9：preflight 自动降级到 4.1.8 后继续执行四层锁
- 四层锁部分失效：每次 `start.bat` 重跑 `check_lock_update()`，发现异常立即重锁

## 范围限定

**在范围内**：
- `navigation.config.ts` 删除 `/module-health` nav 项的 `requireSuperAdmin: true`
- `WechatCustomerServiceConfigPage.tsx` 顶部加 `<Line04PreflightCard />` 组件，调 `fetchModuleHealth()`
- `preflight.py` `check_lock_update()` 扩展四层锁：icacls 只读 + 域名防火墙出站 block + 注册表 AutoUpdate=0
- `start.bat` preflight failed 改为 blocking：`exit /b 1`，不再 warn-and-continue

**不在范围内**：
- Line01/02/05 配置页的状态卡片
- Agent 本地 UI 弹窗
- preflight 历史记录 / 趋势图
- 多机器选择逻辑（展示最近活跃一台即可）

## 假设

- [ASSUMPTION: WeChat 4.1.8 安装包在 COS 路径不变：`zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/wechat/WeChatWin_4.1.8.exe`]
- [ASSUMPTION: `/api/agent/module-health` 端点已返回含 `module_status['line04-wechat-cs']` 的结构，无需新增端点]
- [ASSUMPTION: `start.bat` preflight 段（line 280）已将 preflight exit code 赋给变量，可直接判断]

## 预期受影响文件

- `apps/dashboard/src/config/navigation.config.ts`：删除 `requireSuperAdmin: true`（line 299）
- `apps/dashboard/src/pages/WechatCustomerServiceConfigPage.tsx`：加 Line04PreflightCard 组件
- `apps/dashboard/src/components/Line04PreflightCard.tsx`：新建卡片组件（显示 ok/reason 或无数据提示）
- `services/agent/wechat-rpa/preflight.py`：扩展 `check_lock_update()` 四层锁逻辑
- `services/agent/install-pack/start.bat`：preflight 失败路径改 blocking

## E2E 验收（windows_cloud — GitHub Actions windows-latest）

```bash
# [E2E-1] preflight --dry-run 返回 9 项，含 lock_update
python services/agent/wechat-rpa/preflight.py --dry-run \
  | python -c "import sys,json; r=json.load(sys.stdin); assert len(r)==9 and any(x['name']=='lock_update' for x in r)"

# [E2E-2] 四层锁验证（icacls DENY / 防火墙 dldir1v6.qq.com 出站 / 注册表 AutoUpdate=0）
python -c "
import subprocess,winreg
r=subprocess.run(['icacls','WeixinUpdate.exe.disabled'],capture_output=True,text=True)
assert 'DENY' in r.stdout
fw=subprocess.run(['netsh','advfirewall','firewall','show','rule','name=all'],capture_output=True,text=True)
assert 'dldir1v6.qq.com' in fw.stdout
k=winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'SOFTWARE\Policies\Tencent\WeChat')
v,_=winreg.QueryValueEx(k,'AutoUpdate'); assert v==0
print('✅ E2E-2 四层锁通过')
"

# [E2E-3] start.bat preflight-failed → blocking（mock preflight exit 1）
cmd /c "set PREFLIGHT_MOCK_FAIL=1 && start.bat"
IF %ERRORLEVEL%==0 (echo FAIL && exit 1) ELSE echo "✅ E2E-3 blocking confirmed"

# [E2E-4/5] Dashboard 普通账号访问 /module-health + Line04PreflightCard 渲染
# → apps/dashboard/e2e/module-health-access.spec.ts + line04-preflight-card.spec.ts
```

## journey_type: dev_pipeline
## journey_type_reason: PrepPRD 明确标注 Agent 系统 hardening（57df0a2e）为 dev_pipeline Journey，涉及 Agent install-pack 构建链路
## target_environment: windows_cloud
## target_environment_reason: preflight.py / start.bat / 四层锁死逻辑必须在 GitHub Actions windows-latest 上验证；Dashboard UI 部分另建 mac_web Playwright spec
## journey_id: 57df0a2e
## step_id: L04-preflight-blocking
