---
name: pipeline-diagnose
description: /pipeline-diagnose、pipeline 挂了、看 pipeline 状态 — Content Pipeline 总体健康诊断，一键输出所有关键状态并引导到具体 stage skill
---

# /pipeline-diagnose — Content Pipeline 运维总诊断

## 什么时候用
- 用户说 "pipeline 挂了"、"今天没出内容"、"看 pipeline 状态"
- 不知道 6 阶段里哪一步出问题，先做总体扫描
- 每天早上例行巡检

## 一键诊断（copy-paste 可跑）

```bash
echo "=== 1. LaunchAgent 状态 ==="
launchctl list | grep zenithjoy

echo
echo "=== 2. 核心服务端口 ==="
for port_url in "5200:api/health" "5221:api/brain/status" "8899:"; do
  port="${port_url%%:*}"; path="${port_url#*:}"
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}/${path}" --max-time 3)
  echo "port ${port}: HTTP ${code}"
done

echo
echo "=== 3. 最近 pipeline log tail（20 行） ==="
tail -n 20 /tmp/pipeline-worker.log 2>/dev/null || echo "(log 不存在)"

echo
echo "=== 4. 今日 content-output 产物 ==="
today=$(date +%Y-%m-%d)
ls -d ~/content-output/${today}-* 2>/dev/null | head -10
echo
echo "今日 research findings:"
ls -d ~/content-output/research/*-${today} 2>/dev/null | head -10

echo
echo "=== 5. claude-output/images 最新 PNG（10 张） ==="
ls -lt ~/claude-output/images/*.png 2>/dev/null | head -10

echo
echo "=== 6. NAS SSH 连通性 ==="
ssh -o ConnectTimeout=5 -o BatchMode=yes nas "echo NAS_OK; ls /volume1/workspace/vault/zenithjoy-creator/content 2>/dev/null | tail -5" 2>&1 | head -10
```

## 快速分流

| 症状 | 去哪个 skill |
|------|--------------|
| LaunchAgent `com.zenithjoy.pipeline-worker` 不在 | `launchctl load ~/Library/LaunchAgents/com.zenithjoy.pipeline-worker.plist` |
| 5200 不通 | `launchctl kickstart -k gui/$(id -u)/com.zenithjoy.api` |
| 5221 不通 | 去查 cecelia-brain 服务（不在本 skill 范围） |
| 没有 research/ 目录或 findings.json 为空 | `/pipeline-research` |
| 有 copy.md 但文案半截/违规 | `/pipeline-copywrite` |
| person-data.json 含 "待补充/暂无数据" 或图里有占位符 | `/pipeline-persondata` |
| cards/ 下 PNG <9 张或 V6 脚本报错 | `/pipeline-regen` |
| vision 审图显示 major severity | `/pipeline-review` |
| NAS 没收到 / ssh 失败 | `/pipeline-export` |

## 查 pipeline 状态（需 auth token）

接口 `GET /api/pipelines` 需要 internalAuth。token 用 /credentials skill 从 1Password 的 "CECELIA_INTERNAL_TOKEN" 条目获取。设入 env 后：

```bash
curl -s -H "Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}" \
  "http://localhost:5200/api/pipelines?limit=10" | python3 -m json.tool | head -80
```

看每个 pipeline 卡在哪个 stage：字段 `current_stage` + `status`（running/completed/failed）。

## 常见坑

| 症状 | 原因 | 修法 |
|------|------|------|
| "无待处理的 pipeline（status=running），退出" 刷屏 | 正常空闲，没 topic 在跑 | 这是 ok 状态，不是故障 |
| launchctl list 看到 exit code `-` | Agent 没启动 / plist 没 load | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.zenithjoy.pipeline-worker.plist` |
| 5200 返回 UNAUTHORIZED | 接口需 `Authorization: Bearer` | 带上 CECELIA_INTERNAL_TOKEN |
| curl 5221 `/health` 404 | brain 没 `/health`，用 `/api/brain/status` | 改用 status 端点 |

## 相关文件路径
- LaunchAgent: `~/Library/LaunchAgents/com.zenithjoy.pipeline-worker.plist`
- Pipeline log: `/tmp/pipeline-worker.log`
- Executors 目录: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/`
- content-output: `~/content-output/`
- images 中转: `~/claude-output/images/`
- NAS 挂载: `ssh nas` → `/volume1/workspace/vault/zenithjoy-creator/content/`
