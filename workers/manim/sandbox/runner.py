import json
import os
import re
import resource
import shutil
import signal
import stat
import subprocess
import sys
import sysconfig
import tempfile
import threading
import time
from contextlib import suppress
from pathlib import Path
from typing import BinaryIO

from confine import landlock_abi
from static_check import MAX_BYTES

ROOT = Path(os.environ.get("SANDBOX_DIR", "/data/sandbox"))
INBOX = ROOT / "in"
OUTBOX = ROOT / "out"
SCRATCH = Path(os.environ.get("SANDBOX_TMP", "/tmp"))
HERE = Path(__file__).resolve().parent
RENDER_TIMEOUT_S = float(os.environ.get("SANDBOX_RENDER_TIMEOUT_S", "150"))
MAX_VIDEO_BYTES = int(os.environ.get("SANDBOX_MAX_VIDEO_BYTES", str(100 * 1024 * 1024)))
HEARTBEAT_S = float(os.environ.get("SANDBOX_HEARTBEAT_S", "15"))
POLL_S = 0.5
HELPER_TIMEOUT_S = 30
LIVENESS_S = 30
STDERR_TAIL = 2000
VIDEO_FORMAT = ("h264", 1280, 720, 30.0)
JOB_FILE = re.compile(r"([A-Za-z0-9_-]{1,64})\.py")
PYTHON = [sys.executable, "-B", "-E", "-s"]
# kill(-1) reaches every process of the container's PID namespace but never the host's.
IN_CONTAINER = Path("/.dockerenv").exists() or Path("/run/.containerenv").exists()
STOPPED = "the sandbox stopped before the render finished"
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_REDACTED = (f"{HERE}/", f"{sysconfig.get_paths()['purelib']}/", f"{sysconfig.get_paths()['stdlib']}/")

stopping = False
last_tick = time.monotonic()


class Failure(Exception):
    def __init__(self, stage: str, error: str, tail: str = "") -> None:
        super().__init__(error)
        self.stage = stage
        self.error = error
        self.tail = tail


def log(message: str) -> None:
    print(message, flush=True)


def tick() -> None:
    global last_tick
    last_tick = time.monotonic()


def request_stop(signum: int, frame: object) -> None:
    global stopping
    stopping = True


def remove(path: Path) -> None:
    with suppress(FileNotFoundError):
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()


def wipe(directory: Path) -> None:
    with suppress(FileNotFoundError), os.scandir(directory) as entries:
        for entry in entries:
            with suppress(OSError):
                remove(Path(entry.path))


def publish(target: Path, content: bytes | BinaryIO) -> None:
    part = target.with_name(f".{target.name}.part")
    with suppress(FileNotFoundError):
        part.unlink()
    fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644)
    try:
        with os.fdopen(fd, "wb") as handle:
            if isinstance(content, bytes):
                handle.write(content)
            else:
                shutil.copyfileobj(content, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(part, target)
    except BaseException:
        with suppress(OSError):
            part.unlink()
        raise


def heartbeat() -> None:
    while True:
        if time.monotonic() - last_tick < LIVENESS_S:
            try:
                publish(OUTBOX / ".heartbeat", str(int(time.time())).encode())
            except OSError as error:
                log(f"the heartbeat could not be written: {error}")
        time.sleep(HEARTBEAT_S)


def base_env() -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "NO_COLOR": "1",
        "TERM": "dumb",
        "COLUMNS": "120",
        "OMP_NUM_THREADS": "2",
        "OPENBLAS_NUM_THREADS": "2",
    }


def render_env(work: Path) -> dict[str, str]:
    return base_env() | {
        "HOME": str(work),
        "TMPDIR": str(work),
        "XDG_CACHE_HOME": str(work / ".cache"),
        "XDG_CONFIG_HOME": str(work / ".config"),
        "MPLCONFIGDIR": str(work / ".matplotlib"),
        "TEXMFVAR": str(work / ".texmf-var"),
        "TEXMFCONFIG": str(work / ".texmf-config"),
        "shell_escape": "f",
    }


def reap() -> None:
    with suppress(ChildProcessError):
        while os.waitpid(-1, os.WNOHANG)[0]:
            pass


def sweep(process: subprocess.Popen) -> None:
    with suppress(ProcessLookupError, PermissionError):
        os.killpg(process.pid, signal.SIGKILL)
    if IN_CONTAINER:
        # Kills what a job left behind under another session; spares PID 1 and the runner.
        with suppress(OSError):
            os.kill(-1, signal.SIGKILL)
    process.wait()
    time.sleep(0.05)
    reap()


def supervise(process: subprocess.Popen, timeout_s: float) -> str:
    deadline = time.monotonic() + timeout_s
    outcome = "exited"
    while True:
        tick()
        try:
            process.wait(timeout=POLL_S)
            break
        except subprocess.TimeoutExpired:
            if stopping:
                outcome = "stopped"
                break
            if time.monotonic() >= deadline:
                outcome = "timeout"
                break
    sweep(process)
    return outcome


def helper(stage: str, script: str, stdin: BinaryIO) -> tuple[int | None, bytes]:
    with tempfile.TemporaryFile(dir=SCRATCH) as output:
        process = subprocess.Popen(
            [*PYTHON, str(HERE / script)],
            stdin=stdin,
            stdout=output,
            stderr=subprocess.DEVNULL,
            cwd=SCRATCH,
            env=base_env(),
            start_new_session=True,
        )
        outcome = supervise(process, HELPER_TIMEOUT_S)
        if outcome == "stopped":
            raise Failure(stage, STOPPED)
        output.seek(0)
        return (process.returncode if outcome == "exited" else None), output.read(64 * 1024)


def open_regular(path: Path) -> BinaryIO | None:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError:
        return None
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        return None
    return os.fdopen(fd, "rb")


def read_job(path: Path) -> bytes:
    handle = open_regular(path)
    if handle is None:
        raise Failure("static_check", "the job file is not a regular file")
    with handle:
        return handle.read(MAX_BYTES + 1)


def static_check(source: bytes) -> list[str]:
    with tempfile.TemporaryFile(dir=SCRATCH) as stdin:
        stdin.write(source)
        stdin.seek(0)
        code, output = helper("static_check", "static_check.py", stdin)
    try:
        violations = json.loads(output)
        valid = isinstance(violations, list) and all(isinstance(item, str) for item in violations)
        valid = valid and code == 0
    except ValueError:
        valid = False
    if not valid:
        raise Failure("static_check", f"the static check could not run (exit code {code})")
    return violations


def read_tail(log_file: BinaryIO, work: Path) -> str:
    size = log_file.seek(0, os.SEEK_END)
    log_file.seek(max(0, size - 64 * 1024))
    text = _ANSI.sub("", log_file.read().decode("utf-8", "replace")).replace("\r\n", "\n").replace("\r", "\n")
    for prefix in (f"{work}/", *_REDACTED):
        text = text.replace(prefix, "")
    return text.replace(str(work), ".")[-STDERR_TAIL:]


def exit_reason(code: int) -> str:
    if code >= 0:
        return f"the render failed with exit code {code}"
    name = signal.Signals(-code).name if -code in signal.valid_signals() else f"signal {-code}"
    if -code == signal.SIGKILL:
        return f"the render was killed ({name}), probably by the memory limit"
    return f"the render was killed by {name}"


def probe(video: BinaryIO, tail: str) -> None:
    video.seek(0)
    code, output = helper("render", "probe.py", video)
    try:
        info = json.loads(output)
        found = (str(info["codec"]), int(info["width"]), int(info["height"]), round(float(info["fps"]), 2))
    except (ValueError, KeyError, TypeError) as error:
        raise Failure("render", f"the video could not be read (exit code {code})", tail) from error
    if found != VIDEO_FORMAT:
        codec, width, height, fps = found
        raise Failure(
            "render",
            f"the video is {codec} {width}x{height} at {fps:g} frames per second,"
            f" expected h264 1280x720 at 30",
            tail,
        )


def publish_video(job: str, path: Path, tail: str) -> None:
    video = open_regular(path)
    if video is None:
        raise Failure("render", "the render produced no video", tail)
    with video:
        size = os.fstat(video.fileno()).st_size
        if size == 0:
            raise Failure("render", "the render produced no video", tail)
        if size > MAX_VIDEO_BYTES:
            raise Failure(
                "render", f"the video has {size} bytes, more than the {MAX_VIDEO_BYTES} allowed", tail
            )
        probe(video, tail)
        video.seek(0)
        publish(OUTBOX / f"{job}.mp4", video)


def render(job: str, source: bytes) -> None:
    work = Path(tempfile.mkdtemp(prefix="job-", dir=SCRATCH))
    (work / "scene.py").write_bytes(source)
    with tempfile.TemporaryFile(dir=SCRATCH) as log_file:
        process = subprocess.Popen(
            [*PYTHON, str(HERE / "render.py"), str(work)],
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            cwd=work,
            env=render_env(work),
            start_new_session=True,
        )
        log(f"job {job}: render")
        outcome = supervise(process, RENDER_TIMEOUT_S)
        tail = read_tail(log_file, work)
    if outcome == "timeout":
        raise Failure("render", f"the render exceeded {RENDER_TIMEOUT_S:g} seconds", tail)
    if outcome == "stopped":
        raise Failure("render", STOPPED, tail)
    if process.returncode != 0:
        raise Failure("render", exit_reason(process.returncode), tail)
    publish_video(job, work / "video" / "scene.mp4", tail)


def process_job(job: str) -> dict[str, object]:
    started = time.monotonic()
    stage = "static_check"
    try:
        source = read_job(INBOX / f"{job}.py")
        violations = static_check(source)
        if violations:
            raise Failure("static_check", "\n".join(violations))
        stage = "render"
        if stopping:
            raise Failure("render", STOPPED)
        render(job, source)
        outcome = (True, "render", "", "")
    except Failure as failure:
        outcome = (False, failure.stage, failure.error, failure.tail)
    except Exception as error:
        log(f"job {job}: the sandbox failed: {error!r}")
        outcome = (False, stage, "the sandbox failed while running the job", "")
    finally:
        wipe(SCRATCH)
    ok, stage, error, tail = outcome
    return {
        "ok": ok,
        "stage": stage,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "error": error,
        "stderr_tail": tail,
    }


def next_job() -> str | None:
    candidates = []
    with os.scandir(INBOX) as entries:
        for entry in entries:
            match = JOB_FILE.fullmatch(entry.name)
            if match:
                with suppress(FileNotFoundError):
                    candidates.append((entry.stat(follow_symlinks=False).st_mtime_ns, entry.name, match[1]))
    return min(candidates)[2] if candidates else None


def tidy_outbox() -> None:
    with os.scandir(OUTBOX) as entries:
        for entry in entries:
            if not entry.is_file(follow_symlinks=False):
                with suppress(OSError):
                    remove(Path(entry.path))


def run_job(job: str) -> None:
    log(f"job {job}: start")
    for stale in (OUTBOX / f"{job}.json", OUTBOX / f"{job}.mp4"):
        with suppress(OSError):
            remove(stale)
    result = process_job(job)
    try:
        publish(OUTBOX / f"{job}.json", json.dumps(result, ensure_ascii=False).encode())
    except OSError as error:
        log(f"job {job}: the result could not be written: {error}")
    with suppress(OSError):
        remove(INBOX / f"{job}.py")
    tidy_outbox()
    log(f"job {job}: {result['stage']} {'ok' if result['ok'] else 'failed'} in {result['duration_ms']} ms")


def recover() -> None:
    # A result is complete once its .json exists: the .json is written last and the input is
    # removed after it. Anything else left by a crash is discarded or run again.
    wipe(SCRATCH)
    with os.scandir(OUTBOX) as entries:
        for entry in entries:
            if entry.name.endswith(".part") or not entry.is_file(follow_symlinks=False):
                remove(Path(entry.path))
    with os.scandir(INBOX) as entries:
        for entry in entries:
            match = JOB_FILE.fullmatch(entry.name)
            if not match:
                continue
            if (OUTBOX / f"{match[1]}.json").exists():
                remove(Path(entry.path))
            else:
                remove(OUTBOX / f"{match[1]}.mp4")


def main() -> int:
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    for directory in (INBOX, OUTBOX, SCRATCH):
        directory.mkdir(parents=True, exist_ok=True)
    recover()
    abi = landlock_abi()
    log(
        f"sandbox ready: {ROOT}, landlock {f'ABI {abi}' if abi else 'unavailable'},"
        f" render timeout {RENDER_TIMEOUT_S:g} s"
    )
    threading.Thread(target=heartbeat, daemon=True).start()
    while not stopping:
        tick()
        try:
            job = next_job()
            if job is None:
                time.sleep(POLL_S)
            else:
                run_job(job)
        except Exception as error:
            log(f"the sandbox loop failed: {error!r}")
            time.sleep(POLL_S)
    log("sandbox stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
