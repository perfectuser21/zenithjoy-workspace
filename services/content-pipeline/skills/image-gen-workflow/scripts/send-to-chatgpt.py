#!/usr/bin/env python3
"""
发送 prompt 和参考图到 ChatGPT，生成图片
"""

import json
import asyncio
import websockets
import base64
import sys
import os
import argparse
import requests

async def get_chatgpt_tab():
    """获取 ChatGPT 标签页的 WebSocket URL"""
    response = requests.get("http://localhost:19222/json", timeout=5)
    tabs = response.json()

    for tab in tabs:
        url = tab.get('url', '')
        if 'chat.openai.com' in url or 'chatgpt.com' in url:
            return tab.get('webSocketDebuggerUrl')

    return None


async def send_to_chatgpt(prompt: str, reference_images: list = None):
    """
    发送 prompt 和参考图到 ChatGPT

    Args:
        prompt: 生成图片的 prompt
        reference_images: 参考图片路径列表
    """
    ws_url = await get_chatgpt_tab()
    if not ws_url:
        print("错误: 找不到 ChatGPT 标签页，请在 Mac Mini Chrome 中打开 ChatGPT")
        return None

    print(f"连接到 ChatGPT: {ws_url[:50]}...")

    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        msg_id = 1

        async def send_cmd(method, params=None):
            nonlocal msg_id
            cmd = {"id": msg_id, "method": method}
            if params:
                cmd["params"] = params
            msg_id += 1
            await ws.send(json.dumps(cmd))
            response = await ws.recv()
            return json.loads(response)

        # 1. 如果有参考图，先上传
        if reference_images:
            print(f"上传 {len(reference_images)} 张参考图...")
            for img_path in reference_images:
                if os.path.exists(img_path):
                    # 读取图片并转为 base64
                    with open(img_path, 'rb') as f:
                        img_data = base64.b64encode(f.read()).decode()

                    # 通过 CDP 上传文件（模拟拖放或点击上传按钮）
                    # ChatGPT 的上传比较复杂，这里用剪贴板方式
                    print(f"  - 上传: {img_path}")

                    # 将图片复制到 Mac Mini 并通过剪贴板上传
                    # 先传输图片
                    os.system(f"scp {img_path} mac-mini:/tmp/ref-image.png")

                    # 在 Mac 上复制到剪贴板
                    os.system("ssh mac-mini 'osascript -e \"set the clipboard to (read (POSIX file \\\"/tmp/ref-image.png\\\") as «class PNGf»)\"'")

                    # 粘贴到 ChatGPT
                    result = await send_cmd("Runtime.evaluate", {
                        "expression": '''
                            (function() {
                                // 找到输入框
                                const textarea = document.querySelector('textarea[data-id="root"]') ||
                                                document.querySelector('#prompt-textarea') ||
                                                document.querySelector('textarea');
                                if (textarea) {
                                    textarea.focus();
                                    return "focused";
                                }
                                return "not found";
                            })()
                        '''
                    })
                    print(f"    聚焦结果: {result.get('result', {}).get('result', {}).get('value', '')}")

                    await asyncio.sleep(0.5)

                    # 模拟 Cmd+V
                    os.system("ssh mac-mini 'osascript -e \"tell application \\\"System Events\\\" to keystroke \\\"v\\\" using command down\"'")
                    await asyncio.sleep(1)

        # 2. 输入 prompt
        print("输入 prompt...")
        escaped_prompt = prompt.replace('`', '\\`').replace('\\', '\\\\').replace('\n', '\\n')

        result = await send_cmd("Runtime.evaluate", {
            "expression": f'''
                (function() {{
                    // ChatGPT 输入框
                    const textarea = document.querySelector('textarea[data-id="root"]') ||
                                    document.querySelector('#prompt-textarea') ||
                                    document.querySelector('textarea');
                    if (!textarea) return "找不到输入框";

                    // 设置值
                    textarea.value = `{escaped_prompt}`;

                    // 触发 input 事件
                    textarea.dispatchEvent(new Event('input', {{ bubbles: true }}));

                    // 调整高度
                    textarea.style.height = 'auto';
                    textarea.style.height = textarea.scrollHeight + 'px';

                    return "已输入 prompt";
                }})()
            '''
        })
        print(f"  结果: {result.get('result', {}).get('result', {}).get('value', '')}")

        await asyncio.sleep(0.5)

        # 3. 点击发送按钮
        print("点击发送...")
        result = await send_cmd("Runtime.evaluate", {
            "expression": '''
                (function() {
                    // ChatGPT 发送按钮
                    const sendBtn = document.querySelector('[data-testid="send-button"]') ||
                                   document.querySelector('button[aria-label="Send prompt"]') ||
                                   document.querySelector('form button[type="submit"]') ||
                                   document.querySelector('button svg[viewBox="0 0 24 24"]')?.closest('button');

                    if (sendBtn && !sendBtn.disabled) {
                        sendBtn.click();
                        return "已点击发送";
                    }

                    // 备选：按回车
                    const textarea = document.querySelector('textarea');
                    if (textarea) {
                        textarea.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            bubbles: true
                        }));
                        return "已按回车发送";
                    }

                    return "找不到发送按钮";
                })()
            '''
        })
        print(f"  结果: {result.get('result', {}).get('result', {}).get('value', '')}")

        # 4. 等待生成
        print("等待生成中... (这可能需要 30-60 秒)")
        await asyncio.sleep(30)

        # 5. 检查是否有图片生成
        for i in range(10):
            result = await send_cmd("Runtime.evaluate", {
                "expression": '''
                    (function() {
                        // 查找 DALL-E 生成的图片
                        const images = document.querySelectorAll('img[alt*="DALL"], img[src*="oaidalleapi"], img[src*="openai"]');
                        if (images.length > 0) {
                            const lastImg = images[images.length - 1];
                            return JSON.stringify({
                                found: true,
                                count: images.length,
                                src: lastImg.src.substring(0, 200),
                                width: lastImg.naturalWidth,
                                height: lastImg.naturalHeight
                            });
                        }

                        // 检查是否还在生成中
                        const loading = document.querySelector('[class*="loading"]') ||
                                       document.querySelector('[class*="streaming"]');
                        if (loading) {
                            return JSON.stringify({found: false, status: "generating"});
                        }

                        return JSON.stringify({found: false, status: "no image"});
                    })()
                '''
            })

            status = json.loads(result.get('result', {}).get('result', {}).get('value', '{}'))
            print(f"  检查 {i+1}/10: {status}")

            if status.get('found'):
                print(f"✓ 找到 {status.get('count')} 张图片")
                return status
            elif status.get('status') == 'generating':
                await asyncio.sleep(5)
            else:
                await asyncio.sleep(3)

        print("超时：未能找到生成的图片")
        return None


def main():
    parser = argparse.ArgumentParser(description='发送 prompt 到 ChatGPT 生成图片')
    parser.add_argument('prompt', help='生成图片的 prompt')
    parser.add_argument('-r', '--reference', action='append', help='参考图片路径')
    args = parser.parse_args()

    result = asyncio.run(send_to_chatgpt(args.prompt, args.reference))

    if result and result.get('found'):
        print("\n✓ 图片生成成功")
        sys.exit(0)
    else:
        print("\n✗ 图片生成失败")
        sys.exit(1)


if __name__ == "__main__":
    main()
