"""
视觉风格配置 - 统一规范
"""

# 画布
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1080

# 配色（固定品牌色）
COLORS = {
    "background": "#0D1117",   # 深蓝灰
    "text": "#F0EDE5",          # 暖米白
    "highlight": "#E85A3C",    # 橙红强调
}

# 字号规范
FONT = {
    "base": 72,           # 普通文字
    "highlight": 96,      # 高亮/重点
    "small": 56,          # 小字（如署名）
}

# 行间距（文字高度的比例）
LINE_SPACING = {
    "tight": 0.4,    # 紧凑
    "normal": 0.5,   # 正常
    "loose": 0.6,    # 宽松
}

# 边距
MARGIN = {
    "left": 100,
    "right": 100,
    "top": 150,
    "bottom": 150,
}

# 图标规范
ICON = {
    "size": 120,          # 统一尺寸
    "size_small": 80,     # 小图标
}

# 竖条装饰
ACCENT_BAR = {
    "width": 6,
    "margin": 24,   # 与文字的间距
}
