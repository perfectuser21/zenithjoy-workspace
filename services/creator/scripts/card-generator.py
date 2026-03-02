#!/usr/bin/env python3
"""
金句卡片生成器 v2.0
生成高级感的中文金句卡片图片

用法:
    python card-generator.py "限制你的，不是不会，[是你不试]。"
    python card-generator.py --file content/deep-posts/xxx.md
    python card-generator.py "文案" --icon lightbulb,fist
"""

import argparse
import os
import re
import math
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# 配色方案 - 高级感配色
THEMES = {
    "dark_gold": {
        "background": "#0C0C0C",      # 深黑（不是纯黑，有质感）
        "text": "#E5E0D5",            # 象牙白
        "highlight": "#D4A84B",       # 哑光金（不刺眼）
        "accent": "#D4A84B",          # 装饰色
        "line": "#2A2A2A",            # 装饰线（微妙）
    },
    "dark_coral": {
        "background": "#0D1117",      # 深蓝黑
        "text": "#F0EDE5",            # 暖白
        "highlight": "#E07A5F",       # 珊瑚红
        "accent": "#E07A5F",
        "line": "#1F2937",
    },
    "dark_mint": {
        "background": "#0A0F0D",      # 墨绿黑
        "text": "#E8EDE5",            # 薄荷白
        "highlight": "#81B29A",       # 薄荷绿
        "accent": "#81B29A",
        "line": "#1A2420",
    },
}

# 默认主题
COLORS = THEMES["dark_gold"]

# 字体路径 - 优先用宋体（更高级）
FONT_PATHS = [
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",  # 思源宋体粗体
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",  # 思源宋体
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",  # macOS
]

# 默认输出目录
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "cards")


def get_font(size):
    """获取可用的中文字体"""
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except:
                continue
    # 回退到默认字体
    return ImageFont.load_default()


def hex_to_rgb(hex_color):
    """十六进制颜色转 RGB"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def parse_text_with_highlights(text):
    """
    解析文本中的高亮标记
    格式: "普通文字[高亮文字]普通文字"
    返回: [(text, is_highlight), ...]
    """
    parts = []
    pattern = r'\[([^\]]+)\]'
    last_end = 0

    for match in re.finditer(pattern, text):
        # 添加高亮前的普通文字
        if match.start() > last_end:
            parts.append((text[last_end:match.start()], False))
        # 添加高亮文字
        parts.append((match.group(1), True))
        last_end = match.end()

    # 添加最后的普通文字
    if last_end < len(text):
        parts.append((text[last_end:], False))

    return parts if parts else [(text, False)]


def create_glow_layer(size, color, radius=20):
    """创建发光效果图层"""
    glow = Image.new('RGBA', size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    center = (size[0] // 2, size[1] // 2)
    # 绘制多层渐变圆形模拟发光
    for i in range(radius, 0, -2):
        alpha = int(100 * (1 - i / radius))
        r, g, b = color
        draw.ellipse([center[0] - i, center[1] - i, center[0] + i, center[1] + i],
                     fill=(r, g, b, alpha))
    return glow


def draw_icon_lightbulb(img, x, y, size, color):
    """绘制灯泡图标（带发光效果）"""
    draw = ImageDraw.Draw(img)

    # 发光效果
    glow_size = int(size * 1.5)
    glow_layer = Image.new('RGBA', (glow_size * 2, glow_size * 2), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)

    # 绘制发光晕圈
    for i in range(glow_size, 0, -3):
        alpha = int(40 * (1 - i / glow_size))
        glow_draw.ellipse([glow_size - i, glow_size - i, glow_size + i, glow_size + i],
                         fill=(*color, alpha))

    # 合成发光层
    img.paste(glow_layer, (int(x - glow_size + size//2), int(y - glow_size + size//3)), glow_layer)

    # 灯泡主体
    bulb_width = size * 0.6
    bulb_height = size * 0.5
    bulb_x = x + (size - bulb_width) / 2
    bulb_y = y

    # 灯泡玻璃部分（上半圆）
    draw.ellipse([bulb_x, bulb_y, bulb_x + bulb_width, bulb_y + bulb_height * 1.2],
                 fill=color, outline=color)

    # 灯泡底座
    base_width = bulb_width * 0.5
    base_x = x + (size - base_width) / 2
    base_y = bulb_y + bulb_height * 0.9

    # 螺纹底座
    for i in range(3):
        line_y = base_y + i * 8
        draw.rectangle([base_x, line_y, base_x + base_width, line_y + 5], fill=color)

    # 光芒线条
    center_x = x + size / 2
    center_y = y + size * 0.25
    ray_length = size * 0.25

    for angle in [45, 90, 135]:
        rad = math.radians(angle)
        start_dist = size * 0.4
        end_x = center_x + math.cos(rad) * (start_dist + ray_length)
        end_y = center_y - math.sin(rad) * (start_dist + ray_length)
        start_x = center_x + math.cos(rad) * start_dist
        start_y = center_y - math.sin(rad) * start_dist
        draw.line([start_x, start_y, end_x, end_y], fill=color, width=3)


def draw_icon_fist(img, x, y, size, color):
    """绘制拳头图标"""
    draw = ImageDraw.Draw(img)

    # 拳头主体 - 简化的拳头形状
    fist_width = size * 0.7
    fist_height = size * 0.8
    fist_x = x + (size - fist_width) / 2
    fist_y = y + size * 0.1

    # 拳头轮廓（圆角矩形模拟）
    draw.rounded_rectangle([fist_x, fist_y, fist_x + fist_width, fist_y + fist_height],
                           radius=15, fill=color)

    # 手指关节线条（用背景色画线模拟）
    bg_color = hex_to_rgb(COLORS["background"])
    finger_gap = fist_width / 4
    for i in range(1, 4):
        line_x = fist_x + finger_gap * i
        draw.line([line_x, fist_y + 10, line_x, fist_y + fist_height * 0.6],
                  fill=bg_color, width=3)

    # 拇指
    thumb_x = fist_x - size * 0.1
    thumb_y = fist_y + fist_height * 0.4
    thumb_width = size * 0.25
    thumb_height = size * 0.35
    draw.ellipse([thumb_x, thumb_y, thumb_x + thumb_width, thumb_y + thumb_height],
                 fill=color)

    # 手腕
    wrist_width = fist_width * 0.6
    wrist_x = fist_x + (fist_width - wrist_width) / 2
    wrist_y = fist_y + fist_height - 5
    draw.rectangle([wrist_x, wrist_y, wrist_x + wrist_width, wrist_y + size * 0.15],
                   fill=color)


def draw_icon_spark(img, x, y, size, color):
    """绘制闪光/星星图标"""
    draw = ImageDraw.Draw(img)
    center_x = x + size / 2
    center_y = y + size / 2

    # 四角星
    points = []
    for i in range(8):
        angle = math.radians(i * 45 - 90)
        if i % 2 == 0:
            r = size * 0.45
        else:
            r = size * 0.15
        px = center_x + r * math.cos(angle)
        py = center_y + r * math.sin(angle)
        points.append((px, py))

    draw.polygon(points, fill=color)


def get_dominant_color(img):
    """分析图片，获取主色调"""
    # 缩小图片加快处理
    small = img.resize((50, 50))
    pixels = list(small.getdata())

    # 计算平均亮度
    avg_brightness = sum(sum(p[:3]) / 3 for p in pixels) / len(pixels)

    # 判断是深色还是浅色背景
    is_dark = avg_brightness < 128

    return is_dark, avg_brightness


def generate_card_with_background(text, background_path, output_path=None):
    """
    在底图上叠加文字
    自动检测底图颜色，选择合适的文字颜色
    """
    # 加载底图
    img = Image.open(background_path).convert('RGB')
    width, height = img.size
    draw = ImageDraw.Draw(img)

    # 分析底图颜色
    is_dark, brightness = get_dominant_color(img)

    # 根据底图选择文字颜色
    if is_dark:
        text_color = (245, 240, 230)  # 暖白
        highlight_color = (212, 168, 75)  # 哑光金
    else:
        text_color = (30, 30, 30)  # 深灰
        highlight_color = (180, 80, 60)  # 深红

    # 解析文本
    temp = text.replace('，', '|||').replace('。', '|||')
    temp = temp.replace('！', '|||').replace('？', '|||')
    raw_parts = temp.split('|||')

    line_parts = []
    for part in raw_parts:
        part = part.strip()
        if part:
            line_parts.append(parse_text_with_highlights(part))

    if not line_parts:
        line_parts = [parse_text_with_highlights(text)]

    # 排版
    font_size = int(min(width, height) * 0.065)  # 字号根据图片大小调整
    font = get_font(font_size)
    line_height = int(font_size * 1.7)

    # 计算每行宽度
    line_widths = []
    for parts in line_parts:
        w = sum(font.getbbox(t)[2] - font.getbbox(t)[0] for t, _ in parts)
        line_widths.append(w)
    period_w = font.getbbox("。")[2] - font.getbbox("。")[0]
    line_widths[-1] += period_w

    content_height = len(line_parts) * line_height
    start_y = (height - content_height) / 2

    # 绘制文字（带轻微阴影增加可读性）
    y = start_y
    for idx, parts in enumerate(line_parts):
        line_w = line_widths[idx]
        x = (width - line_w) / 2

        for txt, is_hl in parts:
            color = highlight_color if is_hl else text_color

            # 轻微阴影
            shadow_offset = 2
            shadow_color = (0, 0, 0) if is_dark else (255, 255, 255)
            draw.text((x + shadow_offset, y + shadow_offset), txt,
                     font=font, fill=(*shadow_color, 80))

            # 主文字
            draw.text((x, y), txt, font=font, fill=color)
            x += font.getbbox(txt)[2] - font.getbbox(txt)[0]

        if idx == len(line_parts) - 1:
            draw.text((x + shadow_offset, y + shadow_offset), "。",
                     font=font, fill=(*shadow_color, 80))
            draw.text((x, y), "。", font=font, fill=text_color)

        y += line_height

    # 保存
    if output_path is None:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = os.path.join(OUTPUT_DIR, f"card-{timestamp}.png")

    img.save(output_path, "PNG", quality=95)
    return output_path


def generate_card(text, output_path=None, width=1080, height=1080, theme="dark_gold"):
    """
    生成金句卡片 - 纯色背景版
    """
    colors = THEMES.get(theme, THEMES["dark_gold"])

    # 创建图片
    img = Image.new('RGB', (width, height), hex_to_rgb(colors["background"]))
    draw = ImageDraw.Draw(img)

    # 解析文本分行
    temp = text.replace('，', '|||').replace('。', '|||')
    temp = temp.replace('！', '|||').replace('？', '|||')
    raw_parts = temp.split('|||')

    line_parts = []
    for part in raw_parts:
        part = part.strip()
        if part:
            line_parts.append(parse_text_with_highlights(part))

    if not line_parts:
        line_parts = [parse_text_with_highlights(text)]

    # ========== 排版参数 ==========
    font_size = 66
    font = get_font(font_size)
    line_height = int(font_size * 1.7)

    # 计算每行宽度
    line_widths = []
    for parts in line_parts:
        w = sum(font.getbbox(t)[2] - font.getbbox(t)[0] for t, _ in parts)
        line_widths.append(w)

    # 最后一行加句号
    period_w = font.getbbox("。")[2] - font.getbbox("。")[0]
    line_widths[-1] += period_w

    max_width = max(line_widths)
    content_height = len(line_parts) * line_height

    # 垂直居中（稍微偏上一点，视觉更舒服）
    start_y = (height - content_height) / 2 - 20

    # ========== 装饰：顶部细线 ==========
    line_y = start_y - 50
    line_width = max_width * 0.3
    line_x = (width - line_width) / 2
    draw.line([(line_x, line_y), (line_x + line_width, line_y)],
              fill=hex_to_rgb(colors["line"]), width=2)

    # ========== 装饰：左侧小竖线（高亮行旁边）==========
    # 找到高亮行
    highlight_line_idx = -1
    for idx, parts in enumerate(line_parts):
        for _, is_hl in parts:
            if is_hl:
                highlight_line_idx = idx
                break

    # ========== 绘制文字 ==========
    y = start_y
    for idx, parts in enumerate(line_parts):
        line_w = line_widths[idx]
        x = (width - line_w) / 2

        # 高亮行左侧加小装饰
        if idx == highlight_line_idx:
            accent_x = x - 30
            accent_y = y + font_size * 0.2
            accent_h = font_size * 0.6
            draw.rectangle([accent_x, accent_y, accent_x + 4, accent_y + accent_h],
                          fill=hex_to_rgb(colors["accent"]))

        # 绘制文字
        for txt, is_hl in parts:
            color = hex_to_rgb(colors["highlight"] if is_hl else colors["text"])
            draw.text((x, y), txt, font=font, fill=color)
            x += font.getbbox(txt)[2] - font.getbbox(txt)[0]

        # 最后一行加句号
        if idx == len(line_parts) - 1:
            draw.text((x, y), "。", font=font, fill=hex_to_rgb(colors["text"]))

        y += line_height

    # ========== 装饰：底部小点 ==========
    dot_y = y + 40
    dot_r = 4
    for i in range(3):
        dot_x = width / 2 + (i - 1) * 20
        alpha = 1.0 if i == 1 else 0.4  # 中间亮，两边暗
        c = hex_to_rgb(colors["accent"])
        c_alpha = tuple(int(v * alpha + hex_to_rgb(colors["background"])[j] * (1-alpha))
                       for j, v in enumerate(c))
        draw.ellipse([dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r],
                    fill=c_alpha)

    # ========== 装饰：右上角小标记 ==========
    corner_size = 8
    corner_margin = 60
    draw.rectangle([width - corner_margin - corner_size, corner_margin,
                   width - corner_margin, corner_margin + corner_size],
                  fill=hex_to_rgb(colors["accent"]))

    # 保存
    if output_path is None:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = os.path.join(OUTPUT_DIR, f"card-{timestamp}.png")

    img.save(output_path, "PNG", quality=95)
    return output_path


def extract_quote_from_article(filepath):
    """从文章中提取金句"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 跳过 frontmatter
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            content = parts[2].strip()

    # 提取第一段或标题作为金句
    lines = [l.strip() for l in content.split('\n') if l.strip()]
    if lines:
        # 返回第一个非空行
        return lines[0]
    return content[:100]


def main():
    parser = argparse.ArgumentParser(description="金句卡片生成器")
    parser.add_argument("text", nargs="?", help="金句内容，用 [关键词] 标记高亮")
    parser.add_argument("--file", "-f", help="从 markdown 文件提取金句")
    parser.add_argument("--output", "-o", help="输出文件路径")
    parser.add_argument("--background", "-b", help="底图路径（AI生成的背景图）")
    parser.add_argument("--width", "-W", type=int, default=1080, help="图片宽度")
    parser.add_argument("--height", "-H", type=int, default=1080, help="图片高度")
    parser.add_argument("--theme", "-t", default="dark_gold",
                       choices=["dark_gold", "dark_coral", "dark_mint"],
                       help="配色主题（无底图时使用）")

    args = parser.parse_args()

    # 获取文案
    if args.file:
        text = extract_quote_from_article(args.file)
        print(f"从文件提取: {text[:50]}...")
    elif args.text:
        text = args.text
    else:
        print("请提供文案内容")
        print("用法:")
        print("  纯色背景: python card-generator.py \"文案[高亮]。\"")
        print("  用底图:   python card-generator.py \"文案\" --background 底图.png")
        return

    # 生成卡片
    if args.background:
        # 用底图模式
        output = generate_card_with_background(
            text=text,
            background_path=args.background,
            output_path=args.output
        )
    else:
        # 纯色背景模式
        output = generate_card(
            text=text,
            output_path=args.output,
            width=args.width,
            height=args.height,
            theme=args.theme
        )

    print(f"✅ 卡片已生成: {output}")


if __name__ == "__main__":
    main()
