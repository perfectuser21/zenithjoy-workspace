# Lead Acceptance Evidence Template

> **铁律 7**：每个 Sprint 必须由 lead 在客户机平台真机走完整客户视角链路。CI mock smoke 不能替代。
> 严禁预置 cookie 跳过扫码（contract 防作弊条款）。

## Sprint Info

- **Sprint**: <Sprint 名 + 编号>
- **Worker Machine**: <ssh alias，如 xian-pc>
- **Lead**: <名字>
- **Date**: <YYYY-MM-DD>

## Checklist (按客户视角顺序)

- [ ] Step 1: ssh worker 验证可达
- [ ] Step 2: 真账号注册
- [ ] Step 3: 装客户端 + Agent 自动连中台
- [ ] Step 4: 画像 3 字段
- [ ] Step 5: 扫码绑定（lead 手机扫码 — 严禁预置 cookie）
- [ ] Step 6: 真发到平台公网
- [ ] Step 7: 验证公网 URL + 截图

## Evidence

### cmd stdout 摘录
```
<每步关键命令的 stdout 拷贝在这>
```

### 公网 URL
- <平台>: <真实公网 URL>

### 截图归档
- 弹扫码窗截图: <路径>
- 公网内容截图: <路径>
- Agent log 路由证据: <路径或摘录>

## 决定

- [ ] 全部通过 → sprint APPROVED 可 deliver 给真客户测
- [ ] 部分失败 → 列出哪步失败 + 是否触发 risk R1-R5
