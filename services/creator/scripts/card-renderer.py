#!/usr/bin/env python3
"""
卡片渲染器 - 根据 JSON 配置渲染图片
Claude Code 负责设计，这个脚本只负责执行

用法:
    python card-renderer.py layout.json
    python card-renderer.py layout.json --output card.png
    echo '{"canvas":...}' | python card-renderer.py -
"""

import argparse
import json
import os
import sys
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

# 字体路径
FONT_PATHS = [
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "cards")


def get_font(size, weight="regular"):
    """获取字体"""
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except:
                continue
    return ImageFont.load_default()


def hex_to_rgb(hex_color):
    """十六进制颜色转 RGB"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def render_card(layout, output_path=None):
    """
    根据 JSON 布局渲染卡片

    JSON 结构:
    {
        "canvas": {
            "width": 1080,
            "height": 1080,
            "background": "#0C0C0C" 或 "path/to/image.png"
        },
        "elements": [
            {
                "type": "text",
                "content": "文字内容",
                "x": 540,
                "y": 300,
                "font_size": 66,
                "color": "#E5E0D5",
                "align": "center",  // left, center, right
                "shadow": {"offset": 2, "color": "#000000", "opacity": 0.3}  // 可选
            },
            {
                "type": "line",
                "x1": 400, "y1": 200,
                "x2": 680, "y2": 200,
                "color": "#2A2A2A",
                "width": 2
            },
            {
                "type": "rect",
                "x": 100, "y": 100,
                "width": 4, "height": 40,
                "color": "#D4A84B"
            },
            {
                "type": "circle",
                "x": 540, "y": 700,
                "radius": 4,
                "color": "#D4A84B"
            }
        ]
    }
    """
    canvas = layout["canvas"]
    width = canvas.get("width", 1080)
    height = canvas.get("height", 1080)
    background = canvas.get("background", "#000000")

    # 创建画布 (RGBA 支持透明图标)
    if background.startswith("#"):
        img = Image.new('RGBA', (width, height), (*hex_to_rgb(background), 255))
    else:
        # 背景是图片路径
        img = Image.open(background).convert('RGBA')
        img = img.resize((width, height))

    draw = ImageDraw.Draw(img)

    # 渲染每个元素
    for elem in layout.get("elements", []):
        elem_type = elem.get("type")

        if elem_type == "text":
            render_text(draw, elem)
        elif elem_type == "line":
            render_line(draw, elem)
        elif elem_type == "rect":
            render_rect(draw, elem)
        elif elem_type == "circle":
            render_circle(draw, elem)
        elif elem_type == "image":
            render_image(img, elem)

    # 保存
    if output_path is None:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = os.path.join(OUTPUT_DIR, f"card-{timestamp}.png")

    # 转换为 RGB 保存
    if img.mode == 'RGBA':
        rgb_img = Image.new('RGB', img.size, hex_to_rgb("#000000"))
        rgb_img.paste(img, mask=img.split()[3])
        rgb_img.save(output_path, "PNG", quality=95)
    else:
        img.save(output_path, "PNG", quality=95)
    return output_path


def render_text(draw, elem):
    """渲染文字元素"""
    content = elem.get("content", "")
    x = elem.get("x", 0)
    y = elem.get("y", 0)
    font_size = elem.get("font_size", 48)
    color = hex_to_rgb(elem.get("color", "#FFFFFF"))
    align = elem.get("align", "left")

    font = get_font(font_size)

    # 计算对齐
    bbox = font.getbbox(content)
    text_width = bbox[2] - bbox[0]

    if align == "center":
        x = x - text_width / 2
    elif align == "right":
        x = x - text_width

    # 阴影（可选）
    shadow = elem.get("shadow")
    if shadow:
        offset = shadow.get("offset", 2)
        shadow_color = hex_to_rgb(shadow.get("color", "#000000"))
        draw.text((x + offset, y + offset), content, font=font, fill=shadow_color)

    # 主文字
    draw.text((x, y), content, font=font, fill=color)


def render_line(draw, elem):
    """渲染线条"""
    x1 = elem.get("x1", 0)
    y1 = elem.get("y1", 0)
    x2 = elem.get("x2", 100)
    y2 = elem.get("y2", 0)
    color = hex_to_rgb(elem.get("color", "#FFFFFF"))
    width = elem.get("width", 1)

    draw.line([(x1, y1), (x2, y2)], fill=color, width=width)


def render_rect(draw, elem):
    """渲染矩形"""
    x = elem.get("x", 0)
    y = elem.get("y", 0)
    w = elem.get("width", 10)
    h = elem.get("height", 10)
    color = hex_to_rgb(elem.get("color", "#FFFFFF"))

    draw.rectangle([x, y, x + w, y + h], fill=color)


def render_circle(draw, elem):
    """渲染圆形"""
    x = elem.get("x", 0)
    y = elem.get("y", 0)
    r = elem.get("radius", 5)
    color = hex_to_rgb(elem.get("color", "#FFFFFF"))

    draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def render_image(img, elem):
    """渲染图片（PNG图标）"""
    path = elem.get("path", "")
    x = elem.get("x", 0)
    y = elem.get("y", 0)
    width = elem.get("width", None)
    height = elem.get("height", None)

    if not os.path.exists(path):
        print(f"⚠️ 图标文件不存在: {path}")
        return

    icon = Image.open(path).convert("RGBA")

    # 缩放
    if width and height:
        icon = icon.resize((width, height), Image.Resampling.LANCZOS)
    elif width:
        ratio = width / icon.width
        icon = icon.resize((width, int(icon.height * ratio)), Image.Resampling.LANCZOS)
    elif height:
        ratio = height / icon.height
        icon = icon.resize((int(icon.width * ratio), height), Image.Resampling.LANCZOS)

    # 粘贴（保留透明度）
    img.paste(icon, (x, y), icon)


def main():
    parser = argparse.ArgumentParser(description="卡片渲染器 - 根据 JSON 渲染图片")
    parser.add_argument("input", help="JSON 文件路径，或 - 从 stdin 读取")
    parser.add_argument("--output", "-o", help="输出文件路径")

    args = parser.parse_args()

    # 读取 JSON
    if args.input == "-":
        layout = json.load(sys.stdin)
    else:
        with open(args.input, 'r', encoding='utf-8') as f:
            layout = json.load(f)

    # 渲染
    output = render_card(layout, args.output)
    print(f"✅ 卡片已生成: {output}")


if __name__ == "__main__":
    main()
