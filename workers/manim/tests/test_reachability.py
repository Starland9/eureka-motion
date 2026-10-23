import builtins
import collections
import io
import os
import subprocess
import sys
import types
import unittest
import warnings

import numpy as np
import render
from manim import config
from static_check import FORBIDDEN_ATTRIBUTES

RISKY_ORIGINS = {
    "_io",
    "av",
    "click",
    "cloup",
    "codecs",
    "ctypes",
    "http",
    "importlib",
    "io",
    "logging",
    "multiprocessing",
    "os",
    "pathlib",
    "posix",
    "rich",
    "shutil",
    "socket",
    "sqlite3",
    "subprocess",
    "tarfile",
    "tempfile",
    "threading",
    "urllib",
    "zipfile",
}
DANGEROUS = {
    id(value): name
    for name, value in {
        "open": builtins.open,
        "eval": builtins.eval,
        "exec": builtins.exec,
        "compile": builtins.compile,
        "getattr": builtins.getattr,
        "setattr": builtins.setattr,
        "__import__": builtins.__import__,
        "vars": builtins.vars,
        "globals": builtins.globals,
        "builtins": builtins,
        "builtins dict": vars(builtins),
        "os.system": os.system,
        "subprocess.Popen": subprocess.Popen,
        "io.open": io.open,
    }.items()
}


def accepted(name: str) -> bool:
    candidates = {name, name.removeprefix("get_"), name.removeprefix("set_")}
    return "__" not in name and not name.startswith("_") and not candidates & FORBIDDEN_ATTRIBUTES


def roots() -> dict[str, object]:
    import manim
    import preamble

    modules = render._modules()
    safe_builtins = render._builtins(modules)
    star: dict[str, object] = {"__builtins__": safe_builtins, "__name__": "scene"}
    exec("from manim import *", star)
    found = {f"star.{name}": value for name, value in star.items() if not name.startswith("__")}
    found |= {f"builtins.{name}": value for name, value in safe_builtins.items() if not name.startswith("__")}
    found |= {f"preamble.{name}": getattr(preamble, name) for name in preamble.__all__}
    circle = manim.Circle()
    found |= {
        "np": modules["numpy"],
        "math": modules["math"],
        "scene": manim.Scene(),
        "moving_scene": manim.MovingCameraScene(),
        "three_d_scene": manim.ThreeDScene(),
        "zoomed_scene": manim.ZoomedScene(),
        "circle": circle,
        "text": manim.Text("a"),
        "formula": manim.MathTex("x"),
        "code": manim.Code(code_string="x = 1", language="python"),
        "image": manim.ImageMobject(np.zeros((4, 4, 3), dtype=np.uint8)),
        "axes": manim.Axes(),
        "number": manim.DecimalNumber(1.5),
        "tracker": manim.ValueTracker(1),
        "animation": manim.Create(circle),
        "function": lambda: 0,
        "generator": (item for item in ()),
        "exception": ValueError("x"),
    }
    return found


def explore(depth_limit: int, getter_depth: int) -> tuple[int, dict[str, str]]:
    module_globals = {id(vars(module)): name for name, module in list(sys.modules.items())}
    queue = collections.deque((path, value, 0) for path, value in roots().items())
    # Values are kept alive so that no id is reused by a temporary object.
    seen: dict[int, object] = {}
    findings: dict[str, str] = {}
    while queue:
        path, value, depth = queue.popleft()
        if id(value) in seen or isinstance(value, np.ndarray) and value.size > 1000:
            continue
        seen[id(value)] = value
        kind = type(value)
        origin = (getattr(kind, "__module__", "") or "").split(".")[0]
        if id(value) in DANGEROUS:
            findings.setdefault(DANGEROUS[id(value)], path)
        elif isinstance(value, types.ModuleType):
            if not value.__name__.startswith(("numpy", "math", "sandbox view")):
                findings.setdefault(f"module {value.__name__}", path)
        elif isinstance(value, dict) and id(value) in module_globals:
            findings.setdefault(f"globals of {module_globals[id(value)]}", path)
        elif isinstance(value, io.IOBase) or origin in RISKY_ORIGINS:
            findings.setdefault(f"{kind.__module__}.{kind.__qualname__}", path)
        if depth >= depth_limit or isinstance(value, (str, bytes, int, float, complex)):
            continue
        if isinstance(value, dict):
            children = [(f"{path}[{key!r}]", item) for key, item in list(value.items())[:200]]
        elif isinstance(value, (list, tuple)):
            children = [(f"{path}[{index}]", item) for index, item in enumerate(value[:50])]
        else:
            children = []
        try:
            names = dir(value)
        except Exception:
            names = []
        for name in names:
            if not accepted(name):
                continue
            try:
                child = getattr(value, name)
                children.append((f"{path}.{name}", child))
                if depth < getter_depth and name.startswith("get_") and isinstance(child, types.MethodType):
                    children.append((f"{path}.{name}()", child()))
            except Exception:
                continue
        queue.extend((child_path, child, depth + 1) for child_path, child in children)
    return len(seen), findings


class ReachabilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        warnings.simplefilter("ignore")
        config.media_dir = "/tmp/reachability-media"
        config.verbosity = "ERROR"

    def test_nothing_risky_is_reachable_through_accepted_attributes(self) -> None:
        count, findings = explore(depth_limit=7, getter_depth=0)
        self.assertGreater(count, 100_000)
        self.assertEqual(findings, {})

    def test_nothing_risky_is_returned_by_getters_near_the_scene(self) -> None:
        count, findings = explore(depth_limit=5, getter_depth=2)
        self.assertGreater(count, 50_000)
        self.assertEqual(findings, {})


if __name__ == "__main__":
    unittest.main()
