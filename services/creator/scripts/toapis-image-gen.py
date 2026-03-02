#!/usr/bin/env python3
"""ToAPIs 图像生成工具（异步模式）"""

import sys
import time
import argparse
import requests
from pathlib import Path
from datetime import datetime

TOAPIS_BASE_URL = "https://toapis.com/v1"

def load_credentials():
    cred_file = Path.home() / '.credentials' / 'toapi.env'
    if not cred_file.exists():
        print("❌ 未找到凭据: ~/.credentials/toapi.env")
        sys.exit(1)
    
    with open(cred_file) as f:
        for line in f:
            if line.strip().startswith('TOAPI_API_KEY='):
                return line.split('=', 1)[1].strip()
    sys.exit(1)

def generate_image(prompt, output_path=None, model="gpt-4o-image", size="1024x1792"):
    api_key = load_credentials()
    
    if output_path is None:
        output_dir = Path(__file__).parent.parent / 'output' / 'toapis-cards'
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = output_dir / f"card-{timestamp}.png"
    else:
        output_path = Path(output_path)
    
    print(f"🎨 模型: {model}")
    print(f"📐 尺寸: {size}")
    print(f"📝 Prompt: {prompt[:80]}...")
    print(f"💾 输出: {output_path}")
    print()
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # 1. 提交任务
    print("⏳ 提交生成任务...")
    response = requests.post(
        f"{TOAPIS_BASE_URL}/images/generations",
        headers=headers,
        json={"model": model, "prompt": prompt, "n": 1, "size": size},
        timeout=30
    )
    
    if response.status_code != 200:
        print(f"❌ 提交失败: {response.status_code}")
        print(response.text)
        sys.exit(1)
    
    task = response.json()
    task_id = task['id']
    print(f"✅ 任务已提交: {task_id}")
    print(f"   状态: {task['status']}")
    
    # 2. 轮询任务状态
    print("\n⏳ 等待生成...")
    max_attempts = 60
    for attempt in range(max_attempts):
        time.sleep(3)
        
        response = requests.get(
            f"{TOAPIS_BASE_URL}/images/generations/{task_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"❌ 查询失败: {response.status_code}")
            continue
        
        task = response.json()
        status = task['status']
        progress = task.get('progress', 0)
        
        print(f"   [{attempt+1}/{max_attempts}] 状态: {status}, 进度: {progress}%", end='\r')
        
        if status == 'completed':
            print("\n✅ 生成完成！")
            image_url = task['result']['data'][0]['url']
            print(f"   URL: {image_url}")
            
            # 3. 下载图片
            print("\n⏳ 下载图片...")
            img_response = requests.get(image_url, timeout=60)
            if img_response.status_code != 200:
                print(f"❌ 下载失败: {img_response.status_code}")
                sys.exit(1)
            
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'wb') as f:
                f.write(img_response.content)
            
            size_kb = output_path.stat().st_size / 1024
            print(f"✅ 已保存: {output_path} ({size_kb:.1f} KB)")
            return str(output_path)
        
        elif status == 'failed':
            print(f"\n❌ 生成失败: {task.get('error', 'Unknown error')}")
            sys.exit(1)
    
    print("\n❌ 超时")
    sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description='ToAPIs 图像生成')
    parser.add_argument('prompt', help='图像描述')
    parser.add_argument('-o', '--output', help='输出路径')
    parser.add_argument('-m', '--model', default='gpt-4o-image',
                       choices=['gpt-4o-image', 'nano_banana_pro', 'gemini-3-pro-image-preview'],
                       help='模型')
    parser.add_argument('-s', '--size', default='1024x1792',
                       choices=['1024x1024', '1024x1792', '1792x1024'],
                       help='尺寸')
    
    args = parser.parse_args()
    
    try:
        output = generate_image(args.prompt, args.output, args.model, args.size)
        print("\n" + "="*60)
        print("✅ 成功")
        print(f"文件: {output}")
        print("="*60)
        return 0
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    sys.exit(main())
