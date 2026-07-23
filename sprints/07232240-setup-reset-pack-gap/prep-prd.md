# Bug PrepPRD：build-install-pack.sh 漏拷贝 setup-reset.ps1 + 从未被调用，清环境功能零交付

## 症状
rog 真机安装目录 `zenithjoy-agent-v2.0.88/` 下没有 `setup-reset.ps1` 这个文件；即使补上，仓库里除 contract test 断言脚本内容外，`start.bat`/`install-autostart.ps1` 都没有任何调用点。

## 根因假设
刀B（安装框架 M1，PR#1437）写了 `services/agent/install-pack/setup-reset.ps1`（环境清理：杀残留进程/清 HKCU ZENITHJOY_* 变量/重建计划任务）+ 对应 contract test（`setup-reset-ps1-contract.test.ts`），但打包脚本 `services/agent/scripts/build-install-pack.sh` 的两处 cp 清单（dev 模式段 行61-65 + release 打包段 行107-120）都漏了拷贝这一行；同时产品意图（装机/更新时跑一次环境清理）从未接入实际调用链。

## 关联上下文
- 相关 Journey：智能客服 · 绑定/安装（共享前置）(6df5b884-2ae1-4801-95e8-bb7a11f308d2, mvp)；客户私域 AI 接管 (bfeed805-deed-46c3-8624-87f0028101d4, skeleton)
- 相关 Issue：73a75417-e636-407e-b29b-41faf41afde7
- 相关历史决策：无匹配

## 修法
1. `build-install-pack.sh` 两处 cp 清单都补 `cp install-pack/setup-reset.ps1 "$PACK_DIR/"`（跟随同段其它行的容错风格，release 段其它可选文件多带 `2>/dev/null || true`）
2. `install-autostart.ps1`（安装/开机自启动配置脚本）接入调用 `setup-reset.ps1`：装机/更新流程执行一次（非每次 start.bat 启动都跑，避免重复杀进程/重建计划任务的过度操作）
3. 判定点：调用时机选"装机/更新时跑一次"——用户确认维持此方案（未选"每次启动都跑"）

## Regression Test 计划
扩展 `services/agent/install-pack/__tests__/setup-reset-ps1-contract.test.ts`（或新增同目录 test）：
1. 断言 `build-install-pack.sh` 源码含拷贝 `setup-reset.ps1` 到 `$PACK_DIR` 的行（两处清单都要）
2. 断言 `install-autostart.ps1` 源码含调用 `setup-reset.ps1` 的逻辑

这两条测试先写、先跑红（当前 origin/main 状态下必然失败），再改代码让其转绿，永久留 CI 做 regression test。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 已为本 bug 配 proven-to-fire 守卫（亲眼看两条测试在修复前报红过）
- [ ] CI 全绿
