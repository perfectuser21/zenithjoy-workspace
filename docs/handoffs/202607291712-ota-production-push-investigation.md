# Handoff：作战窗推production调查——发现并修复两个真实生产基础设施缺陷，实际promote待用户触发

**Verdict**: PARTIAL PASS（代码/CI/配置已修好，真正推给客户这最后一步是人工闸，不由AI触发）
**Branch**: 见下方产物列表

## 完成
用户要求把作战窗刀1真的推给生产客户，排查OTA(`.github/workflows/agent-installpack.yml`)链路时发现并修复两个真实、跟本session直接相关的生产级缺陷：

1. **build job一直失败**：本session早前把`apps/agent-panel`的vite build接进了`build-install-pack.sh`，但`agent-installpack.yml`只`npm install`了`services/agent`，从未装过`apps/agent-panel`的devDependencies(含vite)——`'vite' is not recognized`，job必红，下游publish job被跳过。已修（PR #1538）。

2. **publish job写manifest.json失败**：build job修好后第一次真正跑到publish这一步，hk-vps `zenithjoy-api-prod`容器日志实锤`EROFS: read-only file system`——`deploy/docker-compose.prod-api.yml`的install-pack挂载点自PR #1302(2026-07-15生产API迁HK)首次引入就是`:ro`只读，manifest写入端点从那天起就没真正成功过，跟本session任何改动无关，是更早的既有缺陷，本session才第一次真正暴露出来。已修（PR #1542）。

## 没完成 / 有意不做
- **实际把这次修复promote到生产容器**：本仓库死规矩(`deploy/docker-compose.prod-api.yml`文件头注释)——生产容器只由`promote-prod-hk.yml`(workflow_dispatch人工闸，文件自身注释"绝不自动触发")或用户手动操作更新。PR合进main只是让配置就绪，不会自动改动正在跑的生产容器。**真正的OTA推送需要用户手动触发`promote-prod-hk.yml`**，这是本仓库既有设计，不是本次新加的限制。

## 下一步
1. 用户在GitHub Actions页面手动触发`promote-prod-hk.yml`（workflow_dispatch），把hk-vps `zenithjoy-api-prod`容器promote到最新main（含install-pack可写挂载修复）
2. Promote完成后，重新手动触发一次`agent-installpack.yml`(workflow_dispatch)或等下次services/agent变更自动触发，验证publish job这次真的能成功写manifest.json
3. 确认manifest.json真的更新后，用一个已知的真实(非smoke)客户license验证心跳→自升级流程走通（真实customer机器，不是xian-rog）

## 数据源
- `.github/workflows/agent-installpack.yml`（build/publish两阶段OTA流水线）
- `deploy/docker-compose.prod-api.yml`（生产容器挂载配置+人工闸规矩说明）
- `.github/workflows/promote-prod-hk.yml`（真正的生产promote人工闸workflow）
- hk-vps `docker logs zenithjoy-api-prod`（EROFS错误实锤来源）

## 产物
- PR #1538：修build job缺npm install
- PR #1542：修install-pack挂载:ro只读
