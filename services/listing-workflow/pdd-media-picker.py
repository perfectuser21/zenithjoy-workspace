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

    def gallery_control(self, label, expected_count=None):
        if label not in {'全部图片', '返回', '添加更多可访问照片'} and not re.fullmatch(r'PDD_pdd[0-9a-f]{32}', label): raise ValueError('UNSAFE_GALLERY_LABEL')
        if not any(n.get('text') == '预览' and n.get('package') == MERCHANT for n in self.nodes): raise ValueError('GALLERY_PAGE_UNVERIFIED')
        nodes = [n for n in self.nodes if n.get('text') == label and n.get('package') == MERCHANT and self.eligible(n)]
        if len(nodes) != 1: raise ValueError('GALLERY_CONTROL_NOT_UNIQUE')
        node = nodes[0]
        if re.fullmatch(r'PDD_pdd[0-9a-f]{32}', label):
            parents = {c:p for p in self.root.iter() for c in p}
            row = parents.get(node); listing = parents.get(row)
            if row is None or listing is None or row.get('package') != MERCHANT or row.get('class') != 'android.widget.RelativeLayout' or not self.eligible(row) or row.get('clickable') != 'true' or listing.get('package') != MERCHANT or listing.get('class') != 'androidx.recyclerview.widget.RecyclerView' or not self.eligible(listing): raise ValueError('GALLERY_ALBUM_ROW_UNVERIFIED')
            box, name, container = self.bounds(row), self.bounds(node), self.bounds(listing)
            if box[0] != 0 or box[2] != self.width or box[3]-box[1] > self.height/4 or not (container[0] <= box[0] <= name[0] < name[2] <= box[2] <= container[2] and container[1] <= box[1] <= name[1] < name[3] <= box[3] <= container[3]): raise ValueError('GALLERY_ALBUM_GEOMETRY_UNVERIFIED')
            counters = [n.get('text') for n in row.iter('node') if n.get('package') == MERCHANT and self.eligible(n) and re.fullmatch(r'[0-9]+张',n.get('text',''))]
            if type(expected_count) is not int or expected_count <= 0 or counters != [str(expected_count)+'张'] or any(n is not row and n.get('clickable') == 'true' for n in row.iter('node')): raise ValueError('GALLERY_ALBUM_COUNT_OR_CONTROL_CONFLICT')
            node = row
        # Only the explicit add-more tile was observed with a non-clickable label.
        if label in {'添加更多可访问照片', '返回'}:
            parents = {c:p for p in self.root.iter() for c in p}
            while node in parents and node.get('clickable') != 'true': node = parents[node]
        return self.point([node], 'GALLERY_CONTROL_NOT_CLICKABLE')

    def gallery_images(self, album):
        if not re.fullmatch(r'PDD_pdd[0-9a-f]{32}', album) or len([n for n in self.nodes if n.get('package') == MERCHANT and n.get('text') == album and self.eligible(n)]) != 1: raise ValueError('OWNED_GALLERY_ALBUM_UNVERIFIED')
        previews = [n for n in self.nodes if n.get('package') == MERCHANT and n.get('class') == 'android.widget.TextView' and n.get('text') == '预览' and self.bounds(n) and n.get('visible-to-user') != 'false']
        if len(previews) != 1: raise ValueError('GALLERY_PAGE_UNVERIFIED')
        bottom = self.bounds(previews[0])[1]
        photos = [n for n in self.nodes if n.get('package') == MERCHANT and n.get('class') == 'android.widget.ImageView' and self.eligible(n) and n.get('clickable') == 'true' and self.bounds(n)[3] < bottom and self.bounds(n)[2]-self.bounds(n)[0] == self.bounds(n)[3]-self.bounds(n)[1]]
        result = []
        for photo in photos:
            box = self.bounds(photo)
            checks = [n for n in self.nodes if n.get('package') == MERCHANT and n.get('class') == 'android.widget.FrameLayout' and self.eligible(n) and n.get('clickable') == 'true' and box[0] < self.bounds(n)[0] < self.bounds(n)[2] == box[2] and box[1] == self.bounds(n)[1] < self.bounds(n)[3] < box[3] and self.bounds(n)[2]-self.bounds(n)[0] < (box[2]-box[0])/2]
            if len(checks) != 1: raise ValueError('GALLERY_CHECKBOX_NOT_UNIQUE')
            numbers = [n.get('text') for n in checks[0].iter('node') if re.fullmatch(r'[1-9]\d?',n.get('text',''))]
            if len(numbers) > 1: raise ValueError('GALLERY_SELECTION_ORDER_AMBIGUOUS')
            result.append({'bounds':box,'checkbox':self.bounds(checks[0]),'selectedNumber':int(numbers[0]) if numbers else None})
        if len({tuple(x['bounds']) for x in result}) != len(result): raise ValueError('GALLERY_IMAGES_AMBIGUOUS')
        return result

    def gallery_upload(self, count):
        return self.point([n for n in self.nodes if n.get('package') == MERCHANT and n.get('text') in {'上传('+str(count)+')','上传 ('+str(count)+')'} and n.get('class') == 'android.widget.TextView'], 'GALLERY_UPLOAD_COUNT_UNVERIFIED')
