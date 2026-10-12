import { mkdirSync, rmSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const URL = "http://localhost:3000/fr/dev/gallery";
const OUT = ".snapshots/gallery";
const THEMES = ["paper", "board"] as const;
const PLATE_INSET = 24;
const MIN_INK = 0.002;

interface Doc {
  slug: string;
  status: string;
}

const problems: string[] = [];
const report: string[] = [];
let screenshots = 0;
let sceneCount = 0;

function fail(message: string): void {
  problems.push(message);
  console.error(`FAIL ${message}`);
}

async function inkRatio(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(
    async ([base64, inset]) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = `data:image/png;base64,${base64}`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(image, 0, 0);
      const width = image.width - 2 * Number(inset);
      const height = image.height - 2 * Number(inset);
      const { data } = context.getImageData(Number(inset), Number(inset), width, height);
      const buckets = new Map<number, number>();
      for (let i = 0; i < data.length; i += 4) {
        const key = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      let background = 0;
      let best = -1;
      for (const [key, count] of buckets) {
        if (count > best) {
          best = count;
          background = key;
        }
      }
      const br = (background >> 10) << 3;
      const bg = ((background >> 5) & 31) << 3;
      const bb = (background & 31) << 3;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        const distance =
          Math.abs(data[i]! - br) + Math.abs(data[i + 1]! - bg) + Math.abs(data[i + 2]! - bb);
        if (distance > 96) ink += 1;
      }
      return ink / (data.length / 4);
    },
    [png.toString("base64"), PLATE_INSET] as const,
  );
}

async function frameOf(page: Page, slug: string): Promise<number> {
  return Number(await page.getByTestId(`readout-${slug}`).getAttribute("data-frame"));
}

async function waitForFrame(page: Page, slug: string, expected: number): Promise<void> {
  await page.waitForFunction(
    ([id, frame]) =>
      document.querySelector(`[data-testid="readout-${id}"]`)?.getAttribute("data-frame") ===
      String(frame),
    [slug, expected] as const,
    { timeout: 10_000 },
  );
}

async function setPageTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.getByTestId(`theme-${theme}`).click();
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    theme === "board",
  );
  await page.waitForFunction(
    (name) =>
      document.querySelector(`[data-testid="theme-${name}"]`)?.getAttribute("aria-pressed") ===
      "true",
    theme,
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
});
const page = await context.newPage();
page.on("pageerror", (error) => fail(`page error: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") fail(`console error: ${message.text()}`);
});

rmSync(OUT, { recursive: true, force: true });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(
  () =>
    document.querySelectorAll('[data-testid^="play-"]').length > 0 &&
    document.querySelectorAll('[data-testid^="play-"]:disabled').length === 0,
  undefined,
  { timeout: 30_000 },
);
await page.evaluate(() => document.fonts.ready);

const docs: Doc[] = await page.locator('section[data-testid^="doc-"]').evaluateAll((sections) =>
  sections.map((section) => ({
    slug: (section.getAttribute("data-testid") ?? "").slice("doc-".length),
    status: section.getAttribute("data-status") ?? "",
  })),
);
if (docs.length === 0) fail("no document on the page");

for (const doc of docs) {
  if (doc.status === "ok") continue;
  const issues = await page.getByTestId(`issues-${doc.slug}`).innerText();
  fail(`document ${doc.slug} failed to parse:\n${issues}`);
}
const playable = docs.filter((doc) => doc.status === "ok");

await page.waitForTimeout(1500);
for (const doc of playable) {
  const frame = await frameOf(page, doc.slug);
  const playing = await page.getByTestId(`play-${doc.slug}`).getAttribute("data-playing");
  if (frame !== 0 || playing !== "false") {
    fail(`${doc.slug} started by itself (frame ${frame}, playing ${playing})`);
  }
}

const first = playable[0];
let emptyInk = 0;
if (first) {
  const empty = await page.getByTestId(`plate-${first.slug}`).screenshot();
  emptyInk = await inkRatio(page, empty);
  report.push(
    `empty plate reference (${first.slug}, frame 0): ink ${(emptyInk * 100).toFixed(3)} %`,
  );
  const toggle = page.getByTestId(`play-${first.slug}`);
  await toggle.click();
  await page.waitForFunction(
    (id) =>
      Number(document.querySelector(`[data-testid="readout-${id}"]`)?.getAttribute("data-frame")) >
      5,
    first.slug,
    { timeout: 10_000 },
  );
  if ((await toggle.getAttribute("data-playing")) !== "true")
    fail(`${first.slug}: play did not start`);
  for (const doc of playable.slice(1)) {
    if ((await frameOf(page, doc.slug)) !== 0) fail(`${doc.slug} moved while ${first.slug} played`);
  }
  await toggle.click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-testid="play-${id}"]`)?.getAttribute("data-playing") ===
      "false",
    first.slug,
  );
  const stopped = await frameOf(page, first.slug);
  await page.waitForTimeout(400);
  if ((await frameOf(page, first.slug)) !== stopped) fail(`${first.slug}: pause did not stop`);
  report.push(`play/pause checked on ${first.slug}, other players stayed at frame 0`);
}

for (const theme of THEMES) {
  await setPageTheme(page, theme);
  mkdirSync(`${OUT}/${theme}`, { recursive: true });
  for (const doc of playable) {
    const section = page.getByTestId(`doc-${doc.slug}`);
    await section.scrollIntoViewIfNeeded();
    const buttons = section.locator('[data-testid^="scene-"]');
    const count = await buttons.count();
    if (count === 0) fail(`${doc.slug}: no scene button`);
    if (theme === THEMES[0]) sceneCount += count;
    for (let index = 0; index < count; index += 1) {
      const button = page.getByTestId(`scene-${doc.slug}-${index}`);
      const sceneId = await button.getAttribute("data-scene-id");
      const expected = Number(await button.getAttribute("data-frame"));
      await button.click();
      await waitForFrame(page, doc.slug, expected);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const readout = await page.getByTestId(`readout-${doc.slug}`).innerText();
      const label = `${theme}/${doc.slug}-${sceneId}`;
      const png = await page
        .getByTestId(`plate-${doc.slug}`)
        .screenshot({ path: `${OUT}/${theme}/${doc.slug}-${sceneId}.png` });
      screenshots += 1;
      const ink = await inkRatio(page, png);
      console.log(`${label.padEnd(60)} ink ${(ink * 100).toFixed(2).padStart(6)} %  ${readout}`);
      if (ink - emptyInk < MIN_INK)
        fail(`${label}: plate looks blank (ink ${(ink * 100).toFixed(3)} %)`);
    }
  }
}

await browser.close();

for (const line of report) console.log(line);
console.log(
  `documents: ${docs.length} (${playable.length} playable), scenes: ${sceneCount}, screenshots: ${screenshots}`,
);
if (problems.length > 0) {
  console.error(`${problems.length} problem(s)`);
  process.exit(1);
}
console.log("ok");
