#!/usr/bin/env python3
"""
高级感海报生成器
风格统一、排版灵活、支持高亮关键词

用法:
    python poster-generator.py "一人公司最大的资产，不是钱，[是自由]。"
    python poster-generator.py --json content.json
"""

import argparse
import json
import os
import re
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

# ============ 视觉设计规范 ============

# 画布尺寸
IMAGE_WIDTH = 1080
IMAGE_HEIGHT = 1080

# 配色方案（高级感：蓝灰底 + 灰白字 + 橙色强调）
BACKGROUND_COLOR = "#0D1117"      # 蓝灰底
TEXT_COLOR = "#C8CDD3"            # 主字体：灰白
HIGHLIGHT_COLOR = "#E85A3C"       # 强调色：橙红

# 字体路径
FONT_PATHS = [
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]

# 输出目录
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "cards")


# ============ 工具函数 ============

def hex_to_rgb(hex_color):
    """十六进制转 RGB"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def get_font(size):
    """获取可用字体"""
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except:
                continue
    return ImageFont.load_default()


def parse_text_to_blocks(text):
    """
    解析文本为 blocks
    输入: "一人公司最大的资产，不是钱，[是自由]。"
    输出: [
        {"text": "一人公司最大的资产", "highlight": False},
        {"text": "不是钱", "highlight": False},
        {"text": "是自由。", "highlight": True},
    ]
    """
    # 按标点分行
    temp = text.replace('，', '|||').replace('。', '|||')
    temp = temp.replace('！', '|||').replace('？', '|||')
    parts = [p.strip() for p in temp.split('|||') if p.strip()]

    blocks = []
    for part in parts:
        # 检查是否有高亮标记 [xxx]
        match = re.search(r'\[([^\]]+)\]', part)
        if match:
            # 整行高亮
            clean_text = part.replace('[', '').replace(']', '')
            blocks.append({"text": clean_text, "highlight": True})
        else:
            blocks.append({"text": part, "highlight": False})

    # 最后一行加句号
    if blocks and not blocks[-1]["text"].endswith(('。', '！', '？')):
        blocks[-1]["text"] += "。"

    return blocks


# ============ 核心生成函数 ============

def create_poster(text_blocks, output_path=None, align="left"):
    """
    生成海报

    Args:
        text_blocks: [{"text": "xxx", "highlight": True/False}, ...]
        output_path: 输出路径
        align: "left" 或 "center"
    """
    # 创建画布
    image = Image.new("RGB", (IMAGE_WIDTH, IMAGE_HEIGHT), hex_to_rgb(BACKGROUND_COLOR))
    draw = ImageDraw.Draw(image)

    # 字体设置
    font_normal = get_font(88)
    font_highlight = get_font(110)

    # 计算总高度
    line_heights = []
    line_widths = []
    for block in text_blocks:
        font = font_highlight if block["highlight"] else font_normal
        bbox = font.getbbox(block["text"])
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        line_heights.append(h)
        line_widths.append(w)

    line_spacing = 30
    total_height = sum(line_heights) + line_spacing * (len(text_blocks) - 1)

    # 高亮行前多留空间
    for i, block in enumerate(text_blocks):
        if block["highlight"] and i > 0:
            total_height += 30

    # 起始 Y（垂直居中）
    y = (IMAGE_HEIGHT - total_height) // 2

    # 左边距
    margin_left = 120

    # 绘制每行
    for i, block in enumerate(text_blocks):
        font = font_highlight if block["highlight"] else font_normal
        color = hex_to_rgb(HIGHLIGHT_COLOR if block["highlight"] else TEXT_COLOR)
        text = block["text"]

        bbox = font.getbbox(text)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]

        # 高亮行前多留空间
        if block["highlight"] and i > 0:
            y += 30

        # X 位置
        if align == "center":
            x = (IMAGE_WIDTH - w) // 2
        else:
            x = margin_left

        # 绘制文字
        draw.text((x, y), text, font=font, fill=color)

        y += h + line_spacing

    # 保存
    if output_path is None:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = os.path.join(OUTPUT_DIR, f"poster-{timestamp}.png")

    image.save(output_path, "PNG", quality=95)
    return output_path


def create_poster_from_text(text, output_path=None, align="left"):
    """从原始文本生成海报"""
    blocks = parse_text_to_blocks(text)
    return create_poster(blocks, output_path, align)


# ============ 命令行入口 ============

def main():
    parser = argparse.ArgumentParser(description="高级感海报生成器")
    parser.add_argument("text", nargs="?", help="文案，用 [关键词] 标记高亮")
    parser.add_argument("--json", "-j", help="从 JSON 文件读取 text_blocks")
    parser.add_argument("--output", "-o", help="输出路径")
    parser.add_argument("--align", "-a", default="left", choices=["left", "center"], help="对齐方式")

    args = parser.parse_args()

    if args.json:
        with open(args.json, 'r', encoding='utf-8') as f:
            data = json.load(f)
        blocks = data.get("text_blocks", data)
        output = create_poster(blocks, args.output, args.align)
    elif args.text:
        output = create_poster_from_text(args.text, args.output, args.align)
    else:
        print("用法:")
        print('  python poster-generator.py "一人公司最大的资产，不是钱，[是自由]。"')
        print('  python poster-generator.py --json content.json')
        return

    print(f"✅ 已生成: {output}")


if __name__ == "__main__":
    main()
