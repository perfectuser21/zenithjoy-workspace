"""
图标语义映射 - 精简版（8个核心图标）
"""

import os

ICONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                         "..", "assets", "icons")

# 核心图标（8个，风格统一）
CORE_ICONS = {
    "bird": {
        "keywords": ["自由", "飞", "翱翔", "解放", "独立", "自在"],
        "meaning": "自由",
    },
    "rocket": {
        "keywords": ["开始", "启动", "行动", "出发", "起飞", "冲", "干"],
        "meaning": "行动",
    },
    "fire": {
        "keywords": ["热情", "激情", "燃烧", "勇气", "热血", "拼", "斗志"],
        "meaning": "激情",
    },
    "mountain": {
        "keywords": ["挑战", "攀登", "困难", "成长", "高峰", "突破"],
        "meaning": "挑战",
    },
    "target": {
        "keywords": ["目标", "专注", "聚焦", "方向", "瞄准", "计划"],
        "meaning": "目标",
    },
    "heart": {
        "keywords": ["爱", "热爱", "喜欢", "心", "梦想", "passion"],
        "meaning": "热爱",
    },
    "trophy": {
        "keywords": ["成功", "赢", "胜利", "冠军", "成就", "第一"],
        "meaning": "成功",
    },
    "arrow-up": {
        "keywords": ["转折", "上升", "提升", "进步", "变化", "转变", "翻盘"],
        "meaning": "转折",
    },
}


def match_icon(text):
    """
    根据文本匹配最合适的图标
    返回: (icon_name, icon_path) 或 None
    """
    best_icon = None
    best_score = 0

    for icon_name, config in CORE_ICONS.items():
        score = sum(1 for kw in config["keywords"] if kw in text)
        if score > best_score:
            best_score = score
            best_icon = icon_name

    if best_icon:
        icon_path = os.path.join(ICONS_DIR, f"{best_icon}.png")
        if os.path.exists(icon_path):
            return best_icon, icon_path

    return None, None


def get_icon_path(icon_name):
    """获取图标路径"""
    path = os.path.join(ICONS_DIR, f"{icon_name}.png")
    return path if os.path.exists(path) else None
