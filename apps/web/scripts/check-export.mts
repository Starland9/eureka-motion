import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env["BASE_URL"] ?? "http://localhost:3000";
const OUT = ".snapshots/export";
const SIZES = [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "360", width: 360, height: 740, phone: true },
] as const;
const THEMES = ["paper", "board"] as const;
const TOUCH_TARGET = 44;
const CONCEPT = "physics/universal-gravitation";
const JOB = "7b0e1d52-3a54-4c1e-9d3c-0f6c5a1b2e11";
const POLL_WAIT_MS = 3000;

type Size = (typeof SIZES)[number];
type Theme = (typeof THEMES)[number];

interface Reply {
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
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
const RESULT = `/media/${ID}/export-simulated.mp4`;

async function open(browser: Browser, size: Size, theme: Theme, renderWorker = true) {
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

  const simulation = {
    reply: { status: "queued", progress: 0, result_url: null } as Reply,
    posts: 0,
  };
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: { status: "ok", checks: { database: true, render_worker: renderWorker } },
    }),
  );
  await page.route(`**/api/explanations/${ID}/export`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    simulation.posts += 1;
    return route.fulfill({ json: { job_id: JOB, status: "queued" } });
  });
  await page.route("**/api/jobs/*", (route) =>
    route.fulfill({ json: { id: JOB, type: "export", ...simulation.reply } }),
  );

  await page.goto(`${BASE}/fr/e/${ID}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("slider", { name: "Position dans l’explication" })
    .waitFor({ timeout: 60000 });
  return { context, page, simulation };
}

const block = (page: Page) => page.locator('[data-slot="export"]');

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
    .include('[data-slot="export"]')
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
    const action = page.getByRole("button", { name: "Télécharger la vidéo", exact: true });
    await action.waitFor({ timeout: 15000 });
    const box = await action.boundingBox();
    check((box?.height ?? 0) >= TOUCH_TARGET, `${tag}: the action is a 44 px target`, box);
    await shoot(page, size, theme, "1-ready");

    simulation.reply = { status: "running", progress: 42, result_url: null };
    await action.click();
    const bar = page.getByRole("progressbar", { name: "Préparation de la vidéo" });
    await bar.waitFor();
    await page.waitForFunction(
      () => document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "42",
      undefined,
      { timeout: POLL_WAIT_MS },
    );
    const rule = await bar.evaluate((element) => {
      const { height } = element.getBoundingClientRect();
      const fill = element.firstElementChild as HTMLElement;
      return {
        height,
        fill: getComputedStyle(fill).backgroundColor,
        ink: getComputedStyle(document.body).color,
      };
    });
    check(rule.height <= 3, `${tag}: the progress rule is a thin line`, rule);
    check(rule.fill === rule.ink, `${tag}: the progress rule is drawn in ink`, rule);
    const cancel = page.getByRole("button", { name: "Annuler", exact: true });
    check(
      ((await cancel.boundingBox())?.height ?? 0) >= TOUCH_TARGET,
      `${tag}: Annuler is a 44 px target`,
    );
    check(
      await cancel.evaluate((element) => element === document.activeElement),
      `${tag}: the focus follows the action to Annuler`,
    );
    await shoot(page, size, theme, "2-progress");

    simulation.reply = { status: "succeeded", progress: 100, result_url: RESULT };
    const link = page.getByRole("link", { name: "Télécharger la vidéo (MP4) →" });
    await link.waitFor({ timeout: POLL_WAIT_MS + 1000 });
    check((await link.getAttribute("href")) === RESULT, `${tag}: the link points to the file`);
    check(
      (await link.getAttribute("download")) === "la-gravitation-universelle.mp4",
      `${tag}: the file has a useful name`,
    );
    check(
      ((await link.boundingBox())?.height ?? 0) >= TOUCH_TARGET,
      `${tag}: the link is 44 px high`,
    );
    await shoot(page, size, theme, "3-done");
  } finally {
    await context.close();
  }
}

async function failure(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  const { context, page, simulation } = await open(browser, size, theme);
  try {
    simulation.reply = { status: "failed", progress: 30, result_url: null };
    await page.getByRole("button", { name: "Télécharger la vidéo", exact: true }).click();
    const retry = page.getByRole("button", { name: "Réessayer", exact: true });
    await retry.waitFor({ timeout: POLL_WAIT_MS });
    check(
      ((await retry.boundingBox())?.height ?? 0) >= TOUCH_TARGET,
      `${tag}: Réessayer is 44 px high`,
    );
    check(
      (await block(page).getByRole("alert").innerText()).includes("n’a pas pu être préparée"),
      `${tag}: the failure is told in plain words`,
    );
    await shoot(page, size, theme, "4-failed");
  } finally {
    await context.close();
  }
}

async function unavailable(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  const { context, page } = await open(browser, size, theme, false);
  try {
    await block(page).waitFor();
    check(
      (await block(page).innerText()).trim() ===
        "Le téléchargement de la vidéo est momentanément indisponible.",
      `${tag}: the discreet line stands in for the action`,
    );
    check((await block(page).locator("button, a").count()) === 0, `${tag}: no action offered`);
    await shoot(page, size, theme, "5-unavailable");
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      await flow(browser, size, theme);
      await failure(browser, size, theme);
    }
    await unavailable(browser, size, "paper");
  }
} finally {
  await browser.close();
}

check(errors.length === 0, "no console error", errors);
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
