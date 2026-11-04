# 七维审计清退执行

GP-Anchor: none(infra)

本次落实审计中已判定可清退的七项。六个测试退出常青执行；原文保留在 Git 历史，test-registry 六条原 ID 保留为 deprecated 并标注 retirement。没有把测试改后缀后留在默认发现目录中。

| 清退项 | 原因与保留保障 |
|---|---|
| phone-actions-in-lock.test.mjs | 旧 wf-run/batch2 正向引擎；保留现役锁/恢复与拒跑守卫 |
| runtime-start-e2e.test.mjs | 旧 wf-run 首跑正向前置合同；保留真实现役启动/协议和退役拒跑 |
| wf-run-deadline-e2e.test.mjs | 退役引擎假机采词预算；保留现役预算与回执 |
| wf-run-prepare-error-log.test.mjs | 退役门前已不可达旧 prepare 分支；保留现役协议/拒跑/脱敏合同 |
| wf-run.test.mjs | 退役正向流程；保留 wf-run-retired 与 legacy-harvest-retirement |
| apps/api/tests/index.test.ts | 测试内重写 PORT，自身绿不能保护真实入口；保留 GP4 真实构建、启动及 health |
| Pilot diagnostic workflow 388764461 | 一次性诊断，主线无文件且旧分支不存在；GitHub 服务已 disabled_manually，保留两次历史运行 |

显式 capability-phone-regression-smoke 调用同步接现役拒跑与回执保障，继续使用真实 node --test 和失败/跳过阻断。生产账本、索引、回执、旧执行包及混合协议测试均保留。

临时工作流两次历史 run：39165279614（成功）、39165140589（失败），均已结束。停用仅改变后续执行入口；没有删除 run、artifact 或日志。

## 归档来源

六份测试原文：Git `3aae3099636aeb63ecb461cd72b461b7665ac623` 的原路径。登记记录逐项保存该 SHA/path，未来有独立需求时先审现役需求与替代后再恢复。

本地与远端验证结果以本次 PR 检查及交接读回为准；本报告不将历史测试通过外推为生产业务已交付。

## 本地验收

实际 capability smoke 351/351 通过，0 skip/0 fail，136.6秒，原180秒预算不变；入口自测12/12、登记守卫29/29、真实启动配置自检18/18通过。登记校验1844个现存记录、1823个命名测试；六条退役历史保留。product-map无漂移、固定源版本准入及diff检查通过。远端必需检查仍以本PR当前SHA读回为准。

## Windows 实际失败与准备修复

首次远端 Orphan job126331417165在运行浏览器前因Chocolatey PostgreSQL包源HTTP406失败，后续数据库连接被拒；用例未执行，门禁保持红。复用同仓现役Windows流程的预装数据库服务启动方式，拆出独立pwsh步骤，显式启用服务并启动，psql和createdb非零立即抛错；保留原迁移、构建、健康探测、全部spec、取消双跑、证据与聚合。

预装服务及其Stopped/Disabled/PGBIN配置见[GitHub官方runner镜像说明](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md#postgresql)。新增既有workflow接线合同先红后绿，本地仅验证配置合同；实际Windows执行以该候选的远端结果为准。
