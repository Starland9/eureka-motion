import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

const BASE = "http://localhost:3000";
const OUT = ".snapshots/params";
const SIZES = [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "360", width: 360, height: 740, phone: true },
] as const;
const THEMES = ["paper", "board"] as const;
const SCENE_WITH_SWEEP = 2;
const DEFAULT_DISTANCE = 385_000_000;

type Size = (typeof SIZES)[number];
type Theme = (typeof THEMES)[number];

let failures = 0;
const errors: string[] = [];

function check(condition: boolean, message: string, detail?: unknown): void {
  if (condition) {
    console.log(`ok    ${message}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${message}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

const reference = (await (await fetch(`${BASE}/api/reference?language=fr`)).json()) as {
  explanation_id: string;
  title: string;
}[];
const REF = reference.find((entry) => entry.title === "La gravitation universelle")!;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const frames = (page: Page, count = 2): Promise<void> =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
  }, count);

const ruler = (page: Page) => page.getByRole("slider", { name: "Position dans l’explication" });
const clock = async (page: Page): Promise<number> =>
  Number(await ruler(page).getAttribute("aria-valuenow"));
const slider = (page: Page, name: RegExp) => page.getByRole("slider", { name });
const mass = (page: Page) => slider(page, /Masse de la Terre/);
const distance = (page: Page) => slider(page, /Distance entre les centres/);
const figure = (page: Page) => page.locator("div.aspect-video").first();
const result = (page: Page) => page.locator("output");

async function digest(target: Locator): Promise<string> {
  return createHash("sha1")
    .update(await target.screenshot({ animations: "disabled" }))
    .digest("hex");
}

async function read(target: Locator): Promise<number> {
  return Number(await target.inputValue());
}

async function clickAt(page: Page, target: Locator, fraction: number): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

async function open(browser: Browser, size: Size, theme: Theme) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.phone,
    hasTouch: size.phone,
    locale: "fr",
    colorScheme: theme === "board" ? "dark" : "light",
  });
  await context.addInitScript((value) => localStorage.setItem("eureka.theme", value), theme);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource")) return;
    errors.push(message.text());
  });
  await page.goto(`${BASE}/fr/e/${REF.explanation_id}`, { waitUntil: "domcontentloaded" });
  await ruler(page).waitFor({ timeout: 20000 });
  await distance(page).waitFor({ timeout: 20000 });
  return { context, page };
}

async function toScene(page: Page, index: number): Promise<void> {
  await page.locator("ol[aria-label] button").nth(index).click();
  await frames(page, 4);
}

async function play(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Lecture", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor({ timeout: 5000 });
}

async function pause(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Lecture", exact: true }).waitFor({ timeout: 5000 });
}

async function waitFor(what: string, condition: () => Promise<boolean>, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(60);
  }
  check(false, `timeout: ${what}`);
  return false;
}

async function markFigure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector("div.aspect-video svg");
    if (target) target.setAttribute("data-mark", "kept");
  });
}

const marked = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.querySelector('div.aspect-video svg[data-mark="kept"]') !== null);

async function shoot(page: Page, size: Size, theme: Theme, name: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 0, `${name} ${size.name} ${theme}: no horizontal overflow`, overflow);
  await page.screenshot({ path: `${OUT}/${name}-${size.name}-${theme}.png`, fullPage: true });
}

async function liveFlow(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  const { context, page } = await open(browser, size, theme);
  try {
    const sliders = page.getByRole("slider");
    const names = await sliders.evaluateAll((all) => all.map((s) => s.getAttribute("aria-label")));
    check(
      (await page.getByRole("heading", { name: "Fais varier" }).count()) === 1,
      `${tag}: the panel is mounted under the player`,
      names,
    );
    const panelTop = await page.getByRole("heading", { name: "Fais varier" }).boundingBox();
    const playerBottom = await figure(page).boundingBox();
    check(
      panelTop !== null &&
        playerBottom !== null &&
        panelTop.y > playerBottom.y + playerBottom.height,
      `${tag}: the panel sits below the player`,
    );
    await shoot(page, size, theme, "idle");

    await toScene(page, 2);
    await play(page);
    await sleep(1500);
    await markFigure(page);
    const t0 = await clock(page);
    const resultBefore = await result(page).innerText();
    const figureBefore = await digest(figure(page));

    await distance(page).focus();
    for (let press = 0; press < 4; press += 1) {
      await page.keyboard.press("ArrowRight");
      await sleep(40);
    }
    await page.keyboard.press("End");
    await frames(page, 3);
    const keyed = await read(distance(page));
    check(keyed > DEFAULT_DISTANCE, `${tag}: the keyboard raises the distance`, keyed);
    check(
      (await result(page).innerText()) !== resultBefore,
      `${tag}: the result follows the keyboard`,
    );
    check((await digest(figure(page))) !== figureBefore, `${tag}: the figure follows the keyboard`);
    check(await marked(page), `${tag}: the scene was not mounted again by the keyboard`);
    const t1 = await clock(page);
    check(t1 >= t0, `${tag}: the clock did not go back (keyboard)`, { t0, t1 });
    await sleep(2200);
    const t2 = await clock(page);
    check(t2 > t1, `${tag}: playback goes on after the keyboard`, { t1, t2 });
    check(
      await page.getByRole("button", { name: "Pause", exact: true }).isVisible(),
      `${tag}: still playing`,
    );

    const beforeMouse = await digest(figure(page));
    const resultMouse = await result(page).innerText();
    await clickAt(page, distance(page), 0.15);
    await frames(page, 3);
    const clicked = await read(distance(page));
    check(clicked < keyed, `${tag}: the mouse moves the distance`, { keyed, clicked });
    check((await result(page).innerText()) !== resultMouse, `${tag}: the result follows the mouse`);
    check((await digest(figure(page))) !== beforeMouse, `${tag}: the figure follows the mouse`);
    check(await marked(page), `${tag}: the scene was not mounted again by the mouse`);
    const t3 = await clock(page);
    check(t3 >= t2, `${tag}: the clock did not go back (mouse)`, { t2, t3 });

    await pause(page);
    const frozenClock = await clock(page);
    const figurePaused = await digest(figure(page));
    const resultPaused = await result(page).innerText();
    await distance(page).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await frames(page, 2);
    check((await clock(page)) === frozenClock, `${tag}: the paused clock stays`);
    check(
      (await result(page).innerText()) !== resultPaused,
      `${tag}: the result moves while paused`,
    );
    check(
      (await digest(figure(page))) !== figurePaused,
      `${tag}: the figure follows within two frames while paused`,
    );
    await mass(page).focus();
    await page.keyboard.press("ArrowRight");
    await frames(page, 2);
    check((await read(mass(page))) > 5.97e24, `${tag}: the mass slider moves too`);
    await shoot(page, size, theme, "moved");

    await page.getByRole("button", { name: "Réinitialiser" }).click();
    await frames(page, 3);
    check(
      (await read(distance(page))) === DEFAULT_DISTANCE,
      `${tag}: reset restores the default distance`,
    );
    check((await result(page).innerText()) === resultBefore, `${tag}: reset restores the result`, {
      before: resultBefore,
      after: await result(page).innerText(),
    });
    check(await marked(page), `${tag}: the scene was not mounted again by the reset`);
  } finally {
    await context.close();
  }
}

async function sweepFlow(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  const { context, page } = await open(browser, size, theme);
  try {
    await toScene(page, SCENE_WITH_SWEEP);
    await play(page);
    const seen: number[] = [];
    const started = await waitFor("the slider follows the sweep", async () => {
      const value = await read(distance(page));
      if (value !== DEFAULT_DISTANCE) seen.push(value);
      return seen.length > 0;
    });
    if (started) {
      const until = Date.now() + 9000;
      while (Date.now() < until) {
        seen.push(await read(distance(page)));
        await sleep(70);
      }
    }
    const distinct = new Set(seen).size;
    check(distinct >= 6, `${tag}: the slider follows the animated value`, { distinct });
    check(
      Math.max(...seen) > DEFAULT_DISTANCE * 1.5,
      `${tag}: the slider reaches about twice the distance`,
      Math.max(...seen),
    );
    await page.screenshot({ path: `${OUT}/sweep-${size.name}-${theme}.png`, fullPage: false });
  } finally {
    await context.close();
  }
}

async function takeOverFlow(
  browser: Browser,
  size: Size,
  theme: Theme,
  how: "keyboard" | "mouse",
): Promise<void> {
  const tag = `${size.name} ${theme} ${how}`;
  const { context, page } = await open(browser, size, theme);
  try {
    await toScene(page, SCENE_WITH_SWEEP);
    await play(page);
    await waitFor(
      "a sweep in progress",
      async () => (await read(distance(page))) > DEFAULT_DISTANCE * 1.15,
    );
    await markFigure(page);
    const clockAtGrab = await clock(page);
    if (how === "keyboard") {
      await distance(page).focus();
      await page.keyboard.press("ArrowLeft");
    } else {
      await clickAt(page, distance(page), 0.2);
    }
    await frames(page, 3);
    const grabbed = await read(distance(page));
    const resultGrabbed = await result(page).innerText();
    await sleep(1600);
    const later = await read(distance(page));
    check(
      (await result(page).innerText()) === resultGrabbed,
      `${tag}: the result stays with the student value`,
    );
    check(later === grabbed, `${tag}: the slider stays where the student put it`, {
      grabbed,
      later,
    });
    check(
      how === "mouse" ? grabbed < DEFAULT_DISTANCE : grabbed > DEFAULT_DISTANCE * 1.1,
      `${tag}: the student value is not the animated value`,
      grabbed,
    );
    check(await marked(page), `${tag}: the scene was not mounted again`);
    check((await clock(page)) >= clockAtGrab + 1, `${tag}: playback went on`);
    check(
      await page.getByRole("button", { name: "Pause", exact: true }).isVisible(),
      `${tag}: still playing`,
    );
    await page.screenshot({ path: `${OUT}/taken-${how}-${size.name}-${theme}.png` });
  } finally {
    await context.close();
  }
}

async function missingFlow(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "fr",
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/fr/e/aaaaaaaaaaaa`, { waitUntil: "networkidle" });
    check(
      (await page.getByRole("heading", { name: "Fais varier" }).count()) === 0 &&
        (await page.getByRole("slider").count()) === 0,
      "no panel while there is no explanation",
    );
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  await missingFlow(browser);
  for (const size of SIZES) {
    for (const theme of THEMES) await liveFlow(browser, size, theme);
  }
  await sweepFlow(browser, SIZES[0], "paper");
  await sweepFlow(browser, SIZES[1], "board");
  await takeOverFlow(browser, SIZES[0], "paper", "keyboard");
  await takeOverFlow(browser, SIZES[1], "board", "mouse");
} finally {
  await browser.close();
}

check(errors.length === 0, "no console error nor page error", errors.slice(0, 5));
if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
