#!/usr/bin/env python3
"""
从 ChatGPT/Gemini 页面提取生成的图片
"""

import json
import asyncio
import websockets
import base64
import sys
import argparse
import requests
from datetime import datetime


async def get_tab_by_url(keyword):
    """根据 URL 关键词获取标签页"""
    response = requests.get("http://localhost:19222/json", timeout=5)
    tabs = response.json()

    for tab in tabs:
        url = tab.get('url', '')
        if keyword.lower() in url.lower():
            return tab.get('webSocketDebuggerUrl')

    return None


async def extract_from_chatgpt(output_path: str):
    """从 ChatGPT 提取图片"""
    ws_url = await get_tab_by_url('chatgpt')
    if not ws_url:
        ws_url = await get_tab_by_url('chat.openai')

    if not ws_url:
        print("错误: 找不到 ChatGPT 标签页")
        return None

    return await extract_image(ws_url, output_path, 'chatgpt')


async def extract_from_gemini(output_path: str):
    """从 Gemini 提取图片"""
    ws_url = await get_tab_by_url('gemini')
    if not ws_url:
        print("错误: 找不到 Gemini 标签页")
        return None

    return await extract_image(ws_url, output_path, 'gemini')


async def extract_image(ws_url: str, output_path: str, source: str):
    """通用图片提取"""
    print(f"连接到 {source}...")

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

        # 根据来源查找图片
        if source == 'chatgpt':
            selector = '''
                // DALL-E 生成的图片
                const images = Array.from(document.querySelectorAll('img')).filter(img => {
                    const src = img.src || '';
                    const alt = img.alt || '';
                    return (src.includes('oaidalleapi') ||
                            src.includes('openai') ||
                            alt.includes('DALL') ||
                            (img.naturalWidth > 400 && !src.includes('avatar')));
                });
            '''
        else:  # gemini
            selector = '''
                // Gemini 生成的图片
                const images = Array.from(document.querySelectorAll('img')).filter(img => {
                    return (img.naturalWidth > 400 || img.width > 400) &&
                           !img.src.includes('avatar') &&
                           !img.src.includes('icon') &&
                           !img.src.includes('logo');
                });
            '''

        # 获取图片位置
        print("查找生成的图片...")
        result = await send_cmd("Runtime.evaluate", {
            "expression": f'''
                (function() {{
                    {selector}

                    if (images.length === 0) {{
                        return JSON.stringify({{error: "没有找到图片"}});
                    }}

                    const img = images[images.length - 1];
                    const rect = img.getBoundingClientRect();

                    return JSON.stringify({{
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                        src: img.src.substring(0, 100)
                    }});
                }})()
            '''
        })

        img_info = json.loads(result.get('result', {}).get('result', {}).get('value', '{}'))

        if 'error' in img_info:
            print(f"错误: {img_info['error']}")
            return None

        print(f"找到图片: {img_info['naturalWidth']}x{img_info['naturalHeight']}")

        # 截取图片区域
        print("截取图片...")
        result = await send_cmd("Page.captureScreenshot", {
            "format": "png",
            "clip": {
                "x": img_info['x'],
                "y": img_info['y'],
                "width": img_info['width'],
                "height": img_info['height'],
                "scale": 1
            }
        })

        if 'result' in result and 'data' in result['result']:
            img_data = base64.b64decode(result['result']['data'])

            with open(output_path, 'wb') as f:
                f.write(img_data)

            print(f"✓ 图片已保存: {output_path}")
            print(f"  大小: {len(img_data)} bytes")
            return output_path
        else:
            print("截图失败")
            return None


def main():
    parser = argparse.ArgumentParser(description='从 ChatGPT/Gemini 提取生成的图片')
    parser.add_argument('-s', '--source', choices=['chatgpt', 'gemini', 'auto'],
                       default='auto', help='图片来源')
    parser.add_argument('-o', '--output', default=None,
                       help='输出路径 (默认: /tmp/generated-{timestamp}.png)')
    args = parser.parse_args()

    if args.output:
        output_path = args.output
    else:
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        output_path = f'/tmp/generated-{timestamp}.png'

    if args.source == 'chatgpt':
        result = asyncio.run(extract_from_chatgpt(output_path))
    elif args.source == 'gemini':
        result = asyncio.run(extract_from_gemini(output_path))
    else:
        # auto: 先试 ChatGPT，再试 Gemini
        result = asyncio.run(extract_from_chatgpt(output_path))
        if not result:
            result = asyncio.run(extract_from_gemini(output_path))

    if result:
        print(f"\n输出: {result}")
        sys.exit(0)
    else:
        print("\n提取失败")
        sys.exit(1)


if __name__ == "__main__":
    main()
