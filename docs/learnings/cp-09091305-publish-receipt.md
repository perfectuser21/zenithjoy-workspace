# 执行器回执端点（line01 刀3a）（2026-09-09）

## 任务简述
执行器（AI+skill 安卓真机）发完后写回结果：PATCH /api/publish-tasks/:id/receipt → status done/failed + receipt 合并进 result；编排台（刀2）回执方向随即自动写回 Notion 行。

### 根本原因
老 ack 通道绑死 agent.license_id，AI 执行器没有该身份；tenant 级 license 鉴权 + 任务归属校验是执行器协议的正确口径。

### 下次预防
- [ ] "SELECT 判态再 UPDATE" 的幂等一律升级为 UPDATE ... WHERE status=ANY(非终态) 的 CAS——超时重试就是并发的标准形态，串行幂等防不住。
- [ ] 枚举语义常量（非终态集合）只允许一份，落在被各消费方共同 import 的 service；手抄同值副本=H-3 类 sweep 的隐形炸弹。
- [ ] jsonb `||` 是浅合并：往任务 result 里塞回执要用固定子键（receipt），不覆盖发布包 payload。
