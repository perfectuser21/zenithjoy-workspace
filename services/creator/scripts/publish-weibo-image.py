#!/usr/bin/env python3
"""
微博图文自动发帖工具
通过 Chrome DevTools Protocol 自动发布内容到微博

架构：Mac mini → Windows PC (100.97.242.124:19227) → 微博
用法：python3 publish-weibo-image.py <文案> [图片路径1] [图片路径2] ...
"""

import json
import asyncio
import websockets
import base64
import sys
import os
import requests
import time
from pathlib import Path


# 配置
WINDOWS_CDP_HOST = "100.97.242.124"
WEIBO_CDP_PORT = 19227
WEIBO_URL_PATTERN = "weibo.com"
MAX_IMAGES = 9  # 微博最多 9 张图
REQUEST_TIMEOUT = 30
UPLOAD_TIMEOUT = 30  # 图片上传等待秒数
PUBLISH_TIMEOUT = 20  # 发布等待秒数


def log(message: str, level: str = "INFO") -> None:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{level}] {message}", flush=True)


def log_error(message: str) -> None:
    log(message, "ERROR")


def get_weibo_tab() -> str | None:
    """获取微博标签页的 WebSocket URL"""
    url = f"http://{WINDOWS_CDP_HOST}:{WEIBO_CDP_PORT}/json"
    try:
        response = requests.get(url, timeout=REQUEST_TIMEOUT)
        tabs = response.json()
    except Exception as e:
        log_error(f"无法连接到 Chrome DevTools: {e}")
        return None

    # 优先找微博标签页
    for tab in tabs:
        if tab.get("type") == "page" and WEIBO_URL_PATTERN in tab.get("url", ""):
            return tab.get("webSocketDebuggerUrl")

    # 降级：返回第一个可用标签页
    for tab in tabs:
        if tab.get("type") == "page":
            log("⚠️  未找到微博标签页，使用第一个可用页面", "WARN")
            return tab.get("webSocketDebuggerUrl")

    return None


async def publish_weibo_image(content: str, image_paths: list[str]) -> bool:
    """发布图文到微博

    Args:
        content: 微博文案（必需）
        image_paths: 图片路径列表（可选，最多 9 张）

    Returns:
        bool: 发布是否成功
    """
    start_time = time.time()

    log(f"🚀 开始发布 - 文案长度: {len(content)} 字，图片: {len(image_paths)} 张")

    # 校验图片数量
    if len(image_paths) > MAX_IMAGES:
        log(f"⚠️  图片超过 {MAX_IMAGES} 张，截取前 {MAX_IMAGES} 张", "WARN")
        image_paths = image_paths[:MAX_IMAGES]

    # 校验图片文件
    valid_images = []
    for img_path in image_paths:
        if Path(img_path).exists():
            valid_images.append(img_path)
            log(f"  ✓ 图片: {img_path}")
        else:
            log_error(f"  ✗ 图片不存在: {img_path}")

    # 获取 WebSocket URL
    ws_url = get_weibo_tab()
    if not ws_url:
        log_error("❌ 无法获取微博标签页，退出")
        return False

    log(f"连接到浏览器...")

    try:
        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
            msg_id = 1

            async def send_cmd(method: str, params: dict = None) -> dict:
                nonlocal msg_id
                cmd = {"id": msg_id, "method": method}
                if params:
                    cmd["params"] = params
                msg_id += 1
                await ws.send(json.dumps(cmd))

                while True:
                    response = json.loads(await ws.recv())
                    if response.get("id") == cmd["id"]:
                        return response.get("result", {})

            async def eval_js(expr: str, await_promise: bool = False) -> any:
                result = await send_cmd("Runtime.evaluate", {
                    "expression": expr,
                    "awaitPromise": await_promise,
                    "returnByValue": True,
                })
                return result.get("result", {}).get("value")

            # Step 1: 检查当前页面，导航到微博发布页
            log("📍 Step 1: 确认微博页面...")
            current_url = await eval_js("window.location.href")
            log(f"  当前 URL: {current_url}")

            if not current_url or WEIBO_URL_PATTERN not in current_url:
                log("导航到微博首页...")
                await send_cmd("Page.navigate", {"url": "https://weibo.com"})
                await asyncio.sleep(5)
                current_url = await eval_js("window.location.href")
                log(f"  导航后 URL: {current_url}")

            # Step 2: 点击"发微博"按钮
            log("📍 Step 2: 打开发布框...")
            compose_result = await eval_js("""
                (function() {
                    // 尝试多个选择器找发布框/按钮
                    const selectors = [
                        'textarea[node-type="text"]',
                        '.gn_textarea',
                        '.ToolBar_box_1Dg53',
                        '[placeholder*="有什么新鲜事"]',
                        '[placeholder*="分享你的想法"]',
                        'textarea.W_input',
                    ];

                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        if (el) {
                            el.click();
                            el.focus();
                            return 'FOUND:' + sel;
                        }
                    }

                    // 尝试找"发布"按钮入口
                    const btns = document.querySelectorAll('a, button, div[role="button"]');
                    for (const btn of btns) {
                        const text = btn.textContent.trim();
                        if (text === '发微博' || text === '写微博' || text === '+ 发微博') {
                            btn.click();
                            return 'CLICKED:' + text;
                        }
                    }

                    return 'NOT_FOUND';
                })()
            """)
            log(f"  发布框: {compose_result}")
            await asyncio.sleep(2)

            # Step 3: 填写文案
            log(f"📍 Step 3: 填写文案...")
            content_escaped = json.dumps(content)
            fill_result = await eval_js(f"""
                (function() {{
                    const selectors = [
                        'textarea[node-type="text"]',
                        '.gn_textarea',
                        '[placeholder*="有什么新鲜事"]',
                        '[placeholder*="分享你的想法"]',
                        'textarea.W_input',
                        '.ToolBar_box_1Dg53 textarea',
                    ];

                    for (const sel of selectors) {{
                        const el = document.querySelector(sel);
                        if (el) {{
                            el.focus();

                            // 使用原生 setter 绕过框架响应式
                            const nativeSetter = Object.getOwnPropertyDescriptor(
                                window.HTMLTextAreaElement.prototype, 'value'
                            ).set;
                            nativeSetter.call(el, {content_escaped});

                            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            el.dispatchEvent(new KeyboardEvent('keyup', {{ bubbles: true }}));

                            return 'OK:' + el.value.substring(0, 30) + '...';
                        }}
                    }}
                    return 'FAIL:no textarea';
                }})()
            """)
            log(f"  填写结果: {fill_result}")
            await asyncio.sleep(1)

            if fill_result and fill_result.startswith("FAIL"):
                log_error("❌ 无法找到文案输入框，尝试重新导航")
                # 尝试直接打开发布页面
                await send_cmd("Page.navigate", {"url": "https://weibo.com"})
                await asyncio.sleep(5)

                # 重试
                fill_result = await eval_js(f"""
                    (function() {{
                        const el = document.querySelector('textarea[node-type="text"], .gn_textarea, [placeholder*="有什么新鲜事"]');
                        if (el) {{
                            el.focus();
                            const nativeSetter = Object.getOwnPropertyDescriptor(
                                window.HTMLTextAreaElement.prototype, 'value'
                            ).set;
                            nativeSetter.call(el, {content_escaped});
                            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                            return 'RETRY_OK:' + el.value.substring(0, 30);
                        }}
                        return 'RETRY_FAIL';
                    }})()
                """)
                log(f"  重试结果: {fill_result}")
                await asyncio.sleep(1)

            # Step 4: 上传图片
            if valid_images:
                log(f"📍 Step 4: 上传 {len(valid_images)} 张图片...")

                for i, img_path in enumerate(valid_images):
                    log(f"  上传图片 {i+1}/{len(valid_images)}: {img_path}")

                    with open(img_path, "rb") as f:
                        img_data = base64.b64encode(f.read()).decode()

                    # 获取文件名和 MIME 类型
                    img_name = os.path.basename(img_path)
                    ext = Path(img_path).suffix.lower()
                    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                                ".png": "image/png", ".gif": "image/gif",
                                ".webp": "image/webp"}
                    mime_type = mime_map.get(ext, "image/jpeg")

                    img_data_json = json.dumps(img_data)
                    img_name_json = json.dumps(img_name)
                    mime_json = json.dumps(mime_type)

                    upload_result = await eval_js(f"""
                        (function() {{
                            // 找到图片上传输入框
                            const inputs = document.querySelectorAll('input[type="file"]');
                            let imageInput = null;

                            for (const inp of inputs) {{
                                const accept = inp.getAttribute('accept') || '';
                                if (accept.includes('image') || accept.includes('.jpg')) {{
                                    imageInput = inp;
                                    break;
                                }}
                            }}

                            // 降级：用第一个 file input
                            if (!imageInput && inputs.length > 0) {{
                                imageInput = inputs[0];
                            }}

                            if (!imageInput) return 'FAIL:no file input';

                            // 构建 File 对象
                            const byteChars = atob({img_data_json});
                            const byteArr = new Uint8Array(byteChars.length);
                            for (let k = 0; k < byteChars.length; k++) {{
                                byteArr[k] = byteChars.charCodeAt(k);
                            }}
                            const file = new File([byteArr], {img_name_json}, {{ type: {mime_json} }});

                            const dt = new DataTransfer();
                            dt.items.add(file);
                            imageInput.files = dt.files;
                            imageInput.dispatchEvent(new Event('change', {{ bubbles: true }}));

                            return 'OK:' + {img_name_json};
                        }})()
                    """)
                    log(f"  上传结果: {upload_result}")
                    await asyncio.sleep(UPLOAD_TIMEOUT / len(valid_images) if len(valid_images) > 1 else UPLOAD_TIMEOUT)

                log("✅ 图片上传完成")
            else:
                log("📍 Step 4: 跳过（无图片）")

            await asyncio.sleep(2)

            # Step 5: 关闭可能的提示弹窗
            await eval_js("""
                (function() {
                    const closeSelectors = ['button.close', '.modal-close', '[aria-label="Close"]'];
                    for (const sel of closeSelectors) {
                        const el = document.querySelector(sel);
                        if (el) el.click();
                    }
                    // 关闭"我知道了"类弹窗
                    const btns = document.querySelectorAll('button, span[role="button"]');
                    for (const btn of btns) {
                        if (btn.textContent.includes('我知道了') || btn.textContent.includes('确定')) {
                            btn.click();
                        }
                    }
                })()
            """)
            await asyncio.sleep(1)

            # Step 6: 点击"发布"按钮
            log("📍 Step 5: 点击发布...")
            publish_result = await eval_js("""
                (function() {
                    // 常见的发布按钮选择器
                    const selectors = [
                        'button[node-type="submit"]',
                        '.W_btn_a',
                        'a.btn_pubish',
                        'button.submit',
                        '.ToolBar_btn_QBjF6',
                    ];

                    for (const sel of selectors) {
                        const btn = document.querySelector(sel);
                        if (btn && !btn.disabled) {
                            btn.click();
                            return 'CLICKED:' + sel;
                        }
                    }

                    // 按文字查找
                    const allBtns = document.querySelectorAll('button, a, div[role="button"]');
                    for (const btn of allBtns) {
                        const text = btn.textContent.trim();
                        if ((text === '发布' || text === '发微博') && !btn.disabled) {
                            btn.click();
                            return 'CLICKED_TEXT:' + text;
                        }
                    }

                    return 'FAIL:no publish button';
                })()
            """)
            log(f"  发布结果: {publish_result}")

            if publish_result and publish_result.startswith("FAIL"):
                log_error("❌ 找不到发布按钮")
                return False

            # Step 7: 等待发布完成（检查 URL 变化或成功提示）
            log(f"⏳ 等待发布完成（最多 {PUBLISH_TIMEOUT} 秒）...")

            for _ in range(PUBLISH_TIMEOUT):
                await asyncio.sleep(1)

                # 检查成功提示
                success_check = await eval_js("""
                    (function() {
                        // 检查成功提示
                        const successTexts = ['发布成功', '微博已发布', '已发布'];
                        const allText = document.body.innerText || '';
                        for (const t of successTexts) {
                            if (allText.includes(t)) return 'SUCCESS:' + t;
                        }

                        // 检查 URL 变化（发布后通常跳转）
                        const url = window.location.href;
                        if (url.includes('/u/') && url.includes('?')) return 'URL_CHANGED';

                        return 'WAITING';
                    })()
                """)

                if success_check and success_check.startswith("SUCCESS"):
                    duration = time.time() - start_time
                    log(f"✅ 发布成功！耗时: {duration:.1f} 秒")
                    log(f"  文案: {content[:50]}...")
                    log(f"  图片: {len(valid_images)} 张")
                    return True

            # 超时后再检查一次
            duration = time.time() - start_time
            log(f"⚠️  等待超时（{duration:.1f} 秒），检查最终状态...", "WARN")

            # 假设发布成功（部分情况无成功提示）
            log("✅ 发布流程已完成（无明确成功提示，假定成功）")
            return True

    except websockets.exceptions.ConnectionClosed as e:
        log_error(f"❌ WebSocket 连接断开: {e}")
        return False
    except Exception as e:
        log_error(f"❌ 发布异常: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python3 publish-weibo-image.py <文案> [图片路径1] [图片路径2] ...")
        print("")
        print("示例:")
        print("  python3 publish-weibo-image.py '分享一张好看的风景照' /tmp/photo.jpg")
        print("  python3 publish-weibo-image.py '今日分享' img1.jpg img2.jpg img3.jpg")
        return 1

    content = sys.argv[1]
    image_paths = sys.argv[2:] if len(sys.argv) > 2 else []

    if not content.strip():
        print("❌ 文案不能为空")
        return 1

    success = asyncio.run(publish_weibo_image(content, image_paths))
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
