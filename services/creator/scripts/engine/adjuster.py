"""
Step 4: 自动校正器
检测并修复布局问题

检测项：
- 文字超出画布
- 文字太小（视觉信息量不足）
- 空间太空（需要放大或加装饰）
- 图标与文字重叠
"""

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1080
MIN_FONT_SIZE = 48
MAX_FONT_SIZE = 140
TARGET_FILL_RATIO = 0.6  # 文字应占画布高度的 60%


def adjust_layout(layout):
    """
    检查并调整布局
    返回: (adjusted_layout, issues_found, fixes_applied)
    """
    issues = []
    fixes = []

    # 1. 检查文字是否超出画布
    overflow_issues = _check_overflow(layout)
    if overflow_issues:
        issues.extend(overflow_issues)
        layout = _fix_overflow(layout)
        fixes.append("缩小超出文字")

    # 2. 检查文字是否太小
    small_issues = _check_too_small(layout)
    if small_issues:
        issues.extend(small_issues)
        layout = _fix_too_small(layout)
        fixes.append("放大文字填满画布")

    # 3. 检查空间利用
    space_issues = _check_empty_space(layout)
    if space_issues:
        issues.extend(space_issues)
        layout = _fix_empty_space(layout)
        fixes.append("优化空间利用")

    # 4. 检查图标重叠
    overlap_issues = _check_icon_overlap(layout)
    if overlap_issues:
        issues.extend(overlap_issues)
        layout = _fix_icon_overlap(layout)
        fixes.append("调整图标位置避免重叠")

    return layout, issues, fixes


def _check_overflow(layout):
    """检查文字是否超出画布"""
    issues = []
    margin = 80

    for i, block in enumerate(layout.get("blocks", [])):
        x = block["x"]
        font_size = block["font_size"]
        text_len = len(block["text"])
        align = block.get("align", "left")

        # 估算文字宽度
        char_width = font_size * 0.55
        text_width = text_len * char_width

        if align == "left":
            end_x = x + text_width
            if end_x > CANVAS_WIDTH - margin:
                issues.append(f"第{i+1}行超出右边界")
        elif align == "right":
            start_x = x - text_width
            if start_x < margin:
                issues.append(f"第{i+1}行超出左边界")

    return issues


def _fix_overflow(layout):
    """修复超出问题：缩小字号"""
    margin = 80
    max_width = CANVAS_WIDTH - margin * 2

    for block in layout.get("blocks", []):
        text_len = len(block["text"])
        font_size = block["font_size"]

        # 估算需要的宽度
        char_width = font_size * 0.55
        text_width = text_len * char_width

        if text_width > max_width:
            # 计算合适的字号
            new_size = int(max_width / (text_len * 0.55))
            block["font_size"] = max(new_size, MIN_FONT_SIZE)

    return layout


def _check_too_small(layout):
    """检查文字是否太小"""
    issues = []

    blocks = layout.get("blocks", [])
    if not blocks:
        return issues

    # 计算当前文字总高度
    total_height = sum(b["font_size"] + 25 for b in blocks)
    fill_ratio = total_height / CANVAS_HEIGHT

    if fill_ratio < 0.4:
        issues.append(f"文字太小，仅占画布 {fill_ratio*100:.0f}%")

    return issues


def _fix_too_small(layout):
    """放大文字填满画布"""
    blocks = layout.get("blocks", [])
    if not blocks:
        return layout

    # 计算当前和目标高度
    total_height = sum(b["font_size"] + 25 for b in blocks)
    target_height = CANVAS_HEIGHT * TARGET_FILL_RATIO

    if total_height < target_height:
        scale = target_height / total_height
        scale = min(scale, 1.8)  # 最多放大 1.8 倍

        for block in blocks:
            new_size = int(block["font_size"] * scale)
            block["font_size"] = min(new_size, MAX_FONT_SIZE)

        # 重新计算 Y 位置
        total_height = sum(b["font_size"] + 25 for b in blocks)
        start_y = (CANVAS_HEIGHT - total_height) // 2

        y = start_y
        for block in blocks:
            block["y"] = y
            y += block["font_size"] + 25

    return layout


def _check_empty_space(layout):
    """检查空间利用"""
    issues = []

    blocks = layout.get("blocks", [])
    icons = layout.get("icons", [])

    # 如果文字少且没有图标，空间可能太空
    if len(blocks) <= 2 and not icons:
        issues.append("内容较少，可考虑添加装饰元素")

    return issues


def _fix_empty_space(layout):
    """优化空间利用"""
    # 如果没有图标且空间空，可以考虑加大字号
    icons = layout.get("icons", [])

    if not icons:
        for block in layout.get("blocks", []):
            if block.get("role") == "强调":
                # 强调行再放大一点
                block["font_size"] = min(block["font_size"] + 10, MAX_FONT_SIZE)

    return layout


def _check_icon_overlap(layout):
    """检查图标是否与文字重叠"""
    issues = []

    icons = layout.get("icons", [])
    blocks = layout.get("blocks", [])

    for icon in icons:
        icon_x = icon["x"]
        icon_y = icon["y"]
        icon_size = icon.get("size", 80)

        for block in blocks:
            # 估算文字区域
            bx = block["x"]
            by = block["y"]
            bw = len(block["text"]) * block["font_size"] * 0.55
            bh = block["font_size"]

            # 根据对齐调整
            if block.get("align") == "right":
                bx = bx - bw
            elif block.get("align") == "center":
                bx = bx - bw / 2

            # 检查重叠
            if (icon_x < bx + bw and icon_x + icon_size > bx and
                icon_y < by + bh and icon_y + icon_size > by):
                issues.append("图标与文字重叠")
                break

    return issues


def _fix_icon_overlap(layout):
    """修复图标重叠"""
    icons = layout.get("icons", [])
    blocks = layout.get("blocks", [])

    for icon in icons:
        icon_size = icon.get("size", 80)

        # 尝试移动图标到安全位置
        # 策略：移到画布角落
        safe_positions = [
            (CANVAS_WIDTH - 100 - icon_size, 100),  # 右上
            (100, 100),  # 左上
            (CANVAS_WIDTH - 100 - icon_size, CANVAS_HEIGHT - 100 - icon_size),  # 右下
            (100, CANVAS_HEIGHT - 100 - icon_size),  # 左下
        ]

        for sx, sy in safe_positions:
            overlaps = False
            for block in blocks:
                bx = block["x"]
                by = block["y"]
                bw = len(block["text"]) * block["font_size"] * 0.55
                bh = block["font_size"]

                if block.get("align") == "right":
                    bx = bx - bw
                elif block.get("align") == "center":
                    bx = bx - bw / 2

                if (sx < bx + bw + 20 and sx + icon_size > bx - 20 and
                    sy < by + bh + 20 and sy + icon_size > by - 20):
                    overlaps = True
                    break

            if not overlaps:
                icon["x"] = sx
                icon["y"] = sy
                break

    return layout


if __name__ == "__main__":
    # 测试
    test_layout = {
        "canvas": {"width": 1080, "height": 1080, "background": "#0D1117"},
        "blocks": [
            {"text": "测试文字", "x": 100, "y": 400, "font_size": 40, "align": "left"},
        ],
        "icons": [],
    }

    adjusted, issues, fixes = adjust_layout(test_layout)
    print(f"问题: {issues}")
    print(f"修复: {fixes}")
