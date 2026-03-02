# diagnose.py
import os
import sys

def check_structure():
    print("🔍 检查项目结构...")
    
    current_dir = os.getcwd()
    print(f"当前目录: {current_dir}")
    
    # 检查重要文件和目录
    checks = [
        ("main.py", os.path.exists("main.py")),
        ("app/", os.path.exists("app")),
        ("app/ui/", os.path.exists("app/ui")),
        ("app/ui/admin.html", os.path.exists("app/ui/admin.html")),
        ("app/ui/login.html", os.path.exists("app/ui/login.html")),
    ]
    
    for name, exists in checks:
        status = "✅ 存在" if exists else "❌ 缺失"
        print(f"  {name}: {status}")
    
    # 列出 app/ui 目录内容
    ui_dir = "app/ui"
    if os.path.exists(ui_dir):
        print(f"\n📁 {ui_dir} 目录内容:")
        for item in os.listdir(ui_dir):
            print(f"  - {item}")

def check_python_environment():
    print("\n🔍 检查Python环境...")
    print(f"Python版本: {sys.version}")
    print(f"Python路径: {sys.executable}")

if __name__ == "__main__":
    print("="*50)
    print("AI训练师系统诊断工具")
    print("="*50)
    
    check_structure()
    check_python_environment()
    
    print("\n💡 建议:")
    print("1. 确保 main.py 在项目根目录")
    print("2. 确保 app/ui 目录存在且包含HTML文件")
    print("3. 运行: python main.py")
    print("4. 然后在浏览器访问: http://127.0.0.1:8001/api/status")
    print("="*50)