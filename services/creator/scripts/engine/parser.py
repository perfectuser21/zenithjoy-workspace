"""
Step 1: 内容语义解析器
把金句变成结构化语义数据

输出结构:
{
    "type": "转折型|递进型|对比型|单句型",
    "mood": "鼓励|警醒|温暖|热血|理性",
    "lines": [
        {"text": "xxx", "role": "铺垫|否定|转折|强调|结论", "highlight": bool}
    ],
    "keywords": ["关键词"],
    "icon_suggestion": ["icon_name"]
}
"""

import re

# 句型模式识别
SENTENCE_PATTERNS = {
    "转折型": [
        r"不是.+[,，].*(而是|是).+",
        r".+不是.+[,，].*是.+",
        r"限制.+不是.+是.+",
    ],
    "递进型": [
        r".+不仅.+更.+",
        r".+不只.+还.+",
    ],
    "对比型": [
        r".+vs.+",
        r".+而不是.+",
    ],
    "单句型": [
        r".{4,20}$",  # 短句
    ],
}

# 情绪词库
MOOD_KEYWORDS = {
    "热血": ["冲", "干", "拼", "试", "开始", "行动", "勇", "敢", "突破"],
    "鼓励": ["可以", "能", "会", "成功", "赢", "相信", "坚持"],
    "警醒": ["别", "不要", "小心", "限制", "困", "卡", "怕", "失败"],
    "温暖": ["爱", "心", "陪", "温", "暖", "感"],
    "理性": ["思考", "分析", "逻辑", "方法", "策略"],
}

# 角色识别关键词
ROLE_MARKERS = {
    "否定": ["不是", "不会", "不能", "没有"],
    "转折": ["而是", "是你", "就是", "才是", "其实是"],
    "强调": ["最", "真正", "唯一", "关键"],
}

# 图标语义映射
ICON_KEYWORDS = {
    "rocket": ["开始", "启动", "行动", "出发", "干", "做", "试", "尝试", "冲"],
    "fire": ["热情", "激情", "燃烧", "勇气", "热血", "拼", "斗志"],
    "bird": ["自由", "飞", "翱翔", "解放", "独立"],
    "mountain": ["挑战", "攀登", "困难", "成长", "突破", "高峰"],
    "target": ["目标", "专注", "聚焦", "方向", "计划"],
    "heart": ["爱", "热爱", "喜欢", "梦想", "心"],
    "trophy": ["成功", "赢", "胜利", "冠军", "成就"],
    "arrow-up": ["转折", "上升", "提升", "进步", "变化", "翻盘"],
    "lightning": ["快", "效率", "速度", "立刻", "马上"],
    "lightbulb": ["想法", "灵感", "创意", "思考", "点子"],
}


def parse_content(text):
    """
    解析金句内容，返回结构化语义数据
    """
    text = text.strip()
    result = {
        "original": text,
        "type": "单句型",
        "mood": "理性",
        "lines": [],
        "keywords": [],
        "icon_suggestion": [],
    }

    # 1. 识别句型
    for pattern_type, patterns in SENTENCE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text):
                result["type"] = pattern_type
                break
        if result["type"] != "单句型":
            break

    # 2. 识别情绪
    mood_scores = {mood: 0 for mood in MOOD_KEYWORDS}
    for mood, keywords in MOOD_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                mood_scores[mood] += 1

    best_mood = max(mood_scores, key=mood_scores.get)
    if mood_scores[best_mood] > 0:
        result["mood"] = best_mood

    # 3. 智能分行 + 角色识别
    lines = _split_lines(text)
    result["lines"] = _identify_roles(lines, result["type"])

    # 4. 提取关键词（高亮行的核心词）
    for line in result["lines"]:
        if line.get("highlight"):
            # 提取 2-4 字的词
            words = re.findall(r'[\u4e00-\u9fa5]{2,4}', line["text"])
            result["keywords"].extend(words[-2:] if len(words) > 2 else words)

    # 5. 推荐图标
    result["icon_suggestion"] = _suggest_icons(text, result["keywords"])

    return result


def _split_lines(text):
    """
    智能分行 - 节奏感拆分
    核心：把强调词单独拆出来
    """
    # 先按换行分
    if "\n" in text:
        return [l.strip() for l in text.split("\n") if l.strip()]

    # 按标点分
    temp = text
    for punct in ["，", "。", "；", "！", "？"]:
        temp = temp.replace(punct, "|||")

    parts = [p.strip() for p in temp.split("|||") if p.strip()]

    # 进一步拆分：把转折句的核心词单独拆出
    lines = []
    for p in parts:
        # 检测 "是你不X" 模式 → 拆成 "是你" + "不X"
        if p.startswith("是你") and len(p) > 2:
            lines.append("是你")
            lines.append(p[2:])  # "不试" / "不敢" 等
        # 检测 "而是X" 模式 → 拆成 "而是" + "X"
        elif p.startswith("而是") and len(p) > 4:
            lines.append("而是")
            lines.append(p[2:])
        # 检测 "就是X" 模式
        elif p.startswith("就是") and len(p) > 4:
            lines.append("就是")
            lines.append(p[2:])
        else:
            lines.append(p)

    return lines


def _identify_roles(lines, sentence_type):
    """
    识别每行的角色（起承转合）
    - 起：开场铺垫
    - 承：延续/否定
    - 转：转折点
    - 合：落点/强调（最大最突出）
    """
    result = []
    n = len(lines)

    # 按位置和内容分配角色
    for i, line in enumerate(lines):
        role = "起"  # 默认
        highlight = False

        # 最后一行通常是落点（最强调）
        if i == n - 1:
            role = "合"
            highlight = True
        # 倒数第二行如果是转折词
        elif i == n - 2 and line in ["是你", "而是", "就是", "才是"]:
            role = "转"
        # 包含否定词
        elif any(w in line for w in ["不是", "不会", "不能", "没有"]):
            role = "承"
        # 第一行
        elif i == 0:
            role = "起"

        result.append({
            "text": line,
            "role": role,
            "highlight": highlight,
        })

    return result


def _suggest_icons(text, keywords):
    """推荐图标"""
    scores = {icon: 0 for icon in ICON_KEYWORDS}

    # 全文匹配
    for icon, kws in ICON_KEYWORDS.items():
        for kw in kws:
            if kw in text:
                scores[icon] += 1

    # 关键词加权
    for icon, kws in ICON_KEYWORDS.items():
        for kw in kws:
            if any(kw in keyword for keyword in keywords):
                scores[icon] += 2

    # 返回得分最高的 1-2 个
    sorted_icons = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    suggestions = [icon for icon, score in sorted_icons[:2] if score > 0]

    return suggestions if suggestions else ["lightbulb"]


if __name__ == "__main__":
    # 测试
    import json

    test_cases = [
        "限制你的，不是不会，是你不试",
        "成功的人不是赢在起点，而是赢在转折点",
        "热爱可抵岁月漫长",
        "你不是做不到，是你不敢开始",
    ]

    for text in test_cases:
        result = parse_content(text)
        print(f"\n📝 {text}")
        print(json.dumps(result, ensure_ascii=False, indent=2))
