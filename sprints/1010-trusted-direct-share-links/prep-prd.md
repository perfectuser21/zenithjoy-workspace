# 抖音受信直接分享链接兼容

实际新版 101 在第 12 次复制时得到 iesdouyin.com/share/video 长链接，现有取链入口只识别 v.douyin.com 短链，误拒收并中断。支持本次实测长链接以及受信 douyin.com 直接视频/图文链接，保留复制新鲜度、真实内容 ID 与归位核验。采用严格域名/路径/ID 校验，直接链接规范化后交给既有 Video 输出；不额外访问已有明确 ID 的网页。

任务 713e4691-6fb1-444c-9e1a-bd5a8cea28b7；实测证据 /tmp/codex-ai30-candidate12-evidence/scratch-result.xml。原三 Activity 结构不变。
