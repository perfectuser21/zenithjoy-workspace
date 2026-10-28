# Bug：正式ADB服务恢复后的新epoch被维护器误拒

GP-Anchor: line02/keyword_acquisition keep-green

38e533f2-3287-442b-ab8c-69b795b07212。原f1 attempt4真实device、MMV、native覆盖均满足，唯一拒绝对象为014e正式受控恢复后的699 supervisor/ADB。现有external root年龄约束正确保守，但缺少正式恢复闭环。

仅当新维护Ops的委托合同明确引用正规已完成恢复Task，且同Project/root/原owner及claimed_at、单TERM、原/新native身份、source699/config/plist/binary和当前system job链全部可核，允许此一个原服务的新epoch。其他root保原年龄约束。原Task/原UNKNOWN/原f1 journal不改；新代码必须正常候选准入后使用新Ops/新intent，不重跑旧f1。

测试先复用本次归档capture重放，固定历史时钟，不称当前现场证明。负例覆盖伪恢复、错误归属、gui同名、配置/源码/二进制/出生漂移及覆盖不完整。公开CLI仍仅TaskID，不接调用者proof。
