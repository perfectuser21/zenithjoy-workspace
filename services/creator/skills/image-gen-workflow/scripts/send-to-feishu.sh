#!/bin/bash
# 发送图片到飞书群（通过 Mac Mini 飞书客户端）
# 修复：使用剪贴板输入中文，而不是 keystroke

IMAGE_PATH="${1:?用法: send-to-feishu.sh <图片路径> [群名称]}"
GROUP_NAME="${2:-悦升云端}"

echo "发送图片到飞书群: $GROUP_NAME"

# 1. 传输图片到 Mac Mini
echo "1. 传输图片..."
scp "$IMAGE_PATH" mac-mini:/tmp/send-image.png || {
    echo "✗ 图片传输失败"
    exit 1
}

# 2. 点击飞书 Dock 图标激活
echo "2. 激活飞书..."
ssh mac-mini "osascript -e '
tell application \"System Events\"
    tell process \"Dock\"
        click UI element \"飞书\" of list 1
    end tell
end tell
'"
sleep 1

# 3. Cmd+K 打开搜索
echo "3. 打开搜索..."
ssh mac-mini "osascript -e 'tell application \"System Events\" to keystroke \"k\" using command down'"
sleep 0.8

# 4. 清空搜索框并输入群名（用剪贴板输入中文）
echo "4. 搜索群: $GROUP_NAME"
ssh mac-mini "osascript -e 'tell application \"System Events\" to keystroke \"a\" using command down'"
sleep 0.2
ssh mac-mini "osascript -e 'tell application \"System Events\" to key code 51'"  # 删除
sleep 0.3
ssh mac-mini "osascript -e 'set the clipboard to \"$GROUP_NAME\"'"
ssh mac-mini "osascript -e 'tell application \"System Events\" to keystroke \"v\" using command down'"
sleep 1.5

# 5. 回车进入群
echo "5. 进入群..."
ssh mac-mini "osascript -e 'tell application \"System Events\" to keystroke return'"
sleep 2

# 6. 复制图片到剪贴板并粘贴
echo "6. 粘贴图片..."
ssh mac-mini "osascript -e 'set the clipboard to (read (POSIX file \"/tmp/send-image.png\") as «class PNGf»)'"
sleep 0.5
ssh mac-mini "osascript -e 'tell application \"System Events\" to keystroke \"v\" using command down'"
sleep 1

# 7. 发送
echo "7. 发送..."
ssh mac-mini "osascript -e 'tell application \"System Events\" to keystroke return'"

echo "✓ 已发送到「$GROUP_NAME」群"
