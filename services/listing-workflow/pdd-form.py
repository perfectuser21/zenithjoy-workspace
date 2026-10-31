import json
import re
import sys
import xml.etree.ElementTree as ET


def resolve(data):
    unknown = lambda reasons: {'status': 'unknown', 'requiresVisualReview': True, 'anchors': {}, 'reasons': reasons}
    xml = data.get('xml', '')
    width, height = data.get('width'), data.get('height')
    if not isinstance(xml, str) or len(xml) > 4_000_000 or '<!' in xml or not all(type(n) is int and 0 < n <= 16384 for n in [width, height]):
        return unknown(['INVALID_UI_INPUT'])
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return unknown(['INVALID_UI_XML'])
    nodes = list(root.iter('node'))
    if not nodes or any(n.get('package') not in [None, '', 'com.xunmeng.merchant'] for n in nodes):
        return unknown(['WRONG_PACKAGE'])
    parents = {child: node for node in root.iter() for child in node}

    def bounds(node):
        found = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if not found:
            return None
        x1, y1, x2, y2 = map(int, found.groups())
        return [x1, y1, x2, y2] if 0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height else None

    def visible_label(label):
        return [n for n in nodes if n.get('text') == label and n.get('class') == 'android.widget.TextView' and bounds(n)]

    reasons, anchors = [], {}
    if not all(visible_label(label) for label in ['发布商品', '商品轮播图', '保存草稿']):
        return unknown(['WRONG_FORM_PAGE'])
    for key, label in [('title', '商品标题'), ('groupPrice', '拼单价'), ('inventory', '库存'), ('upload', '上传图片'), ('publish', '提交并上架')]:
        labels = visible_label(label)
        if len(labels) != 1:
            reasons.append('AMBIGUOUS_ANCHOR:' + key)
            continue
        node = labels[0]
        if key in ['title', 'groupPrice', 'inventory']:
            while node in parents:
                node = parents[node]
                edits = [n for n in node.iter('node') if n.get('class') == 'android.widget.EditText' and n.get('enabled') == 'true' and bounds(n)]
                if edits:
                    break
            if len(edits) != 1:
                reasons.append('AMBIGUOUS_FIELD:' + key)
                continue
            node = edits[0]
        anchors[key] = {'label': label, 'bounds': bounds(node), 'class': node.get('class'), 'value': node.get('text', '')}
    if reasons:
        return unknown(reasons)
    return {'status': 'observed', 'requiresVisualReview': True, 'anchors': anchors, 'reasons': []}


if __name__ == '__main__':
    print(json.dumps(resolve(json.load(sys.stdin)), ensure_ascii=False))
