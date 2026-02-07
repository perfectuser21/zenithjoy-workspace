# Runner 配置 - 从环境变量或 .env 文件读取
# 使用前确保设置了 RUNNER_API_KEY 和 WINDOWS_IP

if [ -f "$(dirname "$0")/.env" ]; then
    source "$(dirname "$0")/.env"
fi

export RUNNER_API_KEY="${RUNNER_API_KEY:?请设置 RUNNER_API_KEY 环境变量}"
export WINDOWS_IP="${WINDOWS_IP:?请设置 WINDOWS_IP 环境变量}"
