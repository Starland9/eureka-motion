import { AxeBuilder } from "@axe-core/playwright";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

interface Messages {
  [key: string]: Messages | string;
}

interface Choice {
  id: string;
  text: string;
}

interface Question {
  prompt: string;
  choices: Choice[];
  answer_id: string;
}

interface StoredRecord {
  payload: { quiz: { questions: Question[] } | null };
}

interface ReferenceItem {
  slug: string;
  title: string;
  explanation_id: string;
}

interface Stop {
  tag: string;
  role: string;
  name: string;
  signature: string;
  top: number;
  left: number;
  ring: { width: number; contrast: number; on: string } | null;
  covered: boolean;
}

const THEMES = ["paper", "board"] as const;
type Theme = (typeof THEMES)[number];

const THEME_KEY = "eureka.theme";
const LEVEL_KEY = "eureka.level";
const LEVEL = "superieur";
const QUESTION = "la loi de la gravité";
const REFERENCE_SLUG = "physics/universal-gravitation";
const WARM_UP_MS = 60_000;
const GENERATION_MS = 90_000;
const TARGET_PX = 44;
const RING_PX = 2;
const RING_CONTRAST = 3;
const MAX_STOPS = 120;
const ROW_TOLERANCE_PX = 40;
const MIN_TARGETS = 6;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

// Browser zoom of 200 % halves the CSS viewport and doubles the pixel density: Chromium
// exposes no zoom command to Playwright, and the CSS property `zoom` on <html> leaves the media
// queries on the old width, so only a halved viewport reproduces what a visitor gets.
const ZOOMED_VIEWPORTS = [
  { label: "1440 px window at 200 %", width: 720, height: 450 },
  { label: "1280 px window at 200 %", width: 640, height: 360 },
] as const;

// Questions are rate limited per address: each worker is its own visitor.
const octet = (): number => 1 + Math.floor(Math.random() * 254);
const VISITOR = `10.${octet()}.${octet()}.${octet()}`;

test.use({ extraHTTPHeaders: { "X-Forwarded-For": VISITOR } });

// React logs this in development only, from the playback loop of @remotion/player.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;

function loadMessages(): Messages {
  const dir = path.join(__dirname, "../../messages/fr");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  return Object.assign(
    {},
    ...files.map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Messages),
  );
}

const MESSAGES = loadMessages();

function message(key: string, values: Readonly<{ [name: string]: string | number }> = {}): string {
  let node: Messages | string | undefined = MESSAGES;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`No message ${key} in fr`);
  return node.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() === "error" && !KNOWN_DEV_WARNING.test(entry.text())) {
      errors.push(entry.text());
    }
  });
  return errors;
}

const ruler = (page: Page): Locator =>
  page.getByRole("slider", { name: message("Transport.ruler") });
const playButton = (page: Page): Locator =>
  page.getByRole("button", { name: message("Transport.play"), exact: true });
const pauseButton = (page: Page): Locator =>
  page.getByRole("button", { name: message("Transport.pause"), exact: true });
const quizEntry = (page: Page): Locator =>
  page.getByRole("button", { name: message("Quiz.open"), exact: true });
const quizOf = (page: Page): Locator =>
  page.getByRole("region", { name: message("Quiz.label"), exact: true });
const choicesOf = (page: Page): Locator => quizOf(page).locator("ol[aria-labelledby] button");
const skipLink = (page: Page): Locator =>
  page.getByRole("link", { name: message("Common.skipToContent"), exact: true });

async function clock(page: Page): Promise<number> {
  return Number(await ruler(page).getAttribute("aria-valuenow"));
}

async function forceTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [THEME_KEY, theme],
  );
}

async function forceFreshLevel(page: Page): Promise<void> {
  // An older explanation of a development database may predate the quiz and would answer from
  // the cache: another level always generates one with it.
  await page.addInitScript(
    ([key, level]) => localStorage.setItem(key as string, level as string),
    [LEVEL_KEY, LEVEL],
  );
}

async function referenceOf(request: APIRequestContext, language = "fr"): Promise<ReferenceItem> {
  const list = await request.get(`/api/reference?language=${language}`);
  expect(list.status()).toBe(200);
  const entry = ((await list.json()) as ReferenceItem[]).find(
    (item) => item.slug === REFERENCE_SLUG,
  );
  if (!entry) throw new Error(`no reference explanation ${REFERENCE_SLUG}`);
  return entry;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);
}

async function openReferenceFromContents(
  page: Page,
  request: APIRequestContext,
  language = "fr",
): Promise<void> {
  const entry = await referenceOf(request, language);
  await page.goto(`/${language}`);
  await page.locator(`a[href="/${language}/e/${entry.explanation_id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/${language}/e/${entry.explanation_id}$`));
  await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
  await settle(page);
}

async function askGravity(page: Page): Promise<void> {
  await forceFreshLevel(page);
  await page.goto("/fr");
  await expect(
    page.getByRole("radio", { name: message(`Level.${LEVEL}`), exact: true }),
  ).toBeChecked();
  await page.getByRole("textbox", { name: message("Ask.lead") }).fill(QUESTION);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/fr\/e\/[a-z0-9]+$/);
}

async function finishedGravity(page: Page): Promise<void> {
  await askGravity(page);
  await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
  await expect(quizEntry(page)).toBeVisible({ timeout: GENERATION_MS });
  await settle(page);
}

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

function summarise(violations: AxeResults["violations"]): string[] {
  return violations.map((violation) => {
    const nodes = violation.nodes
      .slice(0, 6)
      .map((node) => `${node.target.join(" ")} :: ${node.failureSummary?.replace(/\s+/g, " ")}`);
    return `${violation.id} (${violation.impact}) ${violation.help}\n  ${nodes.join("\n  ")}`;
  });
}

// The development indicator of Next.js is not the product: its links would also change which
// link axe takes as the first of the page, and so whether the skip link is recognised.
async function scan(page: Page): Promise<string[]> {
  await page.evaluate(() => {
    for (const portal of document.querySelectorAll("nextjs-portal")) portal.remove();
  });
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return summarise(results.violations);
}

async function expectNoViolations(page: Page, state: string): Promise<void> {
  await settle(page);
  expect(await scan(page), `axe violations: ${state}`).toEqual([]);
}

async function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function expectNoOverflow(page: Page, state: string): Promise<void> {
  expect(await overflowOf(page), `horizontal scroll: ${state}`).toBeLessThanOrEqual(0);
}

async function measureTargets(page: Page): Promise<{ checked: number; undersized: string[] }> {
  return page.evaluate((minimum) => {
    const SELECTOR = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "summary",
      "[role=button]",
      "[role=link]",
      "[role=slider]",
      "[role=checkbox]",
      "[role=radio]",
      "[role=switch]",
      "[role=tab]",
      "[role=menuitem]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const IGNORED = ".__remotion-player, nextjs-portal, [data-sonner-toaster]";

    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== "none" && style.visibility !== "hidden" && box.width * box.height > 0
      );
    };

    // A control hidden for the eye (radio inside its label) is hit through the label.
    const hitArea = (element: Element): Element => {
      const slider = element.closest("[data-slot=slider]");
      if (slider) return slider;
      if (element instanceof HTMLInputElement && element.type !== "range") {
        const box = element.getBoundingClientRect();
        if (box.width <= 2 || box.height <= 2) return element.closest("label") ?? element;
      }
      return element;
    };

    const insideText = (element: Element): boolean => {
      if (getComputedStyle(element).display !== "inline") return false;
      const parent = element.parentElement;
      return (
        parent !== null && (parent.textContent ?? "").trim() !== (element.textContent ?? "").trim()
      );
    };

    const describe = (element: Element): string => {
      const label = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
      return `${element.tagName.toLowerCase()}[${label.slice(0, 40)}]`;
    };

    const seen = new Set<Element>();
    const failures: string[] = [];
    for (const element of document.querySelectorAll(SELECTOR)) {
      if (element.closest(IGNORED) || !visible(element)) continue;
      const target = hitArea(element);
      if (seen.has(target) || insideText(target)) continue;
      seen.add(target);
      const box = target.getBoundingClientRect();
      if (box.width < minimum - 0.01 || box.height < minimum - 0.01) {
        failures.push(
          `${describe(target)} is ${Math.round(box.width * 10) / 10} x ${Math.round(box.height * 10) / 10}`,
        );
      }
    }
    return { checked: seen.size, undersized: failures };
  }, TARGET_PX);
}

async function expectTargets(page: Page, state: string): Promise<void> {
  const { checked, undersized } = await measureTargets(page);
  expect(checked, `targets measured: ${state}`).toBeGreaterThanOrEqual(MIN_TARGETS);
  expect(undersized, `targets under ${TARGET_PX} px: ${state}`).toEqual([]);
}

async function clippedContent(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const IGNORED = ".__remotion-player, nextjs-portal, [data-sonner-toaster]";
    const failures: string[] = [];
    for (const element of document.querySelectorAll("body *")) {
      if (element.closest(IGNORED)) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.position === "fixed") continue;
      const box = element.getBoundingClientRect();
      if (box.width * box.height <= 4) continue;
      const clips = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
      if (clips && element.scrollWidth > element.clientWidth + 1) {
        failures.push(
          `${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 50)} clips ${element.scrollWidth - element.clientWidth} px`,
        );
      }
      if (style.textOverflow === "ellipsis" && element.scrollWidth > element.clientWidth + 1) {
        failures.push(`${element.tagName.toLowerCase()} is cut with an ellipsis`);
      }
    }
    return failures;
  });
}

async function controlsOutOfView(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const SELECTOR = "main a[href], main button, main input, main textarea, header a, header input";
    const IGNORED = ".__remotion-player, nextjs-portal, [data-sonner-toaster]";
    const width = document.documentElement.clientWidth;
    const failures: string[] = [];
    for (const element of document.querySelectorAll(SELECTOR)) {
      if (element.closest(IGNORED)) continue;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || box.width * box.height <= 4)
        continue;
      if (box.left < -0.5 || box.right > width + 0.5) {
        failures.push(
          `${element.tagName.toLowerCase()}[${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}] spans ${Math.round(box.left)}..${Math.round(box.right)} of ${width}`,
        );
      }
    }
    return failures;
  });
}

async function currentStop(page: Page, client: CDPSession): Promise<Stop | null> {
  const probed = await page.evaluate((minimumRing) => {
    const element = document.activeElement;
    // The development indicator of Next.js closes the page in the tab order: it is not the product.
    const leftThePage =
      !element ||
      element === document.body ||
      element === document.documentElement ||
      element.tagName === "NEXTJS-PORTAL";
    if (leftThePage) return null;

    const rgba = (css: string): [number, number, number, number] => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return [0, 0, 0, 1];
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };

    const luminance = ([r, g, b]: number[]): number => {
      const channel = (value: number): number => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
    };

    const backdrop = (from: Element | null): number[] => {
      const layers: [number, number, number, number][] = [];
      for (let node = from; node; node = node.parentElement) {
        const layer = rgba(getComputedStyle(node).backgroundColor);
        if (layer[3] > 0) layers.push(layer);
        if (layer[3] === 1) break;
      }
      let result = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse()) {
        result = [
          r * a + (result[0] ?? 0) * (1 - a),
          g * a + (result[1] ?? 0) * (1 - a),
          b * a + (result[2] ?? 0) * (1 - a),
        ];
      }
      return result;
    };

    const contrast = (a: number[], b: number[]): number => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
    };

    // The ring is the outline of the control, of the label that wraps a hidden radio, or, for
    // the question field of the home page, the thickened rule under it (MASTER 5.1).
    const candidates: (Element | null)[] = [element, element.closest("label")];
    let ring: { width: number; contrast: number; on: string } | null = null;
    let host: Element = element;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const size = candidate.getBoundingClientRect();
      if (size.width <= 2 || size.height <= 2) continue;
      const style = getComputedStyle(candidate);
      const width = parseFloat(style.outlineWidth);
      if (style.outlineStyle !== "none" && width >= minimumRing) {
        const color = rgba(style.outlineColor);
        ring = {
          width,
          contrast: contrast(color, backdrop(candidate.parentElement)),
          on: `${candidate.tagName.toLowerCase()} outline`,
        };
        host = candidate;
        break;
      }
    }
    if (!ring && element instanceof HTMLTextAreaElement) {
      for (const sibling of element.parentElement?.children ?? []) {
        const style = getComputedStyle(sibling);
        const width = parseFloat(style.borderBottomWidth);
        if (sibling !== element && style.borderBottomStyle !== "none" && width >= 4) {
          ring = {
            width,
            contrast: contrast(rgba(style.borderBottomColor), backdrop(element)),
            on: "thickened rule",
          };
          break;
        }
      }
    }

    const box = host.getBoundingClientRect();
    const inViewport =
      box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
    const point = document.elementFromPoint(
      Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1),
      Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1),
    );
    const covered =
      !inViewport ||
      (point !== null &&
        point.tagName !== "NEXTJS-PORTAL" &&
        !host.contains(point) &&
        !point.contains(host));

    const label = (element.getAttribute("aria-label") ?? element.textContent ?? "")
      .trim()
      .slice(0, 30);
    return {
      tag: element.tagName.toLowerCase(),
      signature: `${element.tagName.toLowerCase()}#${element.id}.${label}@${Math.round(box.top + scrollY)},${Math.round(box.left)}`,
      top: Math.round(box.top + scrollY),
      left: Math.round(box.left + scrollX),
      ring,
      covered,
    };
  }, RING_PX);
  if (!probed) return null;

  const { result } = await client.send("Runtime.evaluate", {
    expression: "document.activeElement",
  });
  const { nodes } = await client.send("Accessibility.getPartialAXTree", {
    objectId: result.objectId,
    fetchRelatives: false,
  });
  const node = nodes[0];
  return {
    ...probed,
    role: String(node?.role?.value ?? ""),
    name: String(node?.name?.value ?? "").trim(),
  };
}

async function walkTabStops(page: Page): Promise<Stop[]> {
  const client = await page.context().newCDPSession(page);
  const stops: Stop[] = [];
  const first = await currentStop(page, client);
  if (first) stops.push(first);
  for (let presses = 0; presses < MAX_STOPS; presses += 1) {
    await page.keyboard.press("Tab");
    const stop = await currentStop(page, client);
    if (stop === null) break;
    if (stops.some((seen) => seen.signature === stop.signature)) break;
    stops.push(stop);
  }
  await client.detach();
  return stops;
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < MAX_STOPS; presses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("the keyboard never reached the control");
}

async function backTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < MAX_STOPS; presses += 1) {
    await page.keyboard.press("Shift+Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("the keyboard never came back to the control");
}

function describeStop(stop: Stop): string {
  return `${stop.role} "${stop.name}" (${stop.signature})`;
}

function expectUsableStops(stops: Stop[]): void {
  expect(stops.length, "number of tab stops").toBeGreaterThan(5);
  expect(stops.length, "the tab order ends: no keyboard trap").toBeLessThan(MAX_STOPS);
  expect(
    stops.filter((stop) => stop.name === "").map(describeStop),
    "controls without an accessible name",
  ).toEqual([]);
  expect(
    stops.filter((stop) => stop.ring === null).map(describeStop),
    `controls without a focus ring of ${RING_PX} px`,
  ).toEqual([]);
  expect(
    stops
      .filter((stop) => stop.ring !== null && stop.ring.contrast < RING_CONTRAST)
      .map((stop) => `${describeStop(stop)} ${stop.ring?.contrast.toFixed(2)}:1`),
    `focus rings under ${RING_CONTRAST}:1`,
  ).toEqual([]);
  expect(
    stops.filter((stop) => stop.covered).map(describeStop),
    "controls hidden under another element when focused",
  ).toEqual([]);
}

// The page has at most two columns: going back up is only allowed into the column on the right.
function expectVisualOrder(stops: Stop[]): void {
  const climbs = stops.flatMap((stop, index) => {
    const before = stops[index - 1];
    return before !== undefined && stop.top < before.top - ROW_TOLERANCE_PX
      ? [{ before, stop }]
      : [];
  });
  expect(
    climbs
      .filter(({ before, stop }) => stop.left <= before.left)
      .map(({ before, stop }) => `${describeStop(before)} -> ${describeStop(stop)}`),
    "stops that climb back up the page inside their own column",
  ).toEqual([]);
  expect(climbs.length, "number of jumps back up the page").toBeLessThanOrEqual(1);
}

async function answerQuiz(page: Page, question: Question, right: boolean): Promise<void> {
  const answerIndex = question.choices.findIndex((choice) => choice.id === question.answer_id);
  const wrongIndex = question.choices.findIndex((choice) => choice.id !== question.answer_id);
  const choice = choicesOf(page).nth(right ? answerIndex : wrongIndex);
  await choice.click();
  await expect(choice).toHaveAttribute("aria-disabled", "true");
}

async function readQuestions(page: Page, request: APIRequestContext): Promise<Question[]> {
  const id = /\/e\/([a-z0-9]+)$/.exec(page.url())?.[1] ?? "";
  const response = await request.get(`/api/explanations/${id}`);
  expect(response.status()).toBe(200);
  const questions = ((await response.json()) as StoredRecord).payload.quiz?.questions ?? [];
  expect(questions.length, "questions of the stored quiz").toBeGreaterThanOrEqual(2);
  return questions;
}

async function pauseAt(page: Page, key: "Home" | "End"): Promise<void> {
  if (await pauseButton(page).isVisible()) await pauseButton(page).click();
  await ruler(page).focus();
  await page.keyboard.press(key);
  await expect(playButton(page)).toBeVisible();
}

test.describe("the automatic check finds no violation", () => {
  test.describe.configure({ timeout: WARM_UP_MS + GENERATION_MS });

  for (const theme of THEMES) {
    test.describe(`in the ${theme} theme`, () => {
      test.beforeEach(async ({ page }) => {
        await forceTheme(page, theme);
      });

      for (const language of ["fr", "en"]) {
        test(`on the home page in ${language}`, async ({ page }) => {
          const errors = trackConsole(page);
          await page.goto(`/${language}`);
          await expect(page.locator("main#content")).toHaveCount(1);
          await expectNoViolations(page, `home ${language}`);
          expect(errors).toEqual([]);
        });
      }

      test("on a reference explanation opened from the contents", async ({ page, request }) => {
        const errors = trackConsole(page);
        await openReferenceFromContents(page, request);
        await expectNoViolations(page, "reference, first frame");

        await pauseAt(page, "End");
        await expectNoViolations(page, "reference, last frame");

        await page.getByRole("button", { name: message("Colophon.heading"), exact: true }).click();
        await expectNoViolations(page, "reference, colophon open");
        expect(errors).toEqual([]);
      });

      test("on a generated explanation and on its quiz", async ({ page, request }) => {
        const errors = trackConsole(page);
        await finishedGravity(page);
        const questions = await readQuestions(page, request);

        await pauseAt(page, "Home");
        await expectNoViolations(page, "generated, first frame");
        await pauseAt(page, "End");
        await expectNoViolations(page, "generated, last frame");

        await quizEntry(page).click();
        await expect(quizOf(page)).toBeVisible();
        await expectNoViolations(page, "quiz, first question");

        for (const [number, question] of questions.entries()) {
          const right = number % 2 === 0;
          await answerQuiz(page, question, right);
          await expectNoViolations(
            page,
            `quiz, question ${number + 1} ${right ? "right" : "wrong"}`,
          );
          const last = number === questions.length - 1;
          await quizOf(page)
            .getByRole("button", {
              name: message(last ? "Quiz.seeScore" : "Quiz.next"),
              exact: true,
            })
            .click();
        }
        await expect(
          quizOf(page).getByText(message("Quiz.score.caption"), { exact: true }),
        ).toBeVisible();
        await expectNoViolations(page, "quiz, score");
        expect(errors).toEqual([]);
      });
    });
  }
});

test.describe("the keyboard alone", () => {
  test.describe.configure({ timeout: WARM_UP_MS + GENERATION_MS });

  test("the skip link is the first stop and lands in the content", async ({ page, request }) => {
    const errors = trackConsole(page);
    const entry = await referenceOf(request);
    await page.goto(`/fr/e/${entry.explanation_id}`);
    await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });

    await page.keyboard.press("Tab");
    await expect(skipLink(page)).toBeFocused();
    const box = await skipLink(page).boundingBox();
    expect(box?.y, "the focused skip link is on screen").toBeGreaterThanOrEqual(0);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#content$/);
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () => document.querySelector("main#content")?.contains(document.activeElement) ?? false,
    );
    expect(inside, "the next stop is inside the main content").toBe(true);
    expect(errors).toEqual([]);
  });

  test("every stop of the reading page is named, visible and in a sensible order", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    const entry = await referenceOf(request);
    await page.goto(`/fr/e/${entry.explanation_id}`);
    await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
    await settle(page);

    const stops = await walkTabStops(page);
    expect(stops[0]?.name).toBe(message("Common.skipToContent"));
    expectUsableStops(stops);
    expectVisualOrder(stops);

    // The symbol and the name of a quantity are read apart: "m₁ Masse", not "m₁Masse".
    const ranges = stops.filter((stop) => stop.tag === "input" && stop.role === "slider");
    expect(ranges.length).toBeGreaterThan(0);
    expect(
      ranges.filter((stop) => !/^\S+ \S/.test(stop.name)).map(describeStop),
      "range inputs whose symbol is glued to their name",
    ).toEqual([]);

    // The parameters fill the row under both columns: they come after the column on the right.
    const position = (name: string): number => stops.findIndex((stop) => stop.name === name);
    expect(position(message("Share.copy"))).toBeGreaterThan(
      position(message("Transport.fullscreen")),
    );
    expect(position(message("Params.reset"))).toBeGreaterThan(position(message("Quiz.open")));
    expect(errors).toEqual([]);
  });
});

async function openReferenceDirect(page: Page, request: APIRequestContext): Promise<void> {
  const entry = await referenceOf(request);
  await page.goto(`/fr/e/${entry.explanation_id}`);
  await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
  await settle(page);
}

const togglePressed = async (button: Locator): Promise<string | null> =>
  button.getAttribute("aria-pressed");

test.describe("the keyboard alone operates the reading page", () => {
  test.describe.configure({ timeout: WARM_UP_MS + GENERATION_MS });

  test("Enter and Space act once on each control", async ({ page, request }) => {
    const errors = trackConsole(page);
    await openReferenceDirect(page, request);

    await tabTo(page, playButton(page));
    await page.keyboard.press("Enter");
    await expect(pauseButton(page)).toBeVisible();
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    await expect(
      playButton(page),
      "Space pauses once, the shortcut does not toggle twice",
    ).toBeVisible();
    await expect(playButton(page)).toBeFocused();

    const before = await clock(page);
    await tabTo(page, ruler(page));
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => clock(page)).toBeGreaterThan(before);

    for (const name of ["Transport.captions", "Transport.sound"]) {
      const button = page.getByRole("button", { name: message(name), exact: true });
      await tabTo(page, button);
      const initial = await togglePressed(button);
      await page.keyboard.press("Enter");
      expect(await togglePressed(button), `${name} after Enter`).not.toBe(initial);
      await page.keyboard.press("Space");
      expect(await togglePressed(button), `${name} after Space`).toBe(initial);
    }

    const volume = page.getByRole("slider", { name: message("Transport.volume") });
    await tabTo(page, volume);
    const level = Number(await volume.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowLeft");
    expect(Number(await volume.getAttribute("aria-valuenow"))).toBeLessThan(level);

    const scene = page
      .getByRole("list", { name: message("Scenes.label"), exact: true })
      .getByRole("button")
      .nth(2);
    await tabTo(page, scene);
    await page.keyboard.press("Enter");
    await expect(scene).toHaveAttribute("aria-current", "true");

    const results = page.getByRole("region", { name: message("Params.title"), exact: true });
    const slider = results.getByRole("slider").first();
    await tabTo(page, slider);
    const shown = await slider.getAttribute("aria-valuetext");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => slider.getAttribute("aria-valuetext")).not.toBe(shown);

    const trigger = page.getByRole("button", { name: message("Colophon.heading"), exact: true });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await backTo(page, quizEntry(page));
    await page.keyboard.press("Enter");
    await expect(quizOf(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Escape leaves no dialog behind and undoes a number being typed", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    await openReferenceDirect(page, request);
    // The error overlay of the development server is a dialog too, in its own shadow root.
    const dialogs = (): Promise<number> =>
      page.evaluate(
        () =>
          document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]').length,
      );
    expect(await dialogs(), "the page opens no dialog of its own").toBe(0);

    const field = page
      .getByRole("region", { name: message("Params.title"), exact: true })
      .getByRole("textbox")
      .first();
    await tabTo(page, field);
    const kept = await field.inputValue();
    await page.keyboard.type("123456");
    expect(await field.inputValue()).not.toBe(kept);
    const address = page.url();

    await page.keyboard.press("Escape");
    expect(await field.inputValue()).toBe(kept);
    await expect(field).toBeFocused();
    expect(await dialogs()).toBe(0);
    expect(page.url()).toBe(address);
    expect(errors).toEqual([]);
  });

  test("the home page can be crossed in a sensible order", async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto("/fr");
    await expect(page.locator("main#content")).toHaveCount(1);
    await settle(page);

    await tabTo(page, skipLink(page));
    const stops = await walkTabStops(page);
    expect(stops[0]?.name).toBe(message("Common.skipToContent"));
    expectUsableStops(stops);
    expectVisualOrder(stops);
    expect(errors).toEqual([]);
  });
});

test.describe("on a screen 360 px wide", () => {
  test.describe.configure({ timeout: WARM_UP_MS + GENERATION_MS });
  test.skip(({ isMobile }) => !isMobile, "only the phone project is 360 px wide");

  for (const language of ["fr", "en"]) {
    test(`the home page in ${language} has no horizontal scroll and wide enough targets`, async ({
      page,
    }) => {
      const errors = trackConsole(page);
      await page.goto(`/${language}`);
      await expect(page.locator("main#content")).toHaveCount(1);
      await settle(page);

      expect(page.viewportSize()?.width).toBe(360);
      await expectNoOverflow(page, `home ${language}`);
      await expectTargets(page, `home ${language}`);
      expect(await clippedContent(page), "clipped content").toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("a reference explanation has no horizontal scroll and wide enough targets", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    await openReferenceFromContents(page, request);

    expect(page.viewportSize()?.width).toBe(360);
    await expectNoOverflow(page, "reference");
    await expectTargets(page, "reference");
    expect(await clippedContent(page), "clipped content").toEqual([]);

    await page.getByRole("button", { name: message("Colophon.heading"), exact: true }).click();
    await settle(page);
    await expectNoOverflow(page, "reference, colophon open");
    await expectTargets(page, "colophon open");

    await quizEntry(page).click();
    await expect(quizOf(page)).toBeVisible();
    await expectNoOverflow(page, "reference, quiz open");
    await expectTargets(page, "quiz open");
    expect(errors).toEqual([]);
  });

  test("a generated explanation and its quiz have no horizontal scroll and wide enough targets", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    await finishedGravity(page);
    const questions = await readQuestions(page, request);

    await pauseAt(page, "Home");
    await expectNoOverflow(page, "generated");
    await expectTargets(page, "generated");

    await quizEntry(page).click();
    await expect(quizOf(page)).toBeVisible();
    for (const [number, question] of questions.entries()) {
      await answerQuiz(page, question, number % 2 === 0);
      await expectNoOverflow(page, `quiz question ${number + 1}`);
      await expectTargets(page, `quiz question ${number + 1}`);
      const last = number === questions.length - 1;
      await quizOf(page)
        .getByRole("button", { name: message(last ? "Quiz.seeScore" : "Quiz.next"), exact: true })
        .click();
    }
    await expect(
      quizOf(page).getByText(message("Quiz.score.caption"), { exact: true }),
    ).toBeVisible();
    await expectNoOverflow(page, "quiz score");
    await expectTargets(page, "score");
    expect(errors).toEqual([]);
  });
});

test.describe("with the page zoomed to 200 %", () => {
  test.describe.configure({ timeout: WARM_UP_MS + GENERATION_MS });
  test.skip(({ isMobile }) => isMobile, "the zoom is a desktop browser feature");

  async function zoomedPage(browser: Browser, width: number, height: number): Promise<Page> {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      locale: "fr",
      extraHTTPHeaders: { "X-Forwarded-For": VISITOR },
    });
    return context.newPage();
  }

  for (const zoomed of ZOOMED_VIEWPORTS) {
    test(`keeps every function and loses no content: ${zoomed.label}`, async ({
      browser,
      baseURL,
      request,
    }) => {
      const page = await zoomedPage(browser, zoomed.width, zoomed.height);
      const errors = trackConsole(page);
      const base = baseURL ?? "";

      await page.goto(`${base}/fr`);
      await expect(page.locator("main#content")).toHaveCount(1);
      await settle(page);
      expect(await page.evaluate(() => [innerWidth, devicePixelRatio])).toEqual([zoomed.width, 2]);
      await expectNoOverflow(page, `home, ${zoomed.label}`);
      expect(await clippedContent(page), "home, clipped content").toEqual([]);
      expect(await controlsOutOfView(page), "home, controls out of view").toEqual([]);
      await expect(page.getByRole("textbox", { name: message("Ask.lead") })).toBeVisible();

      const entry = await referenceOf(request);
      await page.goto(`${base}/fr/e/${entry.explanation_id}`);
      await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
      await settle(page);
      await expectNoOverflow(page, `reading, ${zoomed.label}`);
      expect(await clippedContent(page), "reading, clipped content").toEqual([]);
      expect(await controlsOutOfView(page), "reading, controls out of view").toEqual([]);

      for (const name of [
        "Transport.previousScene",
        "Transport.play",
        "Transport.nextScene",
        "Transport.captions",
        "Transport.sound",
        "Transport.fullscreen",
      ]) {
        await expect(
          page.getByRole("button", { name: message(name), exact: true }),
          name,
        ).toBeVisible();
      }
      await playButton(page).click();
      await expect(pauseButton(page)).toBeVisible();
      await pauseButton(page).click();

      await quizEntry(page).click();
      await expect(quizOf(page)).toBeVisible();
      await expectNoOverflow(page, `quiz, ${zoomed.label}`);
      expect(await clippedContent(page), "quiz, clipped content").toEqual([]);
      expect(await controlsOutOfView(page), "quiz, controls out of view").toEqual([]);

      expect(await scan(page), `axe violations, ${zoomed.label}`).toEqual([]);
      expect(errors).toEqual([]);
      await page.context().close();
    });
  }
});

test.describe("with motion reduced", () => {
  test.describe.configure({ timeout: WARM_UP_MS + GENERATION_MS });

  test("a new explanation does not start by itself and offers the steps", async ({
    page,
    isMobile,
  }) => {
    const errors = trackConsole(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await askGravity(page);
    await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
    await expect(quizEntry(page)).toBeVisible({ timeout: GENERATION_MS });
    await settle(page);

    await expect(playButton(page), "the player waits for a press").toBeVisible();
    await expect(pauseButton(page)).toHaveCount(0);
    const rest = await clock(page);
    await page.waitForTimeout(1500);
    expect(await clock(page), "the clock did not move on its own").toBe(rest);

    const step = page.getByRole("button", { name: message("Transport.stepNext"), exact: true });
    await expect(step).toBeVisible();
    await expect(step).not.toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByRole("button", { name: message("Transport.stepPrevious"), exact: true }),
    ).toBeVisible();

    await step.click();
    await expect.poll(() => clock(page)).toBeGreaterThan(rest);
    await expect(playButton(page), "a step does not start the playback").toBeVisible();

    expect(await scan(page), "axe violations with motion reduced").toEqual([]);
    if (isMobile) {
      await expectNoOverflow(page, "motion reduced");
      await expectTargets(page, "motion reduced");
    }
    expect(errors).toEqual([]);
  });
});

test.describe("the checks themselves", () => {
  test("report a defect when there is one", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.locator("main#content")).toHaveCount(1);
    await settle(page);
    await page.evaluate(() => {
      document.querySelector("main#content")?.insertAdjacentHTML(
        "beforeend",
        `<div id="defects">
          <button id="small" style="width:30px;height:30px;outline:none">x</button>
          <button id="nameless" style="width:50px;height:50px"></button>
          <div style="width:40px;overflow:hidden"><span style="white-space:nowrap">an unbreakable line</span></div>
          <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10">
          <p style="color:#c8c8c8;background:#ffffff">pale text</p>
        </div>`,
      );
    });

    const rules = (await scan(page)).map((entry) => entry.split(" ")[0]);
    expect(rules).toEqual(expect.arrayContaining(["button-name", "image-alt", "color-contrast"]));

    const { undersized } = await measureTargets(page);
    expect(undersized.join("\n")).toContain("button[x] is 30 x 30");
    expect((await clippedContent(page)).join("\n")).toContain("clips");

    const client = await page.context().newCDPSession(page);
    await tabTo(page, page.locator("#small"));
    expect(
      (await currentStop(page, client))?.ring,
      "a button without outline has no ring",
    ).toBeNull();
    await tabTo(page, page.locator("#nameless"));
    expect((await currentStop(page, client))?.name, "an empty button has no name").toBe("");
    await client.detach();

    const stop = (top: number, left: number): Stop => ({
      tag: "button",
      role: "button",
      name: "x",
      signature: `${top},${left}`,
      top,
      left,
      ring: null,
      covered: false,
    });
    expect(() => expectVisualOrder([stop(100, 100), stop(900, 100), stop(200, 600)])).not.toThrow();
    expect(() => expectVisualOrder([stop(100, 600), stop(900, 600), stop(200, 100)])).toThrow();
    expect(() =>
      expectVisualOrder([
        stop(100, 100),
        stop(900, 100),
        stop(200, 600),
        stop(900, 600),
        stop(100, 1000),
      ]),
    ).toThrow();
  });
});
