"""
构图引擎 - 不是布局，是视觉表达

核心理念：
- 构图是"势能分布"，不是"坐标放置"
- 每句话有阅读顺序，有节奏，有落点
- 图标是"视觉动词"，参与表达

构图风格：
1. 收敛型：上面分散，底部收拢到落点
2. 对话型：左右交替，像对话一样
3. 瀑布型：从上到下，越来越大
4. 爆发型：四周散开，中心最大
"""

import os

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1080
ICONS_DIR = "/home/xx/dev/zenithjoy-creator/assets/icons"

COLORS = {
    "background": "#0D1117",
    "text": "#F0EDE5",
    "highlight": "#E85A3C",
}


def compose(parsed_content, style="convergent"):
    """
    根据内容生成构图

    style:
    - convergent: 收敛型（推荐，落点居中最大）
    - dialogue: 对话型（左右交替）
    - waterfall: 瀑布型（从上到下渐大）
    """
    lines = parsed_content["lines"]
    icons = parsed_content.get("icon_suggestion", [])

    if style == "convergent":
        return _compose_convergent(lines, icons)
    elif style == "dialogue":
        return _compose_dialogue(lines, icons)
    else:
        return _compose_convergent(lines, icons)


def _compose_convergent(lines, icons):
    """
    收敛型构图
    - 前几行在上方，左右错落
    - 最后一行（落点）在底部居中，超大
    - 所有视觉都"收"向落点
    - 图标在落点附近强化语义
    """
    layout = {
        "style": "convergent",
        "canvas": {
            "width": CANVAS_WIDTH,
            "height": CANVAS_HEIGHT,
            "background": COLORS["background"],
        },
        "blocks": [],
        "icons": [],
    }

    n = len(lines)
    if n == 0:
        return layout

    # === 字号策略 ===
    # 落点最大，其他行相对小
    punch_size = 140  # 落点
    normal_size = 56  # 铺垫
    transition_size = 64  # 转折

    # === 构图计算 ===
    # 画布分区：上部 60% 放铺垫，下部 40% 放落点
    upper_zone = CANVAS_HEIGHT * 0.55
    lower_zone_start = CANVAS_HEIGHT * 0.58

    # 铺垫行（除最后一行）
    setup_lines = lines[:-1] if n > 1 else []
    punch_line = lines[-1]

    # === 铺垫行布局 ===
    if setup_lines:
        setup_height = len(setup_lines) * (normal_size + 30)
        setup_start_y = (upper_zone - setup_height) / 2 + 80

        y = setup_start_y
        for i, line in enumerate(setup_lines):
            role = line["role"]

            # 交替对齐，但不要太散
            if role == "承" or i % 2 == 1:
                # 右对齐，但不要太靠边
                x = CANVAS_WIDTH - 180
                align = "right"
            else:
                # 左对齐
                x = 150
                align = "left"

            # 转折行稍大
            fs = transition_size if role == "转" else normal_size
            color = COLORS["highlight"] if role == "转" else COLORS["text"]

            layout["blocks"].append({
                "text": line["text"],
                "x": x,
                "y": int(y),
                "font_size": fs,
                "color": color,
                "align": align,
                "role": role,
            })

            y += fs + 35

    # === 落点行布局 ===
    # 居中，超大，橙色
    punch_y = lower_zone_start + 60
    layout["blocks"].append({
        "text": punch_line["text"],
        "x": CANVAS_WIDTH // 2,
        "y": int(punch_y),
        "font_size": punch_size,
        "color": COLORS["highlight"],
        "align": "center",
        "role": "合",
    })

    # === 图标布局 ===
    # 图标在落点上方，作为"引导"和"语义强化"
    if icons:
        icon_name = icons[0]
        icon_path = os.path.join(ICONS_DIR, f"{icon_name}.png")

        if os.path.exists(icon_path):
            icon_size = 70

            # 图标在落点正上方偏左
            icon_x = CANVAS_WIDTH // 2 - punch_size - icon_size // 2
            icon_y = punch_y - 20

            # 或者如果有转折行，放在转折行旁边
            for block in layout["blocks"]:
                if block["role"] == "转":
                    if block["align"] == "left":
                        # 转折行在左，图标放右边
                        icon_x = block["x"] + len(block["text"]) * block["font_size"] * 0.5 + 20
                    else:
                        # 转折行在右，图标放左边
                        icon_x = block["x"] - len(block["text"]) * block["font_size"] * 0.5 - icon_size - 20
                    icon_y = block["y"]
                    break

            icon_x = max(80, min(icon_x, CANVAS_WIDTH - 80 - icon_size))
            icon_y = max(80, min(icon_y, CANVAS_HEIGHT - 150))

            layout["icons"].append({
                "name": icon_name,
                "path": icon_path,
                "x": int(icon_x),
                "y": int(icon_y),
                "size": icon_size,
            })

    return layout


def _compose_dialogue(lines, icons):
    """
    对话型构图
    - 像两个人对话一样
    - 左右交替，但保持整齐
    - 落点在最后，居中收尾
    """
    layout = {
        "style": "dialogue",
        "canvas": {
            "width": CANVAS_WIDTH,
            "height": CANVAS_HEIGHT,
            "background": COLORS["background"],
        },
        "blocks": [],
        "icons": [],
    }

    n = len(lines)
    if n == 0:
        return layout

    # 字号
    normal_size = 60
    punch_size = 110

    # 计算总高度
    heights = []
    for i, line in enumerate(lines):
        if i == n - 1:
            heights.append(punch_size + 50)
        else:
            heights.append(normal_size + 40)

    total_height = sum(heights)
    start_y = (CANVAS_HEIGHT - total_height) // 2

    y = start_y
    for i, line in enumerate(lines):
        is_punch = (i == n - 1)

        if is_punch:
            # 落点居中
            layout["blocks"].append({
                "text": line["text"],
                "x": CANVAS_WIDTH // 2,
                "y": int(y),
                "font_size": punch_size,
                "color": COLORS["highlight"],
                "align": "center",
                "role": line["role"],
            })
        else:
            # 交替左右
            if i % 2 == 0:
                x, align = 180, "left"
            else:
                x, align = CANVAS_WIDTH - 180, "right"

            color = COLORS["highlight"] if line["role"] == "转" else COLORS["text"]

            layout["blocks"].append({
                "text": line["text"],
                "x": x,
                "y": int(y),
                "font_size": normal_size,
                "color": color,
                "align": align,
                "role": line["role"],
            })

        y += heights[i]

    # 图标在右上角
    if icons:
        icon_name = icons[0]
        icon_path = os.path.join(ICONS_DIR, f"{icon_name}.png")
        if os.path.exists(icon_path):
            layout["icons"].append({
                "name": icon_name,
                "path": icon_path,
                "x": CANVAS_WIDTH - 180,
                "y": 120,
                "size": 80,
            })

    return layout


if __name__ == "__main__":
    import json
    from parser import parse_content

    test = "限制你的，不是不会，是你不试"
    parsed = parse_content(test)
    layout = compose(parsed, style="convergent")
    print(json.dumps(layout, ensure_ascii=False, indent=2))
