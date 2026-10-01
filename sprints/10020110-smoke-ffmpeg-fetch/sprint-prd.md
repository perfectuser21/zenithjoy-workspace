# PRD — CI ffmpeg 获取

任务 ff44567b-bf06-41d0-a8f2-500cc7c64bce，父 fa58ae89-c080-40a3-acf0-2e25f47f5d47。修复 hosted Ubuntu 默认APT获取19分钟导致全量Smoke 25分钟超时。仅CI依赖获取；保全量棘轮、真实抽帧与ffprobe、证书和签名、25分钟上限，不改生产机配置或producer来源语义。

GP-Anchor: line02/keyword_acquisition keep-green

以download-only获取阶段的期限防止网络耗尽预算；失败一次临时官方Ubuntu HTTPS sources，指定内置archive keyring；下载全成功才--no-download正常安装。两工具必须真实运行；旧批和现producer部署不受改动。
