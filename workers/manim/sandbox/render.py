import builtins
import collections
import sys
import traceback
import types
from collections.abc import Callable
from pathlib import Path

from confine import confine
from static_check import (
    CONFIG_READABLE,
    COLOUR_FUNCTIONS,
    FORBIDDEN_BUILTINS,
    HIDDEN_MANIM,
    HIDDEN_NUMPY,
)

SCENE_FILE = "scene.py"
SCENE_MODULE = "scene"


def _view(
    name: str,
    module: types.ModuleType,
    allowed: Callable[[str, object], bool],
    overrides: dict[str, object],
) -> types.ModuleType:
    # from-imports fall back to sys.modules[f"{view.__name__}.{attribute}"]: no real module
    # name may start with this one.
    view = types.ModuleType(f"sandbox view of {name}")

    def lookup(attribute: str) -> object:
        if attribute in overrides:
            return overrides[attribute]
        if not attribute.startswith("_") and hasattr(module, attribute):
            value = getattr(module, attribute)
            if allowed(attribute, value):
                return value
        raise AttributeError(f"{name}.{attribute} is not available in the sandbox")

    public = [attribute for attribute in vars(module) if not attribute.startswith("_")]
    view.__getattr__ = lookup
    view.__all__ = sorted(
        {attribute for attribute in public if allowed(attribute, getattr(module, attribute))} | set(overrides)
    )
    return view


# Behind the static check, the scene sees filtered views of manim and numpy, a frozen copy of
# the readable config and builtins without the forbidden ones.
def _modules() -> dict[str, types.ModuleType]:
    import math

    import manim
    import numpy

    numpy_view = _view("numpy", numpy, lambda name, value: name not in HIDDEN_NUMPY, {})
    frozen = collections.namedtuple("Config", CONFIG_READABLE)
    settings = frozen(*(getattr(manim.config, name) for name in CONFIG_READABLE))

    def manim_allowed(name: str, value: object) -> bool:
        return not (
            name in HIDDEN_MANIM
            or name in COLOUR_FUNCTIONS
            or isinstance(value, (types.ModuleType, manim.ManimColor))
        )

    manim_view = _view("manim", manim, manim_allowed, {"np": numpy_view, "config": settings})
    return {"manim": manim_view, "numpy": numpy_view, "math": math}


def _builtins(modules: dict[str, types.ModuleType]) -> dict[str, object]:
    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level == 0 and name in modules:
            return modules[name]
        raise ImportError(f"import of {name} is not allowed in the sandbox")

    allowed = {
        name: value
        for name, value in vars(builtins).items()
        if name not in FORBIDDEN_BUILTINS and (not name.startswith("__") or name == "__build_class__")
    }
    allowed["__import__"] = guarded_import
    return allowed


def _configure(config, work: Path) -> None:
    config.media_dir = str(work / "media")
    config.video_dir = str(work / "video")
    config.output_file = "scene"
    config.format = "mp4"
    config.disable_caching = True
    config.write_to_movie = True
    config.save_last_frame = False
    config.preview = False
    config.progress_bar = "none"
    config.verbosity = "WARNING"


def _report(error: BaseException) -> None:
    frames = [frame for frame in traceback.extract_tb(error.__traceback__) if frame.filename == SCENE_FILE]
    text = "".join(traceback.format_list(frames)) + "".join(traceback.format_exception_only(error))
    print(f"Error in {SCENE_FILE}:\n{text}", end="", file=sys.stderr)


def main() -> int:
    work = Path(sys.argv[1])
    confine(str(work))
    import preamble
    from manim import Scene, config

    _configure(config, work)
    source = (work / SCENE_FILE).read_text(encoding="utf-8-sig")
    namespace: dict[str, object] = {"__name__": SCENE_MODULE, "__builtins__": _builtins(_modules())}
    namespace.update((name, getattr(preamble, name)) for name in preamble.__all__)
    try:
        exec(compile(source, SCENE_FILE, "exec", dont_inherit=True), namespace)
        scenes = [
            value
            for value in list(namespace.values())
            if isinstance(value, type) and issubclass(value, Scene) and value.__module__ == SCENE_MODULE
        ]
        if len(scenes) != 1:
            raise LookupError(
                f"expected one scene class at the top level of {SCENE_FILE}, found {len(scenes)}"
            )
        scenes[0]().render()
    except BaseException as error:
        _report(error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
