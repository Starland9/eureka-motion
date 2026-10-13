import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = ".snapshots/explanation";
const QUESTION = "la loi de la gravité";
const SIZES = [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "360", width: 360, height: 740, phone: true },
] as const;
const THEMES = ["paper", "board"] as const;

type Theme = (typeof THEMES)[number];
type Size = (typeof SIZES)[number];
type Block = { name: string; data: Record<string, unknown> };

let failures = 0;
const errors: string[] = [];
let scenario = "";

// The rate limit counts questions per address: every browser context is its own visitor.
function visitor(): Record<string, string> {
  const octet = () => 1 + Math.floor(Math.random() * 254);
  return { "X-Forwarded-For": `10.${octet()}.${octet()}.${octet()}` };
}

function check(condition: boolean, message: string, detail?: unknown): void {
  if (condition) {
    console.log(`ok    ${message}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${message}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

function encode(blocks: readonly Block[]): string {
  return blocks
    .map(
      ({ name, data }, index) =>
        `id: ${index + 1}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

function decode(text: string): Block[] {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.includes("event:"))
    .map((chunk) => {
      const name = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
      const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? "{}";
      return { name, data: JSON.parse(data) as Record<string, unknown> };
    });
}

async function realBlocks(): Promise<Block[]> {
  const response = await fetch(`${BASE}/api/explanations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "fr", ...visitor() },
    body: JSON.stringify({ question: QUESTION, language: "fr", level: "lycee" }),
  });
  return decode(await response.text());
}

function pick(blocks: readonly Block[], name: string): Block[] {
  return blocks.filter((block) => block.name === name);
}

function step(name: string, status: "started" | "done"): Block {
  return { name: "step", data: { name, status } };
}

function accepted(id: string): Block {
  return { name: "accepted", data: { explanation_id: id, cached: false } };
}

async function mockStart(page: Page, body: string, delayMs = 0): Promise<void> {
  await page.route("**/api/explanations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
}

async function open(
  browser: Browser,
  size: Size,
  theme: Theme,
): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.phone,
    hasTouch: size.phone,
    locale: "fr",
    colorScheme: theme === "board" ? "dark" : "light",
    extraHTTPHeaders: visitor(),
  });
  await context.addInitScript((value) => localStorage.setItem("eureka.theme", value), theme);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`[${scenario}] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Maximum update depth exceeded")) return;
    if (message.text().startsWith("Failed to load resource")) return;
    errors.push(`[${scenario}] ${message.text()}`);
  });
  return { context, page };
}

async function ask(page: Page, question: string): Promise<void> {
  await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await page.getByRole("textbox").fill(question);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/fr\/e\//);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function shoot(page: Page, size: Size, theme: Theme, name: string, full = false) {
  await settle(page);
  if (full) await page.evaluate(() => window.scrollTo(0, 0));
  const horizontal = await overflow(page);
  check(horizontal <= 0, `${name} ${size.name} ${theme}: no horizontal overflow`, horizontal);
  check(
    (await page.locator("h1").count()) === 1 && (await page.locator("main#content").count()) === 1,
    `${name} ${size.name} ${theme}: one h1, one main#content`,
  );
  await page.screenshot({ path: `${OUT}/${name}-${size.name}-${theme}.png`, fullPage: full });
}

async function position(page: Page): Promise<number> {
  const slider = page.getByRole("slider", { name: "Position dans l’explication" });
  return Number(await slider.getAttribute("aria-valuenow"));
}

async function preparing(browser: Browser, size: Size, theme: Theme, real: Block[]) {
  const { context, page } = await open(browser, size, theme);
  const body = encode([
    accepted("demo-preparing"),
    step("triage", "started"),
    step("triage", "done"),
    ...pick(real, "meta"),
    step("plan", "started"),
    step("plan", "done"),
    step("verify_plan", "started"),
    step("verify_plan", "done"),
    ...pick(real, "plan"),
    step("scenes", "started"),
  ]);
  await mockStart(page, body, 600);
  await ask(page, QUESTION);
  await page.locator("[data-slot=preparation] li").nth(3).waitFor({ timeout: 8000 });
  await page.waitForTimeout(900);
  const items = await page.locator("[data-slot=preparation] li").count();
  check(items === 4, `preparing ${size.name} ${theme}: four steps once the count is known`, items);
  await shoot(page, size, theme, "preparing");
  await context.close();
}

async function first(browser: Browser, size: Size, theme: Theme) {
  const { context, page } = await open(browser, size, theme);
  const body = encode([accepted("demo-first")]);
  await mockStart(page, body, 900);
  await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await page.getByRole("textbox").fill(QUESTION);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/fr\/e\//);
  await page.waitForTimeout(500);
  await shoot(page, size, theme, "preparing-empty");
  await context.close();
}

async function playing(browser: Browser, size: Size, theme: Theme) {
  const { context, page } = await open(browser, size, theme);
  await ask(page, QUESTION);
  const deadline = Date.now() + 15000;
  while ((await position(page)) < 5 && Date.now() < deadline) await page.waitForTimeout(100);
  check((await position(page)) >= 5, `playing ${size.name} ${theme}: the position advances`);
  await shoot(page, size, theme, "playing");
  await context.close();
}

async function streaming(browser: Browser, size: Size, theme: Theme, real: Block[]) {
  const { context, page } = await open(browser, size, theme);
  const body = encode([
    accepted("demo-streaming"),
    ...pick(real, "meta"),
    ...pick(real, "plan"),
    ...pick(real, "verdict").slice(0, 3),
    ...pick(real, "scene").slice(0, 2),
  ]);
  await mockStart(page, body);
  await ask(page, QUESTION);
  await page.waitForTimeout(4500);
  await shoot(page, size, theme, "streaming");
  await context.close();
}

async function fromLink(browser: Browser, size: Size, theme: Theme, id: string) {
  const { context, page } = await open(browser, size, theme);
  await page.goto(`${BASE}/fr/e/${id}`, { waitUntil: "networkidle" });
  const play = page.getByRole("button", { name: /Lire l’explication/ });
  await play.waitFor({ timeout: 8000 });
  await page.waitForTimeout(800);
  check((await position(page)) === 0, `link ${size.name} ${theme}: nothing plays by itself`);
  await shoot(page, size, theme, "paused-from-link");
  await context.close();
}

async function colophon(browser: Browser, size: Size, theme: Theme, id: string) {
  const { context, page } = await open(browser, size, theme);
  await page.goto(`${BASE}/fr/e/${id}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Lire l’explication/ }).waitFor({ timeout: 8000 });
  const trigger = page.getByRole("button", { name: /Comment cette explication a été construite/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const lines = await page.locator("li[data-verdict]").count();
  check(lines === 7, `colophon ${size.name} ${theme}: plan and six scene verdicts`, lines);
  await shoot(page, size, theme, "colophon", true);
  await context.close();
}

async function missing(browser: Browser, size: Size, theme: Theme) {
  const { context, page } = await open(browser, size, theme);
  await page.goto(`${BASE}/fr/e/doesnotexist1`);
  await page.getByRole("link", { name: /Revenir à l’accueil/ }).waitFor({ timeout: 8000 });
  await shoot(page, size, theme, "missing");
  await context.close();
}

async function failed(browser: Browser, size: Size, theme: Theme) {
  const { context, page } = await open(browser, size, theme);
  await ask(page, "un sujet que le simulateur ne connaît pas");
  await page.getByRole("button", { name: "Réessayer" }).waitFor({ timeout: 8000 });
  await shoot(page, size, theme, "failed");
  await context.close();
}

async function clarify(browser: Browser, size: Size, theme: Theme) {
  const { context, page } = await open(browser, size, theme);
  const body = encode([
    accepted("demo-clarify"),
    {
      name: "clarify",
      data: {
        reason:
          "Ta question peut se comprendre de deux façons, et les explications seraient très différentes.",
        interpretations: [
          {
            label: "Pourquoi les objets tombent vers le sol",
            question: "pourquoi les objets tombent vers le sol",
          },
          {
            label: "Comment la gravitation retient la Lune autour de la Terre",
            question: "comment la gravitation retient la Lune autour de la Terre",
          },
        ],
      },
    },
  ]);
  await mockStart(page, body);
  await ask(page, "la gravité");
  await page
    .getByRole("button", { name: /Pourquoi les objets tombent/ })
    .waitFor({ timeout: 8000 });
  await shoot(page, size, theme, "clarify");
  await context.close();
}

async function refused(browser: Browser, size: Size, theme: Theme) {
  const { context, page } = await open(browser, size, theme);
  const body = encode([
    accepted("demo-refused"),
    {
      name: "refused",
      data: {
        reason:
          "Cette question ne porte pas sur un sujet scolaire : je ne peux pas en faire une explication.",
      },
    },
  ]);
  await mockStart(page, body);
  await ask(page, "quel est le meilleur film de l’année");
  await page.getByRole("link", { name: /Poser une autre question/ }).waitFor({ timeout: 8000 });
  await shoot(page, size, theme, "refused");
  await context.close();
}

async function partial(browser: Browser, size: Size, theme: Theme, real: Block[]) {
  const { context, page } = await open(browser, size, theme);
  const scenes = pick(real, "scene");
  const body = encode([
    accepted("demo-partial"),
    ...pick(real, "meta").map((block) => ({
      ...block,
      data: { ...block.data, detected_language: "en" },
    })),
    ...pick(real, "plan"),
    ...scenes.slice(0, 3),
    { name: "scene_dropped", data: { index: 3 } },
    ...scenes.slice(4),
    { name: "done", data: { status: "partial", share_url: "/fr/e/demo-partial" } },
  ]);
  await mockStart(page, body);
  await ask(page, QUESTION);
  await page.getByRole("button", { name: "Relancer" }).waitFor({ timeout: 8000 });
  check(
    (await page.getByRole("button", { name: /Voir l’explication en anglais/ }).count()) === 1,
    `partial ${size.name} ${theme}: the language suggestion is offered`,
  );
  await shoot(page, size, theme, "partial");
  await context.close();
}

async function behaviours(browser: Browser) {
  console.log("\n# clarify: pending then rejection");
  {
    const { context, page } = await open(browser, SIZES[0], "paper");
    const clarifyBody = encode([
      accepted("demo-clarify"),
      {
        name: "clarify",
        data: {
          reason: "Deux lectures sont possibles.",
          interpretations: [
            { label: "Première lecture", question: "première lecture" },
            { label: "Seconde lecture", question: "seconde lecture" },
          ],
        },
      },
    ]);
    let posts = 0;
    await page.route("**/api/explanations", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts += 1;
      if (posts === 1) {
        return route.fulfill({ status: 200, contentType: "text/event-stream", body: clarifyBody });
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "30" },
        body: JSON.stringify({ error: { code: "rate_limited", message: "" } }),
      });
    });
    await ask(page, "la gravité");
    const choice = page.getByRole("button", { name: /Première lecture/ });
    await choice.waitFor({ timeout: 8000 });
    await choice.click();
    await page.waitForTimeout(300);
    check(
      (await choice.getAttribute("aria-busy")) === "true",
      "clarify: the pressed button is busy",
    );
    check(
      (await page.getByRole("button", { name: /Seconde lecture/ }).isDisabled()) === true,
      "clarify: the other choices are disabled while pending",
    );
    check(
      (await page
        .getByRole("status")
        .filter({ hasText: /Je prépare/ })
        .count()) === 1,
      "clarify: a status line says the explanation is being prepared",
    );
    await page
      .getByRole("alert")
      .filter({ hasText: /secondes/ })
      .waitFor({ timeout: 5000 });
    check(
      (await page.getByRole("button", { name: /Première lecture/ }).isEnabled()) === true,
      "clarify: the choices are back after the rejection",
    );
    await context.close();
  }

  console.log("\n# clarify: accepted choice navigates to the new explanation");
  {
    const { context, page } = await open(browser, SIZES[0], "paper");
    const real = await realBlocks();
    const clarifyBody = encode([
      accepted("demo-clarify"),
      {
        name: "clarify",
        data: {
          reason: "Deux lectures sont possibles.",
          interpretations: [{ label: "Première lecture", question: "première lecture" }],
        },
      },
    ]);
    let posts = 0;
    await page.route("**/api/explanations", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts += 1;
      const body = posts === 1 ? clarifyBody : encode([...real]);
      return route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });
    await ask(page, "la gravité");
    const choice = page.getByRole("button", { name: /Première lecture/ });
    await choice.waitFor({ timeout: 8000 });
    await choice.click();
    await page.waitForURL((url) => !url.pathname.endsWith("demo-clarify"), { timeout: 8000 });
    await page.getByRole("slider", { name: "Position dans l’explication" }).waitFor();
    check(
      page.url().includes("/fr/e/"),
      "clarify: the player is shown for the chosen reading",
      page.url(),
    );
    await context.close();
  }

  console.log("\n# failed: retry starts the same question again");
  {
    const { context, page } = await open(browser, SIZES[0], "paper");
    await ask(page, "un sujet que le simulateur ne connaît pas");
    const retry = page.getByRole("button", { name: "Réessayer" });
    await retry.waitFor({ timeout: 8000 });
    const before = page.url();
    await retry.click();
    await page.waitForFunction((url) => location.href !== url, before, { timeout: 8000 });
    await page.getByRole("button", { name: "Réessayer" }).waitFor({ timeout: 8000 });
    check(page.url() !== before, "failed: retry navigates to a new explanation", page.url());
    check(
      (await page.getByText("La génération est momentanément indisponible").count()) === 1,
      "failed: the server message is shown",
    );
    await context.close();
  }

  console.log("\n# opened from a link: the affordance, then play");
  {
    const { context, page } = await open(browser, SIZES[0], "paper");
    const real = await realBlocks();
    const id = (real[0]?.data.explanation_id as string | undefined) ?? "";
    await page.goto(`${BASE}/fr/e/${id}`, { waitUntil: "networkidle" });
    const play = page.getByRole("button", { name: /Lire l’explication/ });
    await play.waitFor({ timeout: 8000 });
    await page.waitForTimeout(1200);
    check((await position(page)) === 0, "link: the position stays at zero");
    await play.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[role=slider]") !== null);
    const deadline = Date.now() + 8000;
    while ((await position(page)) < 2 && Date.now() < deadline) await page.waitForTimeout(100);
    check((await position(page)) >= 2, "link: Enter on the affordance plays");
    check((await play.count()) === 0, "link: the affordance disappears at the first play");
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    const paused = await position(page);
    await page.waitForTimeout(1200);
    check((await position(page)) === paused, "link: pausing does not bring the affordance back");
    check((await play.count()) === 0, "link: the affordance stays away after a pause");
    await context.close();
  }

  console.log("\n# reduced motion");
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      locale: "fr",
      extraHTTPHeaders: visitor(),
    });
    const page = await context.newPage();
    await mockStart(page, encode([accepted("demo-reduced"), step("triage", "started")]));
    await ask(page, QUESTION);
    await page.waitForTimeout(800);
    const drawn = await page.evaluate(() => {
      const line = document.querySelector("svg line");
      return line ? getComputedStyle(line).strokeDashoffset : null;
    });
    check(drawn === "0px", "reduced motion: construction lines are shown without animation", drawn);
    await context.close();
  }
}

const real = await realBlocks();
const realId = (real[0]?.data.explanation_id as string | undefined) ?? "";
check(
  realId !== "" && pick(real, "scene").length === 6,
  "the simulated provider answers the reference question",
);

const browser = await chromium.launch();
for (const size of SIZES) {
  for (const theme of THEMES) {
    console.log(`\n# ${size.name} ${theme}`);
    const label = `${size.name} ${theme}`;
    scenario = `first ${label}`;
    await first(browser, size, theme);
    scenario = `preparing ${label}`;
    await preparing(browser, size, theme, real);
    scenario = `streaming ${label}`;
    await streaming(browser, size, theme, real);
    scenario = `playing ${label}`;
    await playing(browser, size, theme);
    scenario = `link ${label}`;
    await fromLink(browser, size, theme, realId);
    scenario = `colophon ${label}`;
    await colophon(browser, size, theme, realId);
    scenario = `missing ${label}`;
    await missing(browser, size, theme);
    scenario = `failed ${label}`;
    await failed(browser, size, theme);
    scenario = `clarify ${label}`;
    await clarify(browser, size, theme);
    scenario = `refused ${label}`;
    await refused(browser, size, theme);
    scenario = `partial ${label}`;
    await partial(browser, size, theme, real);
  }
}
scenario = "behaviours";
await behaviours(browser);
await browser.close();

check(errors.length === 0, "no console error", errors.slice(0, 5));
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
