#!/usr/bin/env python3
"""
NotebookLM 登录状态保存工具
运行后会打开浏览器，手动登录 Google 账号，登录成功后关闭浏览器即可保存状态。
"""

import os
from playwright.sync_api import sync_playwright

STATE_FILE = os.path.join(os.path.dirname(__file__), "notebooklm-state.json")


def main():
    print("=" * 50)
    print("NotebookLM 登录状态保存工具")
    print("=" * 50)
    print()
    print("1. 浏览器将打开 NotebookLM 页面")
    print("2. 请手动登录你的 Google 账号")
    print("3. 登录成功后，关闭浏览器窗口")
    print("4. 登录状态将自动保存")
    print()
    input("按 Enter 开始...")

    with sync_playwright() as p:
        # 使用有头模式，让用户手动登录
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        # 打开 NotebookLM
        page.goto("https://notebooklm.google.com/")

        print()
        print("浏览器已打开，请登录 Google 账号...")
        print("登录成功后，关闭浏览器窗口即可。")

        # 等待用户关闭浏览器
        try:
            page.wait_for_event("close", timeout=300000)  # 5 分钟超时
        except:
            pass

        # 保存登录状态
        context.storage_state(path=STATE_FILE)
        browser.close()

    print()
    print(f"✅ 登录状态已保存到: {STATE_FILE}")
    print("下次运行图片生成脚本时将自动使用此登录状态。")


if __name__ == "__main__":
    main()
