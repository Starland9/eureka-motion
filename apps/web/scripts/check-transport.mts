import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = ".snapshots/transport";
const FPS = 30;

type Messages = Record<string, string>;

function messagesFor(locale: string): Messages {
  const file = new URL(`../messages/${locale}/transport.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")).Transport as Messages;
}

interface Status {
  ready: boolean;
  playing: boolean;
  waiting: boolean;
  ended: boolean;
  muted: boolean;
  captions: boolean;
  frame: number;
  scene: number | null;
  duration: number;
}

async function status(page: Page, id = "status"): Promise<Status> {
  return JSON.parse((await page.getByTestId(id).textContent()) ?? "{}") as Status;
}

async function until(
  what: string,
  condition: () => Promise<boolean>,
  timeout = 6000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timeout: ${what}`);
}

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  assert.ok(result, "element has a box");
  return result;
}

function pass(message: string): void {
  console.log(`  ok  ${message}`);
}

async function newPage(browser: Browser, width: number, height: number, dark = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return { context, page, errors };
}

async function open(page: Page, locale: string): Promise<void> {
  await page.goto(`${BASE}/${locale}/dev/transport`, { waitUntil: "networkidle" });
  await until("player ready", async () => (await status(page)).ready);
  await until("partial player ready", async () => (await status(page, "status-partial")).ready);
}

async function checkTabOrder(page: Page, m: Messages): Promise<void> {
  const bar = page.getByRole("group", { name: m.label }).first();
  const handle = await bar.elementHandle();
  assert.ok(handle);
  const expected = [
    m.ruler,
    m.previousScene,
    m.play,
    m.nextScene,
    m.captions,
    m.sound,
    m.volume,
    m.fullscreen,
  ];
  const interactive = await bar.locator("button:not([disabled]), [role=slider]").count();
  assert.equal(interactive, expected.length, "number of controls in the bar");

  await blur(page);
  const names: string[] = [];
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate((el) => el.contains(document.activeElement), handle);
    if (!inside) {
      if (names.length > 0) break;
      continue;
    }
    const snapshot = await page.locator(":focus").ariaSnapshot();
    const name = /^- \w+ "([^"]*)"/.exec(snapshot)?.[1] ?? "";
    assert.notEqual(name.trim(), "", `focused control has an accessible name: ${snapshot}`);
    names.push(name);
  }
  assert.deepEqual(names, expected, "tab order and accessible names");
  pass(`all ${expected.length} controls reachable with Tab, in visual order, each named`);
}

async function checkTargets(page: Page, label: string): Promise<void> {
  const bar = page.getByRole("group", { name: label }).first();
  const targets = bar.locator("button, [data-slot=slider], div[role=slider]");
  const count = await targets.count();
  const boxes = [];
  for (let index = 0; index < count; index += 1) {
    const rect = await box(targets.nth(index));
    assert.ok(
      rect.width >= 43.5 && rect.height >= 43.5,
      `target ${index} is 44 px: ${rect.width}x${rect.height}`,
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
      assert.ok(Math.max(gapX, gapY) >= 7.5, `targets ${a} and ${b} are at least 8 px apart`);
    }
  }
  pass(`${count} targets are at least 44 px and 8 px apart`);
}

async function checkNoOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  assert.ok(scroll! <= client!, `no horizontal overflow (${scroll} > ${client})`);
  pass(`no horizontal overflow (scrollWidth ${scroll} <= clientWidth ${client})`);
}

async function checkKeyboard(page: Page, m: Messages): Promise<void> {
  const bar = page.getByRole("group", { name: m.label }).first();
  const ruler = bar.getByRole("slider", { name: m.ruler });
  const soundButton = bar.getByRole("button", { name: m.sound });
  const captionsButton = bar.getByRole("button", { name: m.captions });

  await blur(page);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press(" ");
  await until("Space starts playback", async () => (await status(page)).playing);
  await page.keyboard.press(" ");
  await until("Space pauses playback", async () => !(await status(page)).playing);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, "Space does not scroll");
  pass("Space toggles playback without scrolling the page");

  await ruler.focus();
  await page.keyboard.press("Home");
  await until("at start", async () => (await status(page)).frame === 0);
  await blur(page);
  await page.keyboard.press("ArrowRight");
  await until("global ArrowRight", async () => (await status(page)).frame === 5 * FPS);
  await page.keyboard.press("ArrowRight");
  await until("global ArrowRight twice", async () => (await status(page)).frame === 10 * FPS);
  await page.keyboard.press("ArrowLeft");
  await until("global ArrowLeft", async () => (await status(page)).frame === 5 * FPS);
  pass("global ArrowRight / ArrowLeft move the position by exactly 5 s");

  await ruler.focus();
  await page.keyboard.press("ArrowRight");
  await until("slider ArrowRight", async () => (await status(page)).frame === 10 * FPS);
  await page.waitForTimeout(250);
  assert.equal((await status(page)).frame, 10 * FPS, "slider arrow is handled once");
  await page.keyboard.press("ArrowLeft");
  await until("slider ArrowLeft", async () => (await status(page)).frame === 5 * FPS);
  pass("ArrowRight / ArrowLeft on the ruler move by 5 s, handled once");

  const valueText = await ruler.getAttribute("aria-valuetext");
  assert.ok(valueText?.includes("0:05"), `aria-valuetext reflects the position: ${valueText}`);
  assert.equal(await ruler.getAttribute("aria-valuemin"), "0");
  assert.equal(await ruler.getAttribute("aria-valuenow"), "5");
  assert.ok(Number(await ruler.getAttribute("aria-valuemax")) > 60, "aria-valuemax in seconds");
  pass(`aria-valuemin/max/now in seconds, aria-valuetext: "${valueText}"`);

  await blur(page);
  const mutedBefore = (await status(page)).muted;
  await page.keyboard.press("m");
  await until("M toggles sound", async () => (await status(page)).muted === !mutedBefore);
  assert.equal(await soundButton.getAttribute("aria-pressed"), String(mutedBefore));
  await page.keyboard.press("Shift+M");
  await until("Shift+M toggles sound back", async () => (await status(page)).muted === mutedBefore);
  await page.keyboard.press("Control+m");
  await page.waitForTimeout(200);
  assert.equal((await status(page)).muted, mutedBefore, "Ctrl+M is ignored");
  pass("M toggles sound (aria-pressed follows), Ctrl+M is ignored");

  const captionsBefore = (await status(page)).captions;
  await page.keyboard.press("c");
  await until("C toggles captions", async () => (await status(page)).captions === !captionsBefore);
  assert.equal(await captionsButton.getAttribute("aria-pressed"), String(!captionsBefore));
  await page.keyboard.press("c");
  await until(
    "C toggles captions back",
    async () => (await status(page)).captions === captionsBefore,
  );
  pass("C toggles captions (aria-pressed follows)");

  await captionsButton.focus();
  await page.keyboard.press(" ");
  await until(
    "Space on a button activates it only",
    async () => (await status(page)).captions === !captionsBefore,
  );
  assert.equal((await status(page)).playing, false, "Space on a button does not toggle playback");
  await page.keyboard.press(" ");
  await until(
    "Space on button, second press",
    async () => (await status(page)).captions === captionsBefore,
  );
  pass("Space on a focused button activates that button, not playback");

  await ruler.focus();
  await page.keyboard.press("End");
  await until("End goes to the end", async () => {
    const current = await status(page);
    return current.frame >= current.duration - 2;
  });
  assert.equal(
    await ruler.getAttribute("aria-valuenow"),
    await ruler.getAttribute("aria-valuemax"),
  );
  await page.keyboard.press("Home");
  await until("Home goes to the start", async () => (await status(page)).frame === 0);
  pass("End then Home on the ruler reach the end then the start");

  await page.keyboard.press("PageDown");
  await until("PageDown goes to scene 2", async () => (await status(page)).scene === 1);
  await page.keyboard.press("PageDown");
  await until("PageDown goes to scene 3", async () => (await status(page)).scene === 2);
  await page.keyboard.press("PageUp");
  await until("PageUp goes back to scene 2", async () => (await status(page)).scene === 1);
  pass("PageDown / PageUp move to the next / previous scene");
}

async function checkPointer(page: Page, m: Messages): Promise<void> {
  const bar = page.getByRole("group", { name: m.label }).first();
  const ruler = bar.getByRole("slider", { name: m.ruler });
  const touchAction = await ruler.evaluate((el) => getComputedStyle(el).touchAction);
  const barTouchAction = await bar.evaluate((el) => getComputedStyle(el).touchAction);
  assert.equal(touchAction, "none", "touch-action none on the ruler");
  assert.notEqual(barTouchAction, "none", "touch-action none only on the track");

  await ruler.focus();
  await page.keyboard.press("Home");
  await until("ruler at start", async () => (await status(page)).frame === 0);
  const rect = await box(ruler);
  const { duration } = await status(page);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await until("click seeks", async () => (await status(page)).frame > 0);
  const middle = (await status(page)).frame;
  assert.ok(
    Math.abs(middle - duration / 2) <= duration * 0.02,
    `click in the middle seeks near the middle (${middle} of ${duration})`,
  );
  pass(`click in the middle of the ruler seeks near the middle (frame ${middle} of ${duration})`);

  await page.mouse.move(rect.x + rect.width * 0.2, rect.y + 20);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + 20, { steps: 6 });
  await page.mouse.move(rect.x + rect.width * 0.85, rect.y + 60, { steps: 6 });
  await page.mouse.up();
  await until(
    "drag seeks",
    async () => Math.abs((await status(page)).frame - duration * 0.85) <= duration * 0.02,
  );
  pass("dragging the ruler follows the pointer, even when it leaves the track vertically");
}

async function checkButtons(page: Page, m: Messages): Promise<void> {
  const bar = page.getByRole("group", { name: m.label }).first();
  await blur(page);
  const play = bar.getByRole("button", { name: m.play });
  await play.click();
  await until("play button starts", async () => (await status(page)).playing);
  await bar.getByRole("button", { name: m.pause }).click();
  await until("pause button pauses", async () => !(await status(page)).playing);
  pass("play and pause buttons swap names and drive playback");

  await bar.getByRole("slider", { name: m.ruler }).focus();
  await page.keyboard.press("Home");
  await until("at start", async () => (await status(page)).frame === 0);
  await bar.getByRole("button", { name: m.nextScene }).click();
  await until("next scene", async () => (await status(page)).scene === 1);
  await bar.getByRole("button", { name: m.nextScene }).click();
  await until("next scene again", async () => (await status(page)).scene === 2);
  await bar.getByRole("button", { name: m.previousScene }).click();
  await until("previous scene", async () => (await status(page)).scene === 1);
  pass("next / previous scene buttons move between scenes");

  await bar.getByRole("slider", { name: m.ruler }).focus();
  await page.keyboard.press("End");
  await until("at the end", async () => {
    const current = await status(page);
    return current.frame === current.duration - 1;
  });
  await page.keyboard.press("ArrowLeft");
  await until("5 s before the end", async () => {
    const current = await status(page);
    return current.frame === current.duration - 1 - 5 * FPS;
  });
  await bar.getByRole("button", { name: m.play }).click();
  await until("ended", async () => (await status(page)).ended, 10000);
  const replay = bar.getByRole("button", { name: m.replay });
  await replay.waitFor();
  await replay.click();
  await until("replay restarts", async () => {
    const current = await status(page);
    return current.playing && !current.ended && current.frame < 4 * FPS;
  });
  await bar.getByRole("button", { name: m.pause }).click();
  await until("paused after replay", async () => !(await status(page)).playing);
  pass("at the end the play button becomes Replay and restarts from 0");

  const mutedBefore = (await status(page)).muted;
  await bar.getByRole("button", { name: m.sound }).click();
  await until("sound button", async () => (await status(page)).muted === !mutedBefore);
  await bar.getByRole("button", { name: m.sound }).click();
  await until("sound button back", async () => (await status(page)).muted === mutedBefore);

  const volume = bar.getByRole("slider", { name: m.volume });
  await volume.focus();
  await page.keyboard.press("ArrowLeft");
  await until(
    "volume with the keyboard",
    async () => (await volume.getAttribute("aria-valuenow")) === "0.95",
  );
  await page.keyboard.press("End");
  pass(
    `volume slider works with the keyboard (aria-valuetext "${await volume.getAttribute("aria-valuetext")}")`,
  );

  const fullscreen = bar.getByRole("button", { name: m.fullscreen });
  await fullscreen.click();
  await page.waitForTimeout(600);
  const entered = await page.evaluate(() => document.fullscreenElement !== null);
  if (entered) await page.evaluate(() => document.exitFullscreen());
  pass(`full screen button clicked without error (entered: ${entered})`);
}

async function checkStableLayout(page: Page, m: Messages): Promise<void> {
  const bar = page.getByRole("group", { name: m.label }).first();
  const time = bar.getByText(/\d+:\d\d\s+\/\s+\d+:\d\d/);
  const ruler = bar.getByRole("slider", { name: m.ruler });
  const widths: number[] = [];
  const lefts: number[] = [];
  for (const key of ["Home", "End", "Home"]) {
    await ruler.focus();
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    widths.push((await box(time)).width);
    lefts.push((await box(bar.getByRole("button", { name: m.fullscreen }))).x);
  }
  assert.equal(new Set(widths).size, 1, `time width is constant: ${widths}`);
  assert.equal(new Set(lefts).size, 1, `buttons do not move: ${lefts}`);
  pass(`time label keeps its width (${widths[0]} px) and buttons keep their place`);
}

async function checkPartial(page: Page, m: Messages): Promise<void> {
  const bar = page.getByRole("group", { name: m.label }).nth(1);
  const ruler = bar.getByRole("slider", { name: m.ruler });
  await ruler.focus();
  await page.keyboard.press("Home");
  await until("partial at start", async () => (await status(page, "status-partial")).frame === 0);

  const valueText = (await ruler.getAttribute("aria-valuetext")) ?? "";
  assert.ok(
    /6/.test(valueText) && /4/.test(valueText),
    `value text mentions 6 scenes and 4 pending: ${valueText}`,
  );
  assert.equal(await bar.locator("svg pattern").count(), 4, "four sections in preparation");
  pass(`partial ruler: 4 sections in preparation, aria-valuetext "${valueText}"`);

  const rect = await box(ruler);
  const partial = await status(page, "status-partial");
  const known = partial.duration;
  await page.mouse.click(rect.x + rect.width * 0.2, rect.y + 30);
  await until(
    "click in the known part seeks",
    async () => (await status(page, "status-partial")).frame > 0,
  );
  const seeked = (await status(page, "status-partial")).frame;
  assert.ok(
    Math.abs(seeked - known * 3 * 0.2) <= known * 0.06,
    `known part is a third of the ruler (${seeked})`,
  );
  await ruler.focus();
  await page.keyboard.press("Home");
  await until(
    "partial at start again",
    async () => (await status(page, "status-partial")).frame === 0,
  );
  await page.mouse.click(rect.x + rect.width * 0.8, rect.y + 30);
  await page.waitForTimeout(250);
  assert.equal(
    (await status(page, "status-partial")).frame,
    0,
    "sections in preparation ignore the pointer",
  );
  pass("pointer seeks in the known third of the ruler, ignores the sections in preparation");

  const timeLabel = await bar.getByText(/\d+:\d\d\s+\/\s+\d+:\d\d/).textContent();
  assert.ok(timeLabel?.trim().endsWith("+"), `partial total is marked provisional: ${timeLabel}`);

  await ruler.focus();
  await page.keyboard.press("End");
  await until("partial at the end", async () => {
    const current = await status(page, "status-partial");
    return current.frame === current.duration - 1;
  });
  await page.keyboard.press("ArrowLeft");
  await until("partial 5 s before the end", async () => {
    const current = await status(page, "status-partial");
    return current.frame === current.duration - 1 - 5 * FPS;
  });
  await bar.getByRole("button", { name: m.play }).click();
  await until(
    "partial waits at the end",
    async () => (await status(page, "status-partial")).waiting,
    10000,
  );
  const play = bar.getByRole("button", { name: m.play });
  await play.waitFor();
  assert.equal(await play.isDisabled(), false, "play button stays usable while waiting");
  assert.equal(
    await bar.getByRole("button", { name: m.replay }).count(),
    0,
    "no Replay while waiting",
  );
  pass("while waiting for more scenes the button stays Play and enabled, never Replay");
  await play.click();
  await page.waitForTimeout(200);
}

async function checkEmpty(page: Page, m: Messages): Promise<void> {
  const bar = page.getByRole("group", { name: m.label }).nth(2);
  const buttons = bar.locator("button");
  const count = await buttons.count();
  assert.equal(count, 6, "six buttons keep their place");
  for (let index = 0; index < count; index += 1) {
    assert.equal(await buttons.nth(index).isDisabled(), true, `button ${index} disabled`);
  }
  const ruler = bar.getByRole("slider", { name: m.ruler });
  assert.equal(await ruler.getAttribute("aria-disabled"), "true");
  assert.equal(await ruler.getAttribute("aria-valuetext"), m.rulerEmpty);
  assert.equal(await bar.locator("svg pattern").count(), 6, "six sections in preparation");
  pass(
    "with no scene all buttons are disabled, the ruler is aria-disabled and shows 6 planned sections",
  );
}

async function snapshots(browser: Browser, locale: string): Promise<void> {
  for (const [width, height] of [
    [1280, 900],
    [360, 800],
  ] as const) {
    for (const dark of [false, true]) {
      const { context, page, errors } = await newPage(browser, width, height, dark);
      await open(page, locale);
      const m = messagesFor(locale);
      const bars = page.getByRole("group", { name: m.label });
      const first = bars.nth(0).getByRole("slider", { name: m.ruler });
      const second = bars.nth(1).getByRole("slider", { name: m.ruler });
      const a = await box(first);
      await first.click({ position: { x: a.width * 0.45, y: 20 } });
      const b = await box(second);
      await second.click({ position: { x: b.width * 0.2, y: 20 } });
      await page.waitForTimeout(900);
      await first.focus();
      await page.keyboard.press("ArrowRight");
      const name = `${width}-${dark ? "board" : "paper"}${locale === "fr" ? "" : "-en"}`;
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      assert.deepEqual(errors, [], `no console error while taking ${name}`);
      console.log(`  shot ${OUT}/${name}.png`);
      await context.close();
    }
  }
}

const browser = await chromium.launch();
try {
  for (const locale of ["fr", "en"]) {
    const m = messagesFor(locale);
    console.log(`\n== ${locale} 1280 ==`);
    const desktop = await newPage(browser, 1280, 900);
    await open(desktop.page, locale);
    await checkTabOrder(desktop.page, m);
    await checkTargets(desktop.page, m.label!);
    await checkKeyboard(desktop.page, m);
    await checkPointer(desktop.page, m);
    await checkButtons(desktop.page, m);
    await checkStableLayout(desktop.page, m);
    await checkPartial(desktop.page, m);
    await checkEmpty(desktop.page, m);
    await checkNoOverflow(desktop.page);
    assert.deepEqual(desktop.errors, [], "no console error at 1280");
    pass("no console error");
    await desktop.context.close();

    console.log(`\n== ${locale} 360 ==`);
    const phone = await newPage(browser, 360, 800);
    await open(phone.page, locale);
    await checkNoOverflow(phone.page);
    await checkTargets(phone.page, m.label!);
    const bar = phone.page.getByRole("group", { name: m.label }).first();
    const barBox = await box(bar);
    const rulerBox = await box(bar.getByRole("slider", { name: m.ruler }));
    const firstButton = await box(bar.getByRole("button", { name: m.previousScene }));
    assert.ok(rulerBox.width >= barBox.width - 1, "ruler takes the full width");
    assert.ok(rulerBox.y + rulerBox.height <= firstButton.y, "ruler is on its own line");
    pass(`ruler spans the full width (${rulerBox.width} px) on its own line`);
    await checkKeyboard(phone.page, m);
    await checkNoOverflow(phone.page);
    assert.deepEqual(phone.errors, [], "no console error at 360");
    pass("no console error");
    await phone.context.close();
  }
  console.log("\n== snapshots ==");
  await snapshots(browser, "fr");
  await snapshots(browser, "en");
  console.log("\nall checks passed");
} finally {
  await browser.close();
}
