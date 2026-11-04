# Creative canvas staging instance

此镜像运行 ComfyUI 的现成画布，使用 CPU，不含本地模型权重；只允许加载 `zenithjoy` 自定义节点。Dockerfile 固定上游源码 commit、源码包 SHA-256 和 Python 基础镜像摘要；`requirements-cpu.lock` 固定 Python 包版本，但包文件尚未按哈希锁定。

## 实例和身份配置

`deploy/docker-compose.creative-canvas-staging.yml` 只定义 **一个员工**的独立实例 `zenithjoy-creative-canvas-staging-1`，以及独立卷 `zenithjoy-creative-canvas-staging-1-data`。容器不向宿主机或公网发布端口。不要将多名员工映射到同一容器。扩展员工时，复制服务并为每人配置不同的容器名、内部地址、持久卷和令牌；仅地址不同不足以证明底层存储隔离。

令牌应由现有凭据管理流程生成、保管并注入执行环境，不写入代码、镜像或 workflow JSON。部署 Compose 时需要以下环境变量：

- `ZENITHJOY_CANVAS_TOKEN`：该实例专用的至少 32 字符随机令牌；容器启动后用于调用后端的受限接口。它会作为容器环境变量存在于 Docker 配置中，因此 Docker 管理权限也必须受限。

Compose 自动设置 `ZENITHJOY_CANVAS_API=http://zenithjoy-api-staging:5200`，节点使用该内网地址访问 staging API。实例本身不放 API 供应商密钥。

staging API 的私有环境配置必须同时设置以下变量，重启 API 后生效（以下仅为结构示意，不是可用凭据）：

```text
CREATIVE_CANVAS_INSTANCES={"员工真实user.id":"http://zenithjoy-creative-canvas-staging-1:8188"}
CREATIVE_CANVAS_SERVICE_TOKENS={"员工真实user.id":"该实例唯一令牌"}
CREATIVE_CANVAS_ALLOWED_ORIGINS=https://员工staging网站域名:端口
```

两份映射必须使用同一个真实员工 ID，令牌与该实例一致；浏览器通过员工登录进入网关，节点通过实例令牌调用受限 API。具体组织登录、端口和密钥以 staging 实际配置为准。不要在日志、命令行参数或截图里输出令牌。

## 测试与部署边界

镜像采用只读根目录、uid 10001、独立数据卷和丢弃 Linux capabilities。卷首次创建时从镜像的 `/data` 初始化，确保 `input`、`output`、`temp`、`user` 可被 uid 10001 写入。工作流持久保存在实例卷里；删除卷会删除对应员工数据。

画布实例使用专用的 `zenithjoy-canvas-staging-net` 连接 staging API；staging API 同时保留原业务网络。该画布网络只能包含 staging API 和对应画布实例，不要将其他服务接入。节点读取生成图片需要访问素材存储。画布服务不能绕过认证网关向公网开放。

Compose 尚未接入现有 CI/CD。候选提交、镜像构建与 staging 发布需按仓库现行流程处理，不能仅凭配置文件判断已经部署。部署前检查 staging 主机的磁盘、内存和 CPU 架构。部署之后需要逐项验证：

1. 实例健康且四个 ZenithJoy 节点出现；实例数据目录可写且重启后保留。
2. 已授权员工从网站打开画布，HTTP 与 WebSocket 正常；未登录或无对应实例的用户被拒绝。
3. 跑通 Image2 → 选图 → Wan 的真实链路，并检查任务失败、重试及费用。
4. 用两个独立员工实例验证工作流、素材、历史、队列和 WebSocket 不可互访。

## Wan 视频修改模板

`video-remake-wan.json` 连接「Wan 视频修改」与「保存视频」。节点上的上传按钮使用当前员工的网页登录会话上传参考视频、产品或 Logo、背景和人脸图片；画布中保存素材 ID，实例令牌不进入浏览器。视频目前使用现有 `/api/video-tools/uploads` 转发上传，100 MB 是应用上限，反向代理体积限制或超时仍可能阻止大文件；上传失败会显示 HTTP 状态。

先上传参考视频，再分别设置产品操作、背景和换脸；它们可以独立使用或组合。换产品款式、换 Logo 需要图片，改色需要目标颜色；背景可填说明或上传图片。换脸前先确认原片是否露脸，未露脸会跳过，不能只提交一项不会生效的换脸。打开「确认生成」后运行，结果由保存视频节点预览和保存，视频任务 ID 同时展示在修改节点。

上传中运行会被拒绝。修改已经提交的参数后，点击「生成新版本」再运行；普通重试沿用请求标识，避免重复提交。模板请求保留原片时长和比例、关闭声音；服务端负责将操作编译为 Wan 输入。代码测试不代表产品、Logo、人脸或背景在真实模型输出中已经保真，需用实际结果逐项验收。

不安装 ComfyUI/Torch 时可以运行独立合同测试（直接执行真实 Python 节点类、模拟 API 边界，以及真实浏览器扩展的上传控件行为）：

```bash
python3 -m unittest discover -s infrastructure/comfyui/tests -p test_wan_remake.py
node --experimental-vm-modules --test infrastructure/comfyui/tests/remake-extension.test.mjs
```

原 `test_zenithjoy_nodes.py` 仍需完整 ComfyUI、Torch 和其他锁定依赖；上述测试不替代完整画布的浏览器或模型实测。
