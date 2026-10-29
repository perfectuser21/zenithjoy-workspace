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

当前复用 `zenithjoy-net` 连接 staging API。该网络供其他业务组件使用，并非独立网络；应仅允许可信容器加入。节点读取生成图片需要访问素材存储。画布服务不能绕过认证网关向公网开放。

Compose 尚未接入现有 CI/CD。候选提交、镜像构建与 staging 发布需按仓库现行流程处理，不能仅凭配置文件判断已经部署。部署前检查 staging 主机的磁盘、内存和 CPU 架构。部署之后需要逐项验证：

1. 实例健康且四个 ZenithJoy 节点出现；实例数据目录可写且重启后保留。
2. 已授权员工从网站打开画布，HTTP 与 WebSocket 正常；未登录或无对应实例的用户被拒绝。
3. 跑通 Image2 → 选图 → Wan 的真实链路，并检查任务失败、重试及费用。
4. 用两个独立员工实例验证工作流、素材、历史、队列和 WebSocket 不可互访。
