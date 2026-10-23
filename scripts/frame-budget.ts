import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildTimeline,
  CANVAS,
  FPS,
  LANGUAGES,
  SceneFrame,
  type Language,
  type Param,
  type SceneFrameProps,
  type ThemeName,
} from "scene";
import {
  listReferences,
  loadReference,
  type ReferenceDocument,
} from "../apps/web/src/server/reference";

const USAGE =
  "Usage: frame-budget [--dir=<dir>] [--only=<slug>] [--frames=<n>] [--repeats=<n>] [--theme=paper|board] [--max-ms=<n>] [--per-scene] [--browser --base-url=<url> [--seconds=<n>]]";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.INIT_CWD ?? process.cwd();
const webRequire = createRequire(path.join(root, "apps/web/package.json"));

const DEFAULT_FRAMES = 20;
const DEFAULT_REPEATS = 5;
const DEFAULT_MAX_MS = 16;
const DEFAULT_SECONDS = 4;
const DEFAULT_BASE_URL = "http://localhost:3000";
const WARM_UP_PASSES = 2;
const VIEWPORT = { width: 1280, height: 720 };
const SETTLE_MS = 500;
const IDLE_MS = 2000;
const SCENE_MARGIN_S = 0.5;
const LATE_INTERVAL_MS = 33.4;
const PAGE_TIMEOUT_MS = 90_000;

class UsageError extends Error {}

interface Settings {
  dir: string;
  only: string | null;
  frames: number;
  repeats: number;
  theme: ThemeName;
  maxMs: number;
  browser: boolean;
  baseUrl: string;
  seconds: number;
  perScene: boolean;
}

function positive(name: string, text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) throw new UsageError(`--${name} must be positive`);
  return value;
}

function readSettings(argv: string[]): Settings {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: "string" },
      only: { type: "string" },
      frames: { type: "string" },
      repeats: { type: "string" },
      theme: { type: "string" },
      "max-ms": { type: "string" },
      browser: { type: "boolean" },
      "base-url": { type: "string" },
      seconds: { type: "string" },
      "per-scene": { type: "boolean" },
    },
    strict: true,
  });
  const theme = values.theme ?? "paper";
  if (theme !== "paper" && theme !== "board") throw new UsageError("--theme is paper or board");
  return {
    dir: path.resolve(base, values.dir ?? path.join(root, "content/reference")),
    only: values.only ?? null,
    frames: Math.round(positive("frames", values.frames, DEFAULT_FRAMES)),
    repeats: Math.round(positive("repeats", values.repeats, DEFAULT_REPEATS)),
    theme,
    maxMs: positive("max-ms", values["max-ms"], DEFAULT_MAX_MS),
    browser: values.browser === true,
    baseUrl: (values["base-url"] ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    seconds: positive("seconds", values.seconds, DEFAULT_SECONDS),
    perScene: values["per-scene"] === true,
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ms(value: number): string {
  return value.toFixed(2);
}

// Evenly spaced frames from the first to the last of a scene.
function sampleFrames(duration: number, count: number): number[] {
  const total = Math.min(count, duration);
  if (total <= 1) return [0];
  const last = duration - 1;
  const frames = Array.from({ length: total }, (_, index) =>
    Math.round((index * last) / (total - 1)),
  );
  return [...new Set(frames)];
}

interface ValueSet {
  name: string;
  values: Record<string, number>;
}

function valueSets(params: readonly Param[]): ValueSet[] {
  if (params.length === 0) return [{ name: "defaults", values: {} }];
  const at = (pick: (param: Param) => number): Record<string, number> =>
    Object.fromEntries(params.map((param) => [param.id, pick(param)]));
  return [
    { name: "defaults", values: {} },
    { name: "minima", values: at((param) => param.min) },
    { name: "maxima", values: at((param) => param.max) },
  ];
}

interface ReactRuntime {
  createElement(type: typeof SceneFrame, props: SceneFrameProps): unknown;
}

interface ReactServerRuntime {
  renderToStaticMarkup(element: unknown): string;
}

// The root has no react of its own: the web application's copy is the one scene renders with.
function loadRenderer(): (props: SceneFrameProps) => string {
  const { createElement } = webRequire("react") as ReactRuntime;
  const { renderToStaticMarkup } = webRequire("react-dom/server") as ReactServerRuntime;
  return (props) => renderToStaticMarkup(createElement(SceneFrame, props));
}

interface Sample {
  scene: number;
  frame: number;
  valueSet: string;
  props: SceneFrameProps;
}

function buildSamples(
  document: ReferenceDocument,
  language: Language,
  settings: Settings,
): Sample[] {
  const { scenes, params, model } = document.payload;
  const timeline = buildTimeline(scenes, FPS);
  const sets = valueSets(params);
  return timeline.scenes.flatMap((timing, index) =>
    sampleFrames(timing.duration, settings.frames).map((frame, position): Sample => {
      const set = sets[position % sets.length] as ValueSet;
      return {
        scene: index,
        frame,
        valueSet: set.name,
        props: {
          scene: scenes[index] as SceneFrameProps["scene"],
          timing,
          params,
          model,
          language,
          theme: settings.theme,
          values: set.values,
          reducedMotion: false,
          disableSweeps: false,
          burnSubtitles: false,
          frame,
          width: CANVAS.width,
          height: CANVAS.height,
          fps: FPS,
        },
      };
    }),
  );
}

interface Measure {
  id: string;
  title: string;
  mean: number;
  worst: number;
  worstAt: string;
}

interface Report {
  title: string;
  scenes: Measure[];
  mean: number;
  worst: number;
  worstAt: string;
}

function summarize(
  document: ReferenceDocument,
  samples: readonly Sample[],
  timings: readonly number[],
): Report {
  const label = (sample: Sample): string => `${sample.frame} ${sample.valueSet}`;
  const scenes = document.payload.scenes.map((scene, index): Measure => {
    const rows = samples
      .map((sample, position) => ({ sample, time: timings[position] as number }))
      .filter(({ sample }) => sample.scene === index);
    const worst = rows.reduce((a, b) => (b.time > a.time ? b : a));
    return {
      id: scene.id,
      title: scene.title,
      mean: mean(rows.map((row) => row.time)),
      worst: worst.time,
      worstAt: `frame ${label(worst.sample)}`,
    };
  });
  const worstIndex = timings.reduce(
    (best, time, position) => (time > timings[best]! ? position : best),
    0,
  );
  const worstSample = samples[worstIndex] as Sample;
  return {
    title: `${document.slug} (${document.language})`,
    scenes,
    mean: mean(timings),
    worst: timings[worstIndex] as number,
    worstAt: `${document.payload.scenes[worstSample.scene]?.id} frame ${label(worstSample)}`,
  };
}

function measureServerRender(
  render: (props: SceneFrameProps) => string,
  document: ReferenceDocument,
  samples: readonly Sample[],
  settings: Settings,
): Report {
  let sink = 0;
  for (let pass = 0; pass < WARM_UP_PASSES; pass += 1) {
    for (const sample of samples) sink += render(sample.props).length;
  }
  const totals = samples.map(() => 0);
  for (let pass = 0; pass < settings.repeats; pass += 1) {
    samples.forEach((sample, position) => {
      const start = performance.now();
      sink += render(sample.props).length;
      totals[position] = (totals[position] as number) + (performance.now() - start);
    });
  }
  if (sink === 0) throw new Error("nothing was rendered");
  return summarize(
    document,
    samples,
    totals.map((total) => total / settings.repeats),
  );
}

function verdict(
  documentMean: number,
  rows: readonly { id: string; value: number }[],
  settings: Settings,
): boolean {
  const over = rows.filter((row) => row.value > settings.maxMs);
  if (over.length > 0) {
    const list = over.map((row) => `${row.id} ${ms(row.value)} ms`).join(", ");
    console.log(
      `  scenes over ${settings.maxMs} ms: ${list}${settings.perScene ? "" : " (not counted without --per-scene)"}`,
    );
  }
  return documentMean <= settings.maxMs && (!settings.perScene || over.length === 0);
}

function printReport(report: Report, header: string, settings: Settings): boolean {
  const names = report.scenes.map((scene) => `${scene.id}  ${scene.title}`);
  const width = Math.max(...names.map((name) => name.length), 12);
  console.log(`\n${report.title}: ${header}`);
  console.log(
    `  ${"scene".padEnd(width)}  ${"mean ms".padStart(8)}  ${"worst ms".padStart(8)}  worst at`,
  );
  report.scenes.forEach((scene, index) => {
    console.log(
      `  ${(names[index] as string).padEnd(width)}  ${ms(scene.mean).padStart(8)}  ${ms(scene.worst).padStart(8)}  ${scene.worstAt}`,
    );
  });
  console.log(
    `  document: mean ${ms(report.mean)} ms, worst ${ms(report.worst)} ms (${report.worstAt})`,
  );
  const within = verdict(
    report.mean,
    report.scenes.map((scene) => ({ id: scene.id, value: scene.mean })),
    settings,
  );
  console.log(`  budget ${settings.maxMs} ms: ${within ? "within" : "EXCEEDED"}`);
  return within;
}

interface Target {
  document: ReferenceDocument;
  language: Language;
}

async function loadTargets(settings: Settings): Promise<Target[]> {
  const targets: Target[] = [];
  for (const language of LANGUAGES) {
    for (const entry of await listReferences(language, settings.dir)) {
      if (settings.only !== null && entry.slug !== settings.only) continue;
      const document = await loadReference(entry.explanation_id, settings.dir);
      if (document) targets.push({ document, language });
    }
  }
  return targets;
}

function runServerRender(targets: readonly Target[], settings: Settings): boolean {
  const render = loadRenderer();
  console.log(
    `Server render of one scene frame (React renderToStaticMarkup of the SVG and HTML, ${CANVAS.width}x${CANVAS.height}, theme ${settings.theme}).`,
  );
  console.log(
    "It is the JavaScript cost of building a frame; it leaves out React reconciliation, browser style, layout and paint (use --browser for those).",
  );
  let allWithin = true;
  for (const { document, language } of targets) {
    const samples = buildSamples(document, language, settings);
    const report = measureServerRender(render, document, samples, settings);
    const header = `${document.payload.scenes.length} scenes, ${samples.length} frames x ${settings.repeats} repeats`;
    if (!printReport(report, header, settings)) allWithin = false;
  }
  return allWithin;
}

interface Locator {
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Locator;
  nth(index: number): Locator;
  click(): Promise<void>;
  waitFor(options?: { timeout?: number }): Promise<void>;
}

interface CdpSession {
  send(method: string): Promise<unknown>;
}

interface Page extends Pick<Locator, "getByRole"> {
  goto(url: string): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
  context(): { newCDPSession(page: Page): Promise<CdpSession> };
}

interface Browser {
  newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
  close(): Promise<void>;
}

interface PlaywrightRuntime {
  chromium: { launch(): Promise<Browser> };
}

interface Labels {
  ruler: string;
  play: string;
  pause: string;
  scenes: string;
}

function labelsOf(language: Language): Labels {
  const read = (file: string, namespace: string): Record<string, string> => {
    const text = readFileSync(
      path.join(root, "apps/web/messages", language, `${file}.json`),
      "utf8",
    );
    return (JSON.parse(text) as Record<string, Record<string, string>>)[namespace] ?? {};
  };
  const transport = read("transport", "Transport");
  const scenes = read("scenes", "Scenes");
  return {
    ruler: transport["ruler"] ?? "",
    play: transport["play"] ?? "",
    pause: transport["pause"] ?? "",
    scenes: scenes["label"] ?? "",
  };
}

// Strings, not functions: the transpiler of this script must not leak helpers into the page.
const START_SAMPLER = `(() => {
  const state = { intervals: [], stop: false };
  window.__frameBudget = state;
  let last = performance.now();
  const tick = (now) => {
    state.intervals.push(now - last);
    last = now;
    if (!state.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;
const STOP_SAMPLER = `(() => { window.__frameBudget.stop = true; return window.__frameBudget.intervals; })()`;

interface Metrics {
  timestamp: number;
  task: number;
  script: number;
  layout: number;
}

async function readMetrics(session: CdpSession): Promise<Metrics> {
  const { metrics } = (await session.send("Performance.getMetrics")) as {
    metrics: { name: string; value: number }[];
  };
  const get = (name: string): number => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    timestamp: get("Timestamp"),
    task: get("TaskDuration"),
    script: get("ScriptDuration"),
    layout: get("LayoutDuration") + get("RecalcStyleDuration"),
  };
}

interface PlaybackWindow {
  perFrame: number;
  script: number;
  layout: number;
  late: number;
  intervals: number;
  longest: number;
}

async function observe(page: Page, session: CdpSession, waitMs: number): Promise<PlaybackWindow> {
  await page.evaluate(START_SAMPLER);
  const before = await readMetrics(session);
  await page.waitForTimeout(waitMs);
  const after = await readMetrics(session);
  const intervals = (await page.evaluate(STOP_SAMPLER)) as number[];
  const frames = (after.timestamp - before.timestamp) * FPS;
  const perFrame = (seconds: number): number => (seconds * 1000) / frames;
  return {
    perFrame: perFrame(after.task - before.task),
    script: perFrame(after.script - before.script),
    layout: perFrame(after.layout - before.layout),
    late: intervals.filter((interval) => interval > LATE_INTERVAL_MS).length,
    intervals: intervals.length,
    longest: Math.max(0, ...intervals),
  };
}

async function measureInBrowser(
  browser: Browser,
  target: Target,
  settings: Settings,
): Promise<boolean> {
  const { document, language } = target;
  const labels = labelsOf(language);
  const page = await browser.newPage({ viewport: VIEWPORT });
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");

  const url = `${settings.baseUrl}/${language}/e/${document.explanation_id}`;
  await page.goto(url);
  await page.getByRole("slider", { name: labels.ruler }).waitFor({ timeout: PAGE_TIMEOUT_MS });
  await page.waitForTimeout(SETTLE_MS);

  const idle = await observe(page, session, IDLE_MS);
  const timeline = buildTimeline(document.payload.scenes, FPS);
  const sceneButtons = page.getByRole("list", { name: labels.scenes, exact: true });
  const rows: { id: string; title: string; result: PlaybackWindow }[] = [];

  for (const [index, scene] of document.payload.scenes.entries()) {
    const seconds = Math.min(
      settings.seconds,
      (timeline.scenes[index]?.duration ?? 0) / FPS - SCENE_MARGIN_S - SETTLE_MS / 1000,
    );
    if (seconds <= 0) continue;
    await sceneButtons.getByRole("button").nth(index).click();
    await page.getByRole("button", { name: labels.play, exact: true }).click();
    await page.getByRole("button", { name: labels.pause, exact: true }).waitFor();
    await page.waitForTimeout(SETTLE_MS);
    rows.push({
      id: scene.id,
      title: scene.title,
      result: await observe(page, session, seconds * 1000),
    });
    await page.getByRole("button", { name: labels.pause, exact: true }).click();
  }

  const names = rows.map((row) => `${row.id}  ${row.title}`);
  const width = Math.max(...names.map((name) => name.length), 12);
  console.log(`\n${document.slug} (${language}): ${url}`);
  console.log(
    `  ${"scene".padEnd(width)}  ${"busy ms".padStart(8)}  ${"script".padStart(7)}  ${"layout".padStart(7)}  ${"late".padStart(9)}  longest rAF ms`,
  );
  rows.forEach(({ result }, index) => {
    console.log(
      `  ${(names[index] as string).padEnd(width)}  ${ms(result.perFrame).padStart(8)}  ${ms(result.script).padStart(7)}  ${ms(result.layout).padStart(7)}  ${`${result.late}/${result.intervals}`.padStart(9)}  ${ms(result.longest)}`,
    );
  });
  const average = mean(rows.map((row) => row.result.perFrame));
  const worst = Math.max(...rows.map((row) => row.result.perFrame));
  console.log(
    `  document: mean ${ms(average)} ms, worst scene ${ms(worst)} ms; paused page ${ms(idle.perFrame)} ms`,
  );
  const within = verdict(
    average,
    rows.map((row) => ({ id: row.id, value: row.result.perFrame })),
    settings,
  );
  console.log(`  budget ${settings.maxMs} ms: ${within ? "within" : "EXCEEDED"}`);
  await page.close();
  return within;
}

async function runBrowser(targets: readonly Target[], settings: Settings): Promise<boolean> {
  try {
    await fetch(settings.baseUrl, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new UsageError(
      `no server answers at ${settings.baseUrl}: start it first (the script never starts one)`,
    );
  }
  const { chromium } = webRequire("@playwright/test") as PlaywrightRuntime;
  console.log(
    "Chromium playback: main-thread busy time (CDP TaskDuration) per composition frame at the nominal " +
      `${FPS} fps, over ${settings.seconds} s of real playback per scene; "late" counts requestAnimationFrame intervals over ${LATE_INTERVAL_MS} ms.`,
  );
  console.log(
    "A development server runs React's development build: expect higher figures than production.",
  );
  const browser = await chromium.launch();
  try {
    let allWithin = true;
    for (const target of targets) {
      if (!(await measureInBrowser(browser, target, settings))) allWithin = false;
    }
    return allWithin;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  const settings = readSettings(process.argv.slice(2));
  const targets = await loadTargets(settings);
  if (targets.length === 0) {
    console.error(`No reference explanation to measure in ${settings.dir}.`);
    return 1;
  }
  const within = settings.browser
    ? await runBrowser(targets, settings)
    : runServerRender(targets, settings);
  console.log(
    `\n${targets.length} explanation(s): ${within ? "all within" : "at least one over"} the ${settings.maxMs} ms budget.`,
  );
  return within ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof UsageError || (error instanceof TypeError && "code" in error)) {
      console.error(error.message);
      console.error(USAGE);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  },
);
