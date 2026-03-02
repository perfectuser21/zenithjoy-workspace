"""
冲击力海报生成器 - 模仿参考图风格

参考图特点：
1. 紧凑布局，行距小
2. 前几行左对齐，紧挨着
3. "是你" + 拳头图标
4. "不试" 超大，居中，字体不同
5. 右上角装饰图标（灯泡）
6. 整体有"收拢→爆发"的节奏
"""

import os
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1080
ICONS_DIR = "/home/xx/dev/zenithjoy-creator/assets/icons"
OUTPUT_DIR = "/home/xx/dev/zenithjoy-creator/assets/cards"

COLORS = {
    "background": "#0D1117",
    "text": "#F0EDE5",
    "highlight": "#E85A3C",
}

FONT_PATHS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
]


def get_font(size):
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except:
                continue
    return ImageFont.load_default()


def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def generate_impact_poster(lines_config, icons_config=None, output_path=None):
    """
    生成冲击力海报

    lines_config: [
        {"text": "限制你的", "size": 56, "color": "text", "x": 150, "y": 280, "align": "left"},
        {"text": "不是不会", "size": 56, "color": "text", "x": 150, "y": 350, "align": "left"},
        {"text": "是你", "size": 64, "color": "highlight", "x": 150, "y": 440, "align": "left"},
        {"text": "不试", "size": 160, "color": "highlight", "x": 540, "y": 550, "align": "center"},
    ]

    icons_config: [
        {"name": "fire", "x": 320, "y": 430, "size": 60},
        {"name": "lightbulb", "x": 900, "y": 100, "size": 80},
    ]
    """
    bg_color = hex_to_rgb(COLORS["background"])
    img = Image.new('RGBA', (CANVAS_WIDTH, CANVAS_HEIGHT), (*bg_color, 255))
    draw = ImageDraw.Draw(img)

    # 绘制文字
    for line in lines_config:
        text = line["text"]
        font_size = line["size"]
        color_key = line.get("color", "text")
        color = hex_to_rgb(COLORS[color_key])
        x = line["x"]
        y = line["y"]
        align = line.get("align", "left")

        font = get_font(font_size)

        # 计算对齐
        bbox = font.getbbox(text)
        text_width = bbox[2] - bbox[0]

        if align == "center":
            actual_x = x - text_width / 2
        elif align == "right":
            actual_x = x - text_width
        else:
            actual_x = x

        draw.text((actual_x, y), text, font=font, fill=color)

    # 绘制图标
    if icons_config:
        for icon in icons_config:
            icon_path = os.path.join(ICONS_DIR, f"{icon['name']}.png")
            if os.path.exists(icon_path):
                try:
                    icon_img = Image.open(icon_path).convert("RGBA")
                    icon_img = icon_img.resize((icon["size"], icon["size"]), Image.Resampling.LANCZOS)
                    img.paste(icon_img, (icon["x"], icon["y"]), icon_img)
                except Exception as e:
                    print(f"图标加载失败: {e}")

    # 保存
    if output_path is None:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = os.path.join(OUTPUT_DIR, f"impact-{timestamp}.png")

    rgb_img = Image.new('RGB', img.size, bg_color)
    rgb_img.paste(img, mask=img.split()[3])
    rgb_img.save(output_path, "PNG", quality=95)

    return output_path


# 预设模板：限制你的不是不会是你不试
TEMPLATE_LIMIT = {
    "lines": [
        {"text": "限制你的", "size": 52, "color": "text", "x": 160, "y": 260, "align": "left"},
        {"text": "不是不会", "size": 52, "color": "text", "x": 200, "y": 330, "align": "left"},
        {"text": "是你", "size": 60, "color": "highlight", "x": 160, "y": 420, "align": "left"},
        {"text": "不试", "size": 180, "color": "highlight", "x": 540, "y": 560, "align": "center"},
    ],
    "icons": [
        {"name": "fire", "x": 310, "y": 410, "size": 65},      # 拳头/火在"是你"旁边
        {"name": "lightbulb", "x": 880, "y": 120, "size": 70},  # 灯泡右上角
    ]
}


if __name__ == "__main__":
    # 测试
    output = generate_impact_poster(
        TEMPLATE_LIMIT["lines"],
        TEMPLATE_LIMIT["icons"]
    )
    print(f"✅ 生成完成: {output}")
