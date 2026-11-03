# CI/CD 有效性批量修复

从 `b90c3c74c` 独立分支开展多轮并行修复。首轮9类问题不是全仓审计的终点；本批沿相同故障模式继续检查并修复相邻消费者。

## 最终行为

- 七组 required 门禁共享严格的差异与聚合合同：上游非成功、缺失/非法布尔输出、选中任务跳过、任何实际失败/取消均拒绝。业务 job 保留，Lead Windows 仍仅手动执行，WeChat 固定来源证明保留。
- push/PR/merge_group 使用各自真实事件 SHA，Git 差异失败不能成为空变更。共享锁、workspace 清单、检查脚本与 Agent 依赖覆盖其实际消费者；Staff Hub 全套纳入 Runtime。
- npm audit 区分有效漏洞报告与执行/解析失败，保留原豁免名单。登录态未知、状态回写、同步和通知失败准确返回非零。
- 同步验证完整 Cookie 输入，支持真实生产者的数组/storageState，保留 origins/localStorage；非法输入不能写 Secret。主号目标对齐现役 workflow 的 `*_COOKIES`，通知路径正确编码。
- Registry 真正解析结构，检查全执行器命名、重复、真实路径、符号链接边界、退役与替代。历史删除项保留证据，新库存如实标待分类/待接入，不以登记证明执行。
- L2 直接检查已提交投影，不能先 generate 修平漂移。两个孤儿回归进入正式命令；CLI fixture 读取现行固定来源，不导入另一测试文件注册重复用例。
- 两个 Dashboard 测试渲染真实页面，移除测试内复制的 URL/状态逻辑；下载、状态、预览长度突变均能击穿业务断言。
- Core Regression 从语法哨兵改为真实离线发布准入与持久化恢复回归。破坏实际 coordinator 后 PR/Release 均失败。旧 GP 自测改为私有夹具并接 CI，不再依赖原开发 PR 的 diff。

## 验证

以下为同一修复树的本地完整套件结果；各套件存在相邻回归重叠，不相加冒充独立测试总数。

| 套件 | 结果 |
|---|---|
| `.github/workflows/scripts/__tests__/*.test.mjs` | 880/880，通过；包含所有新增门禁与故障注入 |
| `npm run test:product-map` + drift check | 112/112；已提交投影无漂移 |
| `npm run test:acceptance-spec` | 55/55 |
| 固定源 Agent scope 与 orphan 兼容回归 | 14/14 |
| Staff Hub 默认完整套件 | 12文件，45/45 |
| Dashboard 默认完整套件与 coverage | 107文件，720通过，10原有TODO，0失败；四项现行阈值通过 |
| process/business gates + Core runner旧兼容自测 | 15项Python通过，4个Shell场景通过 |
| Registry / YAML / diff | 1844个现存登记、1823个命名测试；87份workflow可解析；无diff空白错误 |

先红后绿保留于测试提交和本地日志。独立作者复核分别运行了504项门禁、50项安全链以及真实curl解析反例。验证中曾发现本机稀疏workspace安装缺依赖和Python解释器缺PyYAML，统一安装/选用已具备依赖的解释器后，仅对受影响失败复验并保留首次日志，未降低任何产品阈值或断言。

## 证明边界

本地HTTP、Git、文件持久化及传输替身不联系生产数据库、真实通知或设备。远端CI仍须以本PR的检查读回为准。

L1和Smoke收到merge_group时发出明确失败关闭：没有逐PR元数据/基线删除理由的等价证据不能放行。没有宣称完整启用merge queue，也未修改分支保护来删除必需检查。

本批不宣称逐条语义审阅全部1823个测试，待接入库存也不是已运行保障。未触碰原主工作区的既有暂存变更；没有主动部署生产。
