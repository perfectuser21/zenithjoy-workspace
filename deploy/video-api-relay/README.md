# 视频 API 私网出口

2026-10-28 香港 staging 宿主及容器连接 DashScope 北京全部 IPv4 都超时；同一 API 从国内节点可达。国际地域的 API Key 不可混用，因此保留原北京 endpoint，只为 `AliVideoProvider` 指定 CONNECT 代理。

代理监听国内节点 Tailscale IP `100.69.180.117:18241`，仅允许香港节点 `100.86.118.99`；只放行文件中的三个阿里域名的 HTTPS 443 CONNECT。禁止普通 HTTP、其他目标或端口。代理不终止 TLS，应用继续验证阿里证书，密钥不写入代理配置或日志。

安装使用 Ubuntu 22.04 官方 tinyproxy-bin 1.11.0-1，仅解包独立二进制，避免启用系统通用代理。以下在 `aliyun-cn` 执行，配置文件从本目录复制：

```bash
mkdir -p /tmp/video-api-relay-package
cd /tmp/video-api-relay-package
apt-get download tinyproxy-bin=1.11.0-1
sudo mkdir -p /opt/zenithjoy/video-api-relay/runtime
sudo dpkg-deb -x tinyproxy-bin_*.deb /opt/zenithjoy/video-api-relay/runtime
# 将本目录 tinyproxy.conf / hosts.filter 安装为 /opt/zenithjoy/video-api-relay/ 下同名文件，权限 0644。
# 将本目录 service 安装到 /etc/systemd/system/zenithjoy-video-api-relay.service，权限 0644。
sudo systemctl daemon-reload
sudo systemctl enable --now zenithjoy-video-api-relay.service
```

在香港 staging 专用 `/opt/zenithjoy/staging-api/.env` 中配置 `ALI_VIDEO_HTTPS_PROXY=http://100.69.180.117:18241`，由固定 SHA 的正常 staging 发布加载，禁止编辑运行中应用代码。其他服务及生产环境不设置此变量。

发布前从香港运行 `bash scripts/deploy/verify-video-api-relay.sh`：不携带密钥，不创建收费任务，检查阿里服务响应、域名/端口/普通 HTTP 拒绝。另从非香港的 tailnet 节点请求同一代理，必须 HTTP 403。发布后还需实际提交并轮询一个小视频直到成功；匿名连通检查不能代替业务验收。

工作空间专属域名需在 `hosts.filter` 添加对应的精确 `域名:443`，再重启代理并重新运行验收。不要放开域名通配符。当前出口不覆盖超分上海 OSS 素材传输。

回退：删除 staging 专用环境变量后按正常 staging 发布加载。确认无使用方后 `sudo systemctl disable --now zenithjoy-video-api-relay.service`，不改变其他代理或网站服务。

配置语义见 [Tinyproxy 官方文档](https://tinyproxy.github.io/)；1.11 使用 `FilterExtended On`，`FilterURLs Yes` 匹配 CONNECT authority，以排除普通 HTTP。
