# Bug PrepPRD：M4 嵌套部署文件保持原目录

任务：870eb051-4e57-4ae9-bdde-40e6323d04db；Actor：Codex。
GP-Anchor: line02/keyword_acquisition keep-green

## 症状与实证
40c 正式七项 Pilot 通过后，native 部署在 M4 的 commander/wf-agent-handoff.py 复制失败，目标错误为 bin-harvest/.commander/wf-agent-handoff.py.deploy-new；未生成新 ACK。MMV 同类入口已通过。本修复延续既有用户授权与 Task，不重建业务。

## 修法与边界
仅修 deploy.sh 的 DEVICE_NODE_FILES 循环，使用真实 dirname、mkdir、basename，语法检查仍保留完整原相对路径；覆盖两份 commander Python 与 config JSON。审计其它真实数组及复制入口。保持部署失败非零/旧原子文件不变，禁止伪造 ACK、手删 .deploying、修改暂停或业务。最终 Source 五定义按正常发布要求 patch，正文不变；不改方法、评分、手机控制逻辑。

## Proven-to-fire 验收
- 真实生产循环及 push_atomic 的离线传输 fixture：MMV/M4 顶层与原不存在嵌套目录都成功。
- 两宿主 mkdir/scp/mv 故障各非零，无 ACK，旧 final 字节不变。
- RED 测试先提交；最小修复后 GREEN；独立审查与正式所有 CI。
- 正式新 Source/Pilot/完整安装与独立 ACK 核验另以真实证据收口；本地测试不冒生产通过。
