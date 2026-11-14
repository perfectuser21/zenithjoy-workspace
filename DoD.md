# 验收

- [x] [BEHAVIOR] 内容业务由ZenithJoy本地接口和固定六阶段Worker拥有，不调用Brain旧内容业务API。
  Test: manual:npm test --workspace=apps/api -- --run src/controllers/__tests__/pipeline-brain-handoff.test.ts
- [x] [BEHAVIOR] Brain挂号、原生epoch认领、续租和幂等回执控制Worker起跑及终态，未知结果不重执行业务。
  Test: manual:python -m pytest services/content-pipeline/tests/test_worker_brain_handoff.py services/content-pipeline/tests/test_brain_task_client.py
- [x] [BEHAVIOR] 本地内容工厂展示真实能力和挂号状态，旧配置工具退出；历史产物保留且重跑使用独立目录。
  Test: manual:npm test --workspace=apps/dashboard -- --run
- [ ] [BEHAVIOR] 原有CI全部必需检查通过后合并；本轮不晋级生产。
  Test: manual:bash -c 'gh pr checks --repo perfectuser21/zenithjoy-workspace'
