# Contract — CI ffmpeg 获取

任务 ff44567b-bf06-41d0-a8f2-500cc7c64bce。target_environment: local_api。journey_type: dev_pipeline。

## 批准范围

仅 .github/workflows/ci-smoke-glob-runner.yml 的ffmpeg步骤、新install-ci-ffmpeg.sh、永久shell故障注入测试与smoke/baseline、原生合同执行工件。保留检测、全量smoke与25分钟期限。下载期限仅覆盖APT update/download-only，禁止限时强杀dpkg；一次失败fallback到临时官方HTTPS Signed-By源，不写/etc/sources，不降签名/TLS，不改生产网络。

## E2E 验收（target_environment: local_api）

```bash
set -euo pipefail
bash -n .github/workflows/scripts/install-ci-ffmpeg.sh
bash .github/workflows/scripts/smoke/ci-ffmpeg-fetch-smoke.sh
```

通过标准：默认源下载失败/慢速真实timeout触发一次官方源，双源失败不安装；缺ffprobe和不可运行工具失败；已有两工具不下载；实际ffmpeg产16x16视频，ffprobe验证stream。正式native/完整CI全量/获客source批次分别留痕，不以此本地测试冒充全部验收。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 原生入口 | `sprints/10020110-smoke-ffmpeg-fetch/tests/ffmpeg-fetch.test.mjs` | `native entry verifies bounded signed ffmpeg acquisition and real tools` | 永久b55ea00e，旧脚本8项2pass6fail；日志 /tmp/ffmpeg-ci-permanent-red.log |
