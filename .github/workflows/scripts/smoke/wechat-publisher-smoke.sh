#!/usr/bin/env bash
# wechat-publisher-smoke.sh
# Walking Skeleton #1 — wechat-publisher 4 脚本结构 smoke
#
# 目标：验证 agent tarball 含 wechat-publisher 完整 4 脚本（image/video/article + dryrun）
#   - 解压 tarball → publishers/wechat-publisher/ 含 4 个 .cjs
#   - 每个脚本含关键命令：connectOverCDP / 19222 / dryRun / 风险等
#   - dryrun 脚本绝不点击「发表」按钮（grep 不点击/不发表的标记）
#
# 退出码：
#   0  4 个脚本齐 + 关键命令齐
#   1  tarball 下载失败
#   2  tarball 缺 wechat-publisher 目录或脚本
#   3  脚本缺关键命令

set -uo pipefail

BASE_URL="${AGENT_TARBALL_URL:-https://autopilot.zenjoymedia.media/download/zenithjoy-agent-v0.1.0.tar.gz}"
URL="${BASE_URL}?cb=$(date +%s)"

TMP_DIR=$(mktemp -d -t zj-wx-pub-smoke.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT
TAR="$TMP_DIR/agent.tar.gz"

echo "▶ [1/4] 下载 tarball 从 $URL"
curl -fsS --max-time 60 "$URL" -o "$TAR" 2>&1 || {
  echo "  FAIL: 下载失败"
  exit 1
}
SIZE=$(stat -f%z "$TAR" 2>/dev/null || stat -c%s "$TAR" 2>/dev/null)
echo "  OK: $SIZE bytes"

echo "▶ [2/4] 解压并校验 wechat-publisher 4 个脚本存在"
tar -xzf "$TAR" -C "$TMP_DIR" || {
  echo "  FAIL: 解压失败"
  exit 1
}
WX_DIR="$TMP_DIR/zenithjoy-agent/publishers/wechat-publisher"
if [ ! -d "$WX_DIR" ]; then
  echo "  FAIL: tarball 缺 publishers/wechat-publisher/ 目录"
  ls -la "$TMP_DIR/zenithjoy-agent/publishers/" 2>&1 | head -10
  exit 2
fi

MISSING=()
for f in publish-wechat-image-dryrun.cjs publish-wechat-image.cjs publish-wechat-video.cjs publish-wechat-article.cjs; do
  [ -f "$WX_DIR/$f" ] || MISSING+=("$f")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "  FAIL: wechat-publisher 缺脚本："
  printf '    - %s\n' "${MISSING[@]}"
  ls -la "$WX_DIR" 2>&1 | head -10
  exit 2
fi
echo "  OK: 4 个脚本齐（image-dryrun / image / video / article）"

echo "▶ [3/4] 校验脚本含 Playwright CDP 19222 关键命令"
ERR=0
for f in publish-wechat-image-dryrun.cjs publish-wechat-image.cjs publish-wechat-video.cjs publish-wechat-article.cjs; do
  P="$WX_DIR/$f"
  if ! grep -q "connectOverCDP" "$P"; then
    echo "  FAIL: $f 缺 connectOverCDP"
    ERR=1
  fi
  if ! grep -q "19222" "$P"; then
    echo "  FAIL: $f 缺 CDP 端口 19222"
    ERR=1
  fi
  if ! grep -q "ok" "$P"; then
    echo "  FAIL: $f 缺 ok 输出标记"
    ERR=1
  fi
done
[ "$ERR" -eq 0 ] && echo "  OK: connectOverCDP / 19222 / ok 关键命令齐"

echo "▶ [4/4] 校验 dryrun 脚本不点「发表」 + 真发脚本含风控关键词「风险」"
DRY="$WX_DIR/publish-wechat-image-dryrun.cjs"
if ! grep -q "dryRun" "$DRY"; then
  echo "  FAIL: dryrun 脚本缺 dryRun:true 输出标记"
  ERR=1
fi
# dryrun 脚本必须有「不点击」/「draft」/「dry-run」类标记
if ! grep -qE "不点击|不点|draft|dry-?run" "$DRY"; then
  echo "  FAIL: dryrun 脚本缺「不点击发表」语义标记"
  ERR=1
fi

# 真发脚本含风控检测
for f in publish-wechat-image.cjs publish-wechat-video.cjs publish-wechat-article.cjs; do
  P="$WX_DIR/$f"
  if ! grep -qE "风险|频繁|违规|风控" "$P"; then
    echo "  FAIL: $f 缺风控关键词检测"
    ERR=1
  fi
done

if [ "$ERR" -ne 0 ]; then
  echo "  FAIL: 关键命令缺失"
  exit 3
fi
echo "  OK: dryrun 不点发表 + 真发含风控关键词"

echo ""
echo "✅ Walking Skeleton #1 wechat-publisher smoke PASS（4 脚本齐 + 关键命令齐）"
exit 0
