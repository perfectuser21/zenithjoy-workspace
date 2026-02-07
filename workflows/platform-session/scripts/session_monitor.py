#!/usr/bin/env python3
"""
监控各平台 session 状态，记录到日志文件
"""
import subprocess
import json
import os
from datetime import datetime

LOG_FILE = os.path.expanduser("~/session_status.log")
STATUS_FILE = os.path.expanduser("~/session_status.json")

PLATFORMS = {
    "douyin": {"container": "novnc-douyin", "name": "抖音"},
    "kuaishou": {"container": "novnc-kuaishou", "name": "快手"},
    "xiaohongshu": {"container": "novnc-xiaohongshu", "name": "小红书"},
    "toutiao": {"container": "novnc-toutiao", "name": "头条主号"},
    "toutiao2": {"container": "novnc-toutiao-2", "name": "头条AI测试"},
    "weibo": {"container": "novnc-weibo", "name": "微博"},
    "channels": {"container": "novnc-channels", "name": "视频号"},
    "gongzhonghao": {"container": "novnc-gongzhonghao", "name": "公众号"},
    "zhihu": {"container": "novnc-zhihu", "name": "知乎"},
}

def get_cookie_info(container):
    """获取 Cookie 文件信息"""
    # 检查两个可能的路径
    paths = [
        "/root/.config/google-chrome/Default/Cookies",
        "/home/ubuntu/.config/google-chrome/Default/Cookies"
    ]
    for path in paths:
        try:
            result = subprocess.run(
                ["docker", "exec", container, "stat", "-c", "%s %Y", path],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                parts = result.stdout.strip().split()
                return {"size": int(parts[0]), "mtime": int(parts[1])}
        except:
            pass
    return None

def check_chrome_running(container):
    """检查 Chrome 是否在运行"""
    try:
        result = subprocess.run(
            ["docker", "exec", container, "pgrep", "-c", "chrome"],
            capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0 and int(result.stdout.strip()) > 0
    except:
        return False

def load_status():
    """加载之前的状态"""
    if os.path.exists(STATUS_FILE):
        with open(STATUS_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_status(status):
    """保存状态"""
    with open(STATUS_FILE, 'w') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def log(message):
    """写入日志"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {message}"
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + "\n")

def main():
    now = datetime.now()
    status = load_status()
    
    log("=" * 50)
    log("Session 状态检查")
    
    for platform, info in PLATFORMS.items():
        container = info["container"]
        name = info["name"]
        
        chrome_running = check_chrome_running(container)
        cookie_info = get_cookie_info(container)
        
        # 初始化平台状态
        if platform not in status:
            status[platform] = {
                "name": name,
                "login_time": now.isoformat(),
                "last_check": now.isoformat(),
                "status": "unknown",
                "duration_hours": 0
            }
        
        prev_status = status[platform]["status"]
        
        if chrome_running and cookie_info and cookie_info["size"] > 10000:
            current_status = "logged_in"
            # 计算持续时间
            login_time = datetime.fromisoformat(status[platform]["login_time"])
            duration = (now - login_time).total_seconds() / 3600
            status[platform]["duration_hours"] = round(duration, 1)
        else:
            current_status = "logged_out"
            if prev_status == "logged_in":
                # 刚刚掉线
                duration = status[platform].get("duration_hours", 0)
                log(f"⚠️ {name} 登录失效！持续了 {duration} 小时")
        
        status[platform]["status"] = current_status
        status[platform]["last_check"] = now.isoformat()
        
        icon = "✅" if current_status == "logged_in" else "❌"
        duration = status[platform].get("duration_hours", 0)
        log(f"{icon} {name}: {current_status} ({duration}h)")
    
    save_status(status)
    log("检查完成")

if __name__ == "__main__":
    main()
