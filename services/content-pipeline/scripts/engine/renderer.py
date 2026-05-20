"""
Step 3: 视觉渲染引擎
根据布局 JSON 渲染图片

功能：
- 动态调整字号填满画布
- 自动避免重叠
- 智能放置图标
"""

import os
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

# 字体路径
FONT_PATHS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]

OUTPUT_DIR = "/home/xx/dev/zenithjoy-creator/assets/cards"


def get_font(size):
    """获取字体"""
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except:
                continue
    return ImageFont.load_default()


def hex_to_rgb(hex_color):
    """十六进制转 RGB"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def render(layout, output_path=None):
    """
    根据布局渲染图片
    """
    canvas = layout["canvas"]
    width = canvas["width"]
    height = canvas["height"]
    bg_color = hex_to_rgb(canvas["background"])

    # 创建画布
    img = Image.new('RGBA', (width, height), (*bg_color, 255))
    draw = ImageDraw.Draw(img)

    # 渲染装饰元素（如竖条）
    for deco in layout.get("decorations", []):
        if deco["type"] == "rect":
            x, y = deco["x"], deco["y"]
            w, h = deco["width"], deco["height"]
            color = hex_to_rgb(deco["color"])
            draw.rectangle([x, y, x + w, y + h], fill=color)

    # 渲染文字块
    for block in layout.get("blocks", []):
        _render_text_block(draw, block, width)

    # 渲染图标
    for icon in layout.get("icons", []):
        _render_icon(img, icon)

    # 保存
    if output_path is None:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = os.path.join(OUTPUT_DIR, f"card-{timestamp}.png")

    # 转 RGB 保存
    if img.mode == 'RGBA':
        rgb_img = Image.new('RGB', img.size, bg_color)
        rgb_img.paste(img, mask=img.split()[3])
        rgb_img.save(output_path, "PNG", quality=95)
    else:
        img.save(output_path, "PNG", quality=95)

    return output_path


def _render_text_block(draw, block, canvas_width):
    """渲染单个文字块"""
    text = block["text"]
    x = block["x"]
    y = block["y"]
    font_size = block["font_size"]
    color = hex_to_rgb(block["color"])
    align = block.get("align", "left")

    font = get_font(font_size)

    # 计算文字宽度
    bbox = font.getbbox(text)
    text_width = bbox[2] - bbox[0]

    # 根据对齐方式调整 x
    if align == "center":
        actual_x = x - text_width / 2
    elif align == "right":
        actual_x = x - text_width
    else:
        actual_x = x

    # 绘制
    draw.text((actual_x, y), text, font=font, fill=color)


def _render_icon(img, icon):
    """渲染图标"""
    path = icon.get("path", "")
    x = icon["x"]
    y = icon["y"]
    size = icon.get("size", 80)

    if not os.path.exists(path):
        return

    try:
        icon_img = Image.open(path).convert("RGBA")
        icon_img = icon_img.resize((size, size), Image.Resampling.LANCZOS)
        img.paste(icon_img, (x, y), icon_img)
    except Exception as e:
        print(f"图标渲染失败: {e}")


if __name__ == "__main__":
    # 测试
    from parser import parse_content
    from layout_planner import plan_layout

    text = "限制你的，不是不会，是你不试"
    parsed = parse_content(text)
    layout = plan_layout(parsed, style="hotblooded")
    output = render(layout)
    print(f"✅ 渲染完成: {output}")
