import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";

// The server behind BASE must run with LLM_PROVIDER=fixture: every request below is a real
// one, answered by the committed scenarios, and never by a paid provider.
if (process.env.CHECK_FIXTURE_SERVER !== "1") {
  console.log(
    "Refusing to run: set CHECK_FIXTURE_SERVER=1 once the server uses the fixture provider",
  );
  process.exit(2);
}

const BASE = process.env.CHECK_BASE ?? "http://localhost:3000";
const OUT = ".snapshots/reformulate";
const QUESTION = "la loi de la gravité";
const CONCEPT = "physics/universal-gravitation";
const SIZES = [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "360", width: 360, height: 740, phone: true },
] as const;
const THEMES = ["paper", "board"] as const;
const LEVEL = "superieur";

type Size = (typeof SIZES)[number];
type Theme = (typeof THEMES)[number];

interface Messages {
  [key: string]: Messages | string;
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

const MESSAGES = Object.assign(
  {},
  ...["reformulate", "explanation", "scenes", "ask"].map(
    (name) => JSON.parse(readFileSync(`messages/fr/${name}.json`, "utf8")) as Messages,
  ),
) as Messages;

function message(key: string, values: Record<string, string | number> = {}): string {
  let node: Messages | string | undefined = MESSAGES;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`No message ${key}`);
  return node
    .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, name, one, other) => {
      const count = Number(values[name]);
      return (count === 1 ? one : other).replace("#", String(count));
    })
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
    .replace(/<\/?v>/g, "");
}

async function forgetCachedGravity(): Promise<void> {
  try {
    process.loadEnvFile(path.resolve("../../.env"));
  } catch {
    // No root .env.
  }
  const sql = postgres(
    process.env.DATABASE_URL ?? "postgresql://eureka:eureka@127.0.0.1:54329/eureka",
    { max: 1, onnotice: () => undefined },
  );
  try {
    await sql`delete from question_cache where language = 'fr' and level = ${LEVEL}
      and explanation_id in (select id from explanations where concept_slug = ${CONCEPT})`;
    await sql`delete from concept_cache
      where language = 'fr' and level = ${LEVEL} and concept_slug = ${CONCEPT}`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

const octet = (): number => randomInt(1, 255);

const section = (page: Page) => page.locator('[data-slot="reformulate"]');
const title = (page: Page) =>
  page.getByRole("heading", { level: 2, name: message("Reformulate.title") });
const versions = (page: Page) =>
  page.getByRole("list", { name: message("Reformulate.versions.label") });
const choice = (page: Page, name: string) =>
  page.getByRole("button", { name: message(`Reformulate.choices.${name}`) });
const field = (page: Page) =>
  page.getByRole("textbox", { name: message("Reformulate.followUp.lead") });
const scenes = (page: Page) =>
  page.getByRole("list", { name: message("Scenes.label") }).getByRole("button");

async function shoot(page: Page, size: Size, theme: Theme, name: string, target?: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(horizontal <= 0, `${name} ${size.name} ${theme}: no horizontal overflow`, horizontal);
  const where = section(page);
  if ((await where.count()) > 0) await where.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}-${size.name}-${theme}${target ?? ""}.png` });
}

async function idOf(page: Page): Promise<string> {
  return /\/fr\/e\/([a-z0-9]{12})$/.exec(page.url())?.[1] ?? "";
}

async function nextVersion(page: Page, previous: string, count: number): Promise<string> {
  await page.waitForURL(new RegExp(`/fr/e/(?!${previous})[a-z0-9]{12}$`), { timeout: 25_000 });
  await title(page).waitFor({ timeout: 25_000 });
  await scenes(page)
    .nth(count - 1)
    .waitFor();
  return idOf(page);
}

async function session(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  await forgetCachedGravity();
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.phone,
    hasTouch: size.phone,
    locale: "fr",
    colorScheme: theme === "board" ? "dark" : "light",
    extraHTTPHeaders: { "X-Forwarded-For": `10.${octet()}.${octet()}.${octet()}` },
  });
  await context.addInitScript(
    ([theme, level]) => {
      localStorage.setItem("eureka.theme", theme as string);
      localStorage.setItem("eureka.level", level as string);
    },
    [theme, LEVEL],
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() !== "error") return;
    const text = entry.text();
    if (/^Maximum update depth exceeded/.test(text) || text.startsWith("Failed to load resource")) {
      return;
    }
    errors.push(text);
  });
  const posts: { mode?: string }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/explanations")) {
      posts.push(request.postDataJSON() as { mode?: string });
    }
  });

  try {
    await page.goto(`${BASE}/fr`);
    await page.getByRole("textbox", { name: message("Ask.lead") }).fill(QUESTION);
    await page.keyboard.press("Enter");
    await title(page).waitFor({ timeout: 25_000 });
    const first = await idOf(page);

    check(
      (await section(page).count()) === 1,
      `${tag}: the section appears once the explanation is complete`,
    );
    check(
      (await choice(page, "another_analogy").isEnabled()) &&
        (await choice(page, "simpler").isEnabled()),
      `${tag}: two choices are enabled`,
    );
    check((await versions(page).count()) === 0, `${tag}: a single version shows no list`);
    const lead = await field(page).count();
    check(lead === 1, `${tag}: the sentence with a blank is there`);
    const box = await section(page).boundingBox();
    check(box !== null && box.width > 0, `${tag}: the section has a box`, box);
    await shoot(page, size, theme, "base");

    await choice(page, "simpler").focus();
    await page.keyboard.press("Tab");
    await shoot(page, size, theme, "focus");
    await page.keyboard.press("Shift+Tab");

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/explanations", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await held;
      return route.continue();
    });
    await field(page).fill(message("Reformulate.followUp.placeholder"));
    await choice(page, "another_analogy").click();
    await page.getByText(message("Reformulate.busy")).waitFor();
    check(
      (await choice(page, "zoom").isDisabled()) && (await choice(page, "simpler").isDisabled()),
      `${tag}: the three choices are disabled while the request is on its way`,
    );
    await shoot(page, size, theme, "busy");
    release();

    await page.waitForURL(new RegExp(`/fr/e/(?!${first})[a-z0-9]{12}$`), { timeout: 25_000 });
    const preparing = await page
      .getByText(message("Explanation.preparation.label"), { exact: true })
      .first()
      .isVisible();
    check(preparing, `${tag}: the new version shows its preparation steps`);
    check(
      (await title(page).count()) === 0,
      `${tag}: no reformulation section during the preparation`,
    );
    await page.screenshot({ path: `${OUT}/preparing-${size.name}-${theme}.png` });
    const second = await nextVersion(page, first, 6);

    await choice(page, "simpler").click();
    const third = await nextVersion(page, second, 5);

    await page
      .getByRole("combobox", { name: message("Reformulate.sceneLegend") })
      .selectOption({ index: 2 });
    await shoot(page, size, theme, "zoom-picked");
    await choice(page, "zoom").click();
    const fourth = await nextVersion(page, third, 2);

    await field(page).fill(message("Reformulate.followUp.placeholder"));
    await shoot(page, size, theme, "followup-typed");
    await field(page).press("Enter");
    const fifth = await nextVersion(page, fourth, 2);

    await versions(page).getByRole("listitem").nth(4).waitFor();
    const entries = await versions(page).getByRole("listitem").allInnerTexts();
    check(entries.length === 5, `${tag}: five versions are listed`, entries);
    check(
      new Set([first, second, third, fourth, fifth]).size === 5,
      `${tag}: each request gave a different explanation`,
    );
    check(
      posts.map((post) => post.mode ?? "initial").join() ===
        "initial,another_analogy,simpler,zoom,followup",
      `${tag}: the requests were sent in order`,
      posts,
    );
    const listBox = await versions(page).boundingBox();
    const fieldBox = await field(page).boundingBox();
    if (listBox && fieldBox) {
      const beside = listBox.x > fieldBox.x + fieldBox.width - 1;
      check(
        size.phone ? !beside : beside,
        `${tag}: the versions are ${size.phone ? "below" : "in the margin beside"} the controls`,
        { listBox, fieldBox },
      );
    }
    await shoot(page, size, theme, "versions");

    await versions(page).getByRole("listitem").first().getByRole("button").click();
    await page.waitForURL(new RegExp(`/fr/e/${first}$`));
    await title(page).waitFor();
    check(
      (await page.locator("main#content .__remotion-player").count()) === 1,
      `${tag}: one explanation is displayed after replaying V1`,
    );
    await shoot(page, size, theme, "replayed");

    await page.route("**/api/explanations", (route) =>
      route.request().method() !== "POST"
        ? route.fallback()
        : route.fulfill({
            status: 429,
            headers: { "Retry-After": "42" },
            json: { error: { code: "rate_limited", message: "" } },
          }),
    );
    await choice(page, "another_analogy").click();
    await page
      .getByRole("alert")
      .filter({ hasText: message("Ask.errors.rateLimitedSeconds", { seconds: 42 }) })
      .waitFor();
    check((await idOf(page)) === first, `${tag}: the explanation stays after a refusal`);
    await shoot(page, size, theme, "rate-limited");
  } finally {
    await context.close();
  }

  const redirectContext = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.phone,
    hasTouch: size.phone,
    locale: "fr",
    colorScheme: theme === "board" ? "dark" : "light",
    extraHTTPHeaders: { "X-Forwarded-For": `10.${octet()}.${octet()}.${octet()}` },
  });
  await forgetCachedGravity();
  await redirectContext.addInitScript(
    ([theme, level]) => {
      localStorage.setItem("eureka.theme", theme as string);
      localStorage.setItem("eureka.level", level as string);
    },
    [theme, LEVEL],
  );
  const other = await redirectContext.newPage();
  other.on("pageerror", (error) => errors.push(error.message));
  try {
    await other.goto(`${BASE}/fr`);
    await other.getByRole("textbox", { name: message("Ask.lead") }).fill(QUESTION);
    await other.keyboard.press("Enter");
    await title(other).waitFor({ timeout: 25_000 });
    await field(other).fill("comment les plantes fabriquent-elles leur sucre ?");
    await field(other).press("Enter");
    const notice = other.getByText(message("Explanation.redirected.notice"));
    await notice.waitFor({ timeout: 25_000 });
    check(true, `${tag}: the unrelated follow-up is announced`);
    await title(other).waitFor({ timeout: 25_000 });
    check(
      await notice.isVisible(),
      `${tag}: the announcement is still there when the answer is complete`,
    );
    await other.evaluate(() => document.fonts.ready);
    await other.waitForTimeout(250);
    await notice.scrollIntoViewIfNeeded();
    await other.screenshot({ path: `${OUT}/redirected-${size.name}-${theme}.png` });
  } finally {
    await redirectContext.close();
  }
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    for (const theme of THEMES) await session(browser, size, theme);
  }
} finally {
  await browser.close();
}

check(errors.length === 0, "no page error in the console", errors);
if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
