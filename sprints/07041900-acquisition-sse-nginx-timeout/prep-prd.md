# Bug PrepPRD：Line02 采集任务 SSE 推送连接被 nginx 30 秒超时反复掐断，Stage 2（评论抓取）永远接不上指令

## 症状

真实机器上绑好抖音小号、Stage 1（关键词搜视频）能正常完成，但 Stage 2（对每个视频抓评论）从未被触发。Agent 本地日志显示反复循环：

```
[acquisition] 采集任务 SSE 已连接，等待中台推送...
[acquisition] SSE 断开: terminated，5s 后重连
[acquisition] 连接任务推送 SSE...
```

约 30-40 秒一个周期，持续循环，中台推送的 `collect_task` 事件从未被 Agent 稳定接住过。

## 根因假设

Agent 端（`services/agent/src/index.ts` `startAcquisitionCollectLoop`）连接的 SSE URL 是：

```
${apiBase}/api/acquisition/agent/task-stream
```

`deploy/nginx.staging.conf`（第37行）和 `deploy/nginx.conf`（生产，同一行号）都有一条专门给 SSE 长连接开的正则 location：

```nginx
location ~ ^/api/acquisition/collect/[^/]+/sse$ {
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    ...
}
```

但这条正则匹配的路径形态是 `/api/acquisition/collect/<id>/sse`，跟 Agent 实际连接的 `/api/acquisition/agent/task-stream` 结构完全不同，**匹配不上**。于是这条连接落进通用兜底 location：

```nginx
location /api/ {
    proxy_pass http://100.71.151.105:5201/api/;
    proxy_read_timeout 30;
    ...
}
```

只给 30 秒超时，且未关闭 `proxy_buffering`。采集任务推送是间歇性的（可能几十秒到几分钟才有一次），SSE 连接空闲超过 30 秒没有新数据流出就被 nginx 掐断，Agent 收到 `terminated` 报错后 5 秒重连，重连后又在约 30 秒左右被再次掐断——陷入死循环，中台即使有 Stage 2 指令要推，Agent 也接不稳。

**生产 `nginx.conf` 存在同样的正则不匹配 + 30 秒超时问题**，是同一份配置模板复制出的缺陷，非环境差异。

## 关联上下文

- 相关 Journey：Line 02 客户智能获客路径（journey_id = afa6abca-53c0-4815-8594-b7fb81ca547f）
- 相关 Ability/Feature：采集(关键词→视频→留言) 的 Stage 2 评论抓取环节
- 无直接关联的历史决策记录，属本次新发现的基础设施配置缺陷

## 修法

在 `deploy/nginx.staging.conf` 和 `deploy/nginx.conf` 中，紧挨着现有的 SSE 专属 location 块（`^/api/acquisition/collect/[^/]+/sse$` 之后），新增一条精确匹配 Agent 实际连接路径的 SSE location，复用相同的长连接参数：

```nginx
location = /api/acquisition/agent/task-stream {
    proxy_pass http://100.71.151.105:5201;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

两个文件都改（staging + 生产），保持两份配置一致。

修完后需要重新部署 nginx 配置到 HK VPS 的 staging 容器（`autopilot-staging`），验证 SSE 连接能稳定挂住不断线。生产端配置只改仓库文件，**不由 AI 自行 promote/重启生产 nginx**，交给用户在合适时间点手动应用（沿用"AI 只部署 staging，生产人工确认"规则）。

## Regression Test 计划

这是纯配置类 bug，逻辑测不到（nginx 配置解析不了单元测试）。采用配置类 smoke test：

1. 新增 `.github/workflows/scripts/smoke/acquisition-sse-nginx-route-smoke.sh`：
   - 用 `nginx -t -c` 或者简单的正则脚本，解析 `deploy/nginx.conf` 和 `deploy/nginx.staging.conf`，断言存在一条能匹配 `/api/acquisition/agent/task-stream` 的 SSE 专属 location（`proxy_buffering off` + `proxy_read_timeout` ≥ 3600s）
   - 若两份配置文件里任一份缺失匹配的 SSE location，脚本非零退出，CI 红
2. 该 smoke 脚本永久留在 CI 里跑，防止未来改 nginx 配置模板时再次引入同类路径不匹配问题

## 验收标准

- [ ] failing test（smoke 脚本，先证明现在确实匹配不上）先 commit（commit-1）
- [ ] 两份 nginx 配置新增精确 SSE location，smoke 脚本变绿（commit-2）
- [ ] staging nginx 配置重新部署到 HK VPS，真实验证 SSE 连接不再 30 秒断线（tail Agent 日志观察 ≥ 2 分钟无 terminated）
- [ ] CI 全绿
- [ ] 生产 nginx.conf 改动仅提交到仓库，不由 AI 自行应用到生产环境
