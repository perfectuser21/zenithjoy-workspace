#!/usr/bin/env python3
"""
今日头条自动发帖工具（通过 node PC）
"""

import json
import asyncio
import websockets
import base64
import sys
import requests
from pathlib import Path


async def publish_to_toutiao(title, content, image_path=None):
    """发布内容到今日头条

    Args:
        title: 标题
        content: 正文
        image_path: 配图路径（可选）
    """
    # 获取今日头条标签页
    response = requests.get("http://100.97.242.124:19226/json", timeout=20)
    tabs = response.json()

    # 找到今日头条页面
    ws_url = None
    for tab in tabs:
        if tab.get('type') == 'page' and 'mp.toutiao.com' in tab.get('url', ''):
            ws_url = tab.get('webSocketDebuggerUrl')
            break

    if not ws_url:
        print("❌ 未找到今日头条页面")
        return False

    print(f"连接到今日头条...")

    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        msg_id = 1

        async def send_cmd(method, params=None):
            nonlocal msg_id
            cmd = {"id": msg_id, "method": method}
            if params:
                cmd["params"] = params
            msg_id += 1
            await ws.send(json.dumps(cmd))

            while True:
                response = json.loads(await ws.recv())
                if response.get('id') == cmd['id']:
                    return response.get('result', {})

        # 1. 检查当前页面，如果不是发布页面则导航
        result = await send_cmd('Runtime.evaluate', {
            'expression': 'window.location.href'
        })
        current_url = result.get('result', {}).get('value', '')

        if 'graphic/publish' not in current_url:
            print("打开发布页面...")
            await send_cmd('Page.navigate', {
                'url': 'https://mp.toutiao.com/profile_v4/graphic/publish'
            })

            # 等待页面加载完成（最多 30 秒）
            for i in range(30):
                await asyncio.sleep(1)
                result = await send_cmd('Runtime.evaluate', {
                    'expression': '''
                        document.querySelector('textarea[placeholder*="标题"]') !== null
                    '''
                })
                if result.get('result', {}).get('value'):
                    print(f"  页面加载完成 ({i+1}秒)")
                    break
            else:
                print("  警告: 页面加载超时")
        else:
            print("已在发布页面...")

        await asyncio.sleep(1)

        # 2. 填写标题（模拟真实输入，触发 Vue/React 更新）
        print(f"填写标题: {title}")
        await send_cmd('Runtime.evaluate', {
            'expression': f'''
                (function() {{
                    const textarea = document.querySelector('textarea[placeholder*="标题"]') ||
                                    document.querySelector('.editor-title textarea');
                    if (!textarea) return 'FAIL:textarea not found';

                    // 聚焦输入框
                    textarea.focus();

                    // 使用原生 setter 绕过 Vue/React 的响应式系统
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLTextAreaElement.prototype, 'value'
                    ).set;
                    nativeInputValueSetter.call(textarea, {json.dumps(title)});

                    // 触发 input 事件让框架更新
                    textarea.dispatchEvent(new Event('input', {{ bubbles: true, cancelable: true }}));
                    textarea.dispatchEvent(new Event('change', {{ bubbles: true, cancelable: true }}));

                    return 'OK:' + textarea.value;
                }})()
            '''
        })
        await asyncio.sleep(1)

        # 3. 填写正文（今日头条用的是 ProseMirror 编辑器）
        print(f"填写正文...")
        await send_cmd('Runtime.evaluate', {
            'expression': f'''
                (function() {{
                    const editor = document.querySelector('.ProseMirror') ||
                                  document.querySelector('[contenteditable="true"]');
                    if (editor) {{
                        editor.innerHTML = '<p>' + {json.dumps(content)} + '</p>';
                        editor.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        return 'OK:' + editor.textContent.substring(0, 50);
                    }}
                    return 'FAIL:editor not found';
                }})()
            '''
        })
        await asyncio.sleep(2)

        # 4. 上传配图（如果有）
        if image_path and Path(image_path).exists():
            print(f"上传配图: {image_path}")
            with open(image_path, 'rb') as f:
                image_data = base64.b64encode(f.read()).decode()

            # 模拟文件上传
            await send_cmd('Runtime.evaluate', {
                'expression': f'''
                    (function() {{
                        const uploadBtn = document.querySelector('[class*="upload"]') ||
                                         document.querySelector('input[type="file"]');
                        if (uploadBtn) {{
                            // 创建 File 对象
                            const byteCharacters = atob({json.dumps(image_data)});
                            const byteNumbers = new Array(byteCharacters.length);
                            for (let i = 0; i < byteCharacters.length; i++) {{
                                byteNumbers[i] = byteCharacters.charCodeAt(i);
                            }}
                            const byteArray = new Uint8Array(byteNumbers);
                            const file = new File([byteArray], "cover.png", {{type: "image/png"}});

                            // 触发上传
                            const dt = new DataTransfer();
                            dt.items.add(file);
                            if (uploadBtn.tagName === 'INPUT') {{
                                uploadBtn.files = dt.files;
                                uploadBtn.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            }}
                            return true;
                        }}
                        return false;
                    }})()
                '''
            })
            await asyncio.sleep(3)
        else:
            # 没有配图，选择"无封面"
            print("选择无封面...")
            await send_cmd('Runtime.evaluate', {
                'expression': '''
                    (function() {
                        // 找到"无封面"选项并点击
                        const labels = document.querySelectorAll('span, label');
                        for (const label of labels) {
                            if (label.textContent.trim() === '无封面') {
                                label.click();
                                return 'clicked 无封面';
                            }
                        }
                        return 'not found';
                    })()
                '''
            })
            await asyncio.sleep(1)

        # 5. 关闭可能的提示框
        await send_cmd('Runtime.evaluate', {
            'expression': '''
                (function() {
                    const knowBtn = Array.from(document.querySelectorAll('button, span')).find(
                        el => el.textContent.includes('我知道了')
                    );
                    if (knowBtn) knowBtn.click();
                })()
            '''
        })
        await asyncio.sleep(1)

        # 6. 点击"预览并发布"按钮
        print("点击发布按钮...")
        await send_cmd('Runtime.evaluate', {
            'expression': '''
                (function() {
                    const btn = document.querySelector('.publish-btn-last') ||
                               document.querySelector('button.byte-btn-primary');
                    if (btn && btn.textContent.includes('发布')) {
                        btn.click();
                        return 'clicked';
                    }
                    return 'not found';
                })()
            '''
        })

        # 7. 等待预览弹窗出现，然后点击确认发布
        await asyncio.sleep(3)
        print("确认发布...")

        result = await send_cmd('Runtime.evaluate', {
            'expression': '''
                (function() {
                    // 在预览弹窗中找"发布"按钮
                    const modal = document.querySelector('.byte-modal, [class*="modal"], [class*="preview"]');
                    if (!modal) return 'FAIL:no modal';

                    // 找所有按钮，点击包含"发布"但不包含"预览"的按钮
                    const buttons = modal.querySelectorAll('button');
                    for (const btn of buttons) {
                        const text = btn.textContent.trim();
                        if (text === '发布' || (text.includes('发布') && !text.includes('预览') && !text.includes('定时'))) {
                            btn.click();
                            return 'SUCCESS:' + text;
                        }
                    }

                    // 如果没找到，列出所有按钮
                    const allBtns = Array.from(buttons).map(b => b.textContent.trim()).join(', ');
                    return 'FAIL:buttons=' + allBtns;
                })()
            '''
        })

        publish_result = result.get('result', {}).get('value', '')

        if publish_result.startswith('SUCCESS:'):
            print("✓ 发布成功！")
            print("  标题:", title)
            print("  正文长度:", len(content), "字")
            if image_path:
                print("  配图:", image_path)
            return True
        else:
            print(f"❌ 发布失败: {publish_result}")
            print("  标题:", title)
            print("  正文长度:", len(content), "字")
            return False


async def main():
    if len(sys.argv) < 3:
        print("用法: python3 publish-to-toutiao.py <标题> <正文> [配图路径]")
        sys.exit(1)

    title = sys.argv[1]
    content = sys.argv[2]
    image_path = sys.argv[3] if len(sys.argv) > 3 else None

    success = await publish_to_toutiao(title, content, image_path)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    asyncio.run(main())
