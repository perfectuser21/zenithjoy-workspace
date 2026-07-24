# contract-draft.md
# Sprint: Path 2 Dashboard 展示与人工干预能力建设
# Task ID: 7cb465c1-03cc-4934-a638-e61f78195d37
# Sprint Dir: sprints/07221948-path2-dashboard-visibility
# 产出时间: 2026-07-24
# target_environment: local_api

---

## 元数据

| 字段 | 值 |
|------|-----|
| contract_version | 1.0.0 |
| proposer | harness-contract-proposer |
| prd_version | 1.0.0 |
| target_environment | local_api |
| GAN_round | 1（首轮，无 reviewer feedback） |

---

## 合同范围声明

本合同覆盖 PRD 中 5 条需求（FR-1 ~ FR-5），对应 Golden Path GP-1 ~ GP-5。
target_environment=local_api，全部断言走 API 层（curl + psql），不要求 Android 真机输出。

---

## Golden Path 与 BEHAVIOR 映射

### GP-1：获客列表触达状态展示

**BEHAVIOR-GP1-A**
```
GIVEN  租户 T 有 lead L1，L1 在 dm_assignments 表有最新一条 status='sent' 的 assignment
WHEN   GET /api/acquisition/leads [X-Tenant-Id: T]
THEN   响应 JSON 中 leads 数组内 L1 对应项的 outreach_status == "touched"
       HTTP 200
```

**BEHAVIOR-GP1-B**
```
GIVEN  租户 T 有 lead L2，L2 在 dm_assignments 表无任何 assignment
WHEN   GET /api/acquisition/leads [X-Tenant-Id: T]
THEN   响应 JSON 中 L2 对应项的 outreach_status == "untouched"
```

**BEHAVIOR-GP1-C**
```
GIVEN  租户 T 有 lead L3，L3 有多条 dm_assignments 历史记录（含脏数据），
       最新一条（MAX updated_at）status='failed'
WHEN   GET /api/acquisition/leads [X-Tenant-Id: T]
THEN   L3 的 outreach_status == "retry_needed"（只取最新一条）
```

**BEHAVIOR-GP1-D（租户隔离）**
```
GIVEN  租户 T_A 有 lead LA 有 assignment；租户 T_B 无任何 assignment
WHEN   GET /api/acquisition/leads [X-Tenant-Id: T_B]
THEN   响应 leads 中不含 LA 的数据（tenant 隔离不串）
```

**判定点**：`outreach_status` 映射规则——
- `sent | dispatched | queued` → `touched`
- `failed | limited` → `retry_needed`
- 无 assignment → `untouched`
- 多条时取 `updated_at DESC LIMIT 1`

---

### GP-2：人工触达配置弹窗（选号+话术）

**BEHAVIOR-GP2-A**
```
GIVEN  租户 T，小号 ACC1 在线（agents.last_heartbeat_at > NOW()-10min，
       account_sessions.status NOT IN ('limited','blocked')）
WHEN   GET /api/acquisition/outreach/defaults?lead_id=<lead_id> [X-Tenant-Id: T]
THEN   响应 JSON 含 accounts 数组（每项含 account_label、online_source: "heartbeat_proxy"）
       + default_script 字段（非空字符串）
       HTTP 200
```

**BEHAVIOR-GP2-B**
```
GIVEN  租户 T，lead L，小号 ACC1（active），话术 S
WHEN   POST /api/acquisition/outreach/manual
       body: {lead_id: L.id, account_label: "ACC1", script_text: "S"}
       [X-Tenant-Id: T]
THEN   HTTP 200
       dm_assignments 表含 (tenant_id=T, lead_id=L.id, account_label="ACC1") 行
       行的 script_text == "S"（或通过 dm_assignments 关联字段可查到话术）
```

**BEHAVIOR-GP2-C（幂等）**
```
GIVEN  dm_assignments 已有 (T, L.id, "ACC1") 行，status='sent', script_text='old'
WHEN   POST /api/acquisition/outreach/manual
       body: {lead_id: L.id, account_label: "ACC1", script_text: "new_script"}
THEN   HTTP 200（不报 409 conflict）
       dm_assignments 中 (T, L.id, "ACC1") 行的 script_text 已更新为 "new_script"
       该租户+lead+label 组合只有 1 行（无重复插入）
```

**BEHAVIOR-GP2-D（cancelling 防重入）**
```
GIVEN  dm_assignments 中 (T, L.id, "ACC1") 行 status='cancelling'
WHEN   GET /api/acquisition/outreach/defaults?lead_id=<L.id> [X-Tenant-Id: T]
THEN   响应中该 assignment 的 status 字段明确标注或前端弹窗禁用（API 层：响应含 cancelling_assignment: true 或等价字段）
```

---

### GP-3：安卓客户端下载入口

**BEHAVIOR-GP3-A**
```
GIVEN  install-pack manifest 已就绪（服务端已有 /api/agent/install-pack）
WHEN   GET /api/agent/install-pack [任意有效租户]
THEN   HTTP 200
       响应 JSON 含 download_url 字段（非空字符串，格式为 https://... 的 URL）
       不重建下载逻辑（验证现有 agent-install-pack.ts 路由未被破坏）
```

---

### GP-4：关键词去重机制

**BEHAVIOR-GP4-A（30天内同租户同关键词触发去重）**
```
GIVEN  租户 T，关键词 K 在 30 天内已有 acquisition_collect_tasks 记录（same keywords 字段含 K）
WHEN   POST /api/acquisition/collect/start
       body: {keywords: [K], ...}（不含 force: true）
       [X-Tenant-Id: T]
THEN   HTTP 200
       响应 JSON 含 duplicate: true, days_ago: N（N >= 0 && N <= 30）
       任务不强制创建（或标记为待确认）
```

**BEHAVIOR-GP4-B（force 参数跳过去重）**
```
GIVEN  租户 T，关键词 K 在 30 天内已采集过
WHEN   POST /api/acquisition/collect/start
       body: {keywords: [K], force: true}
THEN   HTTP 200
       响应 JSON 中 duplicate 字段为 false 或不存在
       新任务正常创建（task_id 返回）
```

**BEHAVIOR-GP4-C（跨租户不触发去重——INV-2、INV-3）**
```
GIVEN  租户 T_A 30 天内采集过关键词 K
       租户 T_B 从未采集过关键词 K
WHEN   POST /api/acquisition/collect/start
       body: {keywords: [K]}
       [X-Tenant-Id: T_B]
THEN   响应中 duplicate == false（T_A 的历史不影响 T_B）
```

**BEHAVIOR-GP4-D（30天外不触发）**
```
GIVEN  租户 T 在 31 天前采集过关键词 K，30 天内无采集记录
WHEN   POST /api/acquisition/collect/start
       body: {keywords: [K]}
THEN   响应中 duplicate == false（超出 30 天窗口）
```

**BEHAVIOR-GP4-E（sec_uid 强去重）**
```
GIVEN  lead_A 已存在（tenant_id=T, sec_uid="uid_X"）
WHEN   采集任务落库时尝试插入 sec_uid="uid_X" 的新 lead（相同租户）
THEN   不产生重复行（命中 (tenant_id, sec_uid) 唯一约束，走 UPDATE 或忽略）
       DB 中 (T, "uid_X") 只有 1 行
```

---

### GP-5：任务进程可视化 + 设备类型埋点

**BEHAVIOR-GP5-A（7 态合法值）**
```
GIVEN  租户 T 有若干 acquisition_collect_tasks（含各状态）
WHEN   GET /api/acquisition/collect/tasks [X-Tenant-Id: T]
THEN   HTTP 200
       响应每条任务含 status 字段
       status 值域仅限 {pending, running, stage_1_done, done, partial, failed, cancelling}
```

**BEHAVIOR-GP5-B（失败态含 error_code 翻译）**
```
GIVEN  租户 T 有 task 状态为 failed，error_code='quota_exceeded'
WHEN   GET /api/acquisition/collect/tasks [X-Tenant-Id: T]
THEN   响应该 task 含 error_message 字段（中文人话，非空）
       error_code 'quota_exceeded' → '配额已用尽' 或等价中文说明
```

**BEHAVIOR-GP5-C（cancelling 禁重试）**
```
GIVEN  任务 TK status='cancelling'
WHEN   POST /api/acquisition/collect/retry?task_id=<TK.id> [X-Tenant-Id: T]
THEN   HTTP 409 或 HTTP 400（拒绝重试）
       响应含明确错误提示（not retryable in cancelling state）
```

**BEHAVIOR-GP5-D（设备类型字段值域统一——INV-1）**
```
GIVEN  DB schema 中 agents.os_type 列 与 line02_account_sessions.device_type 列
WHEN   psql 查询两列的 CHECK constraint 或 ENUM 定义
THEN   两列的合法值域包含 'android' 和 'windows'（或统一枚举）
       值域不存在互相矛盾的命名（如一个叫 'win32' 另一个叫 'windows'）
       PR 必须包含 migration 文件或字段枚举统一 decision 文档
```

---

## E2E 验收

target_environment=local_api，验收断言写入 `golden-path-2-smoke.sh` Step 25-29：

| Step | FR | 断言摘要 |
|------|----|----------|
| Step 25 | FR-1 | GET /api/acquisition/leads 响应每 lead 含 outreach_status；有 assignment → non-untouched；无 assignment → untouched；多条取最新 |
| Step 26 | FR-2 | GET .../outreach/defaults 返回 accounts[]+default_script；POST .../outreach/manual 写入 dm_assignments，命中约束走 UPDATE 不重复 INSERT |
| Step 27 | FR-3 | GET /api/agent/install-pack 返回含 download_url 的 200 响应（验证现有逻辑未被破坏） |
| Step 28 | FR-4 | 同租户同关键词 30 天内第二次返回 duplicate:true+days_ago；force:true 正常执行；跨租户不互触；超 30 天不触 |
| Step 29 | FR-5 | GET .../collect/tasks 每条含 status（7 态合法值之一）；psql 验证 agents.os_type 与 line02_account_sessions.device_type 值域一致 |

smoke 脚本必须：
- 每个断言条件不满足时 `exit 1`（禁止静默跳过，INV-5）
- 用真实 curl + psql 调用（非 mock）
- 断言至少 ≥5 行实质内容（非占位）

**CI 全绿标准**：Step 1-24 保持绿（无回归）+ Step 25-29 全通。

---

## 判定点登记（6 条）

| # | 判定点 | 选定方案 | 理由 |
|---|--------|---------|------|
| 1 | outreach_status 取哪条 assignment | A：updated_at DESC LIMIT 1 | 最新覆盖旧，串台脏数据下最贴近真实语义 |
| 2 | 默认在线小号判定源 | B：现有心跳代理 | 安卓信号任务未合并，不阻塞本 sprint |
| 3 | APK 下载地址来源 | B：保持现状动态查询 | agent-install-pack.ts 已实现，本次只引用 |
| 4 | 关键词去重范围 | B：仅本租户（WHERE tenant_id=$tid）| 多租户隔离硬约束 |
| 5 | 同一人判定字段 | C：sec_uid 主+nickname 弱兜底 | 复用现有两级去重机制 |
| 6 | 任务进度设备类型区分 | 介于 A/B：补埋点字段值域统一 | agents.os_type 现值 'win32/darwin/linux'，line02_account_sessions.device_type 现值 'web/android'——本 sprint 必须出 migration 对齐为 'android/windows/unknown' |

---

## Invariant 合规声明

| Invariant | 本合同合规措施 |
|-----------|--------------|
| INV-1（设备类型 UI 区分强制） | FR-5.5 必须出 migration，不允许只写 TODO |
| INV-2（租户隔离） | 所有 API 断言含 X-Tenant-Id scope，BEHAVIOR-GP1-D/GP4-C 覆盖跨租户隔离 |
| INV-3（测试默认多租户） | BEHAVIOR-GP1-D, GP4-C 均种 ≥2 租户断言互不串 |
| INV-4（合同 1:1 映射 Golden Path） | GP-1~GP-5 每步均有对应 BEHAVIOR 条目 |
| INV-5（smoke 硬失败） | smoke Step 25-29 每条断言 `exit 1` 硬失败，禁止静默跳过 |
| INV-6（target_environment 校准） | local_api 环境只验 API 层，不要求 Android 真机输出 |
| INV-7（manual oracle exit code）| contract-dod 批准前需在 staging 执行 smoke 并记录 exit code |

---

## 不包含（范围外）

- 真实在线小号判定（依赖安卓 Agent 信号上报任务）
- 任务进度按设备类型完整分列 UI
- 触达小号/话术智能推荐算法
- Android 真机端测试
