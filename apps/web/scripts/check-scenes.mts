import { chromium, type Locator, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = ".snapshots/scenes";
const NBSP = "\u00a0";
const failures: string[] = [];
const consoleErrors: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures.push(`${label} ${detail}`.trim());
  console.log(ok ? "ok  " : "FAIL", label, ok ? "" : detail);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function open(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  width: number,
  dark: boolean,
  path = "/fr/dev/scenes",
) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  for (const name of ["full", "partial"]) {
    await page.waitForFunction(
      (id) =>
        document.querySelector(`[data-testid="probe-${id}"]`)?.getAttribute("data-ready") ===
        "true",
      name,
    );
  }
  return { context, page };
}

async function attr(locator: Locator, name: string): Promise<string> {
  return (await locator.getAttribute(name)) ?? "";
}

async function seek(page: Page, name: string, frame: number): Promise<void> {
  const probe = page.getByTestId(`probe-${name}`);
  const last = Number(await attr(probe, "data-duration")) - 1;
  const target = Math.min(frame, last);
  await page.getByTestId(`frame-${name}`).fill(String(target));
  await page.getByTestId(`seek-${name}`).click();
  await page.waitForFunction(
    ([id, wanted]) =>
      document.querySelector(`[data-testid="probe-${id}"]`)?.getAttribute("data-frame") ===
      String(wanted),
    [name, target] as const,
  );
}

async function lineStats(page: Page): Promise<{ lines: number; longest: number }> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="instance-full"] [data-slot="subtitles"]');
    const node = root?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return { lines: 0, longest: 0 };
    const text = node.textContent ?? "";
    const range = document.createRange();
    const rows = new Map<number, number>();
    for (let i = 0; i < text.length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      if (!rect || (rect.width === 0 && text[i] === " ")) continue;
      const top = Math.round(rect.top);
      rows.set(top, (rows.get(top) ?? 0) + 1);
    }
    return { lines: rows.size, longest: Math.max(0, ...rows.values()) };
  });
}

const browser = await chromium.launch();

{
  const { context, page } = await open(browser, 1280, false);
  const full = page.getByTestId("instance-full");
  const probe = page.getByTestId("probe-full");
  const subtitles = full.locator('[data-slot="subtitles"]');
  const caption = full.locator('[data-slot="figure-caption"]');
  const entries = full.locator('[data-slot="scene-list"] ol > li');

  const duration = Number(await attr(probe, "data-duration"));
  const sceneStarts = (await attr(probe, "data-scene-starts")).split(",").map(Number);
  const beatStarts = (await attr(probe, "data-beat-starts")).split(",").map(Number);
  console.log("duration", duration, "scenes", sceneStarts.length, "beats", beatStarts.length);

  const frames = new Set<number>();
  for (let i = 0; i < 10; i += 1) frames.add(Math.round((duration - 1) * (i / 9)));
  for (const start of beatStarts) {
    frames.add(start);
    if (start > 0) frames.add(start - 1);
  }
  const positions = [...frames].sort((a, b) => a - b);
  check("at least eight positions tested", positions.length >= 8, String(positions.length));

  const heights = new Set<number>();
  let maxLongest = 0;
  let maxLines = 0;
  let subtitleMismatches = 0;
  let captionMismatches = 0;
  let currentMismatches = 0;
  for (const frame of positions) {
    await seek(page, "full", frame);
    const expectedNarration = await attr(probe, "data-expected-narration");
    const expectedNumber = Number(await attr(probe, "data-expected-number"));
    const expectedTitle = await attr(probe, "data-expected-title");
    const text = (await subtitles.textContent()) ?? "";
    if (text !== expectedNarration || text === "") {
      subtitleMismatches += 1;
      console.log(
        "  subtitle",
        frame,
        JSON.stringify(text),
        "expected",
        JSON.stringify(expectedNarration),
      );
    }
    const captionText = (await caption.textContent()) ?? "";
    const expectedCaption = `Fig.${NBSP}${pad(expectedNumber)}${NBSP}— ${expectedTitle}`;
    if (captionText !== expectedCaption) {
      captionMismatches += 1;
      console.log(
        "  caption",
        frame,
        JSON.stringify(captionText),
        "expected",
        JSON.stringify(expectedCaption),
      );
    }
    const current = full.locator('[data-slot="scene-list"] [aria-current="true"]');
    const currentCount = await current.count();
    const currentIndex = await entries.evaluateAll((items) =>
      items.findIndex((item) => item.querySelector('[aria-current="true"]') !== null),
    );
    if (currentCount !== 1 || currentIndex !== expectedNumber - 1) {
      currentMismatches += 1;
      console.log("  current", frame, currentCount, currentIndex, "expected", expectedNumber - 1);
    }
    const box = await subtitles.boundingBox();
    heights.add(Math.round(box?.height ?? 0));
    const stats = await lineStats(page);
    maxLongest = Math.max(maxLongest, stats.longest);
    maxLines = Math.max(maxLines, stats.lines);
  }
  check(
    `subtitle equals the narration of the beat at ${positions.length} positions`,
    subtitleMismatches === 0,
    `${subtitleMismatches} mismatches`,
  );
  check(
    "caption shows the number and title of the scene at each position",
    captionMismatches === 0,
    `${captionMismatches} mismatches`,
  );
  check(
    "exactly one entry has aria-current, on the right scene",
    currentMismatches === 0,
    `${currentMismatches} mismatches`,
  );
  check(
    "subtitle block keeps one height at every position",
    heights.size === 1,
    JSON.stringify([...heights]),
  );
  console.log("subtitle lines max", maxLines, "longest line (characters)", maxLongest);
  check("subtitle line length at most 72 characters", maxLongest <= 72, String(maxLongest));
  check("subtitles fit two lines", maxLines <= 2, String(maxLines));
  check("subtitles have lang fr", (await subtitles.getAttribute("lang")) === "fr");
  check(
    "subtitles are not a live region",
    (await subtitles.getAttribute("aria-live")) === null &&
      (await subtitles.getAttribute("role")) === null &&
      (await subtitles.locator("[aria-live], [role=status], [role=alert]").count()) === 0,
  );

  await seek(page, "full", 0);
  const fullList = full.locator('[data-slot="scene-list"]');
  check(
    "full counter reads 6 scènes",
    ((await fullList.locator("[role=status]").textContent()) ?? "") === "6 scènes",
    (await fullList.locator("[role=status]").textContent()) ?? "",
  );
  check("full list has six buttons", (await entries.locator("button").count()) === 6);
  const buttonBoxes = await entries
    .locator("button")
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  check(
    "entries are at least 44 px high",
    buttonBoxes.every((h) => h >= 44),
    JSON.stringify(buttonBoxes),
  );

  await entries.nth(3).locator("button").click();
  const landed = await page
    .waitForFunction(
      (wanted) =>
        document.querySelector('[data-testid="probe-full"]')?.getAttribute("data-frame") ===
        String(wanted),
      sceneStarts[3],
      { timeout: 3000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(
    "clicking the fourth entry seeks to the start of the fourth scene",
    landed,
    `frame ${await attr(probe, "data-frame")}, expected ${sceneStarts[3]}`,
  );
  check(
    "fourth entry is current after the click",
    (await entries.nth(3).locator('[aria-current="true"]').count()) === 1,
  );

  await seek(page, "full", sceneStarts[2]! + 5);
  const below = page.getByTestId("below-full");
  const belowBefore = await below.boundingBox();
  const subtitlesBefore = await subtitles.boundingBox();
  const shown = ((await subtitles.textContent()) ?? "") !== "";
  await page.getByTestId("captions-full").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="probe-full"]')?.getAttribute("data-captions") ===
      "false",
  );
  const belowAfter = await below.boundingBox();
  const subtitlesAfter = await subtitles.boundingBox();
  check("subtitle text was shown before turning captions off", shown);
  check("captions off hides the subtitle text", ((await subtitles.textContent()) ?? "") === "");
  check(
    "captions off does not move the content below",
    belowBefore?.y === belowAfter?.y && subtitlesBefore?.height === subtitlesAfter?.height,
    JSON.stringify([belowBefore, belowAfter]),
  );
  await seek(page, "full", sceneStarts[4]! + 5);
  check(
    "subtitle stays hidden while seeking with captions off",
    ((await subtitles.textContent()) ?? "") === "",
  );
  await page.getByTestId("captions-full").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="probe-full"]')?.getAttribute("data-captions") ===
      "true",
  );
  check("captions on shows the subtitle again", ((await subtitles.textContent()) ?? "") !== "");

  await seek(page, "full", sceneStarts[2]! + 10);
  const listBefore = await entries.first().boundingBox();
  const frameBefore = Number(await attr(probe, "data-frame"));
  await page.getByTestId("toggle-full").click();
  await page.waitForTimeout(1500);
  await page.getByTestId("toggle-full").click();
  const frameAfter = Number(await attr(probe, "data-frame"));
  const listAfter = await entries.first().boundingBox();
  check(
    "playback advanced while the list was checked",
    frameAfter > frameBefore + 20,
    `${frameBefore} -> ${frameAfter}`,
  );
  check("list does not move while playing", listBefore?.y === listAfter?.y);
  const playedText = (await subtitles.textContent()) ?? "";
  check(
    "subtitle after playing equals the narration of the beat",
    playedText === (await attr(probe, "data-expected-narration")),
    playedText,
  );

  const partial = page.getByTestId("instance-partial");
  const partialList = partial.locator('[data-slot="scene-list"]');
  const partialCounter = (await partialList.locator("[role=status]").textContent()) ?? "";
  console.log("partial counter:", partialCounter);
  check("partial counter reads 2 ... 6", /^2\D+6$/.test(partialCounter.trim()), partialCounter);
  check(
    "partial has two ready entries",
    (await partialList.locator("li[data-state=ready]").count()) === 2,
  );
  check(
    "partial has three entries in preparation",
    (await partialList.locator("li[data-state=pending]").count()) === 3,
  );
  check(
    "partial has one missing entry",
    (await partialList.locator("li[data-state=missing]").count()) === 1,
  );
  check("only the ready entries are buttons", (await partialList.locator("button").count()) === 2);
  check(
    "pending and missing entries are not focusable",
    (await partialList.locator("li:not([data-state=ready]) :is(button, a, [tabindex])").count()) ===
      0,
  );
  const states = await partialList
    .locator("ol > li")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-state")));
  check(
    "partial entries are in planned order",
    JSON.stringify(states) ===
      JSON.stringify(["ready", "ready", "pending", "missing", "pending", "pending"]),
    JSON.stringify(states),
  );
  check(
    "partial list has one entry marked current",
    (await partialList.locator('[aria-current="true"]').count()) === 1,
  );
  const partialDuration = Number(await attr(page.getByTestId("probe-partial"), "data-duration"));
  await seek(page, "partial", partialDuration - 1);
  const lastCaption = (await partial.locator('[data-slot="figure-caption"]').textContent()) ?? "";
  check(
    "partial caption at the last frame names figure 02",
    lastCaption.startsWith(`Fig.${NBSP}02`),
    lastCaption,
  );
  const lastCurrent = await partialList
    .locator("ol > li")
    .evaluateAll((items) =>
      items.findIndex((item) => item.querySelector('[aria-current="true"]') !== null),
    );
  check("partial current entry follows the playhead", lastCurrent === 1, String(lastCurrent));

  await context.close();
}

{
  const { context, page } = await open(browser, 1280, false, "/en/dev/scenes");
  const partialCounter =
    (await page.getByTestId("instance-partial").locator("[role=status]").textContent()) ?? "";
  const fullCounter =
    (await page.getByTestId("instance-full").locator("[role=status]").textContent()) ?? "";
  check("english partial counter", partialCounter === "2 scenes ready out of 6", partialCounter);
  check("english full counter", fullCounter === "6 scenes", fullCounter);
  const lang = await page
    .getByTestId("instance-full")
    .locator('[data-slot="subtitles"]')
    .getAttribute("lang");
  check(
    "english page subtitles keep the language of the document (fr)",
    lang === "fr",
    String(lang),
  );
  await context.close();
}

for (const [name, width, dark] of [
  ["desktop-paper", 1280, false],
  ["desktop-board", 1280, true],
  ["mobile-paper", 360, false],
  ["mobile-board", 360, true],
] as const) {
  const { context, page } = await open(browser, width, dark);
  const probe = page.getByTestId("probe-full");
  const starts = (await attr(probe, "data-scene-starts")).split(",").map(Number);
  await seek(page, "full", starts[2]! + 40);
  await seek(page, "partial", 20);
  await page.addStyleTag({ content: ".skip-link, nextjs-portal { display: none !important; }" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  if (width === 360) {
    const overflow = await page.evaluate(() => ({
      root: document.documentElement.scrollWidth - window.innerWidth,
      body: document.body.scrollWidth - window.innerWidth,
    }));
    check(
      `no horizontal overflow at 360 px (${name})`,
      overflow.root <= 0 && overflow.body <= 0,
      JSON.stringify(overflow),
    );
    const plate = await page
      .getByTestId("instance-full")
      .locator('[data-slot="subtitles"]')
      .boundingBox();
    const list = await page
      .getByTestId("instance-full")
      .locator('[data-slot="scene-list"]')
      .boundingBox();
    check(
      `list sits under the plate at 360 px (${name})`,
      !!plate && !!list && list.y > plate.y,
      JSON.stringify([plate, list]),
    );
  } else {
    const plate = await page
      .getByTestId("instance-full")
      .locator('[data-slot="subtitles"]')
      .boundingBox();
    const list = await page
      .getByTestId("instance-full")
      .locator('[data-slot="scene-list"]')
      .boundingBox();
    check(
      `list stands beside the plate at 1280 px (${name})`,
      !!plate && !!list && list.x > plate.x + plate.width - 1 && list.y < plate.y,
      JSON.stringify([plate, list]),
    );
  }
  await context.close();
}

await browser.close();

check("no console error", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall checks passed");
