"""
布局模板 - 4种视觉风格（统一中有变化）

模板说明：
- left-brand:    经典左对齐，竖条 + 右上图标
- center-punch:  居中冲击，图标在底部
- right-compact: 右对齐紧凑，图标在左上
- bottom-focus:  底部聚焦，大量留白 + 图标在上
"""

from ..config.style import *


def layout_left_brand(lines, highlight_idx, icon_path):
    """
    经典左对齐布局
    - 左边竖条装饰
    - 文字左对齐
    - 图标右上角
    """
    elements = []

    # 计算文字区域
    total_lines = len(lines)
    line_height_base = FONT["base"] + int(FONT["base"] * LINE_SPACING["normal"])
    line_height_highlight = FONT["highlight"] + int(FONT["highlight"] * LINE_SPACING["normal"])

    # 计算总高度
    total_height = 0
    for i in range(total_lines):
        if i == highlight_idx:
            total_height += line_height_highlight
        else:
            total_height += line_height_base

    # 垂直居中起点
    start_y = (CANVAS_HEIGHT - total_height) // 2

    # 竖条
    elements.append({
        "type": "rect",
        "x": MARGIN["left"],
        "y": start_y - 10,
        "width": ACCENT_BAR["width"],
        "height": total_height + 20,
        "color": COLORS["highlight"],
    })

    # 文字
    text_x = MARGIN["left"] + ACCENT_BAR["width"] + ACCENT_BAR["margin"]
    y = start_y
    for i, line in enumerate(lines):
        is_highlight = (i == highlight_idx)
        font_size = FONT["highlight"] if is_highlight else FONT["base"]

        elements.append({
            "type": "text",
            "content": line,
            "x": text_x,
            "y": y,
            "font_size": font_size,
            "color": COLORS["highlight"] if is_highlight else COLORS["text"],
            "align": "left",
        })

        if is_highlight:
            y += line_height_highlight
        else:
            y += line_height_base

    # 图标（右上角）
    if icon_path:
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": CANVAS_WIDTH - MARGIN["right"] - ICON["size"],
            "y": MARGIN["top"],
            "width": ICON["size"],
            "height": ICON["size"],
        })

    return elements


def layout_center_punch(lines, highlight_idx, icon_path):
    """
    居中冲击布局
    - 文字居中
    - 高亮行更大
    - 图标在底部居中
    """
    elements = []

    total_lines = len(lines)
    line_height_base = FONT["base"] + int(FONT["base"] * LINE_SPACING["normal"])
    line_height_highlight = FONT["highlight"] + int(FONT["highlight"] * LINE_SPACING["normal"])

    # 计算总高度
    total_height = 0
    for i in range(total_lines):
        if i == highlight_idx:
            total_height += line_height_highlight
        else:
            total_height += line_height_base

    # 垂直居中（稍微偏上，给图标留空间）
    start_y = (CANVAS_HEIGHT - total_height - ICON["size"] - 60) // 2

    # 文字
    y = start_y
    for i, line in enumerate(lines):
        is_highlight = (i == highlight_idx)
        font_size = FONT["highlight"] if is_highlight else FONT["base"]

        elements.append({
            "type": "text",
            "content": line,
            "x": CANVAS_WIDTH // 2,
            "y": y,
            "font_size": font_size,
            "color": COLORS["highlight"] if is_highlight else COLORS["text"],
            "align": "center",
        })

        if is_highlight:
            y += line_height_highlight
        else:
            y += line_height_base

    # 图标（底部居中）
    if icon_path:
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": (CANVAS_WIDTH - ICON["size"]) // 2,
            "y": y + 40,
            "width": ICON["size"],
            "height": ICON["size"],
        })

    return elements


def layout_right_compact(lines, highlight_idx, icon_path):
    """
    右对齐紧凑布局
    - 文字右对齐
    - 右边竖条
    - 图标在左上
    """
    elements = []

    total_lines = len(lines)
    line_height_base = FONT["base"] + int(FONT["base"] * LINE_SPACING["tight"])
    line_height_highlight = FONT["highlight"] + int(FONT["highlight"] * LINE_SPACING["tight"])

    # 计算总高度
    total_height = 0
    for i in range(total_lines):
        if i == highlight_idx:
            total_height += line_height_highlight
        else:
            total_height += line_height_base

    # 垂直居中
    start_y = (CANVAS_HEIGHT - total_height) // 2

    # 竖条（右边）
    bar_x = CANVAS_WIDTH - MARGIN["right"]
    elements.append({
        "type": "rect",
        "x": bar_x,
        "y": start_y - 10,
        "width": ACCENT_BAR["width"],
        "height": total_height + 20,
        "color": COLORS["highlight"],
    })

    # 文字
    text_x = bar_x - ACCENT_BAR["margin"]
    y = start_y
    for i, line in enumerate(lines):
        is_highlight = (i == highlight_idx)
        font_size = FONT["highlight"] if is_highlight else FONT["base"]

        elements.append({
            "type": "text",
            "content": line,
            "x": text_x,
            "y": y,
            "font_size": font_size,
            "color": COLORS["highlight"] if is_highlight else COLORS["text"],
            "align": "right",
        })

        if is_highlight:
            y += line_height_highlight
        else:
            y += line_height_base

    # 图标（左上角）
    if icon_path:
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": MARGIN["left"],
            "y": MARGIN["top"],
            "width": ICON["size"],
            "height": ICON["size"],
        })

    return elements


def layout_bottom_focus(lines, highlight_idx, icon_path):
    """
    底部聚焦布局
    - 大量顶部留白
    - 文字在底部
    - 图标在顶部居中
    """
    elements = []

    # 图标（顶部居中，大尺寸）
    if icon_path:
        icon_size = ICON["size"] + 40  # 稍大一点
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": (CANVAS_WIDTH - icon_size) // 2,
            "y": MARGIN["top"] + 50,
            "width": icon_size,
            "height": icon_size,
        })

    total_lines = len(lines)
    line_height_base = FONT["base"] + int(FONT["base"] * LINE_SPACING["normal"])
    line_height_highlight = FONT["highlight"] + int(FONT["highlight"] * LINE_SPACING["normal"])

    # 计算总高度
    total_height = 0
    for i in range(total_lines):
        if i == highlight_idx:
            total_height += line_height_highlight
        else:
            total_height += line_height_base

    # 从底部往上
    start_y = CANVAS_HEIGHT - MARGIN["bottom"] - total_height

    # 文字
    y = start_y
    for i, line in enumerate(lines):
        is_highlight = (i == highlight_idx)
        font_size = FONT["highlight"] if is_highlight else FONT["base"]

        elements.append({
            "type": "text",
            "content": line,
            "x": CANVAS_WIDTH // 2,
            "y": y,
            "font_size": font_size,
            "color": COLORS["highlight"] if is_highlight else COLORS["text"],
            "align": "center",
        })

        if is_highlight:
            y += line_height_highlight
        else:
            y += line_height_base

    return elements


# 布局注册表
LAYOUTS = {
    "left-brand": layout_left_brand,
    "center-punch": layout_center_punch,
    "right-compact": layout_right_compact,
    "bottom-focus": layout_bottom_focus,
}


def get_layout(name):
    """获取布局函数"""
    return LAYOUTS.get(name)


def list_layouts():
    """列出所有布局"""
    return list(LAYOUTS.keys())
