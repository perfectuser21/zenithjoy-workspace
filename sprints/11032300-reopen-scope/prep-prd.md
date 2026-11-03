# 候选重开按原安全事务核对精确待审名单

GP-Anchor: none(infra)
任务：52a29b7e-3641-4cc7-81a6-3c750bba4a71

原现场phone-safety-3fe事务记录两个待审serial；重开脚本却固定要求三个，因此合法现场必被拒绝。相同数量不能证明是原名单。

仅改重开scope校验：原journal摘要、全部五步完成、生产manifest和自动入口静止检查保留；journal名单须非空、合法且无重复；沿用双根inventory/hash/guard/owner原件校验，两个根的owner集合必须精确等于原journal名单。prepare只建立全新空命名空间，不改旧sealed目录、journal或任何owner。finalize保持精确OLD身份、独立证据及最后owner禁止释放。

验收：两owner合法现场和三owner旧场景通过；同数量换serial、缺失/额外owner、重复/非法scope及证据漂移拒绝；中断重放不恢复旧根；2到1仅释放已固定OLD_SERIAL，另一owner逐文件字节不变；最后owner仍拒绝。

已完成：红测试commit4d4abb1b，最小实现f35867f9；root独立读diff并运行全部48项Python和2项workflow测试，均通过。现场重开尚未执行，依赖上一PR正常合并及原锁迁移事务成功。
