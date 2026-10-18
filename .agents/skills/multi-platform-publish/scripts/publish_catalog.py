#!/usr/bin/env python3
"""发布分支只读索引；核对固定 Skill 来源，不导入或启动发布脚本。"""
import argparse
import json
import os
import subprocess
import sys
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


def git_blob(workspace, revision, path):
    try:
        return subprocess.check_output(
            ["git", "-C", str(workspace), "show", f"{revision}:{path}"], stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as error:
        raise ValueError("无法读取固定发布文件：" + path) from error


def has_lock(workspace, ref="HEAD"):
    if (workspace / ".skills-source.json").exists():
        return True
    try:
        git_blob(workspace, ref, ".skills-source.json")
        return True
    except ValueError:
        return False


def resolve_ref(workspace, ref):
    try:
        return subprocess.check_output(
            ["git", "-C", str(workspace), "rev-parse", "--verify", str(ref) + "^{commit}"],
            stderr=subprocess.PIPE).decode().strip()
    except subprocess.CalledProcessError as error:
        raise ValueError("无法解析固定 Workflow 发布版本") from error


class PinnedRelease:
    """Git 发布版本是信任根；可变安装状态和相邻开发目录均不是。"""
    def __init__(self, workspace, ref):
        self.workspace = workspace.resolve()
        self.ref = resolve_ref(workspace, ref)
        self.bootstrap = git_blob(workspace, self.ref, "scripts/skills-source.py")
        self.lock = json.loads(git_blob(workspace, self.ref, ".skills-source.json"))

    def installed(self, relative):
        relative = Path(relative)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("发布路径越界")
        path = self.workspace / relative
        current = self.workspace
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError("发布文件不能通过符号链接覆盖：" + str(relative))
        if not path.is_file():
            raise ValueError("固定发布源文件不存在：" + str(path))
        bootstrap = "__file__ = " + repr(str(self.workspace / "scripts/skills-source.py")) + "\n" + self.bootstrap.decode()
        try:
            expected = subprocess.check_output(
                [sys.executable, "-c", bootstrap, "cat", "--workspace", str(self.workspace),
                 "--ref", self.ref, "--path", relative.as_posix()], stderr=subprocess.PIPE)
        except subprocess.CalledProcessError:
            raise ValueError("固定 Skill 来源校验失败：" + str(relative)) from None
        if path.read_bytes() != expected:
            raise ValueError("安装文件与固定 Skill 版本不一致：" + str(relative))
        return path


def load_catalog(release=None):
    if release is None and has_lock(WORKSPACE):
        release = PinnedRelease(WORKSPACE, "HEAD")
    path = release.installed(".agents/skills/multi-platform-publish/references/catalog.json") if release else CATALOG
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_source(source, workspace, skills, release=None):
    if source["root"] not in {"workspace", "skills"}:
        raise ValueError("不可信的源文件根目录")
    if release and source["root"] == "skills":
        return str(release.installed(Path(".skills-runtime") / source["path"]))
    if release and source["root"] == "workspace" and source["path"].startswith(".agents/skills/"):
        return str(release.installed(source["path"]))
    root = workspace if source["root"] == "workspace" else skills
    path = (root / source["path"]).resolve()
    if not path.is_file():
        raise ValueError("源文件不存在：" + str(path))
    return str(path)


def plan(platform, content_type, channel, workspace=None, skills=None, ref=None):
    workspace = Path(workspace or os.environ.get("ZENITHJOY_WORKSPACE_ROOT", WORKSPACE)).resolve()
    fixed_ref = resolve_ref(workspace, ref) if ref is not None else None
    locked = has_lock(WORKSPACE) or has_lock(workspace, fixed_ref or "HEAD")
    if locked:
        if workspace != WORKSPACE.resolve() or skills is not None or os.environ.get("ZENITHJOY_SKILLS_ROOT"):
            raise ValueError("固定发布禁止开发目录覆盖；请使用独立的无锁探索工作区")
        release = PinnedRelease(workspace, fixed_ref or "HEAD")
    else:
        release = None
    skills = Path(skills or os.environ.get("ZENITHJOY_SKILLS_ROOT", SKILLS))
    content_type = normalize_type(content_type)
    routes = load_catalog(release)["routes"]
    route = next((r for r in routes if r["platform"] == platform and r["type"] == content_type), None)
    if route is None:
        raise ValueError("未找到此平台与类型的发布分支：" + platform + "/" + content_type)
    selected = route["channels"].get(channel)
    if selected is None:
        raise ValueError("未找到该类型的独立通道：" + platform + "/" + content_type + "/" + channel)
    entrypoint = resolve_source(selected["source"], workspace, skills, release)
    instructions = []
    if channel == "phone":
        instructions.append(resolve_source({"root": "skills", "path": "android-publish/SKILL.md"}, workspace, skills, release))
    instruction = selected.get("instruction")
    if instruction:
        instructions.append(resolve_source(instruction, workspace, skills, release))
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
    p.add_argument("--ref", help="本次 Workflow 固定的 Git 发布版本")
    p.add_argument("--platform", required=True)
    p.add_argument("--type", required=True)
    p.add_argument("--channel", choices=["phone", "browser", "api"], required=True)
    args = parser.parse_args(argv)
    try:
        catalog = load_catalog() if args.command in {"list", "matrix"} else None
        result = plan(args.platform, args.type, args.channel, ref=args.ref) if args.command == "plan" else catalog
    except ValueError as error:
        print(json.dumps({"error": str(error), "executed": False}, ensure_ascii=False))
        return 2
    if args.command == "matrix":
        print("<!-- 由 scripts/publish_catalog.py matrix 生成；真身为 catalog.json -->")
        print("# 发布内容分支清单\n")
        print("2026-10-11：保留24个历史逻辑候选；当前授权范围为21个安卓模式及公众号长文官方API，共22类。候选或模式数不冒正式workflow登记数量。")
        print("此清单只记录源文件路由；实时验收状态以 Brain 任务回执为准。源文件存在不等于已上线或已跑通。\n")
        print("| 平台与类型 | 已找到的源文件通道 | 状态 |")
        print("|---|---|---|")
        labels = {"phone": "手机手册", "browser": "浏览器脚本", "api": "公众号 API"}
        for route in catalog["routes"]:
            channels = "、".join(labels[c] for c in route["channels"])
            print("| " + route["name"] + " | " + channels + " | 源文件已定位 |")
        print("\n长图片归 image，渲染成品视频归 video；是否是新的独立工作流，要看触发、输入、编辑入口和结果，不能仅按叫法增加条数。")
        print("\n安卓补充模式见 [补充手册](android-additional-modes.md)：小红书图文/原生长文、头条文章、微博原生文章和知乎三类。发表效果、字段保真、权限、审核终态及安全收尾分别验收；未全验的严格断言与限制保留。公众号本轮只走官方API，群发、草稿及链接模式分开判定。")
        return 0
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
