import os
import sys
import subprocess
import tempfile
from dataclasses import dataclass

@dataclass
class RunResult:
    ok: bool
    stdout: str
    stderr: str
    exit_code: int

def run_python(code: str, time_limit_sec: int = 2) -> RunResult:
    """
    极简、安全性基础版：
    - 通过子进程执行
    - 超时强制终止
    - 不提供网络（这里先不做更重的沙箱，MVP先跑通）
    """
    with tempfile.TemporaryDirectory(prefix="pyq_") as td:
        file_path = os.path.join(td, "main.py")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(code)

        try:
            p = subprocess.run(
                [sys.executable, file_path],
                capture_output=True,
                text=True,
                timeout=time_limit_sec,
                cwd=td,
                env={
                    **os.environ,
                    # 给一个干净点的环境变量（可按需再收紧）
                    "PYTHONIOENCODING": "utf-8",
                },
            )
            return RunResult(
                ok=(p.returncode == 0),
                stdout=p.stdout or "",
                stderr=p.stderr or "",
                exit_code=p.returncode,
            )
        except subprocess.TimeoutExpired as e:
            out = (e.stdout or "") if isinstance(e.stdout, str) else ""
            err = (e.stderr or "") if isinstance(e.stderr, str) else ""
            return RunResult(
                ok=False,
                stdout=out,
                stderr=(err + "\n[Timeout] 运行超时，请检查是否有死循环。").strip(),
                exit_code=124,
            )
