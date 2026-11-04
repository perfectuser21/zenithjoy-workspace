# 悦升备用设备准入修复

Task: c734170d-5fde-4cff-a595-b310df428b88
GP-Anchor: line02/keyword_acquisition keep-green

## 问题与授权范围

同公司已核验的 e6 设备缺少固定101/102 scope；公司routing包含完全相同的重复字符串。普通配置编辑正确拒绝改身份。本任务新增严格认证的独立修复入口及固定设备模板，不改账号、政策、104或旧run。

## 验收

- 真实session与同tenant owner/admin、trusted Origin检查；客户端身份头不可绕过。
- 普通流程先保存draft；POST仅接收expected_version/request_id，服务端保序消除完全相同重复profile。
- 行锁、CAS、新版本和actor/旧新hash审计同事务；旧版本/run不可变。
- 精确GET原request读回持久历史；版本后移、ACK未知、冲突与外租户不可冒成功。
- 实际隔离PG并发只提交一次，故障回滚，旧snapshot文本不变。
- 固定M4/e6模板匹配101/102，工具/策略pins取现有真实只读证据；其他模板不变。

## 测试策略

API Supertest先红后绿，运行真实认证边界与租户中间件；真实隔离PG验证事务和并发。scope通过正式默认模板消费者验证。普通编辑/登记/核验及原scope测试回归，完整必需CI。现场online/账号/native闭域仍由独立正式运行验收，源码测试不能替代现场。

## 尚未证明

未对生产配置执行写入；未启动手机；模板加入不代表当前online/账号或业务完成。正常PR/候选与独立真实session验收后才可使用新配置版本。旧431隔离不触碰。
