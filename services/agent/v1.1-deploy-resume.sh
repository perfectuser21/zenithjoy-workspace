#!/bin/bash
# v1.1 部署续作脚本 — 等 SCP 完成后接力部署 + 8 平台真测
# 使用：bash services/agent/v1.1-deploy-resume.sh
#
# 前提：scp zenithjoy-agent.exe.gz 到 xian-pc 的过程已经在跑（PID 24876）
# 期待结果：
#   1. 等 .gz 文件大小达到 21243824 字节
#   2. Windows 端 stop agent → 解压替换 .exe → 启动 agent
#   3. 装 Chromium（被前序步骤 kill 过）
#   4. 验证 capabilities 含 'xiaohongshu'
#   5. 8 平台真测（不含公众号）

set -e

EXPECTED_SIZE=21243824
HOST=xian-pc
GZ_PATH='C:/Users/xuxia/zenithjoy-agent/zenithjoy-agent.exe.gz'
EXE_PATH='C:/Users/xuxia/zenithjoy-agent/zenithjoy-agent.exe'

echo "=== Step 1: 等 SCP 完成 ==="
while true; do
  size=$(ssh -o ConnectTimeout=10 "$HOST" "powershell -Command \"(Get-Item $GZ_PATH -ErrorAction SilentlyContinue).Length\"" 2>/dev/null | tr -d '[:space:]')
  if [ "$size" = "$EXPECTED_SIZE" ]; then
    echo "SCP 完成: $size bytes"
    break
  fi
  echo "scp progress: $size / $EXPECTED_SIZE"
  sleep 120
done

echo "=== Step 2: Windows 端 stop agent + gunzip + start agent ==="
ssh "$HOST" 'powershell -Command "& {
  $src = \"C:\Users\xuxia\zenithjoy-agent\zenithjoy-agent.exe.gz\"
  $dst = \"C:\Users\xuxia\zenithjoy-agent\zenithjoy-agent.exe\"

  Stop-Process -Name zenithjoy-agent -Force -ErrorAction SilentlyContinue
  Start-Sleep 2

  if (Test-Path $dst) { Remove-Item $dst -Force }

  $input = [System.IO.File]::OpenRead($src)
  $output = [System.IO.File]::Create($dst)
  $gzip = New-Object System.IO.Compression.GZipStream($input, [System.IO.Compression.CompressionMode]::Decompress)
  $gzip.CopyTo($output)
  $gzip.Close()
  $output.Close()
  $input.Close()
  Remove-Item $src

  Start-Process $dst -WindowStyle Hidden
  Write-Host \"agent restarted\"
}"'

echo "=== Step 3: 装 Chromium ==="
ssh "$HOST" 'powershell -Command "cd C:\Users\xuxia\zenithjoy-agent\publishers; npx playwright install chromium"' || echo "WARN: chromium install failed"

sleep 10

echo "=== Step 4: 验证 capabilities ==="
curl -s https://autopilot.zenjoymedia.media/api/agent/status | jq '.'

echo "=== Step 5: 8 平台真测 (不含公众号!) ==="
for p in douyin kuaishou xiaohongshu toutiao weibo shipinhao zhihu; do
  echo "=== $p ==="
  curl -s -X POST https://autopilot.zenjoymedia.media/api/agent/test-publish-$p | head -1
  echo ""
  sleep 3
done

echo "=== DONE ==="
