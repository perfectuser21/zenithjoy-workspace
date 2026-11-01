import json
import re
import sys
import xml.etree.ElementTree as ET

PACKAGE = 'com.xunmeng.merchant'
FIELDS = {'title': '商品标题', 'groupPrice': '拼单价', 'inventory': '库存'}
FORBIDDEN = {'提交并上架', '保存草稿', '编辑', '下架', '改库存', '改价', '发送', '聊天', '立即复制', '添加账号', '管理'}


class Screen:
    def __init__(self, xml, width, height):
        if not isinstance(xml, str) or len(xml) > 4_000_000 or '<!' in xml or not all(type(x) is int and 0 < x <= 16384 for x in [width, height]):
            raise ValueError('UNSAFE_UI_INPUT')
        self.tree = ET.fromstring(xml)
        self.width, self.height = width, height
        self.nodes = [n for n in self.tree.iter('node') if n.get('package') == PACKAGE]
        self.parents = {child: node for node in self.tree.iter() for child in node}

    def bounds(self, node):
        m = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if not m:
            return None
        x1, y1, x2, y2 = map(int, m.groups())
        return [x1, y1, x2, y2] if 0 <= x1 < x2 <= self.width and 0 <= y1 < y2 <= self.height else None

    def labels(self, text):
        return [n for n in self.nodes if n.get('class') in {'android.widget.TextView', 'android.view.View'} and n.get('text') == text and self.bounds(n) and n.get('visible-to-user') != 'false' and n.get('enabled', 'true') == 'true']

    def form(self):
        return all(self.labels(x) for x in ['发布商品', '商品轮播图', '保存草稿', '提交并上架'])

    def field(self, key):
        if key not in FIELDS:
            raise ValueError('FORBIDDEN_FIELD')
        if not self.form():
            raise ValueError('UNSAFE_FORM_PAGE')
        labels = self.labels(FIELDS[key])
        if len(labels) != 1:
            raise ValueError('UNSAFE_FIELD_LABEL')
        node, edits = labels[0], []
        while node in self.parents:
            node = self.parents[node]
            edits = [x for x in node.iter('node') if x.get('package') == PACKAGE and x.get('class') == 'android.widget.EditText' and self.bounds(x)]
            if edits:
                break
        if len(edits) != 1:
            raise ValueError('UNSAFE_FIELD_AMBIGUOUS')
        node = edits[0]
        if node.get('enabled') != 'true' or node.get('password') == 'true' or node.get('focusable', 'true') != 'true' or node.get('editable', 'true') != 'true':
            raise ValueError('UNSAFE_FIELD_PROTECTED')
        return {'bounds': self.bounds(node), 'value': node.get('text', ''), 'focused': node.get('focused') == 'true', 'package': PACKAGE, 'class': node.get('class')}

    def navigate(self, label, owned_names):
        if label in FORBIDDEN:
            raise ValueError('FORBIDDEN_CONTROL')
        if label == '商品管理':
            if self.form() or not any(n.get('resource-id') == PACKAGE + ':id/tv_title' and self.bounds(n) for n in self.nodes):
                raise ValueError('WRONG_HOME_PAGE')
        elif label == '发布商品':
            if self.form() or not self.labels('商品管理'):
                raise ValueError('WRONG_LIST_PAGE')
        elif label == '上传图片':
            if not self.form():
                raise ValueError('WRONG_FORM_PAGE')
        elif label in {'从手机相册选择', '图片空间', '取消'}:
            if not all(self.labels(x) for x in ['拍照', '从手机相册选择', '图片空间', '取消']):
                raise ValueError('WRONG_SOURCE_SHEET')
        elif label in owned_names:
            if self.form() and not self.labels('完成'):
                raise ValueError('WRONG_PICKER_PAGE')
        else:
            raise ValueError('FORBIDDEN_CONTROL')
        nodes = self.labels(label)
        if len(nodes) != 1:
            raise ValueError('ANCHOR_NOT_UNIQUE')
        return {'label': label, 'bounds': self.bounds(nodes[0]), 'clickable': nodes[0].get('clickable') == 'true', 'requiresVisualReview': True}

    def agree_list_entry(self, approved):
        for screen in [self, approved]:
            counts = screen.facts()['counts']
            if screen.form() or len(screen.labels('商品管理')) != 1 or not {'在售中', '发布中'} <= set(counts): raise ValueError('WRONG_LIST_PAGE')
        point, old = self.navigate('发布商品', []), approved.navigate('发布商品', [])
        if point['bounds'] != old['bounds']: raise ValueError('LIST_ENTRY_CHANGED')
        rect = point['bounds']; cx, cy = (rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2
        target = self.labels('发布商品')[0]
        def ancestor(node, resource):
            while node in self.parents:
                node = self.parents[node]
                if node.get('resource-id') == resource: return node
            return None
        footer = ancestor(target, 'bottomButtonId')
        if footer is None: raise ValueError('FIXED_NEW_FORM_FOOTER_UNVERIFIED')
        old_footer = approved.labels('发布商品')[0]
        while old_footer in approved.parents and old_footer.get('resource-id') != 'bottomButtonId': old_footer = approved.parents[old_footer]
        if old_footer.get('resource-id') != 'bottomButtonId' or self.bounds(footer) != approved.bounds(old_footer): raise ValueError('FIXED_NEW_FORM_FOOTER_CHANGED')
        box = self.bounds(footer)
        if not box or box[0] != 0 or box[2:] != [self.width,self.height] or box[3] - box[1] >= self.height // 4 or not box[1] <= rect[1] < rect[3] <= box[3]: raise ValueError('FIXED_NEW_FORM_FOOTER_UNVERIFIED')
        for text in FORBIDDEN:
            for node in self.labels(text):
                bounds = self.bounds(node)
                if bounds[0] <= cx < bounds[2] and bounds[1] <= cy < bounds[3] and ancestor(node, 'scrollNode0') is None: raise ValueError('DANGEROUS_CONTROL_OVERLAP')
        return point

    def homepage_animation_mask(self, target):
        if target.get('label') != '商品管理' or self.form() or not self.facts()['storeName']:
            raise ValueError('ANIMATION_MASK_NOT_APPLICABLE')
        labels = self.labels('营销活动')
        if len(labels) != 1: raise ValueError('ANIMATION_LABEL_NOT_UNIQUE')
        label = self.bounds(labels[0])
        icons = [self.bounds(n) for n in self.nodes if n.get('class') == 'android.widget.ImageView' and n.get('clickable') == 'true' and self.bounds(n) and label[0] <= self.bounds(n)[0] < self.bounds(n)[2] <= label[2] and 0 <= label[1] - self.bounds(n)[3] <= label[3] - label[1]]
        if len(icons) != 1: raise ValueError('ANIMATION_ICON_NOT_UNIQUE')
        box, tap = icons[0], target['bounds']
        if max(box[0], tap[0]) < min(box[2], tap[2]) and max(box[1], tap[1]) < min(box[3], tap[3]): raise ValueError('ANIMATION_MASK_OVERLAPS_TARGET')
        if not target.get('clickable'): raise ValueError('TARGET_NOT_CLICKABLE')
        cx, cy = (tap[0] + tap[2]) // 2, (tap[1] + tap[3]) // 2
        covering = [n for n in self.nodes if n.get('clickable') == 'true' and self.bounds(n) and self.bounds(n)[0] <= cx < self.bounds(n)[2] and self.bounds(n)[1] <= cy < self.bounds(n)[3]]
        if len(covering) != 1: raise ValueError('TARGET_OVERLAP_AMBIGUOUS')
        return box

    def facts(self):
        names = [n.get('text') for n in self.nodes if n.get('resource-id') == PACKAGE + ':id/tv_title' and self.bounds(n)]
        counts = {}
        for node in self.nodes:
            match = re.fullmatch(r'(在售中|发布中|草稿箱)\((\d+)\)', node.get('text', ''))
            if match:
                counts[match[1]] = int(match[2])
        return {'storeName': names[0] if len(names) == 1 else None, 'form': self.form(), 'counts': counts}


def dispatch(data):
    screen = Screen(data['xml'], data['width'], data['height'])
    if data['action'] == 'field':
        return screen.field(data['field'])
    if data['action'] == 'navigate':
        return screen.navigate(data['label'], data.get('ownedNames', []))
    if data['action'] == 'facts':
        return screen.facts()
    raise ValueError('FORBIDDEN_UI_OPERATION')


if __name__ == '__main__':
    try:
        print(json.dumps(dispatch(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
