import json
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

SANDBOX_CODE = Path("/opt/sandbox")
SAMPLES = Path(__file__).resolve().parent.parent / "samples"
EXCHANGE = Path("/data/sandbox")
PYTHON = [sys.executable, "-B", "-E", "-s"]

QUICK_SCENE = """from manim import *


class Quick(Scene):
    def construct(self):
        self.add(Circle(color=QUANTITY))
        self.wait(0.2)
"""

LOOP_SCENE = """from manim import *


class Loop(Scene):
    def construct(self):
        while True:
            pass
"""

REFUSED_SCENE = """import os
from manim import *


class Refused(Scene):
    def construct(self):
        os.system("true")
"""

T = TypeVar("T")


def wait_for(condition: Callable[[], T], timeout: float = 60, message: str = "condition") -> T:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = condition()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(f"timed out after {timeout} s waiting for {message}")


def alive(pid: int) -> bool:
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
    except (OSError, IndexError):
        return False
    return state not in ("Z", "X")


def processes_running(fragment: str) -> list[int]:
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            command = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode()
        except OSError:
            continue
        if fragment in command and alive(int(entry.name)):
            found.append(int(entry.name))
    return found


class Sandbox:
    def __init__(self, name: str, **env: str) -> None:
        self.name = name
        self.root = EXCHANGE / name
        self.inbox = self.root / "in"
        self.outbox = self.root / "out"
        self.scratch = Path("/tmp/scratch") / name
        self.log_path = Path("/tmp/logs") / f"{name}.log"
        for directory in (self.inbox, self.outbox, self.scratch, self.log_path.parent):
            directory.mkdir(parents=True, exist_ok=True)
        self.env = {
            "PATH": os.environ["PATH"],
            "SANDBOX_DIR": str(self.root),
            "SANDBOX_TMP": str(self.scratch),
            **env,
        }
        self.process: subprocess.Popen | None = None

    def submit(self, job: str, source: str | bytes, mtime: float | None = None) -> None:
        part = self.inbox / f".{job}.part"
        part.write_bytes(source.encode() if isinstance(source, str) else source)
        if mtime is not None:
            os.utime(part, (mtime, mtime))
        part.rename(self.inbox / f"{job}.py")

    def start(self) -> "Sandbox":
        with open(self.log_path, "w") as log:
            self.process = subprocess.Popen(
                [*PYTHON, "-u", str(SANDBOX_CODE / "runner.py")],
                env=self.env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        wait_for(lambda: "sandbox ready" in self.output(), 30, f"{self.name} to start")
        return self

    def output(self) -> str:
        return self.log_path.read_text()

    def result(self, job: str, timeout: float = 120) -> dict:
        path = self.outbox / f"{job}.json"
        wait_for(path.exists, timeout, f"the result of {job}")
        return json.loads(path.read_text())

    def stop(self) -> int | None:
        if self.process is None:
            return None
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
        try:
            return self.process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
            raise

    def __enter__(self) -> "Sandbox":
        return self.start()

    def __exit__(self, *_: object) -> None:
        self.stop()
