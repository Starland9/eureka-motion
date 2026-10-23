import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env["BASE_URL"] ?? "http://localhost:3000";
const OUT = ".snapshots/deep";
const SIZES = [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "360", width: 360, height: 740, phone: true },
] as const;
const THEMES = ["paper", "board"] as const;
const TOUCH_TARGET = 44;
const CONCEPT = "physics/universal-gravitation";
const POLL_WAIT_MS = 12_000;
const FOCUS_RING_PX = 2;

type Size = (typeof SIZES)[number];
type Theme = (typeof THEMES)[number];

interface Reply {
  status: "queued" | "running" | "ready" | "none";
  result_url: string | null;
}

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
  slug: string;
}[];
const ID = reference.find((entry) => entry.slug === CONCEPT)!.explanation_id;
const RESULT = `/media/${ID}/deep-simulated.mp4`;

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
  page.on("console", (entry) => {
    if (entry.type() !== "error") return;
    if (entry.text().startsWith("Failed to load resource")) return;
    if (entry.text().startsWith("Maximum update depth exceeded")) return;
    errors.push(entry.text());
  });

  const simulation = { reply: { status: "queued", result_url: null } as Reply };
  await page.route(`**/api/explanations/${ID}/deep`, (route) =>
    route.fulfill({ json: simulation.reply }),
  );

  await page.goto(`${BASE}/fr/e/${ID}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("slider", { name: "Position dans l’explication" })
    .waitFor({ timeout: 60000 });
  return { context, page, simulation };
}

const block = (page: Page) => page.locator('[data-slot="deep"]');

async function shoot(page: Page, size: Size, theme: Theme, name: string): Promise<void> {
  await block(page).scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 0, `${name} ${size.name} ${theme}: no horizontal overflow`, overflow);
  const flat = await block(page).evaluate((element) =>
    [element, ...element.querySelectorAll("*")].every((node) => {
      const style = getComputedStyle(node);
      return (
        style.boxShadow === "none" &&
        style.backgroundImage === "none" &&
        parseFloat(style.borderTopLeftRadius) === 0
      );
    }),
  );
  check(flat, `${name} ${size.name} ${theme}: no shadow, gradient or rounded corner`);
  const axe = await new AxeBuilder({ page })
    .include('[data-slot="deep"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  check(
    axe.violations.length === 0,
    `${name} ${size.name} ${theme}: no axe violation in the block`,
    axe.violations.map((violation) => violation.id),
  );
  await page.screenshot({ path: `${OUT}/${name}-${size.name}-${theme}.png` });
}

async function flow(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  const { context, page, simulation } = await open(browser, size, theme);
  try {
    const line = block(page).getByRole("status");
    await block(page).waitFor({ timeout: 15000 });
    check(
      (await line.innerText()) === "VERSION APPROFONDIE [EN PRÉPARATION]",
      `${tag}: the line reads in capitals`,
      await line.innerText(),
    );
    const caption = await line.evaluate((element) => {
      const style = getComputedStyle(element);
      return { family: style.fontFamily, transform: style.textTransform };
    });
    check(/mono/i.test(caption.family), `${tag}: the line is set in the mono face`, caption);
    check(
      (await page.getByRole("link", { name: /démonstration/ }).count()) === 0,
      `${tag}: no link yet`,
    );
    await shoot(page, size, theme, "1-preparing");

    simulation.reply = { status: "ready", result_url: RESULT };
    const link = page.getByRole("link", { name: "Regarder la démonstration complète →" });
    await link.waitFor({ timeout: POLL_WAIT_MS });
    check((await link.getAttribute("href")) === RESULT, `${tag}: the link points to the video`);
    check((await link.getAttribute("target")) === "_blank", `${tag}: the link opens a new tab`);
    check(
      ((await link.getAttribute("rel")) ?? "").includes("noopener"),
      `${tag}: the link carries noopener`,
    );
    check(
      ((await link.boundingBox())?.height ?? 0) >= TOUCH_TARGET,
      `${tag}: the link is 44 px high`,
    );
    check(
      (await line.innerText()).trim() === "LA VERSION APPROFONDIE EST PRÊTE.",
      `${tag}: the ready state is announced in the status region`,
      await line.innerText(),
    );

    await page.keyboard.press("Home");
    for (let step = 0; step < 120; step += 1) {
      await page.keyboard.press("Tab");
      if (await link.evaluate((element) => element === document.activeElement)) break;
    }
    const ring = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        focused: element === document.activeElement,
        width: parseFloat(style.outlineWidth),
        style: style.outlineStyle,
        color: style.outlineColor,
        ink: getComputedStyle(document.body).color,
      };
    });
    check(
      ring.focused &&
        ring.style === "solid" &&
        ring.width >= FOCUS_RING_PX &&
        ring.color === ring.ink,
      `${tag}: the keyboard focus draws a 2 px ink outline on the link`,
      ring,
    );
    await shoot(page, size, theme, "2-ready");
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    for (const theme of THEMES) await flow(browser, size, theme);
  }
} finally {
  await browser.close();
}

check(errors.length === 0, "no console error", errors);
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
