"""
Step 2: 布局规划器
根据语义分析结果，生成布局 JSON

输出结构:
{
    "style": "hotblooded|brand|minimal",
    "canvas": {"width": 1080, "height": 1080, "background": "#0D1117"},
    "blocks": [
        {
            "text": "xxx",
            "x": 100, "y": 200,
            "font_size": 64,
            "color": "#F0EDE5",
            "align": "left|center|right",
            "role": "铺垫|强调"
        }
    ],
    "icons": [
        {"name": "rocket", "x": 100, "y": 500, "size": 80}
    ]
}
"""

import os

# 配置
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1080
COLORS = {
    "background": "#0D1117",
    "text": "#F0EDE5",
    "highlight": "#E85A3C",
}
ICONS_DIR = "/home/xx/dev/zenithjoy-creator/assets/icons"

# 字号规范（起承转合）
FONT_SIZES = {
    "起": 64,      # 开场
    "承": 64,      # 延续
    "转": 72,      # 转折
    "合": 120,     # 落点（最大！）
    # 旧兼容
    "铺垫": 64,
    "否定": 64,
    "转折": 72,
    "强调": 120,
}


def plan_layout(parsed_content, style="auto"):
    """
    根据解析结果规划布局
    """
    lines = parsed_content["lines"]
    mood = parsed_content["mood"]
    sentence_type = parsed_content["type"]
    icons = parsed_content["icon_suggestion"]

    # 自动选择风格
    if style == "auto":
        if mood in ["热血", "警醒"]:
            style = "hotblooded"
        else:
            style = "brand"

    # 根据风格生成布局
    if style == "hotblooded":
        return _plan_hotblooded(lines, icons)
    else:
        return _plan_brand(lines, icons)


def _plan_hotblooded(lines, icons):
    """
    热血风格布局 - 真正的错落有致

    核心原则：
    1. 起承转合，每行角色不同，大小不同
    2. 对齐交错：左→右→左→中，形成视觉动势
    3. 落点（合）最大最突出，可能居中或偏右
    4. 图标作为节奏的一部分，不是装饰
    """
    layout = {
        "style": "hotblooded",
        "canvas": {
            "width": CANVAS_WIDTH,
            "height": CANVAS_HEIGHT,
            "background": COLORS["background"],
        },
        "blocks": [],
        "icons": [],
    }

    n = len(lines)

    # === 1. 计算字号（根据角色，落点最大） ===
    font_sizes = []
    for line in lines:
        role = line["role"]
        base_size = FONT_SIZES.get(role, 64)
        font_sizes.append(base_size)

    # === 2. 缩放以填满画布 ===
    line_heights = [fs + 20 for fs in font_sizes]
    total_height = sum(line_heights)

    target = CANVAS_HEIGHT * 0.6
    scale = target / total_height if total_height > 0 else 1
    scale = max(0.9, min(scale, 1.4))

    font_sizes = [int(fs * scale) for fs in font_sizes]
    line_heights = [fs + 20 for fs in font_sizes]
    total_height = sum(line_heights)

    # === 3. 错落对齐策略 ===
    # 根据行数和角色分配位置
    alignments = _get_rhythm_alignment(lines)

    # === 4. 计算每行位置 ===
    start_y = (CANVAS_HEIGHT - total_height) // 2
    y = start_y

    punch_block = None  # 落点行

    for i, line in enumerate(lines):
        align_cfg = alignments[i]
        fs = font_sizes[i]

        block = {
            "text": line["text"],
            "x": align_cfg["x"],
            "y": y,
            "font_size": fs,
            "color": COLORS["highlight"] if line["highlight"] else COLORS["text"],
            "align": align_cfg["align"],
            "role": line["role"],
        }
        layout["blocks"].append(block)

        if line["role"] == "合":
            punch_block = block

        y += line_heights[i]

    # === 5. 图标：作为视觉节奏的一部分 ===
    if icons and punch_block:
        icon_name = icons[0]
        icon_path = os.path.join(ICONS_DIR, f"{icon_name}.png")

        if os.path.exists(icon_path):
            # 图标大小根据落点字号比例
            icon_size = int(punch_block["font_size"] * 0.7)
            icon_size = max(60, min(icon_size, 100))

            # 图标位置：在落点行上方，作为"引导"
            if punch_block["align"] == "center":
                icon_x = (CANVAS_WIDTH - icon_size) // 2
                icon_y = punch_block["y"] - icon_size - 30
            elif punch_block["align"] == "right":
                # 右对齐时，图标在左上方引导视线
                icon_x = 150
                icon_y = start_y - icon_size - 20
            else:
                # 左对齐时，图标在右上方
                icon_x = CANVAS_WIDTH - 150 - icon_size
                icon_y = start_y - icon_size - 20

            # 边界保护
            icon_x = max(80, min(icon_x, CANVAS_WIDTH - 80 - icon_size))
            icon_y = max(80, min(icon_y, CANVAS_HEIGHT - 80 - icon_size))

            layout["icons"].append({
                "name": icon_name,
                "path": icon_path,
                "x": int(icon_x),
                "y": int(icon_y),
                "size": icon_size,
            })

    return layout


def _get_rhythm_alignment(lines):
    """
    生成节奏感的对齐配置
    原则：左右交错，落点居中或突出
    """
    n = len(lines)
    configs = []

    # 经典四行：起(左) - 承(右) - 转(左) - 合(中/大)
    if n == 4:
        configs = [
            {"x": 150, "align": "left"},
            {"x": CANVAS_WIDTH - 150, "align": "right"},
            {"x": 180, "align": "left"},
            {"x": CANVAS_WIDTH // 2, "align": "center"},
        ]
    # 三行：起(左) - 承(右) - 合(中)
    elif n == 3:
        configs = [
            {"x": 150, "align": "left"},
            {"x": CANVAS_WIDTH - 150, "align": "right"},
            {"x": CANVAS_WIDTH // 2, "align": "center"},
        ]
    # 两行：起(左) - 合(右/大)
    elif n == 2:
        configs = [
            {"x": 200, "align": "left"},
            {"x": CANVAS_WIDTH - 120, "align": "right"},
        ]
    # 单行：居中
    elif n == 1:
        configs = [
            {"x": CANVAS_WIDTH // 2, "align": "center"},
        ]
    # 更多行：交替
    else:
        for i, line in enumerate(lines):
            if line["role"] == "合":
                configs.append({"x": CANVAS_WIDTH // 2, "align": "center"})
            elif i % 2 == 0:
                configs.append({"x": 150, "align": "left"})
            else:
                configs.append({"x": CANVAS_WIDTH - 150, "align": "right"})

    return configs


def _plan_brand(lines, icons):
    """
    品牌风格布局
    - 左对齐 + 竖条
    - 稳重专业
    """
    layout = {
        "style": "brand",
        "canvas": {
            "width": CANVAS_WIDTH,
            "height": CANVAS_HEIGHT,
            "background": COLORS["background"],
        },
        "blocks": [],
        "icons": [],
        "decorations": [],
    }

    n = len(lines)

    # 字号
    font_sizes = []
    for line in lines:
        base_size = FONT_SIZES.get(line["role"], 64)
        if line["highlight"]:
            base_size = max(base_size, 88)
        font_sizes.append(base_size)

    # 计算总高度并缩放
    line_heights = [fs + 40 for fs in font_sizes]
    total_text_height = sum(line_heights)

    target_height = CANVAS_HEIGHT * 0.55
    scale = target_height / total_text_height if total_text_height > 0 else 1
    scale = max(0.85, min(scale, 1.3))

    font_sizes = [int(fs * scale) for fs in font_sizes]
    line_heights = [fs + 40 for fs in font_sizes]
    total_text_height = sum(line_heights)

    # 起始位置
    start_y = (CANVAS_HEIGHT - total_text_height) // 2
    text_x = 130  # 留出竖条空间

    # 竖条装饰
    layout["decorations"].append({
        "type": "rect",
        "x": 100,
        "y": start_y - 15,
        "width": 6,
        "height": total_text_height + 30,
        "color": COLORS["highlight"],
    })

    # 生成 blocks
    y = start_y
    for i, line in enumerate(lines):
        block = {
            "text": line["text"],
            "x": text_x,
            "y": y,
            "font_size": font_sizes[i],
            "color": COLORS["highlight"] if line["highlight"] else COLORS["text"],
            "align": "left",
            "role": line["role"],
        }
        layout["blocks"].append(block)
        y += line_heights[i]

    # 图标：右上角
    if icons:
        icon_name = icons[0]
        icon_path = os.path.join(ICONS_DIR, f"{icon_name}.png")

        if os.path.exists(icon_path):
            layout["icons"].append({
                "name": icon_name,
                "path": icon_path,
                "x": CANVAS_WIDTH - 100 - 120,
                "y": 120,
                "size": 120,
            })

    return layout




if __name__ == "__main__":
    import json
    from parser import parse_content

    test = "限制你的，不是不会，是你不试"
    parsed = parse_content(test)
    layout = plan_layout(parsed, style="hotblooded")

    print(json.dumps(layout, ensure_ascii=False, indent=2))
