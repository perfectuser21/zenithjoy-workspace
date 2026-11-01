# Only the system photo-picker UI observed in the evidence is recognized.
import re
import xml.etree.ElementTree as ET

SYSTEM_PICKER = 'com.android.providers.media.module'
PERMISSION = 'com.android.permissioncontroller'
MERCHANT = 'com.xunmeng.merchant'


class PickerTree:
    def __init__(self, xml, width, height):
        if not isinstance(xml, str) or len(xml) > 4_000_000 or '<!' in xml: raise ValueError('UNSAFE_PICKER_XML')
        self.root = ET.fromstring(xml)
        self.width, self.height = width, height
        self.nodes = list(self.root.iter('node'))

    def bounds(self, node):
        match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if not match: return None
        a,b,c,d = map(int, match.groups())
        return [a,b,c,d] if 0 <= a < c <= self.width and 0 <= b < d <= self.height else None

    def eligible(self, node):
        return self.bounds(node) and node.get('enabled') == 'true' and node.get('visible-to-user') != 'false'

    def point(self, nodes, error):
        if len(nodes) != 1: raise ValueError(error)
        node = nodes[0]
        if not self.eligible(node) or node.get('clickable') != 'true': raise ValueError(error)
        return {'bounds': self.bounds(node), 'caption': node.get('content-desc', ''), 'selected': node.get('selected') == 'true'}

    def photo(self, caption):
        return self.point([n for n in self.nodes if n.get('package') == SYSTEM_PICKER and n.get('class') == 'android.widget.FrameLayout' and n.get('content-desc') == caption], 'PHOTO_IDENTITY_NOT_UNIQUE_OR_ENABLED')

    def selected(self):
        return [{'caption': n.get('content-desc'), 'bounds': self.bounds(n)} for n in self.nodes if n.get('package') == SYSTEM_PICKER and n.get('class') == 'android.widget.FrameLayout' and self.eligible(n) and n.get('content-desc') and n.get('selected') == 'true']

    def permission_more(self):
        labels = [n.get('text', '') for n in self.nodes if n.get('package') == PERMISSION]
        if not any('拼多多商家版' in x and '照片和视频' in x for x in labels): raise ValueError('PERMISSION_APP_UNVERIFIED')
        return self.point([n for n in self.nodes if n.get('package') == PERMISSION and n.get('resource-id') == PERMISSION + ':id/permission_allow_selected_button' and n.get('text') == '选择更多照片和视频'], 'LIMITED_PERMISSION_CONTROL_UNVERIFIED')

    def confirm(self, count):
        nodes = [n for n in self.nodes if n.get('package') == SYSTEM_PICKER and n.get('resource-id') == SYSTEM_PICKER + ':id/button_add' and re.fullmatch(r'允许\s*\(' + str(count) + r'\)', n.get('text', ''))]
        return self.point(nodes, 'EXACT_PERMISSION_COUNT_UNVERIFIED')

    def gallery_control(self, label):
        if label not in {'全部图片', '返回', '添加更多可访问照片'} and not re.fullmatch(r'PDD_pdd[0-9a-f]{32}', label): raise ValueError('UNSAFE_GALLERY_LABEL')
        if not any(n.get('text') == '预览' and n.get('package') == MERCHANT for n in self.nodes): raise ValueError('GALLERY_PAGE_UNVERIFIED')
        nodes = [n for n in self.nodes if n.get('text') == label and n.get('package') == MERCHANT and self.eligible(n)]
        if len(nodes) != 1: raise ValueError('GALLERY_CONTROL_NOT_UNIQUE')
        node = nodes[0]
        # Only the explicit add-more tile was observed with a non-clickable label.
        if label == '添加更多可访问照片':
            parents = {c:p for p in self.root.iter() for c in p}
            while node in parents and node.get('clickable') != 'true': node = parents[node]
        return self.point([node], 'GALLERY_CONTROL_NOT_CLICKABLE')
