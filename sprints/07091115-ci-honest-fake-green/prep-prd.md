# 小改动 PrepPRD：CI 删假标真 — 4 条冒名真机闸诚实化（假绿灯治理第一刀）

## 改什么
只改 CI 命名/注释/跳过告警，**不接真机、不动任何执行逻辑**。让 4 条冒充"真机验收"的 workflow 诚实自报家门。

### ① `.github/workflows/golden-path-4-smoke.yml`
- ws5 job 名 `ws5 — 飞书审批 + Python wechat_rpa 真发 + 频控` → `[DRYRUN] ws5 — 飞书审批 + wechat_rpa 管道拼接（非真发，ubuntu 无微信）`
- 删除 line 9-10 冒名注释「Lead 自验在 rog-xian REAL_PUBLISH=1 真扫码 + 真发，由 lead-acceptance-check workflow 跑」→ 改为诚实说明：**CI 全程 REAL_PUBLISH=0 dryrun；Path4 真机真发尚未接入 CI（真机闸待建，见治理第二刀）**
- 顶部 header 注释同步标注：本 workflow 全部 job 跑 ubuntu，仅验管道拼接，无真机成分

### ② `.github/workflows/lead-acceptance-check.yml`
- 加 header 注释正名：**本 workflow 只在 ubuntu 上 grep 校验 markdown 证据文件存在性，非真机执行、不 REAL_PUBLISH**（消除被 ① 冒名引用的误解）

### ③ `.github/workflows/agent-windows-sandbox-real-publish.yml`
- 去 Summary 夸大结论 `Douyin 3 scripts CONFIRMED on Windows` → `CONFIRMED on GitHub 云 Windows（数据中心 IP，非真客户机；有风控/封号风险，≠ 真机验收）`
- name/header 标注：windows-latest 云机，cookie 注入，dispatch-only，非常态闸、非真客户机

### ④ `.github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh`
- DPAPI 跳过分支（line 78-83）：exit 0 前把醒目 SKIPPED 写进 `$GITHUB_STEP_SUMMARY`，让 Actions run 页面顶部直接显示「⚠️ 抖音真机闸未执行（DPAPI 解不开），本次绿灯不代表通过」——不再靠翻日志

## 为什么改
审计 20 条 RPA workflow 发现多条冒名真机：名字/注释声称真扫码真发/CONFIRMED，实跑 ubuntu mock 或云 Windows。假绿灯比没测更危险——让人以为守着，真机根本没守（7-02「连发5只回1」即此类）。命中铁律：真环境验证才算 done / Line04 防假成功 / 禁止写死环境假设值。

## 关联上下文
- 相关 Journey：Line04 私域 AI（bfeed805）+ Line02 获客
- Brain task：db02d79d
- 治理第一刀 = 删假标真（本 PR）；第二刀 = 照 wechat-cs 气泡门诚实范式接真机闸（另起）

## 影响范围
纯命名/注释/日志。不改 runs-on、不改 step 执行、不改任何断言逻辑。不影响任何现有绿红结果（④跳过仍 exit 0 不阻塞，只多一条 summary 记录）。

## 验收标准
- [ ] 4 文件改动仅限命名/注释/summary，`git diff` 无逻辑行变更
- [ ] 每个改动后的 workflow `yaml` 语法有效（actionlint / yq 解析通过）
- [ ] ④ 脚本 `bash -n` 通过
- [ ] PR 标题带 `[CONFIG]`
- [ ] CI 全绿
