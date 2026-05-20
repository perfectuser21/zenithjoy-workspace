#!/usr/bin/env python3
"""
NotebookLM 图片生成工具
通过 Playwright 自动化操作 NotebookLM 生成 Nano Banana 图片。

用法:
    python notebooklm-image.py "你的文案内容" [--notebook-id ID] [--output 输出路径]
    python notebooklm-image.py --file content/deep-posts/xxx.md
"""

import os
import sys
import argparse
import time
from datetime import datetime
from playwright.sync_api import sync_playwright

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(SCRIPT_DIR, "notebooklm-state.json")
DEFAULT_OUTPUT_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "assets", "generated")


def check_login_state():
    """检查登录状态文件是否存在"""
    if not os.path.exists(STATE_FILE):
        print("❌ 未找到登录状态文件")
        print(f"   请先运行: python {os.path.join(SCRIPT_DIR, 'notebooklm-login.py')}")
        sys.exit(1)


def read_content_from_file(filepath):
    """从 markdown 文件读取内容"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 跳过 frontmatter
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            content = parts[2].strip()

    return content


def generate_image(content, notebook_id=None, output_path=None, style="infographic"):
    """
    使用 NotebookLM 生成图片

    Args:
        content: 要生成图片的文案内容
        notebook_id: NotebookLM notebook ID（可选，使用已有的或创建新的）
        output_path: 输出文件路径
        style: 图片风格 (infographic/slide)
    """
    check_login_state()

    if output_path is None:
        os.makedirs(DEFAULT_OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = os.path.join(DEFAULT_OUTPUT_DIR, f"nano-banana-{timestamp}.png")

    print(f"📝 内容长度: {len(content)} 字符")
    print(f"🎨 图片风格: {style}")
    print(f"💾 输出路径: {output_path}")
    print()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,  # 无头模式
            args=['--no-sandbox', '--disable-setuid-sandbox']
        )

        # 加载登录状态
        context = browser.new_context(storage_state=STATE_FILE)
        page = context.new_page()

        try:
            # 1. 打开 NotebookLM
            print("🌐 打开 NotebookLM...")
            if notebook_id:
                page.goto(f"https://notebooklm.google.com/notebook/{notebook_id}")
            else:
                page.goto("https://notebooklm.google.com/")

            # 等待页面加载
            page.wait_for_load_state("networkidle", timeout=30000)
            time.sleep(2)

            # 2. 检查是否需要创建新 notebook 或使用已有的
            print("📓 检查 Notebook...")

            # 尝试找到创建新 notebook 的按钮或进入已有 notebook
            # NotebookLM 的 UI 可能会变化，这里需要根据实际情况调整选择器

            # 如果在主页，点击创建新 notebook
            new_notebook_btn = page.locator('button:has-text("New notebook"), button:has-text("Create")')
            if new_notebook_btn.count() > 0:
                print("   创建新 Notebook...")
                new_notebook_btn.first.click()
                page.wait_for_load_state("networkidle")
                time.sleep(2)

            # 3. 添加内容作为 source（粘贴文本）
            print("📋 添加内容...")

            # 查找添加 source 的按钮
            add_source_btn = page.locator('button:has-text("Add source"), button:has-text("添加来源")')
            if add_source_btn.count() > 0:
                add_source_btn.first.click()
                time.sleep(1)

            # 查找粘贴文本的选项
            paste_text_btn = page.locator('button:has-text("Paste text"), button:has-text("粘贴文本"), [data-testid="paste-text"]')
            if paste_text_btn.count() > 0:
                paste_text_btn.first.click()
                time.sleep(1)

            # 输入内容
            text_input = page.locator('textarea, [contenteditable="true"]').first
            if text_input:
                text_input.fill(content)
                time.sleep(1)

            # 确认添加
            confirm_btn = page.locator('button:has-text("Insert"), button:has-text("Add"), button:has-text("确认")')
            if confirm_btn.count() > 0:
                confirm_btn.first.click()
                time.sleep(3)

            # 4. 生成图片（Infographic 或 Slide Deck）
            print(f"🎨 生成 {style}...")

            # 查找生成图片的选项
            if style == "infographic":
                gen_btn = page.locator('button:has-text("Infographic"), button:has-text("信息图")')
            else:
                gen_btn = page.locator('button:has-text("Slide"), button:has-text("幻灯片")')

            if gen_btn.count() > 0:
                gen_btn.first.click()
                print("   等待生成...")
                # 等待图片生成（可能需要较长时间）
                time.sleep(30)
            else:
                print("   ⚠️ 未找到生成按钮，尝试通过聊天生成...")
                # 通过聊天界面请求生成
                chat_input = page.locator('textarea[placeholder*="Ask"], input[placeholder*="Ask"]')
                if chat_input.count() > 0:
                    chat_input.first.fill(f"Create an infographic about: {content[:500]}")
                    page.keyboard.press("Enter")
                    time.sleep(30)

            # 5. 等待并下载图片
            print("📥 下载图片...")

            # 查找生成的图片
            page.wait_for_selector('img[src*="generated"], img[src*="nano-banana"], .generated-image', timeout=60000)

            # 截图保存
            # 方式1: 直接截图整个生成区域
            gen_area = page.locator('.generated-content, .infographic-container, [data-testid="generated-image"]')
            if gen_area.count() > 0:
                gen_area.first.screenshot(path=output_path)
            else:
                # 方式2: 截取整个页面
                page.screenshot(path=output_path, full_page=True)

            print(f"✅ 图片已保存: {output_path}")

        except Exception as e:
            print(f"❌ 生成失败: {e}")
            # 保存错误截图用于调试
            error_screenshot = os.path.join(DEFAULT_OUTPUT_DIR, f"error-{datetime.now().strftime('%Y%m%d-%H%M%S')}.png")
            page.screenshot(path=error_screenshot, full_page=True)
            print(f"   错误截图已保存: {error_screenshot}")
            raise

        finally:
            browser.close()

    return output_path


def main():
    parser = argparse.ArgumentParser(description="NotebookLM 图片生成工具")
    parser.add_argument("content", nargs="?", help="要生成图片的文案内容")
    parser.add_argument("--file", "-f", help="从 markdown 文件读取内容")
    parser.add_argument("--notebook-id", "-n", help="NotebookLM notebook ID")
    parser.add_argument("--output", "-o", help="输出文件路径")
    parser.add_argument("--style", "-s", choices=["infographic", "slide"], default="infographic", help="图片风格")

    args = parser.parse_args()

    # 获取内容
    if args.file:
        content = read_content_from_file(args.file)
    elif args.content:
        content = args.content
    else:
        print("请提供内容或文件路径")
        print("用法:")
        print('  python notebooklm-image.py "你的文案"')
        print('  python notebooklm-image.py --file content/deep-posts/xxx.md')
        sys.exit(1)

    # 生成图片
    output = generate_image(
        content=content,
        notebook_id=args.notebook_id,
        output_path=args.output,
        style=args.style
    )

    print()
    print(f"🎉 完成！图片路径: {output}")


if __name__ == "__main__":
    main()
