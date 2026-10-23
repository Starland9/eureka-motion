import ast
import json
import re
import sys
from pathlib import Path
from typing import NamedTuple

MAX_LINES = 300
MAX_BYTES = 64 * 1024
MAX_VIOLATIONS = 20

ALLOWED_MODULES = frozenset({"manim", "math", "numpy"})
SCENE_BASES = frozenset(
    {
        "Scene",
        "MovingCameraScene",
        "ThreeDScene",
        "SpecialThreeDScene",
        "ZoomedScene",
        "VectorScene",
        "LinearTransformationScene",
    }
)
CONFIG_READABLE = (
    "frame_width",
    "frame_height",
    "frame_x_radius",
    "frame_y_radius",
    "pixel_width",
    "pixel_height",
    "frame_rate",
)

# Builtins that run code, touch files or the console, or reach attributes by name.
FORBIDDEN_BUILTINS = frozenset(
    {
        "eval",
        "exec",
        "compile",
        "open",
        "input",
        "breakpoint",
        "exit",
        "quit",
        "help",
        "getattr",
        "setattr",
        "delattr",
        "hasattr",
        "vars",
        "globals",
        "locals",
        "dir",
        "type",
        "memoryview",
        "license",
        "credits",
        "copyright",
    }
)
FORBIDDEN_MODULES = frozenset(
    {"os", "sys", "subprocess", "socket", "pathlib", "shutil", "importlib", "builtins", "ctypes"}
)
FORBIDDEN_NAMES = FORBIDDEN_BUILTINS | FORBIDDEN_MODULES

# Names of `from manim import *` that the sandbox does not hand to the scene: modules, and
# functions that run programs, touch files, change the configuration or write to the console.
HIDDEN_MANIM = frozenset(
    {
        "AS2700",
        "BS381",
        "DVIPSNAMES",
        "SVGNAMES",
        "X11",
        "XKCD",
        "animation",
        "camera",
        "color",
        "constants",
        "core",
        "data_structures",
        "manager",
        "manim_colors",
        "mobject",
        "opengl",
        "plugins",
        "rate_functions",
        "renderer",
        "scene",
        "typing",
        "unit",
        "utils",
        "CONTEXT_SETTINGS",
        "SceneFileWriter",
        "TexFontTemplates",
        "TexTemplate",
        "TexTemplateLibrary",
        "add_extension_if_not_present",
        "capture",
        "cli_ctx_settings",
        "console",
        "ensure_executable",
        "error_console",
        "frame",
        "get_dir_layout",
        "get_full_raster_image_path",
        "get_full_sound_file_path",
        "get_ipython",
        "get_plugins",
        "get_video_metadata",
        "guarantee_empty_existence",
        "guarantee_existence",
        "ipy",
        "list_plugins",
        "logger",
        "modify_atime",
        "open_file",
        "register_font",
        "seek_full_path_from_defaults",
        "tempconfig",
    }
)
HIDDEN_NUMPY = frozenset(
    {
        "DataSource",
        "core",
        "ctypeslib",
        "distutils",
        "f2py",
        "fromfile",
        "fromregex",
        "genfromtxt",
        "lib",
        "load",
        "loadtxt",
        "memmap",
        "save",
        "savetxt",
        "savez",
        "savez_compressed",
        "show_config",
        "show_runtime",
        "testing",
        "typing",
    }
)
COLOUR_FUNCTIONS = frozenset(
    {
        "ManimColor",
        "RandomColorGenerator",
        "average_color",
        "color_gradient",
        "interpolate_color",
        "invert_color",
        "random_bright_color",
        "random_color",
        "rgb_to_color",
        "rgba_to_color",
    }
)
_COLOUR_NAME = re.compile(
    r"(?:(?:PURE|DARK|DARKER|LIGHT|LIGHTER|LOGO)_)?"
    r"(?:WHITE|BLACK|GRAY|GREY|RED|GREEN|BLUE|CYAN|MAGENTA|YELLOW|GOLD|TEAL|MAROON|PURPLE|PINK"
    r"|ORANGE|BROWN|GRAY_BROWN|GREY_BROWN)(?:_[A-E])?"
)
_HEX_COLOUR = re.compile(r"#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})")

# Standard-library module names are refused as attributes because a module reached through
# another one (typing.operator, np.os) gives everything that module holds.
_COMMON_ATTRIBUTES = frozenset({"array", "copy", "math", "random", "time"})
FORBIDDEN_ATTRIBUTES = (
    (frozenset(sys.stdlib_module_names) - _COMMON_ATTRIBUTES)
    | FORBIDDEN_NAMES
    | HIDDEN_NUMPY
    # Frame and code introspection, attribute access by name, the file writers of Manim, Cairo,
    # PIL and numpy objects, the attributes holding a pathlib.Path and the methods of one.
    | {
        "ag_await",
        "ag_code",
        "ag_frame",
        "as_strided",
        "attrgetter",
        "chmod",
        "config",
        "copy_into",
        "cr_await",
        "cr_code",
        "cr_frame",
        "create_from_png",
        "dump",
        "f_back",
        "f_builtins",
        "f_code",
        "f_globals",
        "f_locals",
        "file_name",
        "file_path",
        "file_writer",
        "file_writer_settings",
        "gi_code",
        "gi_frame",
        "gi_yieldfrom",
        "hardlink_to",
        "hash_seed",
        "itemgetter",
        "iterdir",
        "lchmod",
        "methodcaller",
        "mkdir",
        "move",
        "move_into",
        "mro",
        "npyio",
        "open_memmap",
        "opengl",
        "output_plan",
        "parser",
        "plugins",
        "read_bytes",
        "read_text",
        "readlink",
        "rename",
        "rglob",
        "rmdir",
        "save_image",
        "save_static_frame_data",
        "set_default",
        "show",
        "stride_tricks",
        "symlink_to",
        "tb_frame",
        "tb_next",
        "tex_compiler",
        "tex_template",
        "tofile",
        "touch",
        "unlink",
        "utils",
        "walk",
        "write_bytes",
        "write_frame",
        "write_subcaption_file",
        "write_text",
        "write_to_png",
    }
)
THEME_KEYS = frozenset(
    {
        "background_color",
        "background_opacity",
        "background_image",
        "pixel_width",
        "pixel_height",
        "frame_rate",
    }
)
_STORE_PROTECTED = THEME_KEYS | {"background"}
_FORBIDDEN_KEYWORDS = frozenset({"gradient", "t2f", "t2g", "tex_template"})
_GRADIENT_ATTRIBUTES = frozenset(
    {"set_color_by_gradient", "set_colors_by_radial_gradient", "set_sheen", "set_sheen_direction"}
)


def _preamble_names() -> frozenset[str]:
    tree = ast.parse((Path(__file__).resolve().parent / "preamble.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "__all__" for target in node.targets
        ):
            return frozenset(ast.literal_eval(node.value))
    raise RuntimeError("preamble.py declares no __all__")


PREAMBLE_NAMES = _preamble_names()
PREAMBLE_FONTS = frozenset(name for name in PREAMBLE_NAMES if name.endswith("_FONT"))
_THEME_COLOURS = ", ".join(
    sorted(name for name in PREAMBLE_NAMES if not name.endswith("_FONT") and not name.startswith("STROKE"))
)


class Violation(NamedTuple):
    line: int
    reason: str

    def __str__(self) -> str:
        return f"line {self.line}: {self.reason}" if self.line else self.reason


def is_colour(name: str) -> bool:
    return bool(_COLOUR_NAME.fullmatch(name)) or name in COLOUR_FUNCTIONS


def _is_super_call(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "super"


class _Checker:
    def __init__(self, tree: ast.Module) -> None:
        self.tree = tree
        self.found: list[Violation] = []
        self.parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        self.bound = self._bound_names()

    def run(self) -> list[Violation]:
        for node in ast.walk(self.tree):
            handler = getattr(self, f"_visit_{type(node).__name__}", None)
            if handler is not None:
                handler(node)
        self._check_scenes()
        return sorted(set(self.found))[:MAX_VIOLATIONS]

    def _flag(self, node: ast.AST | None, reason: str) -> None:
        self.found.append(Violation(getattr(node, "lineno", 0), reason))

    def _bound_names(self) -> set[str]:
        names: set[str] = set()
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Name) and not isinstance(node.ctx, ast.Load):
                names.add(node.id)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, ast.arg):
                names.add(node.arg)
            elif isinstance(node, ast.alias) and node.name != "*":
                names.add(node.asname or node.name.split(".")[0])
            elif isinstance(node, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)) and node.name:
                names.add(node.name)
            elif isinstance(node, ast.MatchMapping) and node.rest:
                names.add(node.rest)
        return names

    def _bind(self, node: ast.AST, name: str) -> None:
        if "__" in name:
            self._flag(node, f"the name {name} contains a double underscore")
        elif name in FORBIDDEN_NAMES:
            self._flag(node, f"the name {name} is not allowed")
        elif name in PREAMBLE_NAMES or name == "config":
            self._flag(node, f"{name} is set by the sandbox and cannot be redefined")

    def _attribute(self, node: ast.AST, attr: str, owner: ast.AST | None = None) -> None:
        if "__" in attr:
            if not (attr == "__init__" and _is_super_call(owner)):
                self._flag(node, f"the attribute {attr} contains a double underscore")
        elif attr.startswith("_"):
            self._flag(node, f"the private attribute {attr} is not allowed")
        elif {attr, attr.removeprefix("get_"), attr.removeprefix("set_")} & FORBIDDEN_ATTRIBUTES:
            self._flag(node, f"the attribute {attr} is not allowed")
        elif attr in _GRADIENT_ATTRIBUTES:
            self._flag(node, f"{attr} draws a gradient or a sheen, which the design system refuses")

    def _visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name not in ALLOWED_MODULES - {"manim"}:
                self._flag(
                    node,
                    f"import {alias.name} is not allowed:"
                    " use from manim import ..., import numpy or import math",
                )
            if alias.asname:
                self._bind(node, alias.asname)

    def _visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        if node.level or module not in ALLOWED_MODULES:
            self._flag(node, f"from {'.' * node.level}{module} import is not allowed")
            return
        hidden = {"manim": HIDDEN_MANIM, "numpy": HIDDEN_NUMPY}.get(module, frozenset())
        for alias in node.names:
            name = alias.name
            if name == "*":
                if module != "manim":
                    self._flag(node, f"from {module} import * is not allowed")
                continue
            if name.startswith("_") or name in hidden or name in FORBIDDEN_NAMES:
                self._flag(node, f"{name} cannot be imported from {module}")
            elif module == "manim" and is_colour(name):
                self._flag(node, f"{name} is a Manim colour; use a theme colour: {_THEME_COLOURS}")
            if name == "config":
                if alias.asname is not None:
                    self._flag(node, "config cannot be imported under another name")
                continue
            self._bind(node, alias.asname or name)

    def _visit_Name(self, node: ast.Name) -> None:
        name = node.id
        if not isinstance(node.ctx, ast.Load):
            self._bind(node, name)
        elif "__" in name:
            self._flag(node, f"the name {name} contains a double underscore")
        elif name in FORBIDDEN_NAMES:
            self._flag(node, f"{name} is not allowed")
        elif name == "config":
            parent = self.parents.get(node)
            if not (
                isinstance(parent, ast.Attribute)
                and parent.value is node
                and isinstance(parent.ctx, ast.Load)
                and parent.attr in CONFIG_READABLE
            ):
                readable = ", ".join(CONFIG_READABLE)
                self._flag(node, f"config can only be read, as config.<name> with: {readable}")
        elif name not in self.bound:
            if is_colour(name):
                self._flag(node, f"{name} is a Manim colour; use a theme colour: {_THEME_COLOURS}")
            elif name in HIDDEN_MANIM:
                self._flag(node, f"{name} is not available in the sandbox")

    def _visit_Attribute(self, node: ast.Attribute) -> None:
        self._attribute(node, node.attr, node.value)
        if not isinstance(node.ctx, ast.Load) and node.attr in _STORE_PROTECTED:
            self._flag(node, f"{node.attr} is set by the sandbox and cannot be changed")

    def _visit_MatchClass(self, node: ast.MatchClass) -> None:
        for attr in node.kwd_attrs:
            self._attribute(node, attr)

    def _visit_MatchAs(self, node: ast.MatchAs) -> None:
        if node.name:
            self._bind(node, node.name)

    def _visit_MatchStar(self, node: ast.MatchStar) -> None:
        if node.name:
            self._bind(node, node.name)

    def _visit_MatchMapping(self, node: ast.MatchMapping) -> None:
        if node.rest:
            self._bind(node, node.rest)

    def _visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        if node.name:
            self._bind(node, node.name)

    def _visit_arg(self, node: ast.arg) -> None:
        self._bind(node, node.arg)

    def _visit_FunctionDef(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        if not (node.name == "__init__" and isinstance(self.parents.get(node), ast.ClassDef)):
            self._bind(node, node.name)

    _visit_AsyncFunctionDef = _visit_FunctionDef

    def _visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._bind(node, node.name)
        if node.name in SCENE_BASES:
            self._flag(node, f"the class name {node.name} is reserved by Manim")
        if node.keywords:
            self._flag(node, "class keywords such as metaclass are not allowed")

    def _visit_keyword(self, node: ast.keyword) -> None:
        name = node.arg
        if name is None:
            return
        if "__" in name:
            self._flag(node, f"the keyword {name} contains a double underscore")
        elif name in THEME_KEYS:
            self._flag(node, f"{name} is set by the sandbox and cannot be changed")
        elif name in _FORBIDDEN_KEYWORDS:
            self._flag(node, f"the keyword {name} is not allowed")
        elif name == "font" and not (isinstance(node.value, ast.Name) and node.value.id in PREAMBLE_FONTS):
            self._flag(node, f"font takes one of {', '.join(sorted(PREAMBLE_FONTS))}")

    def _visit_Constant(self, node: ast.Constant) -> None:
        value = node.value
        if isinstance(value, bytes):
            value = value.decode("latin-1")
        if not isinstance(value, str):
            return
        if "__" in value:
            self._flag(node, "strings containing a double underscore are not allowed")
        elif value in THEME_KEYS:
            self._flag(node, f"{value} is set by the sandbox and cannot be changed")
        elif _HEX_COLOUR.fullmatch(value.strip()):
            self._flag(node, f"colours come from the theme: {_THEME_COLOURS}")

    def _check_scenes(self) -> None:
        classes = [node for node in ast.walk(self.tree) if isinstance(node, ast.ClassDef)]
        scene_like = set(SCENE_BASES)
        grew = True
        while grew:
            grew = False
            for node in classes:
                if node.name not in scene_like and any(
                    isinstance(base, ast.Name) and base.id in scene_like for base in node.bases
                ):
                    scene_like.add(node.name)
                    grew = True
        scenes = [node for node in classes if node.name in scene_like]
        if len(scenes) != 1:
            self._flag(
                None,
                f"the file must define exactly one class deriving from {', '.join(sorted(SCENE_BASES))};"
                f" found {len(scenes)}",
            )
        elif scenes[0] not in self.tree.body:
            self._flag(scenes[0], "the scene class must be defined at the top level of the file")


def check(data: bytes) -> list[Violation]:
    if len(data) > MAX_BYTES:
        return [Violation(0, f"the file is larger than {MAX_BYTES} bytes")]
    if b"\0" in data:
        return [Violation(0, "the file contains a null byte")]
    try:
        source = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        return [Violation(0, f"the file is not valid UTF-8 (byte {error.start})")]
    if len(source.splitlines()) > MAX_LINES:
        return [Violation(0, f"the file has more than {MAX_LINES} lines")]
    try:
        tree = ast.parse(source, filename="scene.py")
    except SyntaxError as error:
        return [Violation(error.lineno or 0, f"syntax error: {error.msg}")]
    except (RecursionError, MemoryError, ValueError):
        return [Violation(0, "the file is too deeply nested to be analysed")]
    return _Checker(tree).run()


def main() -> int:
    from confine import confine

    confine(None, cpu_seconds=10, max_file_bytes=1 << 20)
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    print(json.dumps([str(violation) for violation in check(data)]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
