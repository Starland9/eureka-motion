import manimpango
from manim import MarkupText, SingleStringMathTex, Text, config

__all__ = [
    "BOARD",
    "CHALK",
    "CHALK_SOFT",
    "CHALK_FAINT",
    "RULE",
    "QUANTITY",
    "ACTION",
    "RESULT",
    "VALID",
    "STROKE_CONSTRUCTION",
    "STROKE_REGULAR",
    "STROKE_ACCENT",
    "DISPLAY_FONT",
    "TEXT_FONT",
    "MONO_FONT",
]

# Board theme of packages/scene/src/tokens/colors.ts; tests/test_preamble.py compares them.
BOARD = "#1C2622"
CHALK = "#ECE7DA"
CHALK_SOFT = "#A9AFA6"
CHALK_FAINT = "#8A918A"
RULE = "#3A4741"
QUANTITY = "#86B6F0"
ACTION = "#F28A72"
RESULT = "#F2CB5B"
VALID = "#8CCB9A"

config.background_color = BOARD
config.pixel_width = 1280
config.pixel_height = 720
config.frame_rate = 30

# Strokes of design-system § 4 in scene units (width / 120); Manim draws width × 0.01 frame units.
_PER_UNIT = config.frame_width / 120 / 0.01
STROKE_CONSTRUCTION = 0.125 * _PER_UNIT
STROKE_REGULAR = 0.25 * _PER_UNIT
STROKE_ACCENT = 0.5 * _PER_UNIT

_INSTALLED = set(manimpango.list_fonts())


def _first_installed(*families: str) -> str:
    return next((family for family in families if family in _INSTALLED), families[-1])


# The design faces are not in the image; the last family of each list is the one it ships.
DISPLAY_FONT = _first_installed("Bodoni Moda", "STIX Two Text", "Nimbus Roman")
TEXT_FONT = _first_installed("STIX Two Text", "Nimbus Roman")
MONO_FONT = _first_installed("IBM Plex Mono", "Noto Sans Mono")

Text.set_default(font=TEXT_FONT, color=CHALK)
MarkupText.set_default(font=TEXT_FONT, color=CHALK)
SingleStringMathTex.set_default(color=CHALK)
