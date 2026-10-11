#!/usr/bin/env python3
"""发布分支只读索引；不导入、启动发布脚本，不联网，不读取凭据。"""
import argparse
import json
import os
from pathlib import Path


WORKSPACE = Path(__file__).resolve().parents[4]
SKILLS = WORKSPACE.parent / "zenithjoy-skills"
if not SKILLS.is_dir():
    SKILLS = Path.home() / ".agents" / "skills"
CATALOG = Path(__file__).resolve().parent.parent / "references" / "catalog.json"
ALIASES = {
    "图文": "image", "长图文": "image", "长图": "image", "多图": "image",
    "视频": "video", "短视频": "video", "长文": "article", "文章": "article",
    "想法": "idea", "动态": "image",
}


def normalize_type(value):
    if value == "图文短视频":
        raise ValueError("请先确认成品是图片还是视频，不能自动选择发布分支")
    result = ALIASES.get(value, value)
    if result not in {"image", "video", "article", "idea"}:
        raise ValueError("不支持的内容类型：" + str(value))
    return result


def load_catalog():
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def resolve_source(source, workspace, skills):
    root = workspace if source["root"] == "workspace" else skills
    path = (root / source["path"]).resolve()
    if not path.is_file():
        raise ValueError("源文件不存在：" + str(path))
    return str(path)


def plan(platform, content_type, channel, workspace=None, skills=None):
    workspace = Path(workspace or os.environ.get("ZENITHJOY_WORKSPACE_ROOT", WORKSPACE))
    skills = Path(skills or os.environ.get("ZENITHJOY_SKILLS_ROOT", SKILLS))
    content_type = normalize_type(content_type)
    routes = load_catalog()["routes"]
    route = next((r for r in routes if r["platform"] == platform and r["type"] == content_type), None)
    if route is None:
        raise ValueError("未找到此平台与类型的发布分支：" + platform + "/" + content_type)
    selected = route["channels"].get(channel)
    if selected is None:
        raise ValueError("未找到该类型的独立通道：" + platform + "/" + content_type + "/" + channel)
    entrypoint = resolve_source(selected["source"], workspace, skills)
    instructions = []
    if channel == "phone":
        instructions.append(resolve_source({"root": "skills", "path": "android-publish/SKILL.md"}, workspace, skills))
    instruction = selected.get("instruction")
    if instruction:
        instructions.append(resolve_source(instruction, workspace, skills))
    return {
        "route": platform + "." + content_type,
        "name": route["name"], "channel": channel,
        "entrypoint": entrypoint, "instructions": instructions,
        "interface": selected.get("interface", "读取手册，现场核对设备、账号与输入"),
        "readback": selected.get("readback", "回账号作品列表或管理页核对新作品和可见性，保留证据"),
        "warnings": selected.get("warnings", []),
        "source_status": "found", "runtime_validation": "pending", "executed": False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="九平台发布只读索引，不执行发布")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    sub.add_parser("matrix")
    p = sub.add_parser("plan")
    p.add_argument("--platform", required=True)
    p.add_argument("--type", required=True)
    p.add_argument("--channel", choices=["phone", "browser", "api"], required=True)
    args = parser.parse_args(argv)
    if args.command == "matrix":
        print("<!-- 由 scripts/publish_catalog.py matrix 生成；真身为 catalog.json -->")
        print("# 发布内容分支清单\n")
        print("2026-10-10：24 个逻辑内容分支候选；按平台与成品类型计数，同分支的通道不重复计数。")
        print("此清单只记录源文件路由；实时验收状态以 Brain 任务回执为准。源文件存在不等于已上线或已跑通。\n")
        print("| 平台与类型 | 已找到的源文件通道 | 状态 |")
        print("|---|---|---|")
        labels = {"phone": "手机手册", "browser": "浏览器脚本", "api": "公众号 API"}
        for route in load_catalog()["routes"]:
            channels = "、".join(labels[c] for c in route["channels"])
            print("| " + route["name"] + " | " + channels + " | 源文件已定位 |")
        print("\n长图片归 image，渲染成品视频归 video；是否是新的独立工作流，要看触发、输入、编辑入口和结果，不能仅按叫法增加条数。")
        print("\n缺口：知乎无独立安卓发布手册；部分手机手册只覆盖视频或图片；头条长文要核对当前 graphic 接口；公众号 API 长文正文保真、群发与链接发布模式需核对。")
        return 0
    try:
        result = load_catalog() if args.command == "list" else plan(args.platform, args.type, args.channel)
    except ValueError as error:
        print(json.dumps({"error": str(error), "executed": False}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
