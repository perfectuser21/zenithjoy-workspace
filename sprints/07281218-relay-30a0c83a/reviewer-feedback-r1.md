# Reviewer Feedback — R1（合同格式硬检查失败，controller 打回）

**打回原因：合同格式硬检查三项全部未通过（controller 机械 bash 检测，非人工判断）**

---

## ❌ 硬检查失败清单

### 失败 ①：contract-dod.md 缺 `[BEHAVIOR]` 标签（当前 count=0，要求 ≥4）

**问题**：`contract-dod.md` 中没有任何 `[BEHAVIOR]` 标记的条目。当前 DoD 使用的是普通 checkbox `- [ ]` 格式，缺乏行为断言标签。

**修复要求**：在 `contract-dod.md` 中，把核心可验证行为断言条目改写为 `[BEHAVIOR]` 格式，例如：

```
[BEHAVIOR] B1 无认证 → 403：`curl -s GET /api/staff/ability-acceptance/runs` → HTTP 403, error.code=FORBIDDEN
[BEHAVIOR] B3 幂等创建 run：`POST /runs {task_id, sha}` 首次 → {created:true, run_id:UUID}
[BEHAVIOR] B4 幂等复用：相同参数二次 POST → {created:false, run_id 与首次相同}
[BEHAVIOR] B6 提交后锁定：`POST /submit` 成功后再 `POST /checks` → HTTP 400 RUN_ALREADY_SUBMITTED
```

至少 4 条 `[BEHAVIOR]` 条目，覆盖最关键的 API 行为断言。

---

### 失败 ②：contract-draft.md 缺 `## E2E 验收` 顶级段

**问题**：`contract-draft.md` 当前只有 `## 判定点清单` 大段（含 Phase A/B/C/D 子段），没有名为 `## E2E 验收` 的顶级 `##` 标题段。

**修复要求**：在 `contract-draft.md` 中添加一个 `## E2E 验收` 顶级段（`##` 开头），可以是：
- 新增一个专门的 `## E2E 验收` 段，或者
- 将现有的 Phase B/C/D 子段提升重组到 `## E2E 验收` 大段下

---

### 失败 ③：contract-dod.md 缺 `manual:bash` 可执行验收命令

**问题**：`contract-dod.md` 的 `[合同 E2E 脚本]` 段只说"文件存在"和"覆盖断言"，没有以 `manual:bash` 标记的可直接运行的 bash 命令。

**修复要求**：在 `contract-dod.md` 中，在 API 集成验收段加入至少一条 `manual:bash` 命令行，例如：

```
manual:bash bash sprints/07281218-relay-30a0c83a/e2e-contract.sh
```

或者在各主要阶段验收项旁加 `manual:bash` 前缀的单行 bash 验证命令。

---

## 其他内容质量评估（不影响通过，供参考）

- 铁律覆盖 7/7：✅ 正确
- 判定点数量 27 个：✅ 合理
- Phase A product-map 断言：✅ 对应 T1-T7 完整
- Phase B API 集成断言 B1-B9：✅ 内容正确
- Phase C Playwright 断言 C1-C5：✅ 内容正确
- Phase D 部署验收断言：✅ 内容正确

**结论：内容质量合格，但格式三项硬检查必须全部修复后才能进入 reviewer 评审。**
