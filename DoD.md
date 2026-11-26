# 组织素材库投影迁出OpenClaw

Task-ID: 89ef81f7-eb25-4e17-b1cc-910406516a02
GP-Anchor: none(infra)

- [x] 既有素材投影两脚本原字节归位真实ZJ业务仓，原MMV现场代码保留；不新增组织或页面库。
  Test: manual:python3 -m unittest discover -s apps/api/scripts/tests -p 'test_materials_projection.py' -v
- [x] 原组织身份、数据库只读约束、Notion目标与回执逻辑保持；非法来源和未授权现有页禁止写入，原1P刷新和job锁保留。
  Test: manual:python3 -m unittest discover -s apps/api/scripts/tests -p 'test_*.py' -v
- [x] 独立副本破坏真实组织边界后业务断言报红，正式源字节未改。
  Test: manual:python3 -m unittest discover -s apps/api/scripts/tests -p 'test_materials_projection.py' -v
- [ ] 严格PR合并固定新SHA；原host发布双摘要核验，新入口单次真实读回成功后启用唯一Brain调度，旧精确cron通过官方入口停用；以Task证据记录结果，不以源码合并代替完成。
  Test: manual:python3 -m unittest discover -s apps/api/scripts/tests -p 'test_*.py' -v
