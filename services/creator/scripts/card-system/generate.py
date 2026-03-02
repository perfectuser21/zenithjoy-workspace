#!/usr/bin/env python3
"""
金句卡片生成器 v2.0
统一视觉规范 + 4种布局模板 + 8个核心图标

用法:
    python generate.py "成功的人不是赢在起点，而是赢在转折点"
    python generate.py "热爱可抵岁月漫长" --layout center-punch
    python generate.py "你不是做不到，是不敢开始" --layout right-compact
"""

import argparse
import json
import os
import random
import subprocess
import sys
from datetime import datetime

# ============ 配置 ============

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
ICONS_DIR = os.path.join(PROJECT_DIR, "assets", "icons")
OUTPUT_DIR = os.path.join(PROJECT_DIR, "assets", "cards")
RENDERER = os.path.join(os.path.dirname(SCRIPT_DIR), "card-renderer.py")

# 画布
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1080

# 配色
COLORS = {
    "background": "#0D1117",
    "text": "#F0EDE5",
    "highlight": "#E85A3C",
}

# 字号
FONT = {
    "base": 72,
    "highlight": 88,
}

# 每行最大字符数（超过则缩小字号）
MAX_CHARS_PER_LINE = 12

# 边距
MARGIN = {"left": 100, "right": 100, "top": 150, "bottom": 150}

# 图标
ICON_SIZE = 120
ACCENT_BAR_WIDTH = 6

# 核心图标语义（8个）
ICON_SEMANTICS = {
    "bird": ["自由", "飞", "翱翔", "解放", "独立"],
    "rocket": ["开始", "启动", "行动", "出发", "干", "做", "试", "尝试"],
    "fire": ["热情", "激情", "燃烧", "勇气", "热血", "拼"],
    "mountain": ["挑战", "攀登", "困难", "成长", "突破"],
    "target": ["目标", "专注", "聚焦", "方向", "计划"],
    "heart": ["爱", "热爱", "喜欢", "梦想"],
    "trophy": ["成功", "赢", "胜利", "冠军", "成就"],
    "arrow-up": ["转折", "上升", "提升", "进步", "变化", "翻盘"],
}


# ============ 文本分析 ============

def analyze_text(text):
    """分析文案，返回分行、高亮行、推荐图标"""
    text = text.strip()

    # 分行
    if "\n" in text:
        lines = [l.strip() for l in text.split("\n") if l.strip()]
    else:
        # 智能断句
        temp = text
        for punct in ["，", "。", "；", "！", "？"]:
            temp = temp.replace(punct, "|||")
        parts = [p.strip() for p in temp.split("|||") if p.strip()]

        # 合并过短的
        lines = []
        buffer = ""
        for p in parts:
            if len(buffer) + len(p) < 8:
                buffer += p
            else:
                if buffer:
                    lines.append(buffer)
                buffer = p
        if buffer:
            lines.append(buffer)

    # 找高亮行（转折词优先，否则最后一行）
    highlight_idx = len(lines) - 1
    # 优先级：而是 > 就是 > 才是 > 最后一行
    for keyword in ["而是", "就是", "才是"]:
        for i, line in enumerate(lines):
            if keyword in line:
                highlight_idx = i
                break
        else:
            continue
        break

    # 匹配图标
    best_icon = None
    best_score = 0
    for icon, keywords in ICON_SEMANTICS.items():
        score = sum(1 for kw in keywords if kw in text)
        if score > best_score:
            best_score = score
            best_icon = icon

    if not best_icon:
        best_icon = "star"

    icon_path = os.path.join(ICONS_DIR, f"{best_icon}.png")
    if not os.path.exists(icon_path):
        icon_path = None

    return {
        "lines": lines,
        "highlight_idx": highlight_idx,
        "icon": best_icon,
        "icon_path": icon_path,
    }


# ============ 布局模板 ============

def get_font_size(line, is_highlight):
    """根据文字长度自动调整字号"""
    base = FONT["highlight"] if is_highlight else FONT["base"]
    if len(line) > MAX_CHARS_PER_LINE:
        # 每超出2个字，缩小8px
        reduction = ((len(line) - MAX_CHARS_PER_LINE) // 2) * 8
        return max(base - reduction, 56)  # 最小56px
    return base


def layout_left_brand(lines, highlight_idx, icon_path):
    """经典左对齐：竖条 + 左对齐文字 + 右上图标"""
    elements = []

    # 计算文字区域高度
    line_heights = []
    font_sizes = []
    for i in range(len(lines)):
        is_hl = (i == highlight_idx)
        fs = get_font_size(lines[i], is_hl)
        font_sizes.append(fs)
        line_heights.append(fs + 45)

    total_height = sum(line_heights)
    start_y = (CANVAS_HEIGHT - total_height) // 2

    # 竖条
    elements.append({
        "type": "rect",
        "x": MARGIN["left"],
        "y": start_y - 15,
        "width": ACCENT_BAR_WIDTH,
        "height": total_height + 30,
        "color": COLORS["highlight"],
    })

    # 文字
    text_x = MARGIN["left"] + ACCENT_BAR_WIDTH + 24
    y = start_y
    for i, line in enumerate(lines):
        is_hl = (i == highlight_idx)
        elements.append({
            "type": "text",
            "content": line,
            "x": text_x,
            "y": y,
            "font_size": font_sizes[i],
            "color": COLORS["highlight"] if is_hl else COLORS["text"],
            "align": "left",
        })
        y += line_heights[i]

    # 图标
    if icon_path:
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": CANVAS_WIDTH - MARGIN["right"] - ICON_SIZE,
            "y": MARGIN["top"],
            "width": ICON_SIZE,
            "height": ICON_SIZE,
        })

    return elements


def layout_center_punch(lines, highlight_idx, icon_path):
    """居中冲击：居中文字 + 底部图标"""
    elements = []

    line_heights = []
    for i in range(len(lines)):
        if i == highlight_idx:
            line_heights.append(FONT["highlight"] + 50)
        else:
            line_heights.append(FONT["base"] + 40)

    total_height = sum(line_heights)
    start_y = (CANVAS_HEIGHT - total_height - ICON_SIZE - 60) // 2

    y = start_y
    for i, line in enumerate(lines):
        is_hl = (i == highlight_idx)
        elements.append({
            "type": "text",
            "content": line,
            "x": CANVAS_WIDTH // 2,
            "y": y,
            "font_size": FONT["highlight"] if is_hl else FONT["base"],
            "color": COLORS["highlight"] if is_hl else COLORS["text"],
            "align": "center",
        })
        y += line_heights[i]

    if icon_path:
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": (CANVAS_WIDTH - ICON_SIZE) // 2,
            "y": y + 40,
            "width": ICON_SIZE,
            "height": ICON_SIZE,
        })

    return elements


def layout_right_compact(lines, highlight_idx, icon_path):
    """右对齐紧凑：右竖条 + 右对齐 + 左上图标"""
    elements = []

    line_heights = []
    for i in range(len(lines)):
        if i == highlight_idx:
            line_heights.append(FONT["highlight"] + 45)
        else:
            line_heights.append(FONT["base"] + 35)

    total_height = sum(line_heights)
    start_y = (CANVAS_HEIGHT - total_height) // 2

    bar_x = CANVAS_WIDTH - MARGIN["right"]
    elements.append({
        "type": "rect",
        "x": bar_x,
        "y": start_y - 15,
        "width": ACCENT_BAR_WIDTH,
        "height": total_height + 30,
        "color": COLORS["highlight"],
    })

    text_x = bar_x - 24
    y = start_y
    for i, line in enumerate(lines):
        is_hl = (i == highlight_idx)
        elements.append({
            "type": "text",
            "content": line,
            "x": text_x,
            "y": y,
            "font_size": FONT["highlight"] if is_hl else FONT["base"],
            "color": COLORS["highlight"] if is_hl else COLORS["text"],
            "align": "right",
        })
        y += line_heights[i]

    if icon_path:
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": MARGIN["left"],
            "y": MARGIN["top"],
            "width": ICON_SIZE,
            "height": ICON_SIZE,
        })

    return elements


def layout_bottom_focus(lines, highlight_idx, icon_path):
    """底部聚焦：顶部大图标 + 底部文字"""
    elements = []

    # 图标顶部居中
    if icon_path:
        big_icon = ICON_SIZE + 40
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": (CANVAS_WIDTH - big_icon) // 2,
            "y": MARGIN["top"] + 30,
            "width": big_icon,
            "height": big_icon,
        })

    line_heights = []
    for i in range(len(lines)):
        if i == highlight_idx:
            line_heights.append(FONT["highlight"] + 50)
        else:
            line_heights.append(FONT["base"] + 40)

    total_height = sum(line_heights)
    start_y = CANVAS_HEIGHT - MARGIN["bottom"] - total_height

    y = start_y
    for i, line in enumerate(lines):
        is_hl = (i == highlight_idx)
        elements.append({
            "type": "text",
            "content": line,
            "x": CANVAS_WIDTH // 2,
            "y": y,
            "font_size": FONT["highlight"] if is_hl else FONT["base"],
            "color": COLORS["highlight"] if is_hl else COLORS["text"],
            "align": "center",
        })
        y += line_heights[i]

    return elements


def layout_hotblooded(lines, highlight_idx, icon_path):
    """
    热血风格：错落排版 + 节奏感 + 图标融入
    - 每行位置错落，形成视觉节奏
    - 高亮行超大字号 + 右偏
    - 图标融入文字区域
    """
    elements = []
    n = len(lines)

    # 字号：高亮行超大
    font_sizes = []
    for i in range(n):
        if i == highlight_idx:
            font_sizes.append(110)  # 超大冲击
        else:
            font_sizes.append(56)   # 铺垫行稍小

    # 行间距紧凑
    line_heights = [fs + 25 for fs in font_sizes]
    total_height = sum(line_heights)

    # 起始 Y（垂直居中）
    start_y = (CANVAS_HEIGHT - total_height) // 2

    # 错落 X 位置 + 对齐方式
    # 核心逻辑：铺垫行靠左/居中，高亮行靠右
    if n == 2:
        x_configs = [
            {"x": 200, "align": "left"},
            {"x": CANVAS_WIDTH - 150, "align": "right"},
        ]
    elif n == 3:
        x_configs = [
            {"x": 180, "align": "left"},
            {"x": 250, "align": "left"},
            {"x": CANVAS_WIDTH - 120, "align": "right"},
        ]
    else:
        x_configs = [{"x": CANVAS_WIDTH // 2, "align": "center"}] * n

    # 绘制文字
    y = start_y
    hl_info = {"x": 0, "y": 0, "width": 0}

    for i, line in enumerate(lines):
        is_hl = (i == highlight_idx)
        cfg = x_configs[i] if i < len(x_configs) else x_configs[-1]

        elements.append({
            "type": "text",
            "content": line,
            "x": cfg["x"],
            "y": y,
            "font_size": font_sizes[i],
            "color": COLORS["highlight"] if is_hl else COLORS["text"],
            "align": cfg["align"],
        })

        if is_hl:
            hl_info = {"x": cfg["x"], "y": y, "align": cfg["align"], "len": len(line)}

        y += line_heights[i]

    # 图标：贴近高亮行
    if icon_path:
        icon_size = 80

        if hl_info.get("align") == "right":
            # 右对齐：图标在高亮行左边
            text_width = hl_info["len"] * 55  # 估算文字宽度
            icon_x = hl_info["x"] - text_width - icon_size - 15
            icon_y = hl_info["y"] + 15
        else:
            # 左对齐：图标在高亮行右边
            text_width = hl_info["len"] * 55
            icon_x = hl_info["x"] + text_width + 15
            icon_y = hl_info["y"] + 15

        # 边界检查
        icon_x = max(80, min(icon_x, CANVAS_WIDTH - 80 - icon_size))
        icon_y = max(80, min(icon_y, CANVAS_HEIGHT - 80 - icon_size))

        elements.append({
            "type": "image",
            "path": icon_path,
            "x": icon_x,
            "y": icon_y,
            "width": icon_size,
            "height": icon_size,
        })

    return elements


LAYOUTS = {
    "left-brand": layout_left_brand,
    "center-punch": layout_center_punch,
    "right-compact": layout_right_compact,
    "bottom-focus": layout_bottom_focus,
    "hotblooded": layout_hotblooded,
}


# ============ 渲染 ============

def generate_card(text, layout_name="auto", output_path=None):
    """生成卡片"""
    # 分析文本
    analysis = analyze_text(text)

    # 选择布局
    if layout_name == "auto":
        layout_name = random.choice(list(LAYOUTS.keys()))

    layout_func = LAYOUTS.get(layout_name, layout_left_brand)

    # 生成元素
    elements = layout_func(
        analysis["lines"],
        analysis["highlight_idx"],
        analysis["icon_path"]
    )

    # 构建完整 JSON
    layout = {
        "canvas": {
            "width": CANVAS_WIDTH,
            "height": CANVAS_HEIGHT,
            "background": COLORS["background"],
        },
        "elements": elements,
    }

    # 保存临时 JSON
    temp_json = "/tmp/card-layout-v2.json"
    with open(temp_json, "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, indent=2)

    # 调用渲染器
    cmd = ["python3", RENDERER, temp_json]
    if output_path:
        cmd.extend(["--output", output_path])

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode == 0:
        output = result.stdout.strip()
        if "已生成:" in output:
            return output.split("已生成:")[-1].strip(), layout_name, analysis

    return None, layout_name, analysis


def main():
    parser = argparse.ArgumentParser(description="金句卡片生成器 v2.0")
    parser.add_argument("text", help="金句文案")
    parser.add_argument("--layout", "-l",
                        choices=["auto", "left-brand", "center-punch", "right-compact", "bottom-focus", "hotblooded"],
                        default="auto", help="布局模板")
    parser.add_argument("--output", "-o", help="输出路径")
    parser.add_argument("--debug", action="store_true", help="显示调试信息")

    args = parser.parse_args()

    output_path, layout_used, analysis = generate_card(args.text, args.layout, args.output)

    if args.debug:
        print(f"📊 分析结果:")
        print(f"   分行: {analysis['lines']}")
        print(f"   高亮: 第{analysis['highlight_idx']+1}行")
        print(f"   图标: {analysis['icon']}")
        print(f"   布局: {layout_used}")
        print()

    if output_path:
        print(f"✅ 卡片已生成: {output_path}")
    else:
        print("❌ 生成失败")


if __name__ == "__main__":
    main()
