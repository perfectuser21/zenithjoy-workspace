#!/usr/bin/env bash
# deploy-topic-worker.sh — 选题池 v1 阶段2：部署 topic-worker 到本地 + HK
#
# 用法：
#   ./scripts/deploy-topic-worker.sh --dry-run       （默认，只打印将执行的操作）
#   ./scripts/deploy-topic-worker.sh --apply-local   （真的安装本地 LaunchAgent）
#   ./scripts/deploy-topic-worker.sh --apply-hk      （打印 HK server 的手动部署清单）
#   ./scripts/deploy-topic-worker.sh --apply-all     （本地 + HK 全部执行）
#
# 幂等性：重复运行不报错。

set -euo pipefail

# ─── 配置 ────────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="${REPO_ROOT}/infrastructure/launchagents/com.zenithjoy.topic-worker.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/com.zenithjoy.topic-worker.plist"
LAUNCHAGENT_LABEL="com.zenithjoy.topic-worker"

# 主仓 apps/api 配置（部署时需要清理 PIPELINE_* 变量 + 删除旧 dist 产物）
MAIN_REPO="/Users/administrator/perfect21/zenithjoy"
MAIN_API_ENV="${MAIN_REPO}/apps/api/.env"
MAIN_API_DIST_SCHEDULER="${MAIN_REPO}/apps/api/dist/services/pipeline-scheduler.service.js"

# HK server 配置
HK_HOST="vps-hk"                         # ~/.ssh/config 里的别名（或 ubuntu@100.86.118.99）
HK_IP="100.86.118.99"
HK_REPO_PATH_HINT="/home/ubuntu/zenithjoy"   # 参考路径，具体以 HK 现状为准

MODE="${1:-}"

# ─── 工具函数 ────────────────────────────────────────────────────────────────
log() { echo "[deploy-topic-worker] $*"; }

usage() {
    cat <<'EOF'
deploy-topic-worker.sh — 选题池 v1 阶段2 topic-worker 部署工具

用法：
  ./scripts/deploy-topic-worker.sh [选项]

选项：
  --dry-run       只打印将要执行的操作（默认）
  --apply-local   真的安装本地 LaunchAgent（~/Library/LaunchAgents/）
  --apply-hk      打印 HK server 的手动部署清单（用户 copy-paste 执行）
  --apply-all     本地 + HK 全部执行
  -h, --help      显示此帮助

环境：
  本地 LaunchAgent Label : com.zenithjoy.topic-worker
  本地 plist 源文件       : infrastructure/launchagents/com.zenithjoy.topic-worker.plist
  本地 plist 目标路径     : ~/Library/LaunchAgents/com.zenithjoy.topic-worker.plist
  HK server               : vps-hk (100.86.118.99) — cron 方式

幂等性：重复运行不报错。
EOF
}

# ─── 本地部署 ────────────────────────────────────────────────────────────────
plan_local() {
    log "=== 本地部署计划 ==="
    log "  1. 验证 plist 源文件: ${PLIST_SRC}"
    log "  2. cp 到 ${PLIST_DST}"
    log "  3. launchctl unload ${PLIST_DST}（若已加载，忽略失败）"
    log "  4. launchctl load -w ${PLIST_DST}"
    log "  5. 验证: launchctl list | grep ${LAUNCHAGENT_LABEL}"
    log "  6. [可选] 清理老 scheduler: 禁用 ${MAIN_API_ENV} 里的 PIPELINE_SCHEDULER_ENABLED + 删除 ${MAIN_API_DIST_SCHEDULER}"
    log "  7. [可选] 重启 apps/api LaunchAgent: launchctl kickstart -k gui/$(id -u)/com.zenithjoy.api"
}

apply_local() {
    log "=== 执行本地部署 ==="

    if [[ ! -f "${PLIST_SRC}" ]]; then
        log "[ERROR] plist 源文件不存在: ${PLIST_SRC}"
        exit 1
    fi

    log "步骤 1/6: cp plist 到 ~/Library/LaunchAgents/"
    mkdir -p "${HOME}/Library/LaunchAgents"
    cp "${PLIST_SRC}" "${PLIST_DST}"
    log "  [ok] 已复制到 ${PLIST_DST}"

    log "步骤 2/6: unload 旧 LaunchAgent（若存在）"
    if launchctl list | grep -q "^[^[:space:]]*[[:space:]]\{1,\}[^[:space:]]*[[:space:]]\{1,\}${LAUNCHAGENT_LABEL}$"; then
        launchctl unload "${PLIST_DST}" 2>/dev/null || true
        log "  [ok] 已 unload"
    else
        log "  [skip] 未加载，无需 unload"
    fi

    log "步骤 3/6: load -w 新 LaunchAgent"
    launchctl load -w "${PLIST_DST}"
    log "  [ok] 已 load"

    log "步骤 4/6: 验证加载状态"
    if launchctl list | grep -q "${LAUNCHAGENT_LABEL}"; then
        log "  [ok] ${LAUNCHAGENT_LABEL} 已在 launchctl list 中"
    else
        log "[ERROR] ${LAUNCHAGENT_LABEL} 未在 launchctl list 中，加载可能失败"
        exit 1
    fi

    log "步骤 5/6: 清理老 scheduler 配置（幂等）"
    clean_legacy_scheduler

    log "步骤 6/6: 完成"
    log "  下次触发时间：明日 09:00 BJT（若已过今日 9 点，则明日）"
    log "  日志文件：/tmp/topic-worker.log"
    log "  手动立即跑一次（可选）：launchctl kickstart -k gui/$(id -u)/${LAUNCHAGENT_LABEL}"
}

clean_legacy_scheduler() {
    # 幂等清理：禁用 PIPELINE_SCHEDULER_ENABLED、删 dist 产物
    if [[ -f "${MAIN_API_ENV}" ]]; then
        if grep -q '^PIPELINE_SCHEDULER_ENABLED=true' "${MAIN_API_ENV}"; then
            log "  [clean] 禁用 ${MAIN_API_ENV} 里的 PIPELINE_SCHEDULER_ENABLED"
            # 使用 portable sed（macOS/Linux 通用的 BSD/GNU 兼容写法）
            /usr/bin/sed -i.bak 's/^PIPELINE_SCHEDULER_ENABLED=true/PIPELINE_SCHEDULER_ENABLED=false/' "${MAIN_API_ENV}"
            rm -f "${MAIN_API_ENV}.bak"
        else
            log "  [skip] ${MAIN_API_ENV} 已不含 PIPELINE_SCHEDULER_ENABLED=true"
        fi
    else
        log "  [skip] ${MAIN_API_ENV} 不存在"
    fi

    if [[ -f "${MAIN_API_DIST_SCHEDULER}" ]]; then
        log "  [clean] 删除旧 dist 产物: ${MAIN_API_DIST_SCHEDULER}"
        rm -f "${MAIN_API_DIST_SCHEDULER}"
    else
        log "  [skip] 旧 dist 产物已不存在"
    fi
}

# ─── HK 部署 ─────────────────────────────────────────────────────────────────
plan_hk() {
    log "=== HK server 部署计划 ==="
    log "  目标: ${HK_HOST} (${HK_IP})"
    log "  方式: cron entry（与现有基础设施一致）"
    log "  注意: 现有 /Users/administrator/bin/sync-to-hk.sh 只同步 skills/workflows/docs，"
    log "        不同步 zenithjoy 代码 —— HK 部署走手动操作清单（确保凭据/路径正确）"
    log ""
    log "  完整清单见 --apply-hk 输出。"
}

apply_hk() {
    cat <<EOF

=============================================================================
HK server 部署清单（手动执行，copy-paste 到本地终端即可；幂等）
=============================================================================

目标：在 HK server 安装 topic-worker 每日 09:00 BJT 的 cron 任务，
并确保该 server 上的 zenithjoy apps/api 不再有老 pipeline-scheduler。

前置条件：
  - 本地 ~/.ssh/config 有 Host 别名 "${HK_HOST}" 指向 ${HK_IP}，且能免密登录
  - HK server 上有 zenithjoy 仓库 checkout（通常在 ${HK_REPO_PATH_HINT}）

─── 步骤 1：SSH 到 HK 并定位仓库 ───────────────────────────────────────────

    ssh ${HK_HOST}

    # 在 HK 上确认仓库位置（实际路径可能不同）
    ZENITHJOY_REPO=\$(ls -d ~/zenithjoy ~/dev/zenithjoy /home/ubuntu/zenithjoy 2>/dev/null | head -1)
    echo "仓库路径: \$ZENITHJOY_REPO"

─── 步骤 2：拉取最新代码（包含本 PR 合并后的 topic-worker.py） ────────────

    cd "\$ZENITHJOY_REPO"
    git fetch origin main
    git checkout main
    git pull origin main

─── 步骤 3：安装 cron 任务（幂等） ─────────────────────────────────────────

    # 移除旧的（如果存在），再追加新的
    ( crontab -l 2>/dev/null | grep -v 'topic-worker.py' ; \\
      echo "0 9 * * * cd \$ZENITHJOY_REPO && /usr/bin/env python3 services/creator/scripts/topic-worker.py --apply >> /tmp/topic-worker.log 2>&1" \\
    ) | crontab -

    # 验证
    crontab -l | grep topic-worker.py

─── 步骤 4：禁用 HK 上的老 pipeline-scheduler（幂等） ─────────────────────

    # 禁用 .env 里的变量
    if [ -f "\$ZENITHJOY_REPO/apps/api/.env" ]; then
        sed -i 's/^PIPELINE_SCHEDULER_ENABLED=true/PIPELINE_SCHEDULER_ENABLED=false/' \\
            "\$ZENITHJOY_REPO/apps/api/.env"
    fi

    # 删除旧 dist 产物（若仓库已 pull 最新则 rebuild 不会产生）
    rm -f "\$ZENITHJOY_REPO/apps/api/dist/services/pipeline-scheduler.service.js"

    # 重新 build（清理 dist）
    cd "\$ZENITHJOY_REPO/apps/api"
    npm run build 2>/dev/null || echo "[warn] build 失败，手动排查"

─── 步骤 5：重启 apps/api 服务（systemd 或 pm2，按现状） ───────────────────

    # systemd 方式
    sudo systemctl restart zenithjoy-api 2>/dev/null || true
    # pm2 方式
    pm2 restart zenithjoy-api 2>/dev/null || true

    # 观察日志，确认不再有 [pipeline-scheduler] 输出
    tail -30 /var/log/zenithjoy-api.log 2>/dev/null || \\
        pm2 logs zenithjoy-api --lines 30 --nostream 2>/dev/null

─── 步骤 6：立即跑一次验证（可选） ─────────────────────────────────────────

    cd "\$ZENITHJOY_REPO"
    /usr/bin/env python3 services/creator/scripts/topic-worker.py --dry-run

─── 完成 ────────────────────────────────────────────────────────────────────

    exit  # 退出 HK ssh 会话

说明：
  - 之所以走手动清单而非自动化：sync-to-hk.sh 只同步 skills/workflows/docs，
    不负责 zenithjoy 代码同步；HK 的仓库路径、服务管理方式（systemd/pm2）
    因环境而异，强行自动化容易把事情搞错
  - 本清单每步都幂等，重复 copy-paste 不会出问题
  - 如需后续自动化，可将本清单固化为 infrastructure/hk/deploy.sh 并增强 sync-to-hk.sh

=============================================================================
EOF
}

# ─── 主入口 ──────────────────────────────────────────────────────────────────
case "${MODE}" in
    ""|"--dry-run")
        log "MODE: dry-run（只打印计划，不执行任何操作）"
        plan_local
        echo ""
        plan_hk
        log ""
        log "执行：--apply-local（本地）/ --apply-hk（HK）/ --apply-all（全部）"
        ;;
    "--apply-local")
        apply_local
        ;;
    "--apply-hk")
        apply_hk
        ;;
    "--apply-all")
        apply_local
        echo ""
        apply_hk
        ;;
    "-h"|"--help")
        usage
        ;;
    *)
        log "[ERROR] 未知参数: ${MODE}"
        echo ""
        usage
        exit 1
        ;;
esac
