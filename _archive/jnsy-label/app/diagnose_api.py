# test_api.py
import requests
import sys

def test_api():
    base_url = "http://127.0.0.1:8001"
    
    print("🧪 开始测试API连接...")
    
    # 测试1: /api/status
    try:
        response = requests.get(f"{base_url}/api/status")
        print(f"✅ /api/status - 状态码: {response.status_code}")
        print(f"   响应: {response.json()}")
    except Exception as e:
        print(f"❌ /api/status - 错误: {e}")
    
    # 测试2: /api/admin/status
    try:
        response = requests.get(f"{base_url}/api/admin/status")
        print(f"✅ /api/admin/status - 状态码: {response.status_code}")
        print(f"   响应: {response.json()}")
    except Exception as e:
        print(f"❌ /api/admin/status - 错误: {e}")
    
    # 测试3: 静态文件
    try:
        response = requests.get(f"{base_url}/ui/login.html")
        print(f"✅ /ui/login.html - 状态码: {response.status_code}")
    except Exception as e:
        print(f"❌ /ui/login.html - 错误: {e}")

if __name__ == "__main__":
    test_api()