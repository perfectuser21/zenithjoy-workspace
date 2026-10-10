#!/usr/bin/env python3
"""只读核对已观察到的小红书长文标题输入连接，拒绝猜测焦点。"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = "com.xingin.xhs"
VIEW = "com.xingin.capa.post.ui.UnderLineRichEdit"


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


def resolve(xml_path, ime_path):
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
    candidates = [n for n in ET.parse(xml_path).iter("node") if n.get("package") == selection["editor"]["package"] and n.get("class") == "android.widget.EditText" and n.get("resource-id") == selection["resource_id"] and n.get("bounds") == selection["bounds"]]
    if len(candidates) != 1:
        raise ValueError("selected input is absent or ambiguous after typing")
    return candidates[0].get("text", "")


def main():
    command = sys.argv[1]
    if command == "resolve":
        print(json.dumps(resolve(sys.argv[2], sys.argv[3]), ensure_ascii=False))
    elif command == "check":
        selection = json.loads(Path(sys.argv[2]).read_text())
        if editor(sys.argv[3]) != selection["editor"]:
            raise ValueError("input connection changed before typing")
    elif command == "readback":
        selection = json.loads(Path(sys.argv[2]).read_text())
        sys.stdout.write(readback(sys.argv[3], selection))
    else:
        raise ValueError("unknown operation")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, ET.ParseError, IndexError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
