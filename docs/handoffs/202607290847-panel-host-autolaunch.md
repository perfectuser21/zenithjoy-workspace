# Handoff：核心进程实际拉起作战窗WPF壳(agent-panel-host)

**Verdict**: PASS
**Branch**: cp-07290828-panel-host-autolaunch

## 完成
- 发现PrepPRD 12步Golden Path全部标记验证通过，但真实zenithjoy-agent.exe核心进程从未拉起过apps/agent-panel-host——本sprint所有真机验证都是schtasks手动拉起WebView2窗口，客户真实装机后看不到作战窗
- 新增services/agent/src/agent-panel-launcher.ts（TDD 5用例）：ws连上中台open事件时拉起agent-panel-host/ZenithJoyAgentPanel.exe，detached+unref，进程生命周期内只拉一次
- 新增apps/agent-panel-host/SingleInstanceGuard.cs（TDD 6用例，本地首次装dotnet SDK真跑通）：具名Mutex单实例守卫，接入App.xaml.cs OnStartup，防止重复拉起开出两个重叠窗口
- services/agent/package.json 2.0.93→2.0.94
- PR #1517已合并（GP-Anchor: line04/customer_private_ai keep-green）

## 没完成
- 发现并登记了一个真实的、与本PR无关的预存缺陷（issue 14314b94）：crawl-comments-douyin.cjs未复用共享burner Chrome导致Line02关键词→评论smoke真机测试固定失败，不阻塞本PR合并（非required check）

## 下一步
- 继续xian-rog真机部署：用带修复的新代码重新构建zenithjoy-agent.exe+agent-panel-host，替换v2.0.93目录内容，重新触发.active-core自升级，用真实截图验证ZenithJoyAgentPanel.exe进程真的被拉起且渲染正常

## 数据源
- services/agent/src/agent-panel-launcher.ts
- apps/agent-panel-host/SingleInstanceGuard.cs
- sprints/07280929-agent-panel-knife1/prep-prd.md

## 产物
- PR #1517: https://github.com/perfectuser21/zenithjoy-workspace/pull/1517
- Branch: cp-07290828-panel-host-autolaunch
