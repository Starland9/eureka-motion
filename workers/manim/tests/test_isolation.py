import os
import re
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

import runner
from confine import landlock_abi
from support import EXCHANGE

# These snippets run directly in the container, past the static check, to show what the
# container and the confinement refuse to code the check would have missed.


def run_python(code: str, *args: str) -> str:
    completed = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code), *args],
        capture_output=True,
        text=True,
        timeout=60,
        env={"PATH": os.environ["PATH"], "PYTHONPATH": "/opt/sandbox"},
    )
    return completed.stdout + completed.stderr


class ContainerIsolationTest(unittest.TestCase):
    def test_only_the_loopback_interface_exists(self) -> None:
        self.assertEqual(os.listdir("/sys/class/net"), ["lo"])

    def test_outbound_connections_fail(self) -> None:
        output = run_python(
            """
            import socket, urllib.request
            for host, port in (("1.1.1.1", 443), ("8.8.8.8", 53), ("example.com", 80)):
                try:
                    socket.create_connection((host, port), timeout=3).close()
                    print("connected", host)
                except OSError as error:
                    print("refused", host, type(error).__name__)
            try:
                urllib.request.urlopen("http://example.com", timeout=3)
                print("connected http")
            except OSError as error:
                print("refused http", type(error).__name__)
            """
        )
        self.assertNotIn("connected", output)
        self.assertEqual(output.count("refused"), 4, output)

    def test_writes_outside_the_volume_and_tmp_fail(self) -> None:
        targets = [
            "/evil",
            "/etc/evil",
            "/opt/sandbox/runner.py",
            "/opt/sandbox/evil.py",
            "/opt/venv/lib/python3.14/site-packages/evil.pth",
            "/usr/local/bin/evil",
            "/manim/evil",
            "/var/tmp/evil",
        ]
        output = run_python(
            """
            import sys
            for path in sys.argv[1:]:
                try:
                    with open(path, "a") as handle:
                        handle.write("x")
                    print("written", path)
                except OSError as error:
                    print("refused", path, error.errno)
            """,
            *targets,
        )
        self.assertNotIn("written", output)
        self.assertEqual(output.count("refused"), len(targets), output)
        for writable in (EXCHANGE / "probe", Path("/tmp/probe")):
            writable.write_text("x")
            writable.unlink()

    def test_the_process_has_no_privilege(self) -> None:
        status = Path("/proc/self/status").read_text()
        self.assertNotEqual(os.getuid(), 0)
        self.assertRegex(status, r"CapEff:\s+0+\n")
        self.assertRegex(status, r"CapBnd:\s+0+\n")
        self.assertRegex(status, r"NoNewPrivs:\s+1\n")
        self.assertRegex(status, r"Seccomp:\s+2\n")

    def test_resource_limits_match_the_contract(self) -> None:
        cgroup = Path("/sys/fs/cgroup")
        self.assertEqual((cgroup / "pids.max").read_text().strip(), "256")
        self.assertEqual((cgroup / "memory.max").read_text().strip(), str(2 * 1024**3))
        self.assertEqual((cgroup / "memory.swap.max").read_text().strip(), "0")
        self.assertEqual((cgroup / "cpu.max").read_text().strip(), "200000 100000")

    def test_tmp_is_a_size_bound_tmpfs_without_exec(self) -> None:
        mounts = [line.split() for line in Path("/proc/mounts").read_text().splitlines()]
        mount = next(fields for fields in mounts if fields[1] == "/tmp")
        self.assertEqual(mount[2], "tmpfs")
        self.assertTrue({"noexec", "nosuid", "nodev"} <= set(mount[3].split(",")), mount)

    def test_latex_cannot_run_programs(self) -> None:
        work = Path("/tmp/latex")
        work.mkdir(exist_ok=True)
        (work / "probe.idx").write_text("")
        (work / "probe.tex").write_text("\\immediate\\write18{makeindex -o ran.ind probe.idx}\\end\n")

        def compile_tex(env: dict[str, str]) -> bool:
            (work / "ran.ind").unlink(missing_ok=True)
            subprocess.run(
                ["latex", "-interaction=batchmode", "probe.tex"],
                cwd=work,
                env=env,
                capture_output=True,
                timeout=60,
            )
            return (work / "ran.ind").exists()

        env = runner.render_env(work)
        self.assertFalse(compile_tex(env))
        self.assertTrue(compile_tex({name: value for name, value in env.items() if name != "shell_escape"}))

    def test_the_render_environment_holds_only_known_variables(self) -> None:
        env = runner.render_env(Path("/tmp/work"))
        self.assertEqual(
            set(env),
            {
                "PATH",
                "LANG",
                "NO_COLOR",
                "TERM",
                "COLUMNS",
                "OMP_NUM_THREADS",
                "OPENBLAS_NUM_THREADS",
                "HOME",
                "TMPDIR",
                "XDG_CACHE_HOME",
                "XDG_CONFIG_HOME",
                "MPLCONFIGDIR",
                "TEXMFVAR",
                "TEXMFCONFIG",
                "shell_escape",
            },
        )
        secret = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|DATABASE", re.I)
        self.assertEqual([name for name in os.environ if secret.search(name)], [])


RUNTIME_PROBES = """from manim import *


def attempt(label, action):
    try:
        action()
        print(label, "allowed")
    except Exception as error:
        print(label, repr(error).split("(")[0])


def import_os():
    import os


def import_utils():
    from manim import utils


def import_capture():
    from manim import capture


def import_numpy_lib():
    from numpy import lib


def change_config():
    config.pixel_width = 1920


attempt("open", lambda: open("/etc/passwd"))
attempt("eval", lambda: eval("1"))
attempt("getattr", lambda: getattr(Scene, "render"))
attempt("type", lambda: type(Scene))
attempt("import os", import_os)
attempt("import utils", import_utils)
attempt("import capture", import_capture)
attempt("import numpy lib", import_numpy_lib)
attempt("np.lib", lambda: np.lib)
attempt("config", change_config)
attempt("RED", lambda: RED)
attempt("logger", lambda: logger)
attempt("Circle", lambda: Circle(color=QUANTITY))


class Empty(Scene):
    def construct(self):
        self.wait(0.1)
"""


class RuntimeGuardTest(unittest.TestCase):
    def test_the_scene_module_cannot_reach_what_the_check_refuses(self) -> None:
        work = Path("/tmp/runtime-guard")
        work.mkdir(exist_ok=True)
        (work / "scene.py").write_text(RUNTIME_PROBES)
        completed = subprocess.run(
            [*runner.PYTHON, str(runner.HERE / "render.py"), str(work)],
            cwd=work,
            env=runner.render_env(work),
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        lines = set(completed.stdout.splitlines())
        expected = {
            "open NameError",
            "eval NameError",
            "getattr NameError",
            "type NameError",
            "import os ImportError",
            "import utils ImportError",
            "import capture ImportError",
            "import numpy lib ImportError",
            "np.lib AttributeError",
            "config AttributeError",
            "RED NameError",
            "logger NameError",
            "Circle allowed",
        }
        self.assertEqual(expected - lines, set(), completed.stdout)


@unittest.skipUnless(landlock_abi() >= 1, "the kernel offers no Landlock")
class ConfinementTest(unittest.TestCase):
    def setUp(self) -> None:
        self.work = Path("/tmp/confined/work")
        self.work.mkdir(parents=True, exist_ok=True)
        for box in ("in", "out"):
            (EXCHANGE / "confined" / box).mkdir(parents=True, exist_ok=True)
        self.secret = EXCHANGE / "confined" / "in" / "queued.py"
        self.secret.write_text("queued job")

    def attempt(self, code: str) -> str:
        return run_python(
            f"""
            import os, socket
            from confine import confine
            confine({str(self.work)!r})
            try:
                {code}
                print("allowed")
            except OSError as error:
                print("refused", type(error).__name__)
            """
        ).strip()

    def test_the_work_directory_stays_writable(self) -> None:
        self.assertEqual(self.attempt(f"open({str(self.work / 'ok')!r}, 'w').write('x')"), "allowed")

    def test_the_exchange_volume_is_out_of_reach(self) -> None:
        self.assertEqual(self.attempt(f"open({str(self.secret)!r}).read()"), "refused PermissionError")
        target = EXCHANGE / "confined" / "out" / "forged.json"
        self.assertEqual(self.attempt(f"open({str(target)!r}, 'w')"), "refused PermissionError")
        self.assertEqual(self.attempt(f"os.listdir({str(EXCHANGE)!r})"), "refused PermissionError")

    def test_tmp_outside_the_work_directory_is_out_of_reach(self) -> None:
        self.assertEqual(self.attempt("open('/tmp/confined/planted', 'w')"), "refused PermissionError")

    def test_the_job_is_the_first_target_of_the_memory_limit(self) -> None:
        score = self.attempt("assert open('/proc/self/oom_score_adj').read() == '1000\\n'")
        self.assertEqual(score, "allowed")

    def test_the_runner_memory_and_environment_are_out_of_reach(self) -> None:
        environ = self.attempt("open(f'/proc/{os.getppid()}/environ').read()")
        self.assertEqual(environ, "refused PermissionError")
        self.assertEqual(self.attempt("open(f'/proc/{os.getppid()}/mem', 'rb')"), "refused PermissionError")

    @unittest.skipUnless(landlock_abi() >= 4, "Landlock ABI 4 is needed to refuse TCP")
    def test_tcp_is_refused_even_on_loopback(self) -> None:
        self.assertEqual(
            self.attempt("socket.create_connection(('127.0.0.1', 9), timeout=2)"), "refused PermissionError"
        )

    @unittest.skipUnless(landlock_abi() >= 6, "Landlock ABI 6 is needed to scope signals")
    def test_signals_cannot_reach_the_parent(self) -> None:
        self.assertEqual(self.attempt("os.kill(os.getppid(), 0)"), "refused PermissionError")


if __name__ == "__main__":
    unittest.main()
