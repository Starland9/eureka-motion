import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";
const PATH = "/fr/dev/transport";
const OUT = ".snapshots/reduced-motion";
const EMPTY_BELOW = 0.005;

type Messages = Record<string, string>;

const m = JSON.parse(
  readFileSync(new URL("../messages/fr/transport.json", import.meta.url), "utf8"),
).Transport as Messages;

interface Status {
  ready: boolean;
  playing: boolean;
  waiting: boolean;
  ended: boolean;
  frame: number;
  scene: number | null;
  beat: number | null;
  reducedMotion: boolean;
  theme: "paper" | "board";
  duration: number;
}

interface SceneData {
  id: string;
  start: number;
  duration: number;
  beats: { start: number; duration: number; narration: string }[];
}

interface Step {
  frame: number;
  scene: number;
  beat: number;
  narration: string;
}

interface Plate {
  background: number[];
  ink: number[];
  content: number;
}

function pass(message: string): void {
  console.log(`  ok  ${message}`);
}

async function until(
  what: string,
  condition: () => Promise<boolean>,
  timeout = 6000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(`timeout: ${what}`);
}

async function status(page: Page, id = "status"): Promise<Status> {
  return JSON.parse((await page.getByTestId(id).textContent()) ?? "{}") as Status;
}

async function scenesOf(page: Page): Promise<SceneData[]> {
  return JSON.parse((await page.getByTestId("timeline").textContent()) ?? "[]") as SceneData[];
}

function stepsOf(scenes: SceneData[]): Step[] {
  return scenes.flatMap((scene, sceneIndex) =>
    scene.beats.map((beat, beatIndex) => ({
      frame: scene.start + beat.start + beat.duration - 1,
      scene: sceneIndex,
      beat: beatIndex,
      narration: beat.narration,
    })),
  );
}

function barOf(page: Page, index = 0): Locator {
  return page.getByRole("group", { name: m.label }).nth(index);
}

async function subtitle(page: Page): Promise<string> {
  return (await page.locator("[data-slot=subtitles]").first().textContent()) ?? "";
}

async function plate(page: Page): Promise<Plate> {
  const png = await page.locator(".aspect-video").first().screenshot();
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const corner = (Math.floor(height * 0.93) * width + Math.floor(width * 0.93)) * 4;
    const background = [data[corner]!, data[corner + 1]!, data[corner + 2]!];
    let far = 0;
    let ink = background;
    for (let y = Math.floor(height * 0.03); y < height * 0.85; y += 1) {
      for (let x = Math.floor(width * 0.04); x < width * 0.96; x += 1) {
        const i = (y * width + x) * 4;
        const diff =
          Math.abs(data[i]! - background[0]!) +
          Math.abs(data[i + 1]! - background[1]!) +
          Math.abs(data[i + 2]! - background[2]!);
        if (diff > far) {
          far = diff;
          ink = [data[i]!, data[i + 1]!, data[i + 2]!];
        }
      }
    }
    let marked = 0;
    let total = 0;
    for (let y = Math.floor(height * 0.26); y < height * 0.85; y += 1) {
      for (let x = Math.floor(width * 0.04); x < width * 0.96; x += 1) {
        const i = (y * width + x) * 4;
        total += 1;
        const diff =
          Math.abs(data[i]! - background[0]!) +
          Math.abs(data[i + 1]! - background[1]!) +
          Math.abs(data[i + 2]! - background[2]!);
        if (diff > 60) marked += 1;
      }
    }
    return { background, ink, content: marked / total };
  }, png.toString("base64"));
}

function luminance(rgb: number[]): number {
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}

async function newPage(
  browser: Browser,
  width: number,
  height: number,
  reducedMotion: "reduce" | "no-preference",
) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: "light",
    reducedMotion,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return { context, page, errors };
}

async function open(page: Page): Promise<void> {
  await page.goto(`${BASE}${PATH}`, { waitUntil: "networkidle" });
  await until("player ready", async () => (await status(page)).ready);
  await until("partial player ready", async () => (await status(page, "status-partial")).ready);
  await page.waitForFunction(() => {
    const node = document.querySelector("[data-testid=status-empty]");
    return node !== null && Object.keys(node).some((key) => key.startsWith("__reactFiber"));
  });
}

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function goTo(page: Page, frame: number): Promise<void> {
  await page.getByTestId("goto-frame").fill(String(frame));
  await page.getByTestId("goto-submit").click();
  await until(`at frame ${frame}`, async () => (await status(page)).frame === frame);
}

async function landedOn(page: Page, target: Step, label: string): Promise<void> {
  await until(`${label}: frame ${target.frame}`, async () => {
    const current = await status(page);
    return current.frame === target.frame && !current.playing;
  });
  const current = await status(page);
  assert.equal(current.scene, target.scene, `${label}: scene`);
  assert.equal(current.beat, target.beat, `${label}: beat`);
  assert.equal(await subtitle(page), target.narration, `${label}: subtitle is the narration`);
  const stats = await plate(page);
  assert.ok(stats.content > EMPTY_BELOW, `${label}: plate is not empty (${stats.content})`);
}

async function focusByTab(page: Page, name: string, limit = 40): Promise<string[]> {
  const bar = barOf(page);
  const handle = await bar.elementHandle();
  assert.ok(handle);
  await blur(page);
  const names: string[] = [];
  for (let press = 0; press < limit; press += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate((el) => el.contains(document.activeElement), handle);
    if (!inside) {
      if (names.length > 0) break;
      continue;
    }
    const snapshot = await page.locator(":focus").ariaSnapshot();
    const found = /^- \w+ "([^"]*)"/.exec(snapshot)?.[1] ?? "";
    names.push(found);
    if (found === name) return names;
  }
  assert.fail(`${name} was not reached with Tab (reached ${names.join(", ")})`);
}

async function checkLanding(page: Page, steps: Step[]): Promise<void> {
  const first = steps[0]!;
  await until("landing", async () => (await status(page)).frame === first.frame);
  await page.waitForTimeout(2000);
  const after = await status(page);
  assert.equal(after.playing, false, "nothing plays by itself");
  assert.equal(after.frame, first.frame, "position still after 2 s");
  assert.equal(after.reducedMotion, true, "the player knows about the preference");
  await landedOn(page, first, "initial scene");
  pass(`nothing plays by itself: still at frame ${after.frame} after 2 s, the end of beat 1`);
}

async function checkBar(page: Page): Promise<void> {
  const bar = barOf(page);
  await bar.getByRole("button", { name: m.stepNext }).waitFor();
  await bar.getByRole("button", { name: m.stepPrevious }).waitFor();
  await bar.getByRole("button", { name: m.play }).waitFor();
  const names = await focusByTab(page, m.fullscreen ?? "");
  assert.deepEqual(names, [
    m.ruler,
    m.stepPrevious,
    m.stepNext,
    m.play,
    m.previousScene,
    m.nextScene,
    m.captions,
    m.sound,
    m.volume,
    m.fullscreen,
  ]);
  assert.equal(await bar.locator("[role=status]").count(), 1, "one narration region");
  pass(`bar: ${names.join(" > ")}`);
}

async function walkForward(page: Page, steps: Step[]): Promise<void> {
  const bar = barOf(page);
  const next = bar.getByRole("button", { name: m.stepNext });
  const region = bar.locator("[role=status]");
  await focusByTab(page, m.stepNext ?? "");
  assert.equal(await page.locator(":focus").getAttribute("aria-keyshortcuts"), "N");
  for (const [index, step] of steps.slice(1).entries()) {
    await page.keyboard.press(index % 2 === 0 ? "Enter" : "Space");
    await landedOn(page, step, `step ${index + 2}/${steps.length}`);
    await until(
      "narration region",
      async () => (await region.textContent()) === step.narration,
      2000,
    );
  }
  assert.equal(
    await next.getAttribute("aria-disabled"),
    "true",
    "next step unavailable at the end",
  );
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), m.stepNext);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  assert.equal((await status(page)).frame, steps.at(-1)!.frame, "no step past the end");
  pass(`${steps.length - 1} presses of the keyboard walked ${steps.length} beats, scene by scene`);
}

async function walkBack(page: Page, steps: Step[]): Promise<void> {
  const bar = barOf(page);
  const back = bar.getByRole("button", { name: m.stepPrevious });
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), m.stepPrevious);
  for (let index = steps.length - 2; index >= 0; index -= 1) {
    await page.keyboard.press("Enter");
    await landedOn(page, steps[index]!, `back to ${index + 1}/${steps.length}`);
  }
  assert.equal(await back.getAttribute("aria-disabled"), null, "back available from the first end");
  await page.keyboard.press("Enter");
  await until("back to frame 0", async () => {
    const current = await status(page);
    return current.frame === 0 && !current.playing;
  });
  assert.equal(await subtitle(page), steps[0]!.narration, "frame 0 shows the first narration");
  assert.equal(await back.getAttribute("aria-disabled"), "true", "back unavailable at the start");
  const empty = await plate(page);
  assert.ok(empty.content <= EMPTY_BELOW, "frame 0 shows the empty plate");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  assert.equal((await status(page)).frame, 0);
  pass("Étape précédente walks back to the first beat then to frame 0");
}

async function checkMidBeat(page: Page, scenes: SceneData[], steps: Step[]): Promise<void> {
  const scene = scenes[1]!;
  const beat = scene.beats[1]!;
  await goTo(page, scene.start + beat.start + 10);
  const bar = barOf(page);
  await bar.getByRole("button", { name: m.stepNext }).click();
  await landedOn(page, steps[4]!, "next from the middle of a beat");
  await goTo(page, scene.start + beat.start + 10);
  await bar.getByRole("button", { name: m.stepPrevious }).click();
  await landedOn(page, steps[3]!, "previous from the middle of a beat");
  pass("from the middle of a beat: next ends this beat, previous ends the one before");
}

async function checkShortcuts(page: Page, steps: Step[]): Promise<void> {
  await goTo(page, steps[0]!.frame);
  await blur(page);
  await page.keyboard.press("n");
  await landedOn(page, steps[1]!, "N");
  await page.keyboard.press("n");
  await landedOn(page, steps[2]!, "N again");
  await page.keyboard.press("p");
  await landedOn(page, steps[1]!, "P");
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(200);
  assert.equal((await status(page)).frame, steps[1]!.frame, "Ctrl+N is ignored");
  pass("N and P step forward and back from anywhere on the page");
}

async function checkScenes(page: Page, scenes: SceneData[], steps: Step[]): Promise<void> {
  const bar = barOf(page);
  const firstOf = (sceneIndex: number): Step => steps.find((s) => s.scene === sceneIndex)!;
  await goTo(page, steps[0]!.frame);
  for (let index = 1; index < scenes.length; index += 1) {
    await bar.getByRole("button", { name: m.nextScene }).click();
    await landedOn(page, firstOf(index), `next scene ${index + 1}`);
    assert.equal(await subtitle(page), scenes[index]!.beats[0]!.narration);
  }
  for (let index = scenes.length - 2; index >= 0; index -= 1) {
    await bar.getByRole("button", { name: m.previousScene }).click();
    await landedOn(page, firstOf(index), `previous scene ${index + 1}`);
  }
  await goTo(page, scenes[2]!.start + scenes[2]!.duration - 5);
  await bar.getByRole("button", { name: m.previousScene }).click();
  await landedOn(page, firstOf(2), "previous scene from late in the scene restarts it");

  const ruler = bar.getByRole("slider", { name: m.ruler });
  await ruler.focus();
  await page.keyboard.press("PageDown");
  await landedOn(page, firstOf(3), "PageDown");
  await page.keyboard.press("PageUp");
  await landedOn(page, firstOf(2), "PageUp from a landing frame goes to the previous scene");
  pass("choosing a scene (buttons, PageUp / PageDown) lands on the end of its first beat");
}

async function checkPlay(page: Page, steps: Step[]): Promise<void> {
  const bar = barOf(page);
  await goTo(page, steps[0]!.frame);
  await bar.getByRole("button", { name: m.play }).click();
  await until("play starts", async () => (await status(page)).playing);
  const from = (await status(page)).frame;
  await until("frames advance", async () => (await status(page)).frame > from + 8);
  await bar.getByRole("button", { name: m.pause }).click();
  await until("pause returns control", async () => !(await status(page)).playing);
  const paused = (await status(page)).frame;
  await page.waitForTimeout(300);
  assert.equal((await status(page)).frame, paused, "paused means paused");
  await bar.getByRole("button", { name: m.stepNext }).click();
  const target = steps.find((step) => step.frame > paused)!;
  await landedOn(page, target, "step after pausing");

  await bar.getByRole("button", { name: m.play }).click();
  await until("play again", async () => (await status(page)).playing);
  await blur(page);
  await page.keyboard.press("n");
  await until("a step pauses playback", async () => !(await status(page)).playing);
  const stepped = await status(page);
  assert.ok(
    steps.some((step) => step.frame === stepped.frame),
    "a step lands on a beat end",
  );
  await blur(page);
  await page.keyboard.press(" ");
  await until("Space still plays", async () => (await status(page)).playing);
  await page.keyboard.press(" ");
  await until("Space still pauses", async () => !(await status(page)).playing);
  pass("Lecture plays, Pause returns control, a step pauses, Space still toggles playback");
}

const SAMPLER = `(() => {
  const plate = document.querySelector(".aspect-video");
  const seen = { dashed: 0, fractional: 0, ticks: 0 };
  window.__seen = seen;
  const tick = () => {
    seen.ticks += 1;
    let dashed = 0;
    let fractional = 0;
    plate.querySelectorAll("svg line, svg path, svg g").forEach((node) => {
      if (node.getAttribute("stroke-dasharray")) dashed += 1;
      const opacity = Number(node.getAttribute("opacity"));
      if (node.hasAttribute("opacity") && opacity > 0.02 && opacity < 0.98) fractional += 1;
    });
    seen.dashed = Math.max(seen.dashed, dashed);
    seen.fractional = Math.max(seen.fractional, fractional);
    window.__raf = requestAnimationFrame(tick);
  };
  tick();
})()`;

async function drawnAs(
  page: Page,
  scenes: SceneData[],
): Promise<{ dashed: number; fractional: number }> {
  const ruler = barOf(page).getByRole("slider", { name: m.ruler });
  await ruler.focus();
  await page.keyboard.press("Home");
  await until("at the start", async () => (await status(page)).frame === 0);
  await page.evaluate(SAMPLER);
  await barOf(page).getByRole("button", { name: m.play }).click();
  const drawn = Math.round(0.3 * scenes[0]!.beats[0]!.duration) + 24;
  await until("past the drawing", async () => (await status(page)).frame > drawn, 10000);
  await barOf(page).getByRole("button", { name: m.pause }).click();
  const seen = await page.evaluate(() => {
    cancelAnimationFrame((window as unknown as { __raf: number }).__raf);
    return (window as unknown as { __seen: { dashed: number; fractional: number } }).__seen;
  });
  return seen;
}

async function checkFade(page: Page, scenes: SceneData[]): Promise<void> {
  const start = Math.round(0.3 * scenes[0]!.beats[0]!.duration);
  const sample = () =>
    page
      .locator(".aspect-video")
      .first()
      .evaluate((el) => {
        let dashed = 0;
        let fractional = 0;
        el.querySelectorAll("svg line, svg path, svg g").forEach((node) => {
          if (node.getAttribute("stroke-dasharray")) dashed += 1;
          const opacity = Number(node.getAttribute("opacity"));
          if (node.hasAttribute("opacity") && opacity > 0.02 && opacity < 0.98) fractional += 1;
        });
        return { dashed, fractional };
      });
  await goTo(page, start + 2);
  await page.waitForTimeout(150);
  const during = await sample();
  assert.equal(during.dashed, 0, "no traced stroke 2 frames into the drawing");
  assert.ok(during.fractional >= 1, "the drawing is partly transparent 2 frames in");
  await goTo(page, start + 5);
  await page.waitForTimeout(150);
  const after = await sample();
  assert.deepEqual(after, { dashed: 0, fractional: 0 }, "settled 5 frames (167 ms) after it began");

  const playing = await drawnAs(page, scenes);
  assert.equal(playing.dashed, 0, "no traced stroke at any time while playing");
  assert.ok(playing.fractional >= 1, "a fading element was seen while playing");
  pass(
    `a 'draw' action is a fade of 4 frames: frame ${start + 2} has ${during.fractional} semi-transparent element(s) and 0 dashed stroke; while playing, dashed max ${playing.dashed}, fading max ${playing.fractional}`,
  );
}

async function checkTrace(page: Page, scenes: SceneData[]): Promise<void> {
  const playing = await drawnAs(page, scenes);
  assert.ok(playing.dashed >= 1, "without the preference the stroke is traced");
  pass(`without the preference the same drawing is traced (dashed stroke seen: ${playing.dashed})`);
}

async function checkTheme(page: Page, label: string): Promise<void> {
  const css = () =>
    page
      .locator(".aspect-video")
      .first()
      .evaluate((el) =>
        getComputedStyle(el).backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number),
      );
  await page.getByTestId("theme-paper").click();
  await until("paper", async () => (await status(page)).theme === "paper");
  const paper = await plate(page);
  assert.deepEqual(paper.background, await css(), "paper: scene background is the page's");

  await page.getByTestId("theme-board").click();
  await until("board", async () => (await status(page)).theme === "board");
  await until("board plate", async () => (await plate(page)).background[0] !== paper.background[0]);
  const board = await plate(page);
  assert.deepEqual(board.background, await css(), "board: scene background is the page's");
  assert.ok(luminance(board.background) < 60 && luminance(paper.background) > 200);
  assert.ok(luminance(board.ink) > 150 && luminance(paper.ink) < 80, "ink flips with the theme");
  assert.notDeepEqual(board.ink, paper.ink);

  const bar = barOf(page);
  await bar.getByRole("button", { name: m.play }).click();
  await until("playing", async () => (await status(page)).playing);
  await page.getByTestId("theme-paper").click();
  await until(
    "paper while playing",
    async () => (await plate(page)).background[0] === paper.background[0],
  );
  assert.equal((await status(page)).playing, true, "still playing after the switch");
  await page.getByTestId("theme-board").click();
  await until(
    "board while playing",
    async () => (await plate(page)).background[0] === board.background[0],
  );
  await bar.getByRole("button", { name: m.pause }).click();
  await until("paused", async () => !(await status(page)).playing);

  await page.reload({ waitUntil: "networkidle" });
  await until("player ready after reload", async () => (await status(page)).ready);
  assert.equal(
    await page.evaluate(() => document.documentElement.classList.contains("dark")),
    true,
  );
  assert.equal((await status(page)).theme, "board", "theme survives the reload");
  await until("board plate after reload", async () => {
    const current = await plate(page);
    return current.background[0] === board.background[0];
  });
  await page.getByTestId("theme-paper").click();
  await until("paper again", async () => (await status(page)).theme === "paper");
  await page.reload({ waitUntil: "networkidle" });
  await until("player ready after second reload", async () => (await status(page)).ready);
  assert.equal((await status(page)).theme, "paper");
  assert.equal((await plate(page)).background[0], paper.background[0]);
  pass(
    `${label}: Paper ${JSON.stringify(paper.background)} / Board ${JSON.stringify(board.background)} on the plate, paused and playing, kept after reload`,
  );
}

async function checkTargets(page: Page): Promise<void> {
  const bar = barOf(page);
  const targets = bar.locator("button, div[role=slider]");
  const boxes = [];
  for (let index = 0; index < (await targets.count()); index += 1) {
    const rect = await targets.nth(index).boundingBox();
    assert.ok(rect, "target has a box");
    assert.ok(
      rect.width >= 43.5 && rect.height >= 43.5,
      `target ${index}: ${rect.width}x${rect.height}`,
    );
    boxes.push(rect);
  }
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const first = boxes[a]!;
      const second = boxes[b]!;
      const gapX = Math.max(
        first.x - (second.x + second.width),
        second.x - (first.x + first.width),
      );
      const gapY = Math.max(
        first.y - (second.y + second.height),
        second.y - (first.y + first.height),
      );
      assert.ok(Math.max(gapX, gapY) >= 7.5, `targets ${a} and ${b} are 8 px apart`);
    }
  }
  pass(`${boxes.length} targets are at least 44 px and 8 px apart`);
}

async function checkOverflow(page: Page, label: string): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  assert.ok(scroll! <= client!, `${label}: horizontal overflow (${scroll} > ${client})`);
  pass(`${label}: no horizontal overflow (${scroll} <= ${client})`);
}

async function checkPartial(page: Page): Promise<void> {
  const first = await status(page, "status-partial");
  assert.equal(first.playing, false);
  const bar = barOf(page, 1);
  const scenes = await scenesOf(page);
  assert.ok(
    first.frame > 0 && first.frame < scenes[0]!.duration,
    "partial player lands on its first beat",
  );
  const next = bar.getByRole("button", { name: m.stepNext });
  for (let press = 0; press < 5; press += 1) await next.click();
  await until("partial reaches its end", async () => {
    const current = await status(page, "status-partial");
    return current.frame === current.duration - 1;
  });
  await page.waitForTimeout(300);
  const end = await status(page, "status-partial");
  assert.equal(end.playing, false, "no playing at the end of a partial explanation");
  assert.equal(await next.getAttribute("aria-disabled"), "true");
  pass(
    `partial explanation: steps to its last frame without playing (waiting: ${end.waiting}, ended: ${end.ended})`,
  );
}

async function shots(browser: Browser, steps: Step[]): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const [width, height] of [
    [1280, 900],
    [360, 800],
  ] as const) {
    for (const theme of ["paper", "board"] as const) {
      const { context, page, errors } = await newPage(browser, width, height, "reduce");
      await open(page);
      await page.getByTestId(`theme-${theme}`).click();
      await until("theme", async () => (await status(page)).theme === theme);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${width}-${theme}-landing.png`, fullPage: true });
      await focusByTab(page, m.stepNext ?? "");
      for (let press = 0; press < 7; press += 1) await page.keyboard.press("Enter");
      await until("stepped", async () => (await status(page)).frame === steps[7]!.frame);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${width}-${theme}.png`, fullPage: true });
      await checkOverflow(page, `${width} px ${theme}`);
      assert.deepEqual(errors, [], "no console error while taking screenshots");
      console.log(`  shot ${OUT}/${width}-${theme}.png and -landing.png`);
      await context.close();
    }
  }
}

const browser = await chromium.launch();
try {
  console.log("\n== reduced motion, 1280 ==");
  const reduced = await newPage(browser, 1280, 900, "reduce");
  await open(reduced.page);
  const scenes = await scenesOf(reduced.page);
  const steps = stepsOf(scenes);
  assert.equal(steps.length, 18, "reference explanation has 6 scenes of 3 beats");
  await checkLanding(reduced.page, steps);
  await checkBar(reduced.page);
  await checkTargets(reduced.page);
  await walkForward(reduced.page, steps);
  await walkBack(reduced.page, steps);
  await checkMidBeat(reduced.page, scenes, steps);
  await checkShortcuts(reduced.page, steps);
  await checkScenes(reduced.page, scenes, steps);
  await checkPlay(reduced.page, steps);
  await checkFade(reduced.page, scenes);
  await checkPartial(reduced.page);
  await checkTheme(reduced.page, "reduced motion");
  await checkOverflow(reduced.page, "1280 px");
  assert.deepEqual(reduced.errors, [], "no console error (reduced, 1280)");
  pass("no console error");
  await reduced.context.close();

  console.log("\n== reduced motion, 360 ==");
  const phone = await newPage(browser, 360, 800, "reduce");
  await open(phone.page);
  await checkLanding(phone.page, steps);
  await checkBar(phone.page);
  await checkTargets(phone.page);
  await checkOverflow(phone.page, "360 px");
  await focusByTab(phone.page, m.stepNext ?? "");
  for (let press = 0; press < 5; press += 1) await phone.page.keyboard.press("Enter");
  await landedOn(phone.page, steps[5]!, "step 6 at 360 px");
  await checkOverflow(phone.page, "360 px after steps");
  assert.deepEqual(phone.errors, [], "no console error (reduced, 360)");
  pass("no console error");
  await phone.context.close();

  console.log("\n== no preference, 1280 ==");
  const normal = await newPage(browser, 1280, 900, "no-preference");
  await open(normal.page);
  const bar = barOf(normal.page);
  assert.equal(await bar.getByRole("button", { name: m.play }).count(), 1, "play is shown");
  assert.equal(await bar.getByRole("button", { name: m.stepNext }).count(), 0, "no next step");
  assert.equal(
    await bar.getByRole("button", { name: m.stepPrevious }).count(),
    0,
    "no previous step",
  );
  assert.equal(await bar.locator("[role=status]").count(), 0, "no narration region");
  const start = await status(normal.page);
  assert.equal(start.reducedMotion, false);
  assert.equal(start.frame, 0, "no landing on the first beat without the preference");
  await normal.page.keyboard.press("n");
  await normal.page.waitForTimeout(250);
  assert.equal((await status(normal.page)).frame, 0, "N does nothing without the preference");
  await bar.getByRole("button", { name: m.nextScene }).click();
  await until(
    "scene 2 starts at its first frame",
    async () => (await status(normal.page)).frame === scenes[1]!.start,
  );
  pass("play button as before, no step button, N ignored, scenes still start at their first frame");
  await checkTrace(normal.page, scenes);
  await checkTheme(normal.page, "no preference");
  assert.deepEqual(normal.errors, [], "no console error (normal)");
  pass("no console error");
  await normal.context.close();

  console.log("\n== snapshots ==");
  await shots(browser, steps);
  console.log("\nall checks passed");
} finally {
  await browser.close();
}
