#!/usr/bin/env python3
"""只识别本次已证HONOR抖音搜索widget确认框；不操作设备。"""
import re
import sys
import xml.etree.ElementTree as ET

def cancel_center(path, foreground, width, height):
    component = r'com\.hihonor\.android\.launcher/(?:com\.hihonor\.android\.launcher)?\.dragndrop\.AddItemActivity'
    if not re.search(r'(?:^|\s)' + component + r'(?:\}|\s|$)', foreground):
        raise ValueError('foreground')
    nodes = list(ET.parse(path).getroot().iter('node'))
    if any(n.get('package') != 'com.hihonor.android.launcher' for n in nodes):
        raise ValueError('package_or_shape')
    def one(resource, text):
        rows = [n for n in nodes if n.get('resource-id') == resource and n.get('text') == text]
        if len(rows) != 1:
            raise ValueError('identity')
        return rows[0]
    one('android:id/alertTitle', '添加到主屏幕')
    one('com.hihonor.android.launcher:id/widget_name', '抖音搜索')
    add = one('android:id/button1', '添加')
    button = one('android:id/button2', '取消')
    if any(n.get('clickable') == 'true' and n.get('resource-id') not in ('android:id/button1', 'android:id/button2') for n in nodes):
        raise ValueError('unexpected_action')
    if any(sum(n.get('resource-id') == resource for n in nodes) != 1 for resource in ('android:id/button1', 'android:id/button2')):
        raise ValueError('ambiguous_action')
    if button.get('class') != 'android.widget.Button' or button.get('clickable') != 'true' or button.get('enabled') != 'true':
        raise ValueError('cancel_not_actionable')
    m = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', button.get('bounds', ''))
    if not m:
        raise ValueError('bounds')
    x1, y1, x2, y2 = map(int, m.groups())
    if not 0 <= x1 < x2 <= width or not 0 <= y1 < y2 <= height:
        raise ValueError('bounds')
    a = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', add.get('bounds', ''))
    if not a:
        raise ValueError('add_bounds')
    ax1, ay1, ax2, ay2 = map(int, a.groups())
    if not 0 <= ax1 < ax2 <= width or not 0 <= ay1 < ay2 <= height or (x1 < ax2 and ax1 < x2 and y1 < ay2 and ay1 < y2):
        raise ValueError('overlapping_actions')
    return (x1 + x2) // 2, (y1 + y2) // 2

if __name__ == '__main__':
    try:
        print(*cancel_center(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])))
    except (ValueError, ET.ParseError, OSError, IndexError) as error:
        known = {'foreground', 'package_or_shape', 'identity', 'unexpected_action', 'ambiguous_action', 'cancel_not_actionable', 'bounds', 'add_bounds', 'overlapping_actions'}
        reason = str(error) if type(error) is ValueError and str(error) in known else 'evidence_unreadable'
        print('CLIPBOARD_WIDGET_UNVERIFIED:' + reason, file=sys.stderr)
        sys.exit(2)
