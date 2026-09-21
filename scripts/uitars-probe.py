#!/usr/bin/env python3
"""
UI-TARS 视觉定位探针 —— 换模型前的真机验证工具

为什么要有它：换视觉定位模型不能只测一个元素就上线（真机 RPA 上拿一两个样本代表
一整类，是我们反复栽过的坑）。这个探针对同一张真机截图问多个元素、对不同分辨率的
机器各问一遍，把「模型给的坐标有没有落在无障碍树报的 bounds 里」量化出来。

用法：
  uitars-probe.py <截图.png> <元素描述> [期望bounds "[x1,y1][x2,y2]"]
输出一行：描述 → 解析坐标 | 耗时 | 是否落在期望框内 + 距中心偏差
"""
import base64
import json
import os
import re
import sys
import time
import urllib.request

ENDPOINT = os.environ.get('UITARS_ENDPOINT', 'https://openrouter.ai/api/v1/chat/completions')
MODEL = os.environ.get('UITARS_MODEL', 'bytedance/ui-tars-1.5-7b')


def locate(shot_path: str, desc: str):
    key = os.environ.get('OPENROUTER_API_KEY', '')
    if not key:
        raise SystemExit('缺 OPENROUTER_API_KEY')
    img = base64.b64encode(open(shot_path, 'rb').read()).decode()
    body = {
        'model': MODEL,
        'max_tokens': 64,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + img}},
                {'type': 'text', 'text': f"Output only the coordinate of 『{desc}』 in the format (x,y)."},
            ],
        }],
    }
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    t0 = time.time()
    r = json.load(urllib.request.urlopen(req, timeout=90))
    txt = r['choices'][0]['message']['content'].strip()
    m = re.search(r'\((\d+)\s*,\s*(\d+)\)', txt)
    return txt, ((int(m.group(1)), int(m.group(2))) if m else None), time.time() - t0


def main():
    shot, desc = sys.argv[1], sys.argv[2]
    expect = sys.argv[3] if len(sys.argv) > 3 else None
    try:
        txt, xy, dt = locate(shot, desc)
    except Exception as e:  # noqa: BLE001 — 探针要把任何失败原样报出来
        print(f'{desc:<18} → 失败 {type(e).__name__}: {str(e)[:70]}')
        return
    if not xy:
        print(f'{desc:<18} → 解析失败，原始输出: {txt[:60]}')
        return
    verdict = ''
    if expect:
        nums = [int(n) for n in re.findall(r'-?\d+', expect)]
        if len(nums) == 4:
            x1, y1, x2, y2 = nums
            inside = x1 <= xy[0] <= x2 and y1 <= xy[1] <= y2
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            verdict = f" | 框内={'✓' if inside else '✗'} 距中心 {abs(xy[0]-cx)},{abs(xy[1]-cy)}px"
    print(f'{desc:<18} → {xy} | {dt:.1f}s{verdict}')


if __name__ == '__main__':
    main()
