#!/usr/bin/env python3
"""
视觉定位 —— 截图 + 一句人话描述 → 屏幕上的像素坐标。

抖音获客链、朋友圈链共用这一份（此前各自内嵌一段 python，改一次要改两处）。

## 为什么是 UI-TARS

原先用 ToAPIs 上的通用视觉模型（gemini-2.5-flash-lite），让它返回 0-1000 归一化 bbox
再算中心点。两个问题：
 1. 0921 晚该模型配额耗尽（429 Resource exhausted），整条获客链的视觉点击全挂；
 2. 通用模型强于读字数数、**弱于像素定位**——这是当初决策 1e8ffaa1 里就写明的取舍。

UI-TARS 是字节专门为 GUI 定位训练的模型，补的正是这块短板。真机实测（两台机、
抖音搜索页与荣耀桌面两种 UI、8 个元素）用官方 prompt 格式**全部命中**，最大偏差 25px。

## 提问方式是死规矩，不能随便改

UI-TARS 是 **GUI agent 模型**，必须按它的 `Thought / Action` 协议提问。
同一张图、同一个元素，随意问（"Output only the coordinate of X"）实测会乱给——
「商品」标签偏了 925 像素；换成官方格式后同一个元素稳定命中。
改 prompt 前先跑 scripts/uitars-probe2.py 对真机截图验一轮，别凭感觉改。
"""
import base64
import json
import os
import re
import sys
import urllib.request

# UI-TARS 官方 agent 协议。改这段等于换一个模型的行为，必须真机验证后再动。
SYSTEM_PROMPT = """You are a GUI agent. You are given a task and a screenshot. \
You need to output the action to complete the task.

## Output Format
Thought: ...
Action: ...

## Action Space
click(start_box='<|box_start|>(x1,y1)<|box_end|>')

## Note
- Use Chinese in Thought part.
- Output only one action.
"""

DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
DEFAULT_MODEL = 'bytedance/ui-tars-1.5-7b'
TIMEOUT_S = 90
# 超过这个大小就转 JPEG 再传。安卓截图 PNG 动辄 3.5MB，base64 后 4.7MB，
# 从国内机器传到境外会 write timeout（M1 实测）。
# **只换编码不改分辨率** —— 坐标必须仍然对应原图，缩放会让所有坐标失真。
MAX_UPLOAD_BYTES = 900_000
JPEG_QUALITY = 85


def build_body(img_b64: str, desc: str, model: str, mime: str = 'image/png') -> dict:
    """组装请求体。描述会被包成一句「点击 X」的指令——UI-TARS 要的是任务不是名词。"""
    return {
        'model': model,
        'max_tokens': 200,
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': [
                {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,' + img_b64}},
                {'type': 'text', 'text': f'## User Instruction\n点击{desc}'},
            ]},
        ],
    }


def parse_xy(text: str):
    """
    从模型输出里取坐标。

    UI-TARS 正常输出形如：
        Thought: 我需要点击「视频」标签
        Action: click(start_box='<|box_start|>(313,347)<|box_end|>')
    取最后一个 (x,y) —— Thought 里偶尔也会出现数字对，动作在后面。
    """
    pairs = re.findall(r'\((\d+)\s*,\s*(\d+)\)', text)
    if not pairs:
        return None
    x, y = pairs[-1]
    return int(x), int(y)


def check_bounds(xy, width: int, height: int):
    """
    坐标护栏：落在屏幕外的一律判失败，绝不拿去点。

    宁可这一步报错让上层走兜底，也不能点到屏幕外或角落——RPA 里一次盲点可能
    触发意料之外的界面，后面每一步都在错的页面上继续错。
    """
    x, y = xy
    return 0 <= x <= width and 0 <= y <= height


def encode_shot(shot_path: str) -> tuple:
    """
    读图并 base64。太大就转 JPEG——**只换编码，绝不缩放**：模型给的是像素坐标，
    分辨率一变所有坐标就错位，而这种错位不会报错，只会让点击悄悄点偏。
    Pillow 缺失时原样上传（宁可慢，不要静默改图）。
    """
    raw = open(shot_path, 'rb').read()
    if len(raw) <= MAX_UPLOAD_BYTES:
        return base64.b64encode(raw).decode(), 'image/png'
    try:
        import io
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert('RGB')
        buf = io.BytesIO()
        im.save(buf, format='JPEG', quality=JPEG_QUALITY)  # 不传 size/resize：分辨率必须原样
        return base64.b64encode(buf.getvalue()).decode(), 'image/jpeg'
    except Exception:  # noqa: BLE001 — 压不了就原样传，别让定位整个失败
        return base64.b64encode(raw).decode(), 'image/png'


def locate(shot_path: str, desc: str, width: int, height: int,
           endpoint: str, model: str, key: str) -> tuple:
    img, mime = encode_shot(shot_path)
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(build_body(img, desc, model, mime)).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    resp = json.load(urllib.request.urlopen(req, timeout=TIMEOUT_S))
    text = resp['choices'][0]['message']['content']
    xy = parse_xy(text)
    if xy is None:
        raise SystemExit(f'locate parse: no coordinate in model output: {text[:120]}')
    if not check_bounds(xy, width, height):
        raise SystemExit(f'locate box out of range: {xy} not in {width}x{height}')
    return xy


def main():
    if len(sys.argv) < 5:
        raise SystemExit('usage: locate-element.py <shot.png> <desc> <screen_w> <screen_h> [keyfile]')
    shot, desc, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]) + 1, int(sys.argv[4]) + 1
    keyfile = sys.argv[5] if len(sys.argv) > 5 else ''
    endpoint = os.environ.get('LOCATE_ENDPOINT', DEFAULT_ENDPOINT)
    model = os.environ.get('LOCATE_MODEL', DEFAULT_MODEL)
    key = os.environ.get('OPENROUTER_API_KEY', '')
    if not key and keyfile and os.path.isfile(keyfile):
        # 凭据文件两种形态都认：整份就是 key（老的 locate-api.key），
        # 或 KEY=VALUE 的 env 形态（~/.credentials/*.env）。调用方不用再自己抠值出来 ——
        # 少一处在 shell 里传递凭据的地方，就少一处泄漏面。
        raw = open(keyfile).read().strip()
        for line in raw.splitlines():
            if line.startswith('OPENROUTER_API_KEY='):
                key = line.split('=', 1)[1].strip()
                break
        else:
            # 没有 KEY= 前缀 → 整份文件就是裸 key（老的 locate-api.key 形态）
            key = raw if '=' not in raw.splitlines()[0] else ''
    if not key:
        raise SystemExit('locate: no api key (OPENROUTER_API_KEY or keyfile)')
    x, y = locate(shot, desc, w, h, endpoint, model, key)
    print(f'{x} {y}')


if __name__ == '__main__':
    main()
