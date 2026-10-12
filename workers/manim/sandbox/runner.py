import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from static_check import check, scene_name

ROOT = Path(os.environ.get("SANDBOX_DIR", "/sandbox"))
INBOX = ROOT / "in"
OUTBOX = ROOT / "out"
WORK = Path(os.environ.get("SANDBOX_WORK", "/tmp/work"))
HERE = Path(__file__).resolve().parent
RENDER_TIMEOUT_S = int(os.environ.get("RENDER_TIMEOUT_S", "150"))
HEARTBEAT_S = 15
POLL_S = 0.5
STDERR_TAIL = 2000

running = True


def stop(*_: object) -> None:
    global running
    running = False


def heartbeat() -> None:
    while running:
        marker = OUTBOX / ".heartbeat"
        marker.write_text(str(int(time.time())))
        time.sleep(HEARTBEAT_S)


def write_result(job: str, result: dict) -> None:
    temporary = OUTBOX / f".{job}.json.tmp"
    temporary.write_text(json.dumps(result))
    temporary.rename(OUTBOX / f"{job}.json")


def render(job: str, source: str) -> dict:
    started = time.monotonic()
    problems = check(source)
    if problems:
        return {"ok": False, "stage": "static_check", "duration_ms": 0, "error": "; ".join(problems), "stderr_tail": ""}

    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    script = WORK / "scene.py"
    script.write_text((HERE / "preamble.py").read_text() + "\n" + source)
    command = [
        sys.executable,
        "-m",
        "manim",
        "render",
        "-qm",
        "--format",
        "mp4",
        "--disable_caching",
        "--media_dir",
        str(WORK / "media"),
        "-o",
        "out.mp4",
        str(script),
        scene_name(source),
    ]
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(WORK),
        "XDG_CACHE_HOME": str(WORK / ".cache"),
        "MPLCONFIGDIR": str(WORK / ".mpl"),
        "TEXMFVAR": str(WORK / ".texmf-var"),
    }
    try:
        process = subprocess.run(
            command, cwd=WORK, env=env, capture_output=True, text=True, timeout=RENDER_TIMEOUT_S, start_new_session=True
        )
    except subprocess.TimeoutExpired as error:
        tail = (error.stderr or b"")[-STDERR_TAIL:]
        return {
            "ok": False,
            "stage": "render",
            "duration_ms": int((time.monotonic() - started) * 1000),
            "error": f"render exceeded {RENDER_TIMEOUT_S} seconds",
            "stderr_tail": tail.decode(errors="replace") if isinstance(tail, bytes) else str(tail),
        }

    duration_ms = int((time.monotonic() - started) * 1000)
    videos = list((WORK / "media").rglob("out.mp4"))
    if process.returncode != 0 or not videos:
        return {
            "ok": False,
            "stage": "render",
            "duration_ms": duration_ms,
            "error": f"manim exited with code {process.returncode}",
            "stderr_tail": (process.stderr or process.stdout)[-STDERR_TAIL:],
        }
    shutil.move(str(videos[0]), OUTBOX / f"{job}.mp4")
    return {"ok": True, "stage": "render", "duration_ms": duration_ms, "error": "", "stderr_tail": ""}


def main() -> None:
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    INBOX.mkdir(parents=True, exist_ok=True)
    OUTBOX.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=heartbeat, daemon=True).start()
    while running:
        jobs = sorted(INBOX.glob("*.py"), key=lambda path: path.stat().st_mtime)
        if not jobs:
            time.sleep(POLL_S)
            continue
        path = jobs[0]
        job = path.stem
        try:
            result = render(job, path.read_text())
        except Exception as error:  # the runner must outlive any single job
            result = {"ok": False, "stage": "render", "duration_ms": 0, "error": repr(error), "stderr_tail": ""}
        write_result(job, result)
        path.unlink(missing_ok=True)
        shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    main()
