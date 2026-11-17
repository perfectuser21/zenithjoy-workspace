"""One strict, read-only Compose comment parser for enumeration and proof replay."""
import base64
import json
import re
import sys
import xml.etree.ElementTree as ET

COMPOSE_PKG = 'com.ss.android.ugc.aweme'


def compose_bounds(node):
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
    if not match:
        return None
    b = tuple(map(int, match.groups()))
    return b if b[0] < b[2] and b[1] < b[3] else None


def compose_inside(a, b):
    return bool(a and b and b[0] <= a[0] < a[2] <= b[2] and b[1] <= a[1] < a[3] <= b[3])


def compose_row(row, slot, viewport):
    rb, sb = compose_bounds(row), compose_bounds(slot)
    if (row.get('class') != 'android.view.View' or row.get('clickable') != 'false'
            or row.get('text') or row.get('content-desc') or not compose_inside(rb, viewport)
            or not compose_inside(rb, sb) or rb[0] != sb[0] or rb[2] != viewport[2]):
        return None
    children = list(row)
    if any(n.get('enabled') == 'false' or not compose_inside(compose_bounds(n), rb) for n in row.iter('node')):
        return None
    avatars = [n for n in children if n.get('class') == 'android.view.View'
               and n.get('clickable') == 'true' and not n.get('text')
               and not n.get('content-desc') and len(n) == 0]
    if len(avatars) != 1:
        return None
    ab = compose_bounds(avatars[0])
    if ab[0] != rb[0] or ab[1] != rb[1] or ab[2]-ab[0] != ab[3]-ab[1]:
        return None
    names = [n for n in children if n.get('class') == 'android.widget.TextView'
             and n.get('clickable') == 'true' and n.get('text') not in ('', '回复')
             and compose_bounds(n)[0] > ab[2] and compose_bounds(n)[1] == ab[1]
             and compose_bounds(n)[3] <= ab[3]]
    if len(names) != 1:
        return None
    name = names[0]
    nb = compose_bounds(name)
    bodies = [n for n in children if n.get('class') == 'android.view.View'
              and n.get('clickable') == 'false' and not n.get('text') and not n.get('content-desc')
              and compose_bounds(n)[0] == nb[0] and compose_bounds(n)[1] >= nb[3]
              and len(n) == 1 and n[0].get('class') == 'android.widget.TextView'
              and n[0].get('clickable') == 'false' and n[0].get('text')]
    if len(bodies) != 1:
        return None
    body = bodies[0]
    texts = [n for n in children if n.get('class') == 'android.widget.TextView']
    dates = [n for n in texts if n.get('clickable') == 'false' and re.fullmatch(
        r'(?:刚刚|昨天|前天|\d+(?:秒|分钟|小时|天|周|个月|年)前|(?:\d{4}-)?\d{1,2}-\d{1,2})', n.get('text', ''))]
    regions = [n for n in texts if re.fullmatch(r'\s*·\s+[^\r\n\t]+', n.get('text', ''))]
    replies = [n for n in texts if n.get('text') == '回复' and n.get('clickable') == 'true']
    if len(dates) != 1 or len(regions) != 1 or len(replies) != 1:
        return None
    db, gb, qb = map(compose_bounds, (dates[0], regions[0], replies[0]))
    if not (db[0] == nb[0] and db[1] >= compose_bounds(body)[3]
            and db[1] == gb[1] == qb[1] and db[2] <= gb[0] < gb[2] <= qb[0]):
        return None
    likes = [n for n in children if n.get('clickable') == 'true' and len(n) == 1
             and re.fullmatch(r'赞[0-9万.+]+,(?:未选中|已选中)', n[0].get('content-desc', ''))]
    dislikes = [n for n in children if n.get('clickable') == 'true' and len(n) == 1
                and n[0].get('content-desc') == '点踩']
    if len(likes) != 1 or len(dislikes) != 1:
        return None
    nickname, text = name.get('text'), body[0].get('text')
    if any(c in nickname + text for c in '\t\r\n'):
        return None
    author = any(n is not name and n.get('text') == '作者'
                 and compose_bounds(n)[1] == nb[1] and compose_bounds(n)[0] >= nb[2] for n in texts)
    return {'nickname': nickname, 'author': author, 'body': text, 'time': dates[0].get('text'),
            'region': regions[0].get('text').strip().lstrip('·').strip(),
            'x': str((ab[0]+ab[2])//2), 'y': str((ab[1]+ab[3])//2),
            'nickname_b64': base64.b64encode(nickname.encode()).decode()}


def compose_input(view, viewport, comment_list):
    candidates = []
    parents = {n: p for p in view.iter() for n in p}
    for group in view.iter('node'):
        children = list(group)
        if (len(children) != 4 or group.get('enabled') != 'true'
                or group.get('clickable') != 'false' or group.get('text') or group.get('content-desc')):
            continue
        ancestor = parents.get(group)
        owned = True
        while ancestor is not None and ancestor is not view:
            if (ancestor is comment_list or ancestor.get('enabled') == 'false'
                    or not compose_inside(compose_bounds(group), compose_bounds(ancestor))):
                owned = False
                break
            ancestor = parents.get(ancestor)
        if not owned:
            continue
        if any(n.get('class') != 'android.view.View' or n.get('clickable') != 'true'
               or n.get('enabled') != 'true' or n.get('text') or n.get('content-desc') for n in children):
            continue
        field, *icons = children
        descendants = list(field.iter('node'))[1:]
        labels = [n for n in descendants if n.get('class') == 'android.widget.TextView' and n.get('text')]
        if (len(labels) != 1 or any(n.get('clickable') != 'false' or n.get('enabled') != 'true'
                or n.get('content-desc') or not compose_inside(compose_bounds(n), compose_bounds(field))
                or (n is not labels[0] and n.get('text')) for n in descendants)):
            continue
        if any(len(n) != 1 for n in icons):
            continue
        if [n[0].get('content-desc') for n in icons] != ['image', 'at', 'emoji']:
            continue
        if any(n[0].get('class') != 'android.view.View' or n[0].get('clickable') != 'false'
               or n[0].get('enabled') != 'true' or len(n[0]) != 0 for n in icons):
            continue
        gb = compose_bounds(group)
        boxes = [compose_bounds(n) for n in children]
        if (not compose_inside(gb, compose_bounds(view)) or gb[1] < viewport[3]
                or any(not compose_inside(b, gb) for b in boxes)
                or any(not compose_inside(compose_bounds(n[0]), b) for n, b in zip(icons, boxes[1:]))):
            continue
        if (any(b[1] != gb[1] or b[3] != gb[3] for b in boxes)
                or boxes[0][0] != gb[0] or boxes[-1][2] != gb[2]
                or any(a[2] != b[0] for a, b in zip(boxes, boxes[1:]))):
            continue
        candidates.append(field)
    if len(candidates) != 1:
        raise ValueError('COMPOSE_INPUT_REGION')
    return candidates[0]


def compose_panel(xml, width=None):
    if len(xml.encode()) > 4 * 1024 * 1024:
        raise ValueError('COMPOSE_XML_TOO_LARGE')
    if re.search(r'<!DOCTYPE|<!ENTITY', xml, re.I):
        raise ValueError('COMPOSE_XML_ENTITY')
    root = ET.fromstring(xml)
    nodes = list(root.iter('node'))
    if root.tag != 'hierarchy' or not nodes or any(n.get('package') != COMPOSE_PKG for n in nodes):
        raise ValueError('COMPOSE_PACKAGE')
    views = [n for n in nodes if n.get('class') == 'androidx.compose.ui.platform.ComposeView']
    if not views:
        return None
    if len(views) != 1:
        raise ValueError('COMPOSE_PANEL_AMBIGUOUS')
    view = views[0]
    vn = list(view.iter('node'))
    lists = [n for n in vn if n.get('class') == 'android.view.View' and n.get('scrollable') == 'true']
    headers = [n for n in vn if n.get('class') == 'android.widget.TextView'
               and re.fullmatch(r'[0-9万.]+条评论', n.get('text', ''))]
    controls = [[n for n in nodes if n.get('class') == 'android.widget.ImageView'
                 and n.get('content-desc') == desc and n.get('clickable') == 'true']
                for desc in ('关闭', '放大评论区')]
    if (len(lists) != 1 or len(headers) != 1 or any(len(a) != 1 for a in controls)
            or any(n.get('class') == 'android.widget.EditText' for n in vn)):
        raise ValueError('COMPOSE_PANEL_ANCHORS')
    viewport, vb = compose_bounds(lists[0]), compose_bounds(view)
    screen = compose_bounds(nodes[0])
    expected_width = width if width is not None else (screen[2] if screen else None)
    if (not compose_inside(viewport, vb) or not compose_inside(vb, screen)
            or viewport[0] != 0 or viewport[2] != expected_width
            or viewport[2]-viewport[0] < 100 or viewport[3]-viewport[1] < 200
            or not compose_inside(compose_bounds(headers[0]), vb)
            or compose_bounds(headers[0])[3] > viewport[1]):
        raise ValueError('COMPOSE_PANEL_BOUNDS')
    compose_input(view, viewport, lists[0])
    parents = {n: parent for parent in root.iter() for n in parent}
    def ancestors(n):
        out = []
        while n is not None:
            out.append(n)
            n = parents.get(n)
        return out
    common = [n for n in ancestors(view) if all(n in ancestors(a[0]) for a in controls)]
    if not common:
        raise ValueError('COMPOSE_PANEL_OWNER')
    panel = common[0]
    if any(not compose_inside(compose_bounds(a[0]), compose_bounds(panel))
           or compose_bounds(a[0])[3] > vb[1] for a in controls):
        raise ValueError('COMPOSE_PANEL_CONTROLS')
    rows = []
    for slot in list(lists[0]):
        candidates = [n for n in [slot, *list(slot)] if n.get('class') == 'android.view.View']
        found = [r for n in candidates if (r := compose_row(n, slot, viewport)) is not None]
        if len(found) == 1:
            rows.append(found[0])
    return {'panel': panel, 'list': lists[0], 'rows': rows,
            'scroll_viewport': dict(zip(('left', 'top', 'right', 'bottom'), viewport))}


if __name__ == '__main__' and len(sys.argv) == 3:
    try:
        result = compose_panel(open(sys.argv[1], encoding='utf8').read(), int(sys.argv[2]))
        for row in result['rows'] if result else []:
            print('\t'.join([row['nickname'], row['body'], row['time'], row['region'],
                             'author' if row['author'] else '', 'tap='+row['x']+' '+row['y'],
                             'b64='+row['nickname_b64']]))
    except (ValueError, OSError, ET.ParseError):
        sys.exit(2)
