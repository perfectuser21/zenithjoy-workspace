# DoD — CI ffmpeg 获取

- [ ] [BEHAVIOR] 默认源失败/慢速一次官方签名fallback；双源失败不安装；已有检测与两工具实际运行。
  Test: manual:bash .github/workflows/scripts/smoke/ci-ffmpeg-fetch-smoke.sh
- [ ] [BEHAVIOR] 下载成功后无网络安装，期限不杀dpkg；不改/etc/sources、全量门禁与25m。
  Test: manual:node --test .github/workflows/scripts/tests/ci-ffmpeg-fetch.test.mjs
