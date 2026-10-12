from manim import *


class Derivative(Scene):
    def construct(self):
        axes = Axes(x_range=[-1, 4, 1], y_range=[-1, 9, 2], x_length=8, y_length=5, axis_config={"color": CHALK})
        curve = axes.plot(lambda x: x**2, x_range=[-1, 3], color=QUANTITY)
        label = MathTex("f(x) = x^2", color=CHALK).to_corner(UL)
        self.play(Create(axes), run_time=2)
        self.play(Create(curve), Write(label), run_time=3)

        x = ValueTracker(0.5)
        dot = always_redraw(lambda: Dot(axes.c2p(x.get_value(), x.get_value() ** 2), color=RESULT))
        tangent = always_redraw(
            lambda: axes.plot(
                lambda t: 2 * x.get_value() * (t - x.get_value()) + x.get_value() ** 2,
                x_range=[x.get_value() - 1, x.get_value() + 1],
                color=ACTION,
            )
        )
        slope = always_redraw(
            lambda: MathTex(rf"f'(x) = {2 * x.get_value():.1f}", color=ACTION).to_corner(UR)
        )
        self.play(FadeIn(dot), Create(tangent), Write(slope), run_time=3)
        self.play(x.animate.set_value(2.5), run_time=8, rate_func=linear)
        self.play(x.animate.set_value(1.0), run_time=6, rate_func=linear)
        rule = MathTex(r"f'(x) = 2x", color=RESULT).scale(1.4).to_edge(DOWN)
        self.play(Write(rule), run_time=3)
        self.wait(5)
