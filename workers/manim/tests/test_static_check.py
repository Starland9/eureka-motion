import textwrap
import types
import unittest

from static_check import HIDDEN_MANIM, MAX_BYTES, MAX_LINES, PREAMBLE_NAMES, check
from support import SAMPLES


def scene(body: str, header: str = "from manim import *\nimport numpy as np\nimport math\n") -> str:
    return (
        header
        + "\n\nclass Demo(Scene):\n    def construct(self):\n"
        + textwrap.indent(textwrap.dedent(body).strip("\n"), "        ")
        + "\n"
    )


def violations(source: str | bytes) -> list[str]:
    return [str(item) for item in check(source if isinstance(source, bytes) else source.encode())]


class StaticCheckTestCase(unittest.TestCase):
    def assertAccepted(self, source: str) -> None:
        self.assertEqual(violations(source), [])

    def assertRefused(self, source: str | bytes, *fragments: str) -> None:
        found = violations(source)
        self.assertTrue(found, "the source was accepted")
        for fragment in fragments:
            self.assertTrue(any(fragment in item for item in found), f"{fragment!r} not in {found}")


class AcceptedCodeTest(StaticCheckTestCase):
    def test_the_sample_passes(self) -> None:
        self.assertAccepted((SAMPLES / "derivative.py").read_text())

    def test_ordinary_manim_code_passes(self) -> None:
        self.assertAccepted(
            textwrap.dedent(
                """
                from manim import *
                import numpy as np
                import math


                class Marker(VGroup):
                    def __init__(self, label, **kwargs):
                        super().__init__(**kwargs)
                        self.add(Dot(color=RESULT), Text(label, font=MONO_FONT, font_size=24))


                class Zoom(MovingCameraScene):
                    def construct(self):
                        frame = self.camera.frame
                        width = config.frame_width
                        points = [np.array([x, math.sin(x), 0]) for x in np.linspace(-3, 3, 7)]
                        np.random.seed(1)
                        for color in (QUANTITY, ACTION, VALID):
                            line = Line(LEFT, RIGHT, color=color, stroke_width=STROKE_ACCENT)
                            self.add(line.copy().shift(UP))
                        tracker = ValueTracker(0)
                        label = always_redraw(lambda: MathTex(f"{tracker.get_value():.1f}").to_edge(UP))
                        self.add(label, Marker("m"), *[Dot(p) for p in points])
                        for _ in range(2):
                            self.play(frame.animate.set(width=width / 2), tracker.animate.set_value(1))
                        self.wait()
                """
            )
        )

    def test_three_d_scene_passes(self) -> None:
        source = scene("self.set_camera_orientation(phi=60 * DEGREES)")
        self.assertAccepted(source.replace("(Scene)", "(ThreeDScene)"))

    def test_bom_is_accepted(self) -> None:
        self.assertEqual(violations(b"\xef\xbb\xbf" + scene("self.wait()").encode()), [])


class ImportTest(StaticCheckTestCase):
    def test_import_os_is_refused(self) -> None:
        self.assertRefused(scene("pass", header="import os\nfrom manim import *\n"), "line 1", "import os")

    def test_other_imports_are_refused(self) -> None:
        for header in (
            "import os.path",
            "from os import system",
            "import subprocess as sp",
            "import socket",
            "import importlib",
            "import manim",
            "import numpy.linalg",
            "from numpy.lib import npyio",
            "from . import preamble",
            "from __future__ import annotations",
        ):
            with self.subTest(header):
                self.assertRefused(scene("pass", header=header + "\nfrom manim import *\n"), "not allowed")

    def test_star_imports_other_than_manim_are_refused(self) -> None:
        self.assertRefused(scene("pass", header="from manim import *\nfrom numpy import *\n"), "import *")
        self.assertRefused(scene("pass", header="from manim import *\nfrom math import *\n"), "import *")

    def test_hidden_names_cannot_be_imported(self) -> None:
        for header in (
            "from numpy import load",
            "from numpy import ctypeslib",
            "from manim import capture",
            "from manim import utils",
            "from manim import tempconfig",
            "from manim import _config",
        ):
            with self.subTest(header):
                source = scene("pass", header="from manim import *\n" + header)
                self.assertRefused(source, "cannot be imported")

    def test_config_cannot_be_renamed(self) -> None:
        source = scene("c.pixel_width = 1", header="from manim import config as c\nfrom manim import *")
        self.assertRefused(source, "config")


class EscapeTest(StaticCheckTestCase):
    def test_dangerous_builtins_are_refused(self) -> None:
        for call in (
            "eval('1')",
            "exec('x = 1')",
            "compile('1', 's', 'eval')",
            "open('/etc/passwd')",
            "input()",
            "breakpoint()",
            "exit()",
            "quit()",
            "help(Scene)",
            "getattr(self, 'play')",
            "setattr(self, 'x', 1)",
            "vars(self)",
            "globals()",
            "locals()",
            "dir(self)",
            "type(self).mro()",
        ):
            with self.subTest(call):
                self.assertRefused(scene(call), "is not allowed")

    def test_modules_obtained_through_another_path_are_refused(self) -> None:
        for expression in (
            "os.system('id')",
            "np.os.system('id')",
            "math.sys",
            "np.random.os",
            "Scene.sys",
            "typing.operator.attrgetter('x')",
            "utils.commands.capture(['id'])",
            "capture(['id'])",
            "open_file('x')",
            "logger.handlers",
            "console.save_text('x')",
        ):
            with self.subTest(expression):
                self.assertRefused(scene(expression))

    def test_numpy_file_and_memory_functions_are_refused(self) -> None:
        for expression in (
            "np.load('x')",
            "np.save('x', 1)",
            "np.savez('x', a=1)",
            "np.savetxt('x', [1])",
            "np.loadtxt('x')",
            "np.genfromtxt('x')",
            "np.fromfile('x')",
            "np.memmap('x')",
            "np.zeros(3).tofile('x')",
            "np.zeros(3).dump('x')",
            "np.zeros(3).ctypes.data",
            "np.ctypeslib.load_library('x', '.')",
            "np.lib.npyio.DataSource()",
            "np.lib.stride_tricks.as_strided(np.zeros(1), (9,), (8,))",
            "np.f2py",
            "np.testing",
            "Dot().get_image().show()",
            "Dot().save_image('../../escape')",
            "Text('a').file_name.parents[-1].joinpath('data').write_text('x')",
            "Text('a').get_file_path().unlink()",
            "self.file_writer_settings.assets_dir",
            "self.camera.get_cairo_context(self.camera.pixel_array).get_target().write_to_png('x')",
        ):
            with self.subTest(expression):
                self.assertRefused(scene(expression), "not allowed")

    def test_double_underscore_attributes_are_refused(self) -> None:
        for expression in (
            "().__class__.__bases__[0].__subclasses__()",
            "self.__dict__",
            "self.get___class__()",
            "__import__('os')",
            "__builtins__",
            "__name__",
        ):
            with self.subTest(expression):
                self.assertRefused(scene(expression), "double underscore")

    def test_obfuscated_getattr_is_refused(self) -> None:
        self.assertRefused(scene('getattr(__builtins__, "e" + "val")("1")'), "getattr", "__builtins__")

    def test_strings_cannot_carry_double_underscores(self) -> None:
        for expression in (
            "'{0.__class__}'.format(self)",
            "self.set(**{'__class__': Scene})",
            "b'__globals__'",
            "globals()['__builtins__']",
        ):
            with self.subTest(expression):
                self.assertRefused(scene(expression), "double underscore")

    def test_attributes_inside_fstrings_decorators_lambdas_and_comprehensions_are_seen(self) -> None:
        for body in (
            "x = f'{self.__class__}'",
            "@(lambda f: f.__globals__)\ndef helper():\n    pass",
            "dot = Dot()\ndot.add_updater(lambda m: m.__dict__)",
            "[c for c in ().__class__.__mro__]",
            "{k: v for k, v in self.__dict__.items()}",
        ):
            with self.subTest(body):
                self.assertRefused(scene(body), "double underscore")

    def test_frame_and_traceback_introspection_is_refused(self) -> None:
        for body in (
            "(x for x in ()).gi_frame.f_back.f_globals",
            "[g.gi_frame for g in [iter([])]]",
            "try:\n    1 / 0\nexcept Exception as error:\n"
            "    error.with_traceback(None).__traceback__.tb_frame",
        ):
            with self.subTest(body):
                self.assertRefused(scene(body), "not allowed")

    def test_pattern_matching_cannot_read_attributes(self) -> None:
        self.assertRefused(scene("match self:\n    case object(__class__=c):\n        pass"), "__class__")
        self.assertRefused(scene("match self:\n    case object(f_globals=g):\n        pass"), "f_globals")

    def test_unicode_lookalikes_are_normalised(self) -> None:
        self.assertRefused(scene("ｅｖａｌ('1')"), "eval is not allowed")
        self.assertRefused(scene("self.__ｃｌａｓｓ__"), "double underscore")

    def test_private_attributes_are_refused(self) -> None:
        self.assertRefused(scene("np._core"), "private attribute")

    def test_dunder_methods_other_than_init_are_refused(self) -> None:
        source = scene("pass").replace(
            "class Demo",
            "class Trap(VGroup):\n    def __getattr__(self, name):\n        return name\n\n\nclass Demo",
        )
        self.assertRefused(source, "__getattr__")

    def test_metaclasses_are_refused(self) -> None:
        source = scene("pass").replace("class Demo(Scene)", "class Demo(Scene, metaclass=ABCMeta)")
        self.assertRefused(source, "metaclass")


class ThemeTest(StaticCheckTestCase):
    def test_config_is_read_only(self) -> None:
        for body in (
            "config.pixel_width = 1920",
            "config.frame_rate += 30",
            "config['pixel_width'] = 1920",
            "settings = config",
            "config.update({})",
            "del config.background_color",
        ):
            with self.subTest(body):
                self.assertRefused(scene(body), "config")

    def test_tempconfig_is_refused(self) -> None:
        source = scene("with tempconfig({'frame_rate': 60}):\n    pass")
        self.assertRefused(source, "tempconfig", "frame_rate")

    def test_preamble_names_cannot_be_redefined(self) -> None:
        self.assertIn("BOARD", PREAMBLE_NAMES)
        for body in (
            "CHALK = '#FFFFFF'",
            "BOARD += 'x'",
            "for QUANTITY in range(3):\n    pass",
            "(RESULT := 1)",
            "def VALID():\n    pass",
            "try:\n    pass\nexcept Exception as ACTION:\n    pass",
            "f = lambda TEXT_FONT: TEXT_FONT",
            "del RULE",
        ):
            with self.subTest(body):
                self.assertRefused(scene(body), "set by the sandbox")
        source = scene("pass", header="from manim import *\nimport numpy as CHALK\n")
        self.assertRefused(source, "set by the sandbox")

    def test_background_and_resolution_cannot_be_changed(self) -> None:
        for body in (
            "self.camera.background_color = BOARD",
            "self.camera.background = None",
            "self.camera.set(background_color=BOARD)",
            "self.renderer.camera.pixel_width = 1920",
        ):
            with self.subTest(body):
                self.assertRefused(scene(body), "set by the sandbox")

    def test_defaults_and_fonts_come_from_the_preamble(self) -> None:
        self.assertRefused(scene("Text.set_default(font='Arial')"), "set_default")
        self.assertRefused(scene("Text('x', font='Comic Sans MS')"), "font takes one of")
        self.assertAccepted(scene("Text('x', font=DISPLAY_FONT)"))

    def test_manim_colours_and_hexadecimal_colours_are_refused(self) -> None:
        for body in (
            "Circle(color=RED)",
            "Circle(color=PURE_RED)",
            "Circle(color=BLUE_E)",
            "Circle(color='#FF0000')",
            "Circle(color=ManimColor('#123456'))",
            "Circle(color=interpolate_color(QUANTITY, ACTION, 0.5))",
            "Circle(color=XKCD.AQUA)",
        ):
            with self.subTest(body):
                self.assertRefused(scene(body))
        self.assertRefused(scene("Square().set_color_by_gradient(QUANTITY, ACTION)"), "gradient")

    def test_a_local_name_shadowing_a_colour_is_allowed(self) -> None:
        self.assertAccepted(scene("RED = ACTION\nself.add(Circle(color=RED))"))


class ShapeTest(StaticCheckTestCase):
    def test_exactly_one_scene_class(self) -> None:
        none = "from manim import *\n\n\nclass Shape(VGroup):\n    pass\n"
        self.assertRefused(none, "found 0")
        two = scene("pass") + "\n\nclass Other(MovingCameraScene):\n    pass\n"
        self.assertRefused(two, "found 2")
        derived = scene("pass") + "\n\nclass Again(Demo):\n    pass\n"
        self.assertRefused(derived, "found 2")
        nested = (
            "from manim import *\n\n\ndef make():\n    class Inner(Scene):\n        pass\n    return Inner\n"
        )
        self.assertRefused(nested, "top level")

    def test_manim_class_names_are_reserved(self) -> None:
        self.assertRefused(scene("pass") + "\n\nclass Scene(VGroup):\n    pass\n", "reserved")

    def test_line_limit(self) -> None:
        header = scene("pass")
        filler = 300 - len(header.splitlines())
        self.assertAccepted(header + "# x\n" * filler)
        self.assertRefused(header + "# x\n" * (filler + 1), f"more than {MAX_LINES} lines")

    def test_byte_limit_encoding_and_null_bytes(self) -> None:
        self.assertRefused(scene("pass") + "#" * MAX_BYTES, f"larger than {MAX_BYTES} bytes")
        self.assertRefused(scene("pass").encode() + b"\x00", "null byte")
        self.assertRefused(scene("x = 'caf\xe9'").encode("latin-1"), "not valid UTF-8")

    def test_syntax_errors_and_deep_nesting_are_reported(self) -> None:
        self.assertRefused(scene("self.play("), "syntax error")
        self.assertRefused(scene("x = " + "(" * 500 + ")" * 500))


class ManimSurfaceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.namespace: dict[str, object] = {}
        exec("from manim import *", cls.namespace)

    def test_every_manim_colour_is_refused(self) -> None:
        from manim import ManimColor

        colours = [name for name, value in self.namespace.items() if isinstance(value, ManimColor)]
        self.assertGreater(len(colours), 80)
        for name in colours:
            with self.subTest(name):
                self.assertTrue(any("colour" in item for item in violations(scene(f"Dot(color={name})"))))

    def test_every_module_exported_by_manim_is_hidden(self) -> None:
        modules = {name for name, value in self.namespace.items() if isinstance(value, types.ModuleType)}
        self.assertEqual(modules - HIDDEN_MANIM, {"np"})

    def test_hidden_names_exist_in_the_pinned_version(self) -> None:
        self.assertEqual(HIDDEN_MANIM - set(self.namespace), set())

    def test_preamble_names_do_not_collide_with_manim(self) -> None:
        self.assertEqual(PREAMBLE_NAMES & set(self.namespace), set())


if __name__ == "__main__":
    unittest.main()
