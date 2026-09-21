#!/usr/bin/env python3
"""UI-TARS 官方 prompt 格式的定位探针（对照用，不进运行时路径）"""
import base64
import json
import os
import re
import sys
import time
import urllib.request

SYS = """You are a GUI agent. You are given a task and a screenshot. \
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


def locate(shot_path: str, instruction: str):
    key = os.environ.get('OPENROUTER_API_KEY', '')
    img = base64.b64encode(open(shot_path, 'rb').read()).decode()
    body = {
        'model': os.environ.get('UITARS_MODEL', 'bytedance/ui-tars-1.5-7b'),
        'max_tokens': 200,
        'messages': [
            {'role': 'system', 'content': SYS},
            {'role': 'user', 'content': [
                {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + img}},
                {'type': 'text', 'text': f'## User Instruction\n{instruction}'},
            ]},
        ],
    }
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    t0 = time.time()
    r = json.load(urllib.request.urlopen(req, timeout=90))
    txt = r['choices'][0]['message']['content'].strip()
    m = re.search(r'\((\d+)\s*,\s*(\d+)\)', txt)
    return txt, ((int(m.group(1)), int(m.group(2))) if m else None), time.time() - t0


def main():
    shot, instruction = sys.argv[1], sys.argv[2]
    expect = sys.argv[3] if len(sys.argv) > 3 else None
    try:
        txt, xy, dt = locate(shot, instruction)
    except Exception as e:  # noqa: BLE001
        print(f'{instruction:<18} → 失败 {type(e).__name__}: {str(e)[:70]}')
        return
    if not xy:
        print(f'{instruction:<18} → 解析失败: {txt[:80]}')
        return
    verdict = ''
    if expect:
        nums = [int(n) for n in re.findall(r'-?\d+', expect)]
        if len(nums) == 4:
            x1, y1, x2, y2 = nums
            inside = x1 <= xy[0] <= x2 and y1 <= xy[1] <= y2
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            verdict = f" | 框内={'✓' if inside else '✗'} 距中心 {abs(xy[0]-cx)},{abs(xy[1]-cy)}px"
    print(f'{instruction:<18} → {xy} | {dt:.1f}s{verdict}')


if __name__ == '__main__':
    main()
