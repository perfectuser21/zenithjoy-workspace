#!/usr/bin/env python3
"""
今日头条自动发帖工具
通过 Chrome DevTools Protocol 自动发布内容到今日头条
"""

import json
import asyncio
import websockets
import base64
import sys
import os
import requests
from pathlib import Path


async def get_toutiao_tab():
    """获取今日头条标签页的 WebSocket URL"""
    response = requests.get("http://localhost:19222/json", timeout=5)
    tabs = response.json()

    for tab in tabs:
        url = tab.get('url', '')
        if 'mp.toutiao.com' in url or 'toutiao.com' in url:
            return tab.get('webSocketDebuggerUrl')

    # 如果没有找到，返回第一个可用页面
    for tab in tabs:
        if tab.get('type') == 'page':
            return tab.get('webSocketDebuggerUrl')

    return None


async def send_command(ws, method, params=None, msg_id=1):
    """发送 CDP 命令"""
    cmd = {"id": msg_id, "method": method}
    if params:
        cmd["params"] = params

    await ws.send(json.dumps(cmd))

    while True:
        response = json.loads(await ws.recv())
        if response.get('id') == msg_id:
            return response.get('result', {})

    def navigate_to_creator_platform(self):
        """导航到今日头条创作者平台"""
        print("打开今日头条创作者平台...")
        self.send_command('Page.navigate', {
            'url': 'https://mp.toutiao.com/profile_v4/graphic/publish'
        })
        time.sleep(3)  # 等待页面加载

    def check_login_status(self):
        """检查登录状态"""
        print("检查登录状态...")
        result = self.send_command('Runtime.evaluate', {
            'expression': 'window.location.href'
        })
        current_url = result.get('result', {}).get('value', '')

        if 'login' in current_url.lower():
            print("❌ 未登录，请先在浏览器中登录今日头条")
            return False

        print("✓ 已登录")
        return True

    def upload_image(self, image_path):
        """上传图片

        Args:
            image_path: 图片文件路径

        Returns:
            str: 图片 URL 或 None
        """
        print(f"上传图片: {image_path}")

        # 读取图片并转换为 base64
        with open(image_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode()

        # TODO: 实现图片上传逻辑
        # 需要根据今日头条的实际页面结构来实现

        return None

    def publish_post(self, title, content, image_path=None):
        """发布帖子

        Args:
            title: 标题
            content: 正文
            image_path: 配图路径（可选）
        """
        print(f"\n开始发布: {title}")

        # 1. 填写标题
        print("填写标题...")
        self.send_command('Runtime.evaluate', {
            'expression': f'''
                document.querySelector('input[placeholder*="标题"]').value = {json.dumps(title)};
                document.querySelector('input[placeholder*="标题"]').dispatchEvent(new Event('input', {{ bubbles: true }}));
            '''
        })
        time.sleep(1)

        # 2. 填写正文
        print("填写正文...")
        self.send_command('Runtime.evaluate', {
            'expression': f'''
                (function() {{
                    const editor = document.querySelector('.ql-editor, .public-DraftEditor-content, [contenteditable="true"]');
                    if (editor) {{
                        editor.textContent = {json.dumps(content)};
                        editor.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        return true;
                    }}
                    return false;
                }})()
            '''
        })
        time.sleep(1)

        # 3. 上传配图（如果有）
        if image_path:
            self.upload_image(image_path)
            time.sleep(2)

        # 4. 点击发布按钮（先不实际发布，等确认流程）
        print("准备发布...")
        print("⚠️  当前为测试模式，不会实际发布")
        print("    请手动检查页面内容是否正确填充")

    def close(self):
        """关闭连接"""
        if self.ws:
            self.ws.close()


def main():
    """主函数"""
    if len(sys.argv) < 3:
        print("用法: python3 post-to-toutiao.py <标题> <正文> [配图路径]")
        sys.exit(1)

    title = sys.argv[1]
    content = sys.argv[2]
    image_path = sys.argv[3] if len(sys.argv) > 3 else None

    publisher = ToutiaoPublisher()

    try:
        # 连接到浏览器
        publisher.connect()

        # 导航到创作者平台
        publisher.navigate_to_creator_platform()

        # 检查登录状态
        if not publisher.check_login_status():
            print("\n请先在浏览器中登录今日头条，然后重新运行此脚本")
            return

        # 发布帖子
        publisher.publish_post(title, content, image_path)

        print("\n✓ 内容已填充到发布页面")
        print("  请在浏览器中检查并手动点击发布")

    finally:
        publisher.close()


if __name__ == '__main__':
    main()
