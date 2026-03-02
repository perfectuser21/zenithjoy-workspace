#!/usr/bin/env python3
"""
智能金句卡片生成器
分析文案内容 → 选择图标 → 设计布局 → 渲染输出

用法:
    python smart-card-generator.py "一人公司最大的资产，不是钱，是自由。"
    python smart-card-generator.py "你不是做不到，是你不敢开始" --layout right
"""

import argparse
import json
import os
import random
import re
import subprocess
import sys
from datetime import datetime

# 路径配置
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ICONS_DIR = os.path.join(PROJECT_DIR, "assets", "icons")
OUTPUT_DIR = os.path.join(PROJECT_DIR, "assets", "cards")
RENDERER = os.path.join(SCRIPT_DIR, "card-renderer.py")

# 品牌配色
COLORS = {
    "background": "#0D1117",
    "text": "#F0EDE5",
    "highlight": "#E85A3C",
}

# 图标语义映射
ICON_SEMANTICS = {
    # 自由/飞翔
    "bird": ["自由", "飞", "翱翔", "解放", "无拘", "自在", "独立"],
    # 行动/开始
    "rocket": ["开始", "启动", "行动", "出发", "起飞", "冲", "干", "做"],
    # 激情/勇气
    "fire": ["热情", "激情", "燃烧", "勇气", "热血", "斗志", "拼"],
    # 目标/专注
    "target": ["目标", "专注", "瞄准", "精准", "聚焦", "方向"],
    # 速度/效率
    "lightning": ["快", "效率", "速度", "迅速", "闪电", "立刻", "马上"],
    # 爱/热爱
    "heart": ["爱", "热爱", "喜欢", "心", "感情", "情感"],
    # 成功/闪耀
    "star": ["成功", "闪耀", "出众", "优秀", "明星", "卓越"],
    # 成长/上升
    "arrow-up": ["成长", "上升", "提升", "进步", "增长", "向上"],
    # 方向/探索
    "compass": ["方向", "探索", "寻找", "迷茫", "指引", "路"],
    # 想法/灵感
    "lightbulb": ["想法", "灵感", "创意", "思考", "点子", "顿悟"],
    # 攀登/挑战
    "mountain": ["山", "攀登", "挑战", "困难", "高峰", "顶峰"],
    # 奔跑/努力
    "run": ["跑", "奔跑", "努力", "坚持", "追", "赶"],
    # 胜利/奖励
    "trophy": ["胜利", "赢", "奖", "冠军", "第一", "成就"],
    # 关键/重要
    "key": ["关键", "重要", "核心", "秘密", "钥匙", "答案"],
    # 机会/新生
    "door": ["门", "机会", "新", "开始", "进入", "通往"],
}


def analyze_content(text):
    """
    分析文案内容，返回:
    - lines: 分行后的文字
    - highlight_line: 需要高亮的行索引
    - icon: 推荐的图标
    - emotion: 情绪类型 (驱动型/理念型/情感型)
    """
    # 分行处理
    # 支持多种分隔符：逗号、句号、换行、顿号
    text = text.strip()

    # 先按换行分
    if "\n" in text:
        lines = [l.strip() for l in text.split("\n") if l.strip()]
    else:
        # 智能断句
        # 1. 先替换中文标点为分隔符
        temp = text
        for punct in ["，", "。", "；", "！", "？", "、"]:
            temp = temp.replace(punct, "|||")
        parts = [p.strip() for p in temp.split("|||") if p.strip()]

        # 2. 合并过短的部分
        lines = []
        buffer = ""
        for p in parts:
            if len(buffer) + len(p) < 12:  # 太短就合并
                buffer += p
            else:
                if buffer:
                    lines.append(buffer)
                buffer = p
        if buffer:
            lines.append(buffer)

    # 找高亮行（通常是最后一行，或包含"是"、"就是"的转折行）
    highlight_idx = len(lines) - 1
    for i, line in enumerate(lines):
        if line.startswith("是") or line.startswith("就是") or "而是" in line:
            highlight_idx = i
            break

    # 匹配图标
    best_icon = None
    best_score = 0
    for icon, keywords in ICON_SEMANTICS.items():
        score = sum(1 for kw in keywords if kw in text)
        if score > best_score:
            best_score = score
            best_icon = icon

    # 默认图标
    if not best_icon:
        best_icon = random.choice(["star", "lightbulb", "compass"])

    # 判断情绪类型
    emotion = "理念型"
    action_words = ["别", "不要", "赶紧", "马上", "去", "做", "干", "试", "开始"]
    feeling_words = ["爱", "心", "感", "情", "痛", "苦", "乐", "喜"]

    if any(w in text for w in action_words):
        emotion = "驱动型"
    elif any(w in text for w in feeling_words):
        emotion = "情感型"

    return {
        "lines": lines,
        "highlight_line": highlight_idx,
        "icon": best_icon,
        "emotion": emotion,
    }


def generate_layout(analysis, layout_mode="auto"):
    """
    根据分析结果生成 JSON 布局

    layout_mode:
    - auto: 自动选择
    - left: 左对齐（默认）
    - right: 右对齐
    - center: 居中
    - bottom: 底部
    """
    lines = analysis["lines"]
    highlight_idx = analysis["highlight_line"]
    icon = analysis["icon"]

    # 自动选择布局
    if layout_mode == "auto":
        # 驱动型文案用居中或右对齐更有冲击力
        if analysis["emotion"] == "驱动型":
            layout_mode = random.choice(["center", "right"])
        else:
            layout_mode = random.choice(["left", "left", "right"])  # 左对齐概率更高

    # 画布配置
    layout = {
        "canvas": {
            "width": 1080,
            "height": 1080,
            "background": COLORS["background"],
        },
        "elements": []
    }

    # 根据布局模式计算位置
    if layout_mode == "left":
        layout["elements"] = _layout_left(lines, highlight_idx, icon)
    elif layout_mode == "right":
        layout["elements"] = _layout_right(lines, highlight_idx, icon)
    elif layout_mode == "center":
        layout["elements"] = _layout_center(lines, highlight_idx, icon)
    elif layout_mode == "bottom":
        layout["elements"] = _layout_bottom(lines, highlight_idx, icon)

    return layout


def _layout_left(lines, highlight_idx, icon):
    """左对齐布局（经典款）"""
    elements = []

    # 竖线装饰
    text_start_y = 400 - len(lines) * 40
    elements.append({
        "type": "rect",
        "x": 120,
        "y": text_start_y - 10,
        "width": 5,
        "height": len(lines) * 90 + 30,
        "color": COLORS["highlight"],
    })

    # 文字
    y = text_start_y
    for i, line in enumerate(lines):
        is_highlight = (i == highlight_idx)
        elements.append({
            "type": "text",
            "content": line,
            "x": 150,
            "y": y,
            "font_size": 80 if is_highlight else 64,
            "color": COLORS["highlight"] if is_highlight else COLORS["text"],
            "align": "left",
        })
        y += 100 if is_highlight else 85

    # 图标（右上角）
    icon_path = os.path.join(ICONS_DIR, f"{icon}.png")
    if os.path.exists(icon_path):
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": 820,
            "y": 160,
            "width": 140,
            "height": 140,
        })

    return elements


def _layout_right(lines, highlight_idx, icon):
    """右对齐布局"""
    elements = []

    # 竖线装饰（右侧）
    text_start_y = 400 - len(lines) * 40
    elements.append({
        "type": "rect",
        "x": 955,
        "y": text_start_y - 10,
        "width": 5,
        "height": len(lines) * 90 + 30,
        "color": COLORS["highlight"],
    })

    # 文字
    y = text_start_y
    for i, line in enumerate(lines):
        is_highlight = (i == highlight_idx)
        elements.append({
            "type": "text",
            "content": line,
            "x": 930,
            "y": y,
            "font_size": 80 if is_highlight else 64,
            "color": COLORS["highlight"] if is_highlight else COLORS["text"],
            "align": "right",
        })
        y += 100 if is_highlight else 85

    # 图标（左上角）
    icon_path = os.path.join(ICONS_DIR, f"{icon}.png")
    if os.path.exists(icon_path):
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": 120,
            "y": 160,
            "width": 140,
            "height": 140,
        })

    return elements


def _layout_center(lines, highlight_idx, icon):
    """居中布局（更有冲击力）"""
    elements = []

    # 文字居中
    y = 380 - len(lines) * 30
    for i, line in enumerate(lines):
        is_highlight = (i == highlight_idx)
        elements.append({
            "type": "text",
            "content": line,
            "x": 540,
            "y": y,
            "font_size": 88 if is_highlight else 64,
            "color": COLORS["highlight"] if is_highlight else COLORS["text"],
            "align": "center",
        })
        y += 110 if is_highlight else 90

    # 图标（底部居中）
    icon_path = os.path.join(ICONS_DIR, f"{icon}.png")
    if os.path.exists(icon_path):
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": 470,
            "y": y + 60,
            "width": 140,
            "height": 140,
        })

    return elements


def _layout_bottom(lines, highlight_idx, icon):
    """底部布局（图标在上）"""
    elements = []

    # 图标（顶部居中）
    icon_path = os.path.join(ICONS_DIR, f"{icon}.png")
    if os.path.exists(icon_path):
        elements.append({
            "type": "image",
            "path": icon_path,
            "x": 470,
            "y": 200,
            "width": 140,
            "height": 140,
        })

    # 文字（底部）
    y = 500
    for i, line in enumerate(lines):
        is_highlight = (i == highlight_idx)
        elements.append({
            "type": "text",
            "content": line,
            "x": 540,
            "y": y,
            "font_size": 80 if is_highlight else 64,
            "color": COLORS["highlight"] if is_highlight else COLORS["text"],
            "align": "center",
        })
        y += 100 if is_highlight else 85

    return elements


def render_card(layout, output_path=None):
    """调用 card-renderer.py 渲染"""
    # 保存临时 JSON
    temp_json = "/tmp/card-layout.json"
    with open(temp_json, "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, indent=2)

    # 调用渲染器
    cmd = ["python3", RENDERER, temp_json]
    if output_path:
        cmd.extend(["--output", output_path])

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode == 0:
        # 提取输出路径
        output = result.stdout.strip()
        if "已生成:" in output:
            return output.split("已生成:")[-1].strip()

    print(f"渲染失败: {result.stderr}")
    return None


def main():
    parser = argparse.ArgumentParser(description="智能金句卡片生成器")
    parser.add_argument("text", help="金句文案")
    parser.add_argument("--layout", "-l", choices=["auto", "left", "right", "center", "bottom"],
                        default="auto", help="布局模式")
    parser.add_argument("--output", "-o", help="输出文件路径")
    parser.add_argument("--debug", action="store_true", help="显示分析结果")

    args = parser.parse_args()

    # 分析内容
    analysis = analyze_content(args.text)

    if args.debug:
        print("📊 内容分析:")
        print(f"   分行: {analysis['lines']}")
        print(f"   高亮行: {analysis['highlight_line']}")
        print(f"   推荐图标: {analysis['icon']}")
        print(f"   情绪类型: {analysis['emotion']}")
        print()

    # 生成布局
    layout = generate_layout(analysis, args.layout)

    if args.debug:
        print("📐 布局配置:")
        print(json.dumps(layout, ensure_ascii=False, indent=2))
        print()

    # 渲染
    output = render_card(layout, args.output)
    if output:
        print(f"✅ 卡片已生成: {output}")
    else:
        print("❌ 生成失败")


if __name__ == "__main__":
    main()
