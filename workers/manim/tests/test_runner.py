import json
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path

import av
from support import (
    LOOP_SCENE,
    QUICK_SCENE,
    REFUSED_SCENE,
    SAMPLES,
    Sandbox,
    alive,
    processes_running,
    wait_for,
)

RESULT_KEYS = ["ok", "stage", "duration_ms", "error", "stderr_tail"]


class RunnerTest(unittest.TestCase):
    def tearDown(self) -> None:
        wait_for(lambda: not processes_running("render.py"), 10, "render processes to end")

    def test_the_sample_renders_at_1280x720_on_the_board(self) -> None:
        with Sandbox("sample") as box:
            box.submit("deriv-1", (SAMPLES / "derivative.py").read_text())
            result = box.result("deriv-1", timeout=150)
        self.assertEqual(list(result), RESULT_KEYS)
        self.assertEqual((result["ok"], result["stage"], result["error"]), (True, "render", ""), result)
        video = box.outbox / "deriv-1.mp4"
        self.assertGreater(video.stat().st_size, 10_000)
        self.assertFalse((box.inbox / "deriv-1.py").exists())
        with av.open(str(video)) as container:
            stream = container.streams.video[0]
            self.assertEqual((stream.codec_context.name, stream.width, stream.height), ("h264", 1280, 720))
            self.assertEqual(stream.average_rate, 30)
            self.assertAlmostEqual(container.duration / 1_000_000, 30, delta=1)
            corner = next(container.decode(stream)).to_ndarray(format="rgb24")[8, 8]
        for channel, expected in zip(corner, (0x1C, 0x26, 0x22)):
            self.assertLessEqual(abs(int(channel) - expected), 4, corner)

    def test_import_os_is_refused_without_rendering(self) -> None:
        with Sandbox("refused") as box:
            box.submit("os-1", REFUSED_SCENE)
            result = box.result("os-1")
            output = box.output()
        self.assertEqual((result["ok"], result["stage"]), (False, "static_check"))
        self.assertIn("line 1: import os is not allowed", result["error"])
        self.assertIn("line 7: os is not allowed", result["error"])
        self.assertNotIn("job os-1: render", output)
        self.assertFalse((box.outbox / "os-1.mp4").exists())

    def test_an_infinite_loop_is_killed_at_the_time_limit(self) -> None:
        with Sandbox("loop", SANDBOX_RENDER_TIMEOUT_S="5") as box:
            box.submit("loop-1", LOOP_SCENE)
            result = box.result("loop-1", timeout=30)
        self.assertEqual((result["ok"], result["stage"]), (False, "render"))
        self.assertEqual(result["error"], "the render exceeded 5 seconds")
        self.assertGreaterEqual(result["duration_ms"], 5000)
        self.assertLess(result["duration_ms"], 9000)
        self.assertEqual(processes_running("render.py"), [])

    def test_a_python_error_gives_a_useful_tail(self) -> None:
        source = QUICK_SCENE.replace("self.wait(0.2)", 'raise ValueError("deliberate failure")')
        with Sandbox("error") as box:
            box.submit("error-1", source)
            result = box.result("error-1")
        self.assertEqual((result["ok"], result["stage"]), (False, "render"))
        self.assertEqual(result["error"], "the render failed with exit code 1")
        tail = result["stderr_tail"]
        self.assertLessEqual(len(tail), 2000)
        self.assertIn('File "scene.py", line 7, in construct', tail)
        self.assertIn("ValueError: deliberate failure", tail)
        self.assertNotRegex(tail, r"/(tmp|opt|data)/")

    def test_jobs_run_one_at_a_time_in_order_of_arrival(self) -> None:
        box = Sandbox("order")
        now = time.time()
        for offset, job in ((30, "zulu"), (20, "alpha"), (10, "mike")):
            box.submit(job, QUICK_SCENE, mtime=now - offset)
        with box:
            results = {job: box.result(job) for job in ("zulu", "alpha", "mike")}
            output = box.output()
        self.assertTrue(all(result["ok"] for result in results.values()), results)
        ends = {job: (box.outbox / f"{job}.json").stat().st_mtime for job in results}
        self.assertEqual(sorted(ends, key=ends.get), ["zulu", "alpha", "mike"])
        for before, after in (("zulu", "alpha"), ("alpha", "mike")):
            started = ends[after] - results[after]["duration_ms"] / 1000
            self.assertGreaterEqual(started, ends[before] - 0.05)
        starts = [line.split(":")[0] for line in output.splitlines() if line.endswith(": start")]
        self.assertEqual(starts, ["job zulu", "job alpha", "job mike"])

    def test_the_heartbeat_is_renewed_even_during_a_render(self) -> None:
        with Sandbox("beat", SANDBOX_HEARTBEAT_S="1", SANDBOX_RENDER_TIMEOUT_S="10") as box:
            beat = box.outbox / ".heartbeat"
            first = int(wait_for(lambda: beat.exists() and beat.read_text(), 10, "a heartbeat"))
            self.assertRegex(beat.read_text(), r"^[0-9]+$")
            self.assertLess(abs(first - time.time()), 5)
            box.submit("beat-1", LOOP_SCENE)
            wait_for(lambda: "job beat-1: render" in box.output(), 30, "the render to start")
            seen = int(beat.read_text())
            renewed = wait_for(
                lambda: int(beat.read_text()) >= seen + 2 and int(beat.read_text()), 6, "a new beat"
            )
            self.assertFalse((box.outbox / "beat-1.json").exists(), "the render was over before the beat")
            self.assertGreater(renewed, first)

    def test_sigterm_ends_the_render_and_reports_it(self) -> None:
        box = Sandbox("term").start()
        box.submit("term-1", LOOP_SCENE)
        wait_for(lambda: "job term-1: render" in box.output(), 30, "the render to start")
        time.sleep(1)
        self.assertTrue(processes_running("render.py"))
        self.assertEqual(box.stop(), 0)
        result = json.loads((box.outbox / "term-1.json").read_text())
        self.assertEqual((result["ok"], result["stage"]), (False, "render"))
        self.assertEqual(result["error"], "the sandbox stopped before the render finished")
        self.assertFalse((box.inbox / "term-1.py").exists())
        self.assertIn("sandbox stopped", box.output())
        self.assertEqual(processes_running("render.py"), [])

    def test_hostile_file_names_are_ignored(self) -> None:
        box = Sandbox("names")
        ignored = ["has space.py", "dot.name.py", "x" * 65 + ".py", "upper.PY", "job.py.part", ".hidden.py"]
        ignored += ["é.py", "semi;colon.py", "new\nline.py", "x.py.json"]
        for name in ignored:
            (box.inbox / name).write_text(REFUSED_SCENE)
        escape = box.root / "escape.py"
        escape.write_text(REFUSED_SCENE)
        (box.inbox / "folder.py").mkdir()
        os.mkfifo(box.inbox / "fifo.py")
        (box.inbox / "link.py").symlink_to("/etc/passwd")
        with box:
            for job in ("folder", "fifo", "link"):
                result = box.result(job)
                self.assertEqual((result["ok"], result["stage"]), (False, "static_check"))
                self.assertEqual(result["error"], "the job file is not a regular file")
            box.submit("sentinel", REFUSED_SCENE)
            box.result("sentinel")
        for name in ignored:
            self.assertTrue((box.inbox / name).exists(), name)
        self.assertTrue(escape.exists())
        self.assertEqual(sorted(os.listdir(box.inbox)), sorted(ignored))
        results = sorted(name for name in os.listdir(box.outbox) if not name.endswith(".part"))
        self.assertEqual(results, [".heartbeat", "fifo.json", "folder.json", "link.json", "sentinel.json"])
        self.assertNotIn("root:", (box.outbox / "link.json").read_text())
        self.assertTrue(Path("/etc/passwd").read_text().startswith("root:"))

    def test_a_file_over_300_lines_is_refused(self) -> None:
        source = QUICK_SCENE + "        self.wait(0.1)\n" * (301 - len(QUICK_SCENE.splitlines()))
        with Sandbox("long") as box:
            box.submit("long-1", source)
            result = box.result("long-1")
        self.assertEqual((result["ok"], result["stage"]), (False, "static_check"))
        self.assertEqual(result["error"], "the file has more than 300 lines")

    def test_an_oversized_video_is_refused(self) -> None:
        with Sandbox("big", SANDBOX_MAX_VIDEO_BYTES="1000") as box:
            box.submit("big-1", QUICK_SCENE)
            result = box.result("big-1")
        self.assertEqual((result["ok"], result["stage"]), (False, "render"))
        self.assertRegex(result["error"], r"^the video has [0-9]+ bytes, more than the 1000 allowed$")
        self.assertFalse((box.outbox / "big-1.mp4").exists())

    def test_processes_left_behind_are_killed_after_each_job(self) -> None:
        read, write = os.pipe()
        daemon = (
            "import os, sys, time\n"
            "if os.fork():\n    sys.exit(0)\n"
            "os.setsid()\nos.write(int(sys.argv[1]), str(os.getpid()).encode())\ntime.sleep(300)\n"
        )
        subprocess.run([sys.executable, "-c", daemon, str(write)], pass_fds=(write,), check=True)
        os.close(write)
        pid = int(os.read(read, 32))
        os.close(read)
        self.assertTrue(alive(pid))
        with Sandbox("stray") as box:
            box.submit("stray-1", REFUSED_SCENE)
            box.result("stray-1")
        wait_for(lambda: not alive(pid), 5, "the stray process to die")

    def test_a_restart_discards_what_a_crash_left(self) -> None:
        box = Sandbox("recover")
        (box.outbox / ".half.json.part").write_text("{")
        (box.outbox / "lost.mp4").write_bytes(b"partial")
        box.submit("lost", REFUSED_SCENE)
        done = '{"ok": true, "stage": "render", "duration_ms": 1, "error": "", "stderr_tail": ""}'
        (box.outbox / "done.json").write_text(done)
        (box.outbox / "done.mp4").write_bytes(b"video")
        box.submit("done", QUICK_SCENE)
        (box.outbox / "trap.mp4").symlink_to("/etc/passwd")
        with box:
            result = box.result("lost")
            wait_for(lambda: not (box.inbox / "done.py").exists(), 5, "the delivered input to go")
            output = box.output()
        self.assertEqual(result["stage"], "static_check")
        self.assertFalse((box.outbox / ".half.json.part").exists())
        self.assertFalse((box.outbox / "lost.mp4").exists())
        self.assertFalse((box.outbox / "trap.mp4").is_symlink())
        self.assertEqual((box.outbox / "done.json").read_text(), done)
        self.assertTrue((box.outbox / "done.mp4").exists())
        self.assertNotIn("job done:", output)
        self.assertNotIn("failed:", output)


if __name__ == "__main__":
    unittest.main()
