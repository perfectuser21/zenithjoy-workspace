#!/usr/bin/env python3
"""Read a unique native search category tab; never treat filter chips as tabs."""
import base64
import re
import sys
import xml.etree.ElementTree as ET

PACKAGE = 'com.ss.android.ugc.aweme'
TAB = 'androidx.appcompat.app.ActionBar$Tab'
CATEGORIES = {'综合', '视频', '图文', '用户', '商品', '直播', '音乐', '话题', '地点'}


def need(value, reason):
    if not value:
        raise ValueError(reason)


def bounds(node):
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
    need(match, 'invalid tab bounds')
    box = tuple(map(int, match.groups()))
    need(box[2] > box[0] and box[3] > box[1], 'empty tab bounds')
    return box


def contains(outer, inner):
    return outer[0] <= inner[0] < inner[2] <= outer[2] and outer[1] <= inner[1] < inner[3] <= outer[3]


def read_tab(path, expected_query=''):
    root = ET.parse(path).getroot()
    need(root.tag == 'hierarchy', 'not a UI hierarchy')
    parents = {child: parent for parent in root.iter() for child in parent}
    queries = [n for n in root.iter('node') if n.get('resource-id') == PACKAGE + ':id/et_search_kw']
    need(len(queries) == 1, 'search query missing or ambiguous')
    query = queries[0]
    need(query.get('package') == PACKAGE and query.get('class') == 'android.widget.EditText'
         and query.get('enabled') == 'true' and query.get('text', '').strip(), 'invalid search query')
    token = base64.urlsafe_b64encode(query.get('text').encode()).decode()
    need(not expected_query or token == expected_query, 'search query changed')
    window = query
    while parents.get(window) is not root:
        window = parents[window]
    need(window.get('package') == PACKAGE, 'wrong search window')
    window_box = bounds(window)
    need(contains(window_box, bounds(query)), 'search query outside window')
    labels = [n for n in root.iter('node') if n.get('text') == '视频' and n.get('resource-id') == 'android:id/text1']
    need(len(labels) == 1, 'video tab missing or ambiguous')
    target = labels[0]
    tab = parents.get(target)
    row = parents.get(tab)
    need(tab is not None and row is not None and tab.get('class') == TAB
         and row.get('class') == 'android.widget.HorizontalScrollView', 'invalid category tab structure')
    need(row in set(window.iter()), 'category tab in another window')
    need(row.get('package') == PACKAGE and row.get('enabled') == 'true', 'invalid category row')
    row_box = bounds(row)
    need(contains(window_box, row_box), 'category row outside window')
    names, selected = [], []
    for parent in row:
        need(parent.get('class') == TAB and parent.get('package') == PACKAGE
             and parent.get('enabled') == 'true', 'invalid category parent')
        children = list(parent)
        need(len(children) == 1, 'ambiguous category label')
        label = children[0]
        name = label.get('text')
        need(name in CATEGORIES and label.get('package') == PACKAGE
             and label.get('resource-id') == 'android:id/text1'
             and label.get('class') == 'android.widget.Button'
             and label.get('enabled') == 'true', 'invalid category label')
        parent_box, label_box = bounds(parent), bounds(label)
        need(contains(row_box, parent_box) and contains(parent_box, label_box), 'category outside container')
        state = label.get('selected')
        need(state in ('true', 'false') and parent.get('selected') == state, 'conflicting category selected state')
        names.append(name)
        if state == 'true':
            selected.append(name)
    need(len(names) == len(set(names)) and len(names) >= 3
         and {'综合', '视频'}.issubset(names), 'search categories missing or ambiguous')
    need(len(selected) == 1, 'category selected state missing or ambiguous')
    box = bounds(target)
    return (box[0] + box[2]) // 2, (box[1] + box[3]) // 2, int(selected[0] == '视频'), token


if __name__ == '__main__':
    try:
        print(*read_tab(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ''))
    except (ValueError, ET.ParseError, OSError, KeyError, IndexError) as error:
        print('search_video_tab_invalid=' + str(error), file=sys.stderr)
        sys.exit(2)
