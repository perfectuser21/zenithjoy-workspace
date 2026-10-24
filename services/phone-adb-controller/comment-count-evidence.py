#!/usr/bin/env python3
"""只读评论按钮三态；0=严格正数，1=已证零占位，2=未知。"""
import re
import sys
import xml.etree.ElementTree as ET


def label(raw):
    if len(raw) > 10 * 1024 * 1024 or '<!DOCTYPE' in raw or '<!ENTITY' in raw:
        raise ValueError('xml_invalid')
    root = ET.fromstring(raw)
    if root.tag != 'hierarchy':
        raise ValueError('xml_invalid')
    nodes = list(root.iter('node'))
    if not nodes or any(n.get('package') not in ('', 'com.ss.android.ugc.aweme') for n in nodes):
        raise ValueError('package_invalid')
    buttons = [n for n in nodes if n.get('clickable') == 'true' and n.get('content-desc', '').startswith('评论')]
    if len(buttons) != 1:
        raise ValueError('comment_button_unknown')
    button = buttons[0]
    if button.get('package') != 'com.ss.android.ugc.aweme' or button.get('enabled') != 'true':
        raise ValueError('comment_button_unknown')
    bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', button.get('bounds', ''))
    if not bounds or int(bounds[3]) <= int(bounds[1]) or int(bounds[4]) <= int(bounds[2]):
        raise ValueError('comment_bounds_unknown')
    desc = button.get('content-desc')
    if desc == '评论评论，按钮':
        return None
    match = re.fullmatch(r'评论([1-9]\d*|(?:[1-9]\d*(?:\.\d+)?|0\.0*[1-9]\d*)万)，按钮', desc)
    if not match:
        raise ValueError('comment_count_unknown')
    return match[1]


if __name__ == '__main__':
    try:
        with open(sys.argv[1], encoding='utf8') as source:
            value = label(source.read(10 * 1024 * 1024 + 1))
        if value is None:
            sys.exit(1)
        print(value)
    except (ValueError, OSError, ET.ParseError, IndexError) as error:
        reason = str(error)
        allowed = {'xml_invalid', 'package_invalid', 'comment_button_unknown', 'comment_bounds_unknown', 'comment_count_unknown'}
        print('COMMENT_COUNT_UNKNOWN:' + (reason if reason in allowed else 'xml_unreadable'), file=sys.stderr)
        sys.exit(2)
