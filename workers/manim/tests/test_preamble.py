import re
import unittest
from pathlib import Path

import preamble
from manim import MathTex, Text, config

TOKENS = Path("/opt/tokens")
BOARD_TOKENS = {
    "BOARD": "surfaceRaised",
    "CHALK": "ink",
    "CHALK_SOFT": "inkSoft",
    "CHALK_FAINT": "inkFaint",
    "RULE": "rule",
    "QUANTITY": "quantity",
    "ACTION": "action",
    "RESULT": "result",
    "VALID": "valid",
}
STROKE_TOKENS = {
    "STROKE_CONSTRUCTION": "construction",
    "STROKE_REGULAR": "regular",
    "STROKE_ACCENT": "accent",
}


def board_values(source: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for block in re.findall(r"\bboard:\s*\{([^}]*)\}", source):
        values.update(re.findall(r"(\w+):\s*\"(#[0-9A-Fa-f]{6})\"", block))
    return values


@unittest.skipUnless(TOKENS.is_dir(), "packages/scene/src/tokens is not mounted at /opt/tokens")
class TokenSourceTest(unittest.TestCase):
    def test_colours_are_the_board_tokens(self) -> None:
        tokens = board_values((TOKENS / "colors.ts").read_text())
        for name, token in BOARD_TOKENS.items():
            with self.subTest(name):
                self.assertEqual(getattr(preamble, name).upper(), tokens[token].upper())

    def test_strokes_are_the_scene_metric_tokens(self) -> None:
        block = re.search(r"stroke:\s*\{([^}]*)\}", (TOKENS / "scene-metrics.ts").read_text())
        assert block is not None
        units = {key: float(value) for key, value in re.findall(r"(\w+):\s*([0-9.]+)", block[1])}
        for name, token in STROKE_TOKENS.items():
            with self.subTest(name):
                expected = units[token] * config.frame_width / 120 / 0.01
                self.assertAlmostEqual(getattr(preamble, name), expected)


class PreambleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        config.media_dir = "/tmp/preamble-media"
        config.verbosity = "WARNING"

    def test_render_settings_are_imposed(self) -> None:
        self.assertEqual(config.background_color.to_hex().upper(), preamble.BOARD.upper())
        self.assertEqual((config.pixel_width, config.pixel_height, config.frame_rate), (1280, 720, 30))

    def test_every_exported_name_exists(self) -> None:
        for name in preamble.__all__:
            self.assertTrue(hasattr(preamble, name), name)

    def test_text_and_formulas_default_to_chalk_and_the_text_face(self) -> None:
        import manimpango

        self.assertIn(preamble.TEXT_FONT, manimpango.list_fonts())
        self.assertIn(preamble.MONO_FONT, manimpango.list_fonts())
        text = Text("a")
        self.assertEqual(text.font, preamble.TEXT_FONT)
        self.assertEqual(text.color.to_hex().upper(), preamble.CHALK.upper())
        self.assertEqual(MathTex("x").color.to_hex().upper(), preamble.CHALK.upper())


if __name__ == "__main__":
    unittest.main()
