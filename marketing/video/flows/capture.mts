import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire("/home/landry/Dev/eureka-motion/apps/web/package.json");
const { chromium } = require("@playwright/test") as typeof import("@playwright/test");
type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3400";
const DISPLAY = process.env.DISPLAY ?? ":99";
const ROOT = "/home/landry/Dev/eureka-motion/marketing/video";
const FLOW = process.env.FLOW ?? "main";
const STEM = FLOW === "main" ? "" : `${FLOW}_`;
const RAW = path.join(ROOT, FLOW === "main" ? "footage/raw.mkv" : `footage/${FLOW}.mkv`);
const MARKS = path.join(ROOT, `footage/${STEM}marks.json`);
const QUESTION = process.env.DEMO_QUESTION ?? "C’est quoi le théorème de Pythagore ?";

mkdirSync(path.join(ROOT, "footage"), { recursive: true });

const marks: Record<string, number> = {};
let t0 = 0;
const now = (): number => (Date.now() - t0) / 1000;
function mark(name: string): void {
  marks[name] = Math.round(now() * 100) / 100;
  writeFileSync(MARKS, JSON.stringify(marks, null, 2));
  console.log(`[${marks[name]!.toFixed(1).padStart(6)} s] ${name}`);
}
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function startRecording(): ChildProcess {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "x11grab",
      "-framerate",
      "30",
      "-video_size",
      "1920x1080",
      "-draw_mouse",
      "0",
      "-i",
      `${DISPLAY}+0,109`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "16",
      "-pix_fmt",
      "yuv420p",
      RAW,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  return ffmpeg;
}

const CURSOR = `
(() => {
  if (window.top !== window) return;
  const make = () => {
    if (document.getElementById("__demo_cursor")) return;
    const dot = document.createElement("div");
    dot.id = "__demo_cursor";
    dot.style.cssText =
      "position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #C8371F;border-radius:50%;background:rgba(200,55,31,.14);z-index:2147483647;pointer-events:none;transition:transform .08s,background .12s;display:none";
    document.documentElement.appendChild(dot);
    addEventListener("mousemove", (e) => {
      dot.style.display = "block";
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
    }, true);
    addEventListener("mousedown", () => { dot.style.transform = "scale(.7)"; dot.style.background = "rgba(200,55,31,.45)"; }, true);
    addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; dot.style.background = "rgba(200,55,31,.14)"; }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", make); else make();
})();
`;

let mouse = { x: 768, y: 430 };
async function glide(page: Page, x: number, y: number, steps = 28): Promise<void> {
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
  await pause(120);
}
async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box for locator");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function clickOn(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const { x, y } = await center(locator);
  await glide(page, x, y);
  await page.mouse.down();
  await pause(90);
  await page.mouse.up();
  await pause(200);
}

async function setRange(page: Page, range: Locator, fraction: number): Promise<void> {
  const box = await range.boundingBox();
  if (!box) throw new Error("range without box");
  const value = Number(await range.inputValue());
  const min = Number((await range.getAttribute("min")) ?? 0);
  const max = Number((await range.getAttribute("max")) ?? 1);
  const current = max === min ? 0 : (value - min) / (max - min);
  const pad = 8;
  const xAt = (f: number): number => box.x + pad + (box.width - 2 * pad) * f;
  const y = box.y + box.height / 2;
  await glide(page, xAt(current), y);
  await page.mouse.down();
  await pause(120);
  await page.mouse.move(xAt(fraction), y, { steps: 36 });
  mouse = { x: xAt(fraction), y };
  await pause(120);
  await page.mouse.up();
  await pause(300);
}

async function launch(): Promise<{
  browser: import("@playwright/test").Browser;
  context: import("@playwright/test").BrowserContext;
  page: Page;
}> {
  const octet = (): number => 1 + Math.floor(Math.random() * 254);
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--window-position=0,0",
      "--window-size=1400,1000",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-infobars",
      "--hide-scrollbars",
      "--no-first-run",
      "--force-device-scale-factor=1.25",
    ],
    env: { ...process.env, DISPLAY },
  });
  const context = await browser.newContext({
    viewport: { width: 1536, height: 868 },
    deviceScaleFactor: 1.25,
    locale: "fr-FR",
    colorScheme: "light",
    extraHTTPHeaders: { "X-Forwarded-For": `10.${octet()}.${octet()}.${octet()}` },
  });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  return { browser, context, page };
}

async function ensurePaused(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const playing = page.getByRole("button", { name: "Pause", exact: true });
  for (let i = 0; i < 3 && (await playing.count()) > 0; i += 1) {
    await page.keyboard.press("Space");
    await pause(400);
  }
  if ((await playing.count()) > 0) throw new Error("the player did not pause");
}

async function main(): Promise<void> {
  const ffmpeg = startRecording();
  await pause(1500);
  t0 = Date.now();
  mark("recording");

  const { browser, context, page } = await launch();
  let failed: unknown = null;

  try {
    // 1. Accroche : l'accueil et la question tapée.
    await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    await page.mouse.move(768, 330);
    mark("home");
    await pause(2200);
    await clickOn(page, page.getByRole("radio", { name: "Lycée", exact: true }));
    const field = page.getByRole("textbox", { name: /Je n’ai pas compris/ });
    await clickOn(page, field);
    await pause(400);
    mark("typing");
    await page.keyboard.type(QUESTION, { delay: 70 });
    await pause(900);
    mark("typed");
    await page.keyboard.press("Enter");
    mark("submitted");

    // 2. La génération : étapes de préparation puis première scène.
    await page.waitForURL(/\/fr\/e\/[a-z0-9]+$/, { timeout: 30_000 });
    mark("preparation");
    const ruler = page.getByRole("slider", { name: "Position dans l’explication" });
    await ruler.waitFor({ timeout: 120_000 });
    mark("first_scene");

    // 3. L'explication joue : on laisse tourner.
    const quizEntry = page.getByRole("button", { name: "Vérifier ce que j’ai compris", exact: true });
    await quizEntry.waitFor({ timeout: 180_000 });
    mark("generation_done");
    const id = page.url().split("/").pop()!;
    await pause(1500);

    // Retour au début pour montrer le déroulé dans l'ordre, lecture automatique.
    const scenes = page.getByRole("list", { name: /Scènes|scènes/ }).first();
    await scenes.waitFor({ timeout: 10_000 }).catch(() => undefined);
    await page.mouse.move(1200, 260);
    await pause(250);
    const restart = page.getByRole("button", { name: "Scène précédente" });
    for (let i = 0; i < 8; i += 1) {
      if (await ruler.evaluate((node) => Number((node as HTMLInputElement).value) <= 0.5)) break;
      await restart.click({ timeout: 1500 }).catch(() => undefined);
      await pause(120);
    }
    await page.keyboard.press("Space");
    mark("playback_start");
    await pause(26_000);
    mark("playback_mid");

    // 4. Les curseurs : on se place sur la scène interactive, on pose la lecture et on manipule.
    await page.getByRole("button", { name: /^03/ }).first().click();
    await pause(3200);
    await ensurePaused(page);
    await pause(500);
    mark("sliders_start");
    const ranges = page.locator("input[type=range]");
    const count = await ranges.count();
    const paramRanges: Locator[] = [];
    for (let i = 0; i < count; i += 1) {
      const range = ranges.nth(i);
      const name = (await range.getAttribute("aria-label")) ?? "";
      if (!/position|volume/i.test(name)) paramRanges.push(range);
    }
    if (paramRanges.length === 0) throw new Error("no parameter slider found");
    await page.evaluate(() => window.scrollTo({ top: 330, behavior: "smooth" }));
    await pause(1400);
    await setRange(page, paramRanges[0]!, 0.9);
    await pause(700);
    await setRange(page, paramRanges[0]!, 0.35);
    await pause(600);
    if (paramRanges[1]) {
      await setRange(page, paramRanges[1], 0.8);
      await pause(700);
    }
    mark("sliders_result");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await pause(2600);
    mark("sliders_end");

    // 5. « Je n'ai toujours pas compris » : une autre image.
    const another = page.getByRole("button", { name: /Une autre image/ }).first();
    await another.scrollIntoViewIfNeeded();
    await pause(900);
    mark("reformulate_shown");
    await clickOn(page, another);
    mark("reformulate_click");
    await page.waitForURL((url) => !url.pathname.endsWith(id), { timeout: 60_000 });
    mark("reformulate_preparation");
    const ruler2 = page.getByRole("slider", { name: "Position dans l’explication" });
    await ruler2.waitFor({ timeout: 120_000 });
    mark("reformulate_first_scene");
    await quizEntry.waitFor({ timeout: 180_000 });
    mark("reformulate_done");
    await page.mouse.move(1100, 240);
    await pause(5000);
    await page.locator("text=/^V2/").first().scrollIntoViewIfNeeded().catch(() => undefined);
    await pause(1200);
    mark("versions_shown");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await pause(900);
    await page.keyboard.press("Space").catch(() => undefined);

    // 6. Le quiz : une erreur, la scène à revoir, puis la bonne réponse.
    const id2 = page.url().split("/").pop()!;
    const detail = (await (await page.request.get(`${BASE}/api/explanations/${id2}`)).json()) as {
      payload: { quiz: { questions: { answer_id: string; choices: { id: string }[] }[] } };
    };
    const questions = detail.payload.quiz.questions;
    await clickOn(page, quizEntry);
    mark("quiz_open");
    await pause(1600);
    const quiz = page.getByRole("region", { name: /Quiz/ });
    const answerButtons = (): Locator =>
      quiz.getByRole("list").first().getByRole("button");
    const wrongIndex = questions[0]!.choices.findIndex((c) => c.id !== questions[0]!.answer_id);
    await clickOn(page, answerButtons().nth(wrongIndex));
    mark("quiz_wrong");
    await pause(2600);
    const review = quiz.getByRole("button", { name: /Revoir la scène/ }).first();
    if (await review.count()) {
      await clickOn(page, review);
      mark("quiz_review");
      await pause(2200);
    }
    const next = quiz.getByRole("button", { name: /Exercice suivant|Voir mon score/ }).first();
    await clickOn(page, next);
    await pause(900);
    if (questions[1]) {
      const rightIndex = questions[1].choices.findIndex((c) => c.id === questions[1]!.answer_id);
      await clickOn(page, answerButtons().nth(rightIndex));
      mark("quiz_right");
      await pause(2000);
      const next2 = quiz.getByRole("button", { name: /Exercice suivant|Voir mon score/ }).first();
      await clickOn(page, next2);
      await pause(1000);
      if (questions[2]) {
        const idx = questions[2].choices.findIndex((c) => c.id === questions[2]!.answer_id);
        await clickOn(page, answerButtons().nth(idx));
        await pause(1500);
        await clickOn(page, quiz.getByRole("button", { name: /Voir mon score/ }).first());
      }
    }
    await pause(2200);
    mark("quiz_score");

    // 7. Sans IA ni réseau : le sommaire et un exemple qui démarre aussitôt.
    await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    mark("home2");
    await page.mouse.move(768, 400);
    await page.evaluate(() => window.scrollTo({ top: 760, behavior: "smooth" }));
    await pause(1800);
    mark("sommaire_shown");
    await pause(2000);
    const example = page.getByRole("link", { name: /Loi d.Ohm/ }).first();
    await clickOn(page, example);
    mark("example_click");
    await page.getByRole("slider", { name: "Position dans l’explication" }).waitFor({ timeout: 10_000 });
    mark("example_ready");
    await pause(4500);

    // 8. Fiabilité : lien de partage.
    const share = page.getByRole("button", { name: "Copier le lien" });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await clickOn(page, share);
    mark("share_copied");
    await pause(2600);
    mark("end");
  } catch (error) {
    failed = error;
    mark("failed");
    await page.screenshot({ path: path.join(ROOT, "footage/failed.png") }).catch(() => undefined);
    console.error(error);
  } finally {
    await pause(800);
    await browser.close().catch(() => undefined);
    ffmpeg.stdin?.write("q");
    ffmpeg.stdin?.end();
    await new Promise((resolve) => ffmpeg.on("close", resolve));
  }
  if (failed) process.exit(1);
}

async function sliders(): Promise<void> {
  const ffmpeg = startRecording();
  await pause(1500);
  t0 = Date.now();
  mark("recording");
  const { browser, page } = await launch();
  let failed: unknown = null;
  try {
    await page.goto(`${BASE}/fr/e/${process.env.EXPLANATION_ID}`, { waitUntil: "networkidle" });
    await page.mouse.move(1200, 300);
    await pause(900);
    await clickOn(page, page.getByRole("button", { name: /Lire l’explication/ }));
    await pause(1200);
    await page.getByRole("button", { name: /^03/ }).first().click();
    await pause(900);
    mark("scene_shown");
    await pause(3800);
    await ensurePaused(page);
    await pause(900);
    mark("sliders_start");
    const ranges = page.locator("input[type=range]");
    const count = await ranges.count();
    const paramRanges: Locator[] = [];
    for (let i = 0; i < count; i += 1) {
      const range = ranges.nth(i);
      const name = (await range.getAttribute("aria-label")) ?? "";
      if (!/position|volume/i.test(name)) paramRanges.push(range);
    }
    if (paramRanges.length < 2) throw new Error("two parameter sliders expected");
    await page.evaluate(() => window.scrollTo({ top: 330, behavior: "smooth" }));
    await pause(1400);
    await setRange(page, paramRanges[0]!, 0.9);
    await pause(700);
    await setRange(page, paramRanges[0]!, 0.35);
    await pause(600);
    await setRange(page, paramRanges[1]!, 0.8);
    await pause(900);
    mark("sliders_result");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await pause(3000);
    mark("sliders_end");
  } catch (error) {
    failed = error;
    mark("failed");
    await page.screenshot({ path: path.join(ROOT, "footage/failed.png") }).catch(() => undefined);
    console.error(error);
  } finally {
    await pause(800);
    await browser.close().catch(() => undefined);
    ffmpeg.stdin?.write("q");
    ffmpeg.stdin?.end();
    await new Promise((resolve) => ffmpeg.on("close", resolve));
  }
  if (failed) process.exit(1);
}

async function tail(): Promise<void> {
  const ffmpeg = startRecording();
  await pause(1500);
  t0 = Date.now();
  mark("recording");
  const { browser, context, page } = await launch();
  let failed: unknown = null;
  try {
    await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    mark("home2");
    await page.mouse.move(768, 400);
    await pause(900);
    await page.evaluate(() => window.scrollTo({ top: 760, behavior: "smooth" }));
    await pause(1800);
    mark("sommaire_shown");
    await pause(1800);
    await clickOn(page, page.getByRole("link", { name: /Loi d.Ohm/ }).first());
    mark("example_click");
    await page.getByRole("slider", { name: "Position dans l’explication" }).waitFor({ timeout: 10_000 });
    mark("example_ready");
    await pause(900);
    await clickOn(page, page.getByRole("button", { name: /Lire l’explication/ }));
    mark("playing");
    await pause(5200);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("ArrowRight");
    await pause(900);
    await page.keyboard.press("ArrowRight");
    mark("keys");
    await pause(2400);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await clickOn(page, page.getByRole("button", { name: "Copier le lien" }));
    mark("share_copied");
    await pause(1800);
    await glide(page, ...(Object.values(await center(page.getByRole("link", { name: /Télécharger la vidéo/ }).or(page.getByRole("button", { name: /Télécharger la vidéo/ })).first())) as [number, number]));
    await pause(2200);
    mark("end");
  } catch (error) {
    failed = error;
    mark("failed");
    await page.screenshot({ path: path.join(ROOT, "footage/failed.png") }).catch(() => undefined);
    console.error(error);
  } finally {
    await pause(800);
    await browser.close().catch(() => undefined);
    ffmpeg.stdin?.write("q");
    ffmpeg.stdin?.end();
    await new Promise((resolve) => ffmpeg.on("close", resolve));
  }
  if (failed) process.exit(1);
}

const FLOWS: Record<string, () => Promise<void>> = { main, sliders, tail };
await FLOWS[FLOW]!();
