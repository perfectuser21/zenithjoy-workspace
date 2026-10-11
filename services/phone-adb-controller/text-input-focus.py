#!/usr/bin/env python3
"""只读绑定标准焦点EditText及既有小红书标题输入连接，拒绝猜测焦点。"""
INPUT_RUNTIME_REVISION = 1
import json
import hashlib
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = "com.xingin.xhs"
VIEW = "com.xingin.capa.post.ui.UnderLineRichEdit"


class NoStandardInput(ValueError):
    """只有完全没有标准焦点输入时，才允许走既有native白名单。"""


def zhihu_body_structure(tree, field):
    """只认原生写文章页中已实证的唯一Web编辑器正文，不按空id泛化。"""
    package = "com.zhihu.android"
    nodes = list(tree.iter("node"))
    markers = {"com.zhihu.android:id/fake_article_editor_title": "写文章",
               "com.zhihu.android:id/preview_button": "预览",
               "com.zhihu.android:id/fake_article_editor_publish": "发布"}
    for rid, text in markers.items():
        matches = [n for n in nodes if n.get("resource-id") == rid]
        if (len(matches) != 1 or matches[0].get("package") != package or matches[0].get("text") != text
                or matches[0].get("class") != "android.widget.TextView"):
            raise ValueError("Zhihu native article screen changed")
    editors = [n for n in nodes if n.get("class") == "android.webkit.WebView" and n.get("text") == "Zhihu Editor"]
    roots = [n for n in nodes if n.get("resource-id") == "root"]
    if (len(editors) != 1 or editors[0].get("package") != package
            or len(roots) != 1 or roots[0] not in list(editors[0])
            or roots[0].get("class") != "android.view.View" or roots[0].get("package") != package):
        raise ValueError("Zhihu editor root is absent or ambiguous")
    editor, root = editors[0], roots[0]
    parents = [n for n in list(root) if field in list(n)]
    if (len(parents) != 1 or parents[0].get("class") != "android.view.View"
            or parents[0].get("package") != package or parents[0].get("resource-id") != ""):
        raise ValueError("Zhihu body parent changed")
    fields = [n for n in editor.iter("node") if n.get("class") == "android.widget.EditText"]
    if (fields != [field] or field not in list(root.iter("node"))
            or field.get("package") != package or field.get("resource-id") != ""
            or any(n.get("focused") == "true" and n is not field for n in nodes)):
        raise ValueError("Zhihu body field is absent or conflicting")
    for n in (editor, root, parents[0], field):
        if n.get("enabled") != "true" or n.get("password") != "false":
            raise ValueError("Zhihu body structure is unsafe")
    if field.get("focusable") != "true" or field.get("editable", "true") != "true":
        raise ValueError("Zhihu body field is noneditable")
    return {"policy": "zhihu_native_article_body_v1", "editor_text": "Zhihu Editor", "root_id": "root"}


def bounds_rect(value):
    if not re.fullmatch(r"\[\d+,\d+\]\[\d+,\d+\]", value or ""):
        raise ValueError("invalid field geometry")
    values = tuple(map(int, re.findall(r"\d+", value)))
    if values[0] >= values[2] or values[1] >= values[3]:
        raise ValueError("empty field geometry")
    return values


def zhihu_search_structure(tree, field):
    package = "com.zhihu.android"
    nodes = list(tree.iter("node"))
    inputs = [n for n in nodes if n.get("resource-id") == package + ":id/input_text"]
    parents = [n for n in nodes if field in list(n)]
    if (inputs != [field] or len(parents) != 1 or parents[0].get("class") != "android.widget.FrameLayout"
            or parents[0].get("package") != package
            or any(n.get("focused") == "true" and n is not field for n in nodes)):
        raise ValueError("native Zhihu search input or parent is ambiguous")
    parent = parents[0]
    def identity(node):
        if node.get("package") != package or node.get("enabled") != "true" or node.get("password") != "false":
            raise ValueError("unsafe native search structure")
        bounds_rect(node.get("bounds"))
        return {k: node.get(k, "") for k in ("package", "class", "resource-id", "text", "bounds")}
    result = {"policy": "zhihu_search_clear_v1", "parent": identity(parent)}
    for key, cls, text in (("back_layout", "android.widget.FrameLayout", ""),
                           ("search_button", "android.widget.TextView", "搜索"),
                           ("close_layer", "android.view.View", "")):
        matches = [n for n in nodes if n.get("resource-id") == package + ":id/" + key]
        if (len(matches) != 1 or matches[0] not in list(parent) or matches[0].get("class") != cls
                or matches[0].get("text") != text or matches[0].get("focusable") != "true"
                or matches[0].get("focused") != "false"):
            raise ValueError("native search sibling marker changed")
        result[key] = identity(matches[0])
    return result


def check_zhihu_search_shrink(selection, current):
    original, actual = selection["search_structure"], current.get("search_structure")
    if not actual or any(actual[k] != original[k] for k in ("policy", "parent", "back_layout", "search_button")):
        raise ValueError("native search structure changed after typing")
    left, top, right, bottom = bounds_rect(selection["bounds"])
    now_left, now_top, now_right, now_bottom = bounds_rect(current["bounds"])
    old_close = bounds_rect(original["close_layer"]["bounds"])
    clear_left, clear_top, clear_right, clear_bottom = bounds_rect(actual["close_layer"]["bounds"])
    if (now_left != left or now_top != top or now_bottom != bottom or not left < now_right < right
            or old_close[2] > left or old_close[3] > top
            or clear_right != right or not clear_left <= now_right < clear_right
            or clear_left < left or clear_top > top or clear_bottom < bottom
            or clear_right - clear_left > 2 * (bottom - top) or clear_bottom - clear_top > 2 * (bottom - top)):
        raise ValueError("search geometry is not the observed clear-button right shrink")


def standard_resolve(xml_path):
    tree = ET.parse(xml_path)
    nodes = [n for n in tree.iter("node")
             if n.get("focused") == "true" and n.get("class") == "android.widget.EditText"]
    if not nodes:
        raise NoStandardInput("no focused standard input")
    if len(nodes) != 1:
        raise ValueError("multiple focused editable inputs")
    node = nodes[0]
    if (node.get("password") == "true" or node.get("enabled", "true") != "true"
            or node.get("focusable", "true") != "true" or node.get("editable", "true") != "true"):
        raise ValueError("focused input is protected, disabled or noneditable")
    identity = {key: node.get(key, "") for key in ("package", "resource-id", "class", "bounds")}
    if not identity["package"] or not identity["bounds"]:
        raise ValueError("focused input identity is incomplete")
    if identity["package"] == "com.zhihu.android" and identity["resource-id"] == "":
        # 不满足原生正文结构时仍保留原通用严格bounds许可，不能获得布局兼容。
        try:
            identity["body_structure"] = zhihu_body_structure(tree, node)
        except ValueError:
            pass
    if identity["package"] == "com.zhihu.android" and identity["resource-id"] == "com.zhihu.android:id/input_text":
        try:
            identity["search_structure"] = zhihu_search_structure(tree, node)
        except ValueError:
            pass
    return identity


def standard_readback(xml_path, selection, allow_body_growth=False):
    current = standard_resolve(xml_path)
    if allow_body_growth and selection.get("body_structure"):
        current = dict(current)
        current["bounds"] = selection["bounds"]
    if allow_body_growth and selection.get("search_structure") and current != selection:
        check_zhihu_search_shrink(selection, current)
        current = dict(current)
        current["bounds"] = selection["bounds"]
        current["search_structure"] = selection["search_structure"]
    if current != selection:
        raise ValueError("focused input identity changed")
    # 兼容分支也必须重验同屏、唯一命名editor/root以及唯一安全焦点，绝不按空id全局读。
    layout_bound = allow_body_growth and (selection.get("body_structure") or selection.get("search_structure"))
    keys = ("package", "resource-id", "class") if layout_bound else ("package", "resource-id", "class", "bounds")
    candidates = [n for n in ET.parse(xml_path).iter("node")
                  if (not layout_bound or n.get("focused") == "true")
                  and all(n.get(k, "") == selection[k] for k in keys)]
    if len(candidates) != 1:
        raise ValueError("selected input is absent or ambiguous")
    return candidates[0].get("text", "")


def standard_compare(xml_path, selection, source):
    actual = standard_readback(xml_path, selection, allow_body_growth=True)
    if actual == source:
        mode = "exact"
    elif selection.get("body_structure") and source.split("\n\n") == actual.split("\n"):
        mode = "zhihu_article_paragraphs"
    else:
        raise ValueError("selected field text differs from requested text")
    def identity(text):
        raw = text.encode("utf-8")
        return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    return {"comparison_mode": mode, "identity_policy": selection.get("search_structure", {}).get("policy", selection.get("body_structure", {}).get("policy", "strict_standard")), "source": identity(source), "actual": identity(actual),
            "paragraphs": len(source.split("\n\n")) if selection.get("body_structure") else 0}


def editor(path):
    raw = Path(path).read_text()
    matches = list(re.finditer(r"^  mServedView=", raw, re.M))
    if not matches:
        raise ValueError("current served view missing")
    current = raw[matches[-1].start():]
    view = re.search(r"^  mServedView=" + re.escape(VIEW) + r"\{([a-f0-9]+)\b", current, re.M)
    if not view:
        raise ValueError("unsupported current editor")
    if not re.search(r"^  mServedConnecting=false$", current, re.M):
        raise ValueError("editor connection pending")
    info = re.search(r"^  mCurrentEditorInfo:\n(.*?)^  mServedInputConnection=(.*)$", current, re.M | re.S)
    if not info:
        raise ValueError("current editor info missing")
    block, connection = info.groups()
    connection = connection.splitlines()[0]
    if "mDeactivateRequested=false" not in connection or not re.search(r"mServedView=" + re.escape(VIEW) + r"\{" + re.escape(view[1]) + r"[}\s]", connection):
        raise ValueError("inactive or unrelated input connection")
    package = re.search(r"packageName=(\S+) autofillId=(\S+) fieldId=(\d+)", block)
    hint = re.search(r"hintText=(.*?) label=", block)
    kind = re.search(r"inputType=(\S+)", block)
    if not package or package[1] != PACKAGE or not hint or hint[1] != "输入标题" or not kind or kind[1] != "0x20001":
        raise ValueError("unsupported package, hint or input type")
    if not re.search(r"\baid=" + re.escape(package[2]) + r"[}\s]", current.splitlines()[0]):
        raise ValueError("served view and editor identity differ")
    return {"package": package[1], "autofill_id": package[2], "field_id": package[3], "hint": hint[1], "input_type": kind[1], "view_token": view[1]}


TOUTIAO_PACKAGE = "com.ss.android.article.news"
TOUTIAO_VIEW = "com.android.bytedance.search.views.SearchAutoCompleteTextView"
TOUTIAO_ID = TOUTIAO_PACKAGE + ":id/cx"


def toutiao_editor(ime_path):
    raw = Path(ime_path).read_text()
    markers = list(re.finditer(r"^  mServedView=", raw, re.M))
    if not markers:
        raise ValueError("current search editor missing")
    current = raw[markers[-1].start():]
    view = re.search(r"^  mServedView=" + re.escape(TOUTIAO_VIEW) + r"\{([a-f0-9]+)\b([^\n]*)", current, re.M)
    if not view or not re.search(r"#7f0e008b app:id/cx aid=(\d+)\}", view[2]):
        raise ValueError("unsupported search native view or id")
    if not re.search(r"^  mServedConnecting=false$", current, re.M):
        raise ValueError("search input connection pending")
    info = re.search(r"^  mCurrentEditorInfo:\n(.*?)^  mServedInputConnection=(.*)$", current, re.M | re.S)
    if not info:
        raise ValueError("search editor info missing")
    block, connection = info.groups()
    connection = connection.splitlines()[0]
    package = re.search(r"packageName=(\S+) autofillId=(\d+) fieldId=(\d+)", block)
    types = re.search(r"inputType=(\S+) imeOptions=(\S+)", block)
    aid = re.search(r"\baid=(\d+)\}", view[2])
    connected = re.search(r"connection=com\.android\.internal\.inputmethod\.EditableInputConnection@([a-f0-9]+) mDeactivateRequested=false mServedView=" + re.escape(TOUTIAO_VIEW) + r"\{" + re.escape(view[1]) + r"\b", connection)
    if (not package or package[1] != TOUTIAO_PACKAGE or package[3] != "2131624075"
            or not aid or aid[1] != package[2] or not types or types.groups() != ("0x1", "0x3") or not connected):
        raise ValueError("unsupported or inactive search editor identity")
    return {"package": package[1], "field_id": package[3], "autofill_id": package[2],
            "input_type": types[1], "ime_options": types[2], "view_class": TOUTIAO_VIEW,
            "view_token": view[1], "connection_token": connected[1]}


def toutiao_field(xml_path):
    nodes = list(ET.parse(xml_path).iter("node"))
    focused = [n for n in nodes if n.get("focused") == "true"]
    candidates = [n for n in nodes if n.get("resource-id") == TOUTIAO_ID]
    if len(focused) != 1 or len(candidates) != 1 or focused[0] is not candidates[0]:
        raise ValueError("search accessibility focus is absent or ambiguous")
    node = candidates[0]
    if (node.get("package") != TOUTIAO_PACKAGE or node.get("class") != ""
            or node.get("enabled") != "true" or node.get("focusable") != "true"
            or node.get("password") != "false" or node.get("editable", "true") != "true"
            or not re.fullmatch(r"\[\d+,\d+\]\[\d+,\d+\]", node.get("bounds", ""))):
        raise ValueError("unsupported or unsafe search accessibility field")
    left, top, right, bottom = map(int, re.findall(r"\d+", node.get("bounds")))
    if left >= right or top >= bottom:
        raise ValueError("search field bounds are empty")
    return node


def toutiao_resolve(xml_path, ime_path):
    identity = toutiao_editor(ime_path)
    field = toutiao_field(xml_path)
    return {"kind": "toutiao_search", "editor": identity, "package": field.get("package"),
            "resource_id": field.get("resource-id"), "class": field.get("class"), "bounds": field.get("bounds"),
            "structure": toutiao_structure(xml_path, "voice")}


def toutiao_structure(xml_path, slot):
    tree = ET.parse(xml_path)
    nodes = list(tree.iter("node"))
    field = toutiao_field(xml_path)
    # Find the field from this tree rather than compare Element instances across parses.
    field = next(n for n in nodes if n.get("resource-id") == TOUTIAO_ID)
    parent_id = TOUTIAO_PACKAGE + ":id/kk8"
    parents = [n for n in nodes if n.get("resource-id") == parent_id]
    if len(parents) != 1 or field not in list(parents[0]):
        raise ValueError("search field is not in the unique native search header")
    parent = parents[0]
    def snapshot(node, cls, text, desc):
        if (node.get("package") != TOUTIAO_PACKAGE or node.get("class") != cls
                or node.get("text") != text or node.get("content-desc") != desc
                or node.get("enabled") != "true" or node.get("password") != "false"
                or node.get("focusable") != "true" or node.get("focused") != "false"):
            raise ValueError("native search header marker is unsafe or changed")
        bounds_rect(node.get("bounds"))
        return {k: node.get(k, "") for k in ("package", "class", "resource-id", "text", "content-desc", "bounds")}
    result = {"parent": snapshot(parent, "android.widget.FrameLayout", "", "")}
    slot_id, slot_class, slot_desc = (("m4j", "android.widget.LinearLayout", "") if slot == "voice"
                                     else ("ee", "android.widget.ImageView", "清除"))
    expected = ["xp", "cx", slot_id, "e0"]
    if [n.get("resource-id") for n in list(parent)] != [TOUTIAO_PACKAGE + ":id/" + k for k in expected]:
        raise ValueError("native search header children changed")
    if any(n.get("resource-id") == TOUTIAO_PACKAGE + ":id/" + ("ee" if slot == "voice" else "m4j") for n in nodes):
        raise ValueError("conflicting voice and clear slots")
    for key, cls, text, desc in (("xp", "android.widget.ImageView", "", "返回"),
                                 ("e0", "android.widget.Button", "搜索", ""),
                                 (slot_id, slot_class, "", slot_desc)):
        matches = [n for n in nodes if n.get("resource-id") == TOUTIAO_PACKAGE + ":id/" + key]
        if len(matches) != 1 or matches[0] not in list(parent):
            raise ValueError("native search sibling is absent or ambiguous")
        result[key] = snapshot(matches[0], cls, text, desc)
    left, top, right, bottom = bounds_rect(field.get("bounds"))
    pl, pt, pr, pb = bounds_rect(result["parent"]["bounds"])
    sl, st, sr, sb = bounds_rect(result[slot_id]["bounds"])
    search_left, _, search_right, _ = bounds_rect(result["e0"]["bounds"])
    if (not pl <= left < right <= pr or not pt <= top < bottom <= pb
            or sl != right or not top <= st < sb <= bottom or sr > search_left
            or search_right > pr):
        raise ValueError("search field is not adjacent to its bounded native slot")
    return result


def toutiao_compare(xml_path, ime_path, selection, source):
    if selection.get("kind") != "toutiao_search" or toutiao_editor(ime_path) != selection["editor"]:
        raise ValueError("typed search input connection changed")
    field = toutiao_field(xml_path)
    for key, attr in (("package", "package"), ("resource_id", "resource-id"), ("class", "class")):
        if field.get(attr) != selection[key]:
            raise ValueError("typed search accessibility identity changed")
    actual = toutiao_structure(xml_path, "clear")
    original = selection["structure"]
    if any(actual[key] != original[key] for key in ("parent", "xp", "e0")):
        raise ValueError("typed search header identity changed")
    left, top, _, bottom = bounds_rect(selection["bounds"])
    now_left, now_top, _, now_bottom = bounds_rect(field.get("bounds"))
    if (left, top, bottom) != (now_left, now_top, now_bottom):
        raise ValueError("typed search changed left, top or height")
    raw = field.get("text", "")
    if raw == source:
        mode = "exact"
    elif raw == "搜索框，" + source:
        mode = "toutiao_search_accessibility_prefix"
    else:
        raise ValueError("typed search raw text differs from source or literal accessibility prefix")
    def stats(text):
        value = text.encode("utf-8")
        return {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}
    return {"comparison_mode": mode, "identity_policy": "toutiao_search_voice_to_clear_v1",
            "source": stats(source), "raw": stats(raw), "actual": stats(raw), "paragraphs": 0}


def toutiao_readback(xml_path, selection):
    field = toutiao_field(xml_path)
    for key, attr in (("package", "package"), ("resource_id", "resource-id"), ("class", "class"), ("bounds", "bounds")):
        if field.get(attr) != selection[key]:
            raise ValueError("selected search field changed after typing")
    # 真实typed原证尚待独立真机；严格读取原text，不猜测或剥离“搜索框”前缀。
    return field.get("text", "")


def resolve(xml_path, ime_path):
    if any(n.get("package") == TOUTIAO_PACKAGE for n in ET.parse(xml_path).iter("node")):
        return toutiao_resolve(xml_path, ime_path)
    identity = editor(ime_path)
    nodes = list(ET.parse(xml_path).iter("node"))
    if any(node.get("focused") == "true" for node in nodes):
        raise ValueError("conflicting accessibility focus")
    candidates = [n for n in nodes if n.get("package") == PACKAGE and n.get("class") == "android.widget.EditText" and n.get("text") == identity["hint"]]
    if len(candidates) != 1 or not candidates[0].get("bounds") or not candidates[0].get("resource-id"):
        raise ValueError("editor hint does not identify a unique input")
    node = candidates[0]
    return {"editor": identity, "bounds": node.get("bounds"), "resource_id": node.get("resource-id")}


def readback(xml_path, selection):
    if selection.get("kind") == "toutiao_search":
        return toutiao_readback(xml_path, selection)
    candidates = [n for n in ET.parse(xml_path).iter("node") if n.get("package") == selection["editor"]["package"] and n.get("class") == "android.widget.EditText" and n.get("resource-id") == selection["resource_id"] and n.get("bounds") == selection["bounds"]]
    if len(candidates) != 1:
        raise ValueError("selected input is absent or ambiguous after typing")
    return candidates[0].get("text", "")


def main():
    command = sys.argv[1]
    if command == "standard-resolve":
        print(json.dumps(standard_resolve(sys.argv[2]), ensure_ascii=False))
    elif command in ("standard-check", "standard-readback"):
        selection = json.loads(Path(sys.argv[2]).read_text())
        value = standard_readback(sys.argv[3], selection, allow_body_growth=command == "standard-readback")
        if command == "standard-readback":
            sys.stdout.write(value)
    elif command == "standard-compare":
        selection = json.loads(Path(sys.argv[2]).read_text())
        print(json.dumps(standard_compare(sys.argv[3], selection, sys.argv[4])))
    elif command == "toutiao-resolve":
        print(json.dumps(toutiao_resolve(sys.argv[2], sys.argv[3]), ensure_ascii=False))
    elif command == "toutiao-compare":
        selection = json.loads(Path(sys.argv[2]).read_text())
        print(json.dumps(toutiao_compare(sys.argv[3], sys.argv[4], selection, sys.argv[5])))
    elif command == "resolve":
        print(json.dumps(resolve(sys.argv[2], sys.argv[3]), ensure_ascii=False))
    elif command == "check":
        selection = json.loads(Path(sys.argv[2]).read_text())
        if selection.get("kind") == "toutiao_search":
            if toutiao_resolve(sys.argv[4], sys.argv[3]) != selection:
                raise ValueError("search input connection or accessibility field changed before typing")
        elif editor(sys.argv[3]) != selection["editor"]:
            raise ValueError("input connection changed before typing")
    elif command == "readback":
        selection = json.loads(Path(sys.argv[2]).read_text())
        sys.stdout.write(readback(sys.argv[3], selection))
    else:
        raise ValueError("unknown operation")


if __name__ == "__main__":
    try:
        main()
    except NoStandardInput as error:
        print(str(error), file=sys.stderr)
        sys.exit(3)
    except (ValueError, OSError, ET.ParseError, IndexError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
