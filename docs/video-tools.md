# 员工视频工具

员工入口为 `/area/video-tools`，提供两个独立工具：`/wan-playground` 与 `/video-upscale`。
两个页面均需要员工登录。服务端以 better-auth 会话及员工名单校验身份，任务与素材按账号隔离。

Wan 支持提示词、参考图片/视频、时长、画幅、分辨率和声音；超分为独立上传处理。
生成采用异步任务，页面关闭后可从历史记录继续查看。失败会显示原因，不把原视频作为生成结果。
同次提交保留客户端幂等标识，网络重试不会重新创建付费任务。

## 服务端配置

- `DASHSCOPE_API_KEY`：百炼密钥。
- `DASHSCOPE_BASE_URL`：可指定官方服务地址，例如 `https://dashscope.aliyuncs.com/api/v1`。
- `DASHSCOPE_WORKSPACE_ID`：使用业务空间地域地址时配置；密钥、业务空间和地域须对应。
- `ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`：已授权 VIAPI 超分的 RAM 账号。
- `ALIYUN_VIAPI_OSS_BUCKET`：可选自有上海 OSS bucket。内部试用默认使用官方临时 bucket，素材一天后过期；长期使用应配置自有 bucket 并授权 PutObject。
- `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION`：现有私有素材存储，用于网页上传。
- `VIDEO_TOOLS_DATA_DIR`：任务与素材元数据持久化目录。生产与 staging 必须使用独立挂载。
- `STAFF_EMAILS` / `STAFF_FEISHU_OPENIDS`：现有员工白名单。

密钥仅配置于服务器，不进入 Vite 环境变量、页面或 Git。API 镜像需要 ffprobe 检查上传素材。
独立 Nginx 路由允许 100 MB 文件上传；普通 API 的默认限制不变。

## 接口

- `GET /api/video-tools/config`：服务配置状态。
- `POST /api/video-tools/uploads`：multipart `file`，返回素材 URL 与尺寸、时长。
- `POST /api/video-tools/jobs`：创建 Wan 或超分任务。
- `GET /api/video-tools/jobs`：当前员工的任务历史。
- `GET /api/video-tools/jobs/:id`：查询任务状态。
- `GET /api/video-tools/jobs/:id/download`：下载成功任务的视频。

原生阿里 Playground 的 iframe 被官方 `frame-ancestors` 策略拦截，因此本工具使用官方 API。
VIAPI 结果为临时链接，应及时下载；历史元数据持久化不意味着阿里成片链接永久有效。

## 验证与发布

API provider/路由测试、前端交互测试和部署配置真实 Nginx 测试分别覆盖接口合同、员工隔离、
失败状态、重复提交、页面交互、上传体积限制以及任务目录持久化。
这些自动测试不代替真实阿里生成成片验收。发布按当前 staging 与生产晋级工作流执行。
