import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildTimeline,
  CANVAS,
  DocumentSchema,
  typesetTexts,
  fontFaceCss,
  getTheme,
  SceneFrame,
  type Language,
  type ThemeName,
} from "scene";

const root = path.resolve(import.meta.dirname, "../../..");
const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const fontsDir = path.join(root, "packages/scene/assets/fonts");
const require = createRequire(path.join(root, "packages/scene/package.json"));

interface Options {
  file: string;
  scene: string;
  frame: string;
  theme: ThemeName;
  out: string;
  values: Record<string, number>;
  width: number;
}

function parseArgs(argv: string[]): Options {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const flag = (name: string, fallback: string): string => {
    const found = argv.find((arg) => arg.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : fallback;
  };
  const [file, scene = "all"] = positional;
  if (!file) {
    console.error(
      "usage: pnpm snapshot <document.json> [sceneId|all] [--frame=end|N|0.5] [--theme=paper|board] [--values=r=7e8,m1=2e24] [--width=1920] [--out=dir]",
    );
    process.exit(1);
  }
  const values: Record<string, number> = {};
  for (const pair of flag("values", "").split(",").filter(Boolean)) {
    const [key, value] = pair.split("=");
    if (key && value !== undefined) values[key] = Number(value);
  }
  return {
    file: path.resolve(invokedFrom, file),
    scene,
    frame: flag("frame", "end"),
    theme: flag("theme", "paper") as ThemeName,
    out: path.resolve(invokedFrom, flag("out", path.join(root, ".snapshots"))),
    values,
    width: Number(flag("width", String(CANVAS.width))),
  };
}

function katexCss(): string {
  const css = readFileSync(require.resolve("katex/dist/katex.min.css"), "utf8");
  const base = pathToFileURL(path.join(fontsDir, "katex")).href;
  return css.replace(/url\(fonts\//g, `url(${base}/`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(options.file, "utf8"));
  const explanation = typesetTexts(
    DocumentSchema.parse(raw.payload ?? raw),
    raw.language === "en" ? "en" : "fr",
  );
  const language: Language = raw.language === "en" ? "en" : "fr";
  const theme = getTheme(options.theme);
  const height = Math.round((options.width * CANVAS.height) / CANVAS.width);
  const scenes = explanation.scenes.filter(
    (scene) => options.scene === "all" || scene.id === options.scene,
  );
  if (scenes.length === 0) throw new Error(`no scene "${options.scene}" in ${options.file}`);

  mkdirSync(options.out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: options.width, height },
    deviceScaleFactor: 1,
  });

  for (const scene of scenes) {
    const timing = buildTimeline([scene]).scenes[0]!;
    const fraction = Number(options.frame);
    const frame =
      options.frame === "end"
        ? timing.duration - 1
        : fraction > 0 && fraction < 1
          ? Math.round(fraction * (timing.duration - 1))
          : Math.min(timing.duration - 1, Math.max(0, Math.round(fraction)));
    const markup = renderToStaticMarkup(
      <div
        style={{
          position: "relative",
          width: options.width,
          height,
          backgroundColor: theme.surfaceRaised,
          overflow: "hidden",
        }}
      >
        <SceneFrame
          scene={scene}
          timing={timing}
          params={explanation.params}
          model={explanation.model}
          language={language}
          theme={options.theme}
          values={options.values}
          reducedMotion={false}
          disableSweeps={false}
          burnSubtitles={false}
          frame={frame}
          width={options.width}
          height={height}
          fps={30}
        />
      </div>,
    );
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaceCss(pathToFileURL(fontsDir).href)}\n${katexCss()}\nhtml,body{margin:0}</style></head><body>${markup}</body></html>`;
    const pagePath = path.join(options.out, ".frame.html");
    writeFileSync(pagePath, html);
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const target = path.join(
      options.out,
      `${path.basename(options.file, ".json")}.${scene.id}.f${frame}.${options.theme}.png`,
    );
    await page.screenshot({ path: target });
    console.log(target);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
