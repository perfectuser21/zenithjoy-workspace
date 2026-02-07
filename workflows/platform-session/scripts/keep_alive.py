#!/usr/bin/env python3
"""
定时刷新平台页面，防止 session 过期
通过 Chrome DevTools Protocol (CDP) 刷新页面
"""
import subprocess
import json
import time
import requests
from datetime import datetime

PLATFORMS = {
    "novnc-douyin": {"port": 9222, "url": "https://creator.douyin.com"},
    "novnc-kuaishou": {"port": 9222, "url": "https://cp.kuaishou.com"},
    "novnc-xiaohongshu": {"port": 9222, "url": "https://creator.xiaohongshu.com"},
    "novnc-toutiao": {"port": 9222, "url": "https://mp.toutiao.com"},
    "novnc-weibo": {"port": 9222, "url": "https://creator.weibo.com"},
    "novnc-channels": {"port": 9222, "url": "https://channels.weixin.qq.com"},
    "novnc-gongzhonghao": {"port": 9222, "url": "https://mp.weixin.qq.com"},
    "novnc-zhihu": {"port": 9222, "url": "https://www.zhihu.com/creator"},
}

def get_container_ip(container):
    """获取容器 IP"""
    try:
        result = subprocess.run(
            ["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", container],
            capture_output=True, text=True
        )
        return result.stdout.strip()
    except:
        return None

def refresh_page(container, port):
    """通过 CDP 刷新页面"""
    ip = get_container_ip(container)
    if not ip:
        return False, "容器未运行"
    
    try:
        # 获取页面列表
        resp = requests.get(f"http://{ip}:{port}/json", timeout=5)
        pages = resp.json()
        
        if not pages:
            return False, "无打开的页面"
        
        # 刷新第一个页面
        ws_url = pages[0].get("webSocketDebuggerUrl")
        page_id = pages[0].get("id")
        
        # 发送刷新命令
        requests.get(f"http://{ip}:{port}/json/reload/{page_id}", timeout=5)
        return True, pages[0].get("title", "")[:30]
    except Exception as e:
        return False, str(e)[:30]

def main():
    print(f"\n{'='*50}")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 刷新所有平台")
    print('='*50)
    
    for container, config in PLATFORMS.items():
        success, msg = refresh_page(container, config["port"])
        status = "✓" if success else "✗"
        print(f"{status} {container.replace('novnc-', ''):12} | {msg}")

if __name__ == "__main__":
    main()
