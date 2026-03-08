#!/usr/bin/env python3
"""
金句卡片生成引擎 v3.0
完整的表达驱动型内容生成系统

流程：
Step 1: 内容解析（情绪识别 + 结构划分）
Step 2: 布局规划（生成布局 JSON）
Step 3: 图像渲染（Pillow 绘制）
Step 4: 自动校正（检测并修复问题）
Step 5: 出图

用法:
    python main.py "限制你的，不是不会，是你不试"
    python main.py "热爱可抵岁月漫长" --style brand
    python main.py "你不是做不到，是不敢开始" --debug
"""

import argparse
import json
import sys
import os

# 添加当前目录到 path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parser import parse_content
from layout_planner import plan_layout
from composer import compose
from renderer import render
from adjuster import adjust_layout


def generate(text, style="auto", debug=False):
    """
    完整的卡片生成流程
    """
    results = {
        "input": text,
        "steps": {},
    }

    # Step 1: 内容解析
    if debug:
        print("\n" + "="*50)
        print("📝 Step 1: 内容解析")
        print("="*50)

    parsed = parse_content(text)
    results["steps"]["parse"] = parsed

    if debug:
        print(f"句型: {parsed['type']}")
        print(f"情绪: {parsed['mood']}")
        print(f"分行:")
        for line in parsed['lines']:
            hl = "⭐" if line['highlight'] else "  "
            print(f"  {hl} [{line['role']}] {line['text']}")
        print(f"关键词: {parsed['keywords']}")
        print(f"推荐图标: {parsed['icon_suggestion']}")

    # Step 2: 构图设计
    if debug:
        print("\n" + "="*50)
        print("📐 Step 2: 构图设计")
        print("="*50)

    # 用构图引擎替代简单布局
    if style == "auto":
        compose_style = "convergent" if parsed["mood"] in ["热血", "警醒"] else "dialogue"
    elif style == "hotblooded":
        compose_style = "convergent"
    else:
        compose_style = "dialogue"

    layout = compose(parsed, style=compose_style)
    results["steps"]["layout"] = layout

    if debug:
        print(f"构图风格: {layout['style']}")
        print(f"文字块: {len(layout['blocks'])} 个")
        for b in layout['blocks']:
            align_icon = {"left": "←", "right": "→", "center": "·"}[b['align']]
            print(f"  {align_icon} [{b['role']}] {b['text']} @ y={b['y']} size={b['font_size']}")
        print(f"图标: {len(layout['icons'])} 个")

    # Step 3: 自动校正
    if debug:
        print("\n" + "="*50)
        print("🔧 Step 3: 自动校正")
        print("="*50)

    layout, issues, fixes = adjust_layout(layout)
    results["steps"]["adjust"] = {"issues": issues, "fixes": fixes}

    if debug:
        if issues:
            print(f"发现问题: {issues}")
            print(f"应用修复: {fixes}")
        else:
            print("✅ 布局检查通过，无需调整")

    # Step 4: 渲染
    if debug:
        print("\n" + "="*50)
        print("🎨 Step 4: 渲染出图")
        print("="*50)

    output_path = render(layout)
    results["output"] = output_path

    if debug:
        print(f"✅ 图片已生成: {output_path}")

    return results


def main():
    parser = argparse.ArgumentParser(
        description="金句卡片生成引擎 v3.0 - 表达驱动型内容生成系统"
    )
    parser.add_argument("text", help="金句文案")
    parser.add_argument(
        "--style", "-s",
        choices=["auto", "hotblooded", "brand"],
        default="auto",
        help="视觉风格: auto(自动), hotblooded(热血), brand(品牌)"
    )
    parser.add_argument("--debug", "-d", action="store_true", help="显示详细过程")
    parser.add_argument("--output", "-o", help="输出路径")
    parser.add_argument("--json", action="store_true", help="输出 JSON 结果")

    args = parser.parse_args()

    results = generate(args.text, style=args.style, debug=args.debug)

    if args.json:
        # 简化输出（移除大对象）
        output = {
            "input": results["input"],
            "parsed": {
                "type": results["steps"]["parse"]["type"],
                "mood": results["steps"]["parse"]["mood"],
                "keywords": results["steps"]["parse"]["keywords"],
            },
            "style": results["steps"]["layout"]["style"],
            "issues": results["steps"]["adjust"]["issues"],
            "fixes": results["steps"]["adjust"]["fixes"],
            "output": results["output"],
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(f"\n✅ 卡片已生成: {results['output']}")


if __name__ == "__main__":
    main()
