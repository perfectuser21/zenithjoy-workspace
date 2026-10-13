#!/usr/bin/env python3
"""非手机核对报告：只读 Brain，产物与核验分开执行，不自行完成父任务。"""
import argparse
import csv
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.request

UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
LIMIT = 200000
FILES = ("report.json", "report.csv", "report-manifest.json")


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def validate_input(value):
    if not isinstance(value, dict) or set(value) - {"task_ids", "release_ids", "label", "tags"}:
        raise ValueError("报告输入字段非法")
    if len(encoded(value)) > 16384:
        raise ValueError("报告输入过大")
    count = 0
    for key in ("task_ids", "release_ids"):
        ids = value.get(key, [])
        if not isinstance(ids, list) or len(ids) > 20 or any(not isinstance(i, str) or not UUID.fullmatch(i) for i in ids):
            raise ValueError("查询范围须为最多 20 个 UUID")
        if len(set(ids)) != len(ids):
            raise ValueError("查询范围重复")
        count += len(ids)
    if count == 0:
        raise ValueError("至少指定一个真实任务或发布版本")
    if not isinstance(value.get("label", ""), str) or len(value.get("label", "")) > 2000:
        raise ValueError("报告标签非法")
    tags = value.get("tags", [])
    if not isinstance(tags, list) or len(tags) > 20 or any(not isinstance(t, str) or len(t) > 200 for t in tags):
        raise ValueError("报告 tags 非法")
    return value


def source_paths(request):
    return [("task", ident, "/tasks/" + ident) for ident in request.get("task_ids", [])] + [
        ("release", ident, "/releases/" + ident + "/gate") for ident in request.get("release_ids", [])]


def read_sources(request, fetch):
    sources, rows = [], []
    for kind, ident, endpoint in source_paths(request):
        raw = fetch(endpoint)
        if not isinstance(raw, dict):
            raise ValueError("来源不是有效对象")
        if kind == "task":
            if raw.get("id") != ident or not isinstance(raw.get("status"), str):
                raise ValueError("来源任务身份缺失或不符")
            # 报告只收所需字段，不复制任务正文中可能存在的私密资料。
            observed = {key: raw.get(key) for key in ("id", "title", "status")}
            row = {"kind": kind, "id": ident, "status": raw["status"], "title": str(raw.get("title") or "")}
        else:
            if not isinstance(raw.get("deployed"), bool):
                raise ValueError("发布门禁没有明确 deployed 判定")
            observed = {"release_id": ident, "deployed": raw["deployed"]}
            row = {"kind": kind, "id": ident, "status": "deployed" if raw["deployed"] else "unverified", "title": "发布部署核对"}
        sources.append({"endpoint": endpoint, "observed": observed, "sha256": digest(encoded(observed))})
        rows.append(row)
    return {"schema_version": 1, "input": request, "input_sha256": digest(encoded(request)), "sources": sources, "rows": rows}


def csv_bytes(rows):
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=["kind", "id", "status", "title"])
    writer.writeheader()
    for row in rows:
        # 下载后用电子表格打开时，自由标题不能变成公式。
        writer.writerow({k: "'" + v if v.startswith(("=", "+", "-", "@", "\t", "\r")) else v for k, v in row.items()})
    return buf.getvalue().encode("utf-8")


def check_directory(directory):
    directory = Path(directory)
    if not directory.is_absolute() or any(p.is_symlink() for p in [directory, *directory.parents]):
        raise ValueError("产物目录须为绝对路径且不能经过符号链接")
    return directory


def read_file(directory, name):
    target = directory / name
    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("报告产物过大")
    return data


def receipt(directory, manifest):
    return {"status": "completed", "outputs": {"json_path": str(directory / FILES[0]),
            "csv_path": str(directory / FILES[1]), "manifest_path": str(directory / FILES[2]),
            "json_sha256": manifest["json_sha256"], "csv_sha256": manifest["csv_sha256"]},
            "evidence": [str(directory / name) for name in FILES]}


def verify(request, directory, fetch):
    validate_input(request)
    directory = check_directory(directory)
    try:
        raw = read_file(directory, FILES[0])
        report = json.loads(raw)
        csv_raw = read_file(directory, FILES[1])
        manifest = json.loads(read_file(directory, FILES[2]))
        if (manifest.get("json_sha256") != digest(raw) or manifest.get("csv_sha256") != digest(csv_raw)
                or report.get("input") != request or report.get("input_sha256") != digest(encoded(request))
                or csv_raw != csv_bytes(report.get("rows", []))):
            return {"verdict": "FAIL", "reason": "产物摘要、输入或CSV不一致"}
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return {"verdict": "FAIL", "reason": "产物缺失或格式损坏"}
    try:
        observed = read_sources(request, fetch)
    except Exception:
        return {"verdict": "INCONCLUSIVE", "reason": "独立来源当前无法读取"}
    if observed != report:
        return {"verdict": "FAIL", "reason": "报告与独立重读的来源不一致"}
    return {"verdict": "PASS", "assertions": ["实际输入一致", "JSON与CSV摘要一致", "独立重读全部来源一致"],
            "evidence": [str(directory / name) for name in FILES]}


def collect(request, directory, fetch):
    validate_input(request)
    directory = check_directory(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(directory / ".report.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        existing = [p for p in FILES if (directory / p).exists()]
        if existing:
            if len(existing) != len(FILES) or verify(request, directory, fetch)["verdict"] != "PASS":
                raise ValueError("已有报告不完整或核验不通过，不覆盖旧证据")
            return receipt(directory, json.loads(read_file(directory, FILES[2])))
        report = read_sources(request, fetch)
        raw = encoded(report)
        csv_raw = csv_bytes(report["rows"])
        manifest = {"schema_version": 1, "json_sha256": digest(raw), "csv_sha256": digest(csv_raw)}
        for name, content in zip(FILES, [raw, csv_raw, encoded(manifest)]):
            fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
        return receipt(directory, manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["collect", "verify"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--brain-url", default="http://localhost:5221")
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as stream:
        value = stream.read(16385)
    if len(value.encode()) > 16384:
        raise ValueError("输入文件过大")
    request = json.loads(value)

    def fetch(endpoint):
        headers = {"Accept": "application/json"}
        token = os.environ.get("CECELIA_INTERNAL_TOKEN")
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(args.brain_url.rstrip("/") + "/api/brain" + endpoint, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            raw = response.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError("来源响应过大")
        return json.loads(raw)

    result = (collect if args.command == "collect" else verify)(request, Path(args.output_dir), fetch)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "completed" or result.get("verdict") == "PASS" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError):
        print(json.dumps({"status": "failed", "reason": "报告输入、来源或产物不可用"}, ensure_ascii=False))
        raise SystemExit(1)
