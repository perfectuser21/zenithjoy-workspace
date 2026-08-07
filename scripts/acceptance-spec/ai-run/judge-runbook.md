# AI 判官协议（发版验收双表 · 机器列判定）

采证器产出 `pending-judgments.json` + `evidence/` 后，由一个 **AI 会话**按本协议逐格判定，
把每格 `verdict: null` 填成三态之一，另存为 `ai-column.json`，并跑协议校验。

## 铁规

1. **判据 = 屏幕所见**：只依据 `evidence/` 里的截图与页面文本判定。**禁止查库、禁止调接口、
   禁止读服务端代码**——那是 CI 细网的辖区，不是你的。
2. **三态，禁止第四态**：`通过` / `不通过` / `无法验证`。没有"基本通过""大概没问题"。
3. **宁红勿假绿**：证据不足以支撑"通过"就写 `无法验证` 并在 `reasons` 里说明缺什么；
   看见可疑就 `不通过` 并在 `symptoms` 里写命中的症状。误红有四象限人工裁决兜底，误绿没有。
4. **`scenario_required: true` 的格子**（来自规程 yaml 的 `scenario_class: mandatory`）：
   截图里若看不到对应场景（掉线号/重启恢复/数据覆盖），判 `无法验证`，reason 写"场景未出现"。
   禁止因为"页面看起来正常"就判通过。
5. **每格判定必须引用证据**：`reasons` 里指明依据哪张截图/哪段文本得出的结论。
6. **判完必须校验**：

```bash
node -e "
import('./scripts/acceptance-spec/ai-run/lib.mjs').then(async m => {
  const col = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  const { errors } = await m.validateAiColumn(col);
  if (errors.length) { console.error('FAIL:', errors); process.exit(1); }
  console.log('PASS: ai-column 协议校验通过');
})" acceptance-spec/runs/<本轮目录>/ai-column.json
```

## 逐格判定要点（判据原文见每格 `criteria` 字段，此处只补"看什么"）

| 格 | 看什么 |
|---|---|
| S1-c3 | 截图域名是否预发前缀、注册后是否进入已登录后台 |
| S4-c2/c3 | 设备列表有无在线设备与时间戳；无重启场景 → 无法验证 |
| S5-c3/c4 | 有无"掉线仍标可用"的行；无掉线场景 → 无法验证 |
| S6-c3 | 任务行的关键词是否等于本轮关键词、归属是否本账号 |
| S6-c4 | 新账号列表是否只含本轮产生的数据（出现陌生任务=不通过，红线3） |
| S7-c1/c2 | 轮询序列里任务是否在5分钟内出现终态；失败时有无具体分类字样 |
| S8-c1/c3/c4 | 视频行数≥2？编号是否15位以上数字？有无明显占位/假编号 |
| S9-c1/c2 | 判定列是否有离开"判定中"的行；3分钟内是否出结果 |
| S10-c1 | 线索行昵称/评论是否是人话（出现按钮名/坐标=不通过） |
| S10-c4 | 无两轮对照场景 → 无法验证 |
| S11-c1/c3/c4 | 派单目标是否来自本轮线索；链条字段是否一致；有无他租户数据 |

S13-c4（红线8 频控）本版已改判 `human_only` + `scenario_class: unverifiable_this_version`，
不在 AI 列采证范围，绿灯必经主理人裁决——判官看不到这一格，也不要替它下结论。

## 背靠背纪律

AI 列结果只落 `acceptance-spec/runs/<轮>/`，**绝不回写员工验收网页**。
员工填表时不可见本列，两列只在刀3对比页叠合。
