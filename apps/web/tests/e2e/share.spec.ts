import { randomInt } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";

interface Messages {
  [key: string]: Messages | string;
}

type Language = "fr" | "en";

const QUESTION = "la loi de la gravité";
const CONCEPT = "physics/universal-gravitation";
const GENERATION_MS = 60_000;
const FEEDBACK_MS = 4000;
const ID_PATTERN = /\/fr\/e\/([a-z0-9]{12})$/;
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const RETENTION_DAYS = 90;

// React logs this in development only, from the playback loop of @remotion/player.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;
const SIMULATED_410 = /Failed to load resource.*410/;
// The document itself answers 404, and React warns in development when Next.js client-renders
// the inline theme script of the locale layout under a not-found boundary.
const NOT_FOUND_DOCUMENT = [
  /Failed to load resource.*404/,
  /^Encountered a script tag while rendering React component/,
];
const LEVEL_KEY = "eureka.level";
// The lycee gravity explanation of a development database may predate the quiz.
const LEVEL = "superieur";

test.describe.configure({ timeout: 3 * GENERATION_MS });

function loadMessages(language: Language): Messages {
  const dir = path.join(__dirname, "../../messages", language);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  return Object.assign(
    {},
    ...files.map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Messages),
  );
}

const MESSAGES: Record<Language, Messages> = { fr: loadMessages("fr"), en: loadMessages("en") };

function message(
  key: string,
  values: Record<string, string | number> = {},
  language: Language = "fr",
): string {
  let node: Messages | string | undefined = MESSAGES[language];
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`No message ${key} in ${language}`);
  return node
    .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, name, one, other) => {
      const count = Number(values[name]);
      return (count === 1 ? one : other).replace("#", String(count));
    })
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
}

function databaseUrl(): string {
  try {
    process.loadEnvFile(path.join(__dirname, "../../../../.env"));
  } catch {
    // No root .env: the environment provides the address.
  }
  return process.env.DATABASE_URL ?? "postgresql://eureka:eureka@127.0.0.1:54329/eureka";
}

function newId(): string {
  return Array.from({ length: 12 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");
}

// A copy that expired yesterday: the original, and the cache that points at it, stay untouched.
async function insertExpiredCopy(id: string): Promise<string> {
  const copy = newId();
  const sql = postgres(databaseUrl(), { max: 1, onnotice: () => undefined });
  try {
    await sql`insert into explanations
      select * from jsonb_populate_record(null::explanations,
        (select to_jsonb(e) || jsonb_build_object(
          'id', ${copy}::text, 'root_id', ${copy}::text, 'parent_id', null,
          'expires_at', to_jsonb(now() - interval '1 day'))
         from explanations e where e.id = ${id}))`;
  } finally {
    await sql.end({ timeout: 2 });
  }
  return copy;
}

async function deleteCopy(id: string): Promise<void> {
  const sql = postgres(databaseUrl(), { max: 1, onnotice: () => undefined });
  try {
    await sql`delete from explanations where id = ${id}`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

const octet = (): number => randomInt(1, 255);
const visitorAddress = (): string => `10.${octet()}.${octet()}.${octet()}`;

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "X-Forwarded-For": visitorAddress() });
});

function trackConsole(page: Page, ignore: RegExp[] = []): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() !== "error") return;
    const text = entry.text();
    if (KNOWN_DEV_WARNING.test(text) || ignore.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  return errors;
}

const copyAction = (page: Page): Locator =>
  page.getByRole("button", { name: message("Share.copy"), exact: true });
const shareStatus = (page: Page): Locator =>
  page.locator('[data-slot="share"]').getByRole("status");
const askLink = (page: Page): Locator =>
  page.getByRole("link", { name: message("Share.ask"), exact: true });
const quizEntry = (page: Page): Locator =>
  page.getByRole("button", { name: message("Quiz.open"), exact: true });
const ruler = (page: Page): Locator =>
  page.getByRole("slider", { name: message("Transport.ruler") });
const scenesList = (page: Page): Locator =>
  page.getByRole("list", { name: message("Scenes.label"), exact: true });
const sectionTitle = (page: Page): Locator =>
  page.getByRole("heading", { level: 2, name: message("Reformulate.title") });

const pageBox = (locator: Locator) =>
  locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x: x + window.scrollX, y: y + window.scrollY, width, height };
  });

async function position(page: Page): Promise<number> {
  return Number(await ruler(page).getAttribute("aria-valuenow"));
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectPlays(page: Page): Promise<void> {
  const play = page
    .getByRole("button", { name: message("Explanation.play") })
    .or(page.getByRole("button", { name: message("Transport.play"), exact: true }))
    .first();
  await play.click();
  await expect(
    page.getByRole("button", { name: message("Transport.pause"), exact: true }),
  ).toBeVisible();
  await expect.poll(() => position(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
}

async function grantClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
}

const clipboardText = (page: Page): Promise<string> =>
  page.evaluate(() => navigator.clipboard.readText());

async function newVisitor(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const { viewport, userAgent, hasTouch, isMobile, deviceScaleFactor } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    viewport,
    userAgent,
    hasTouch,
    isMobile,
    deviceScaleFactor,
    extraHTTPHeaders: { "X-Forwarded-For": visitorAddress() },
  });
  return context.newPage();
}

test("the link is copied, confirmed for 4 seconds, and plays for another visitor", async ({
  page,
  browser,
  baseURL,
}) => {
  const errors = trackConsole(page);
  await grantClipboard(page);
  await page.addInitScript(
    ([key, level]) => localStorage.setItem(key as string, level as string),
    [LEVEL_KEY, LEVEL],
  );

  await page.goto("/fr");
  await page.getByRole("textbox", { name: message("Ask.lead") }).fill(QUESTION);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(ID_PATTERN);
  await expect(copyAction(page)).toBeVisible({ timeout: GENERATION_MS });
  const id = ID_PATTERN.exec(new URL(page.url()).pathname)?.[1] ?? "";
  const address = new URL(`/fr/e/${id}`, baseURL).href;

  await test.step("the owner copies the link and sees it confirmed for 4 seconds", async () => {
    const box = await copyAction(page).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await expect(shareStatus(page)).toHaveText("");

    const below = scenesList(page);
    const before = await pageBox(below);
    await copyAction(page).click();
    await expect(shareStatus(page)).toHaveText(message("Share.copied"));
    const shownAt = Date.now();
    await expect(copyAction(page)).toBeFocused();
    expect(await pageBox(below)).toEqual(before);
    expect(await clipboardText(page)).toBe(address);

    await page.waitForTimeout(1500);
    await expect(shareStatus(page)).toHaveText(message("Share.copied"));
    await expect(shareStatus(page)).toHaveText("", { timeout: 3000 });
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(FEEDBACK_MS - 500);
    expect(await pageBox(below)).toEqual(before);
    await expect(copyAction(page)).toBeFocused();

    await expect(sectionTitle(page)).toBeVisible();
    await expectNoOverflow(page);
  });

  const visitor = await newVisitor(browser, baseURL);
  const visitorErrors = trackConsole(visitor, [SIMULATED_410]);

  await test.step("another visitor plays it without any input zone", async () => {
    await visitor.goto(address);
    await expect(ruler(visitor)).toBeVisible({ timeout: GENERATION_MS });
    await expect(scenesList(visitor).getByRole("listitem")).not.toHaveCount(0);
    await expect(visitor.locator("main#content .__remotion-player")).toBeVisible();
    await expect(visitor.getByRole("heading", { name: message("Params.title") })).toBeVisible();
    await expect(quizEntry(visitor)).toBeVisible();
    await expect(copyAction(visitor)).toBeVisible();

    for (const name of [message("Ask.lead"), message("Reformulate.followUp.lead")]) {
      await expect(visitor.getByRole("textbox", { name })).toHaveCount(0);
    }
    await expect(sectionTitle(visitor)).toHaveCount(0);
    await expect(visitor.locator('[data-slot="reformulate"]')).toHaveCount(0);
    await expect(visitor.locator('[data-slot="level-choice"]')).toHaveCount(0);
    await expect(askLink(visitor)).toBeVisible();

    await expectPlays(visitor);
    await expectNoOverflow(visitor);

    await grantClipboard(visitor);
    await copyAction(visitor).click();
    await expect(shareStatus(visitor)).toHaveText(message("Share.copied"));
    expect(await clipboardText(visitor)).toBe(address);
  });

  await test.step("the owner still sees the reformulation after a reload", async () => {
    await page.reload();
    await expect(sectionTitle(page)).toBeVisible({ timeout: GENERATION_MS });
    await expect(page.locator('[data-slot="visitor-ask"]')).toHaveCount(0);
  });

  await test.step("the visitor asks a question of their own", async () => {
    await askLink(visitor).click();
    await expect(visitor).toHaveURL(/\/fr$/);
    await expect(visitor.getByRole("textbox", { name: message("Ask.lead") })).toBeVisible();
  });

  await test.step("a link whose expiry date has passed shows the expired page", async () => {
    const expired = await insertExpiredCopy(id);
    try {
      const api = await visitor.request.get(`/api/explanations/${expired}`);
      expect(api.status()).toBe(410);

      const response = await visitor.goto(`/fr/e/${expired}`);
      // A Next.js page cannot answer 410: only the API does.
      expect(response?.status()).toBe(200);
      await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
        message("Share.expired.title"),
      );
      await expect(visitor.locator("main")).toContainText(
        message("Share.expired.lead", { days: RETENTION_DAYS }),
      );
      await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(visitor).toHaveTitle(
        message("Explanation.documentTitle", {
          title: message("Share.expired.title"),
          product: message("Common.productName"),
        }),
      );
      await expect(askLink(visitor)).toBeVisible();
      await expect(visitor.locator("video, .__remotion-player")).toHaveCount(0);
      await expectNoOverflow(visitor);
      await askLink(visitor).click();
      await expect(visitor).toHaveURL(/\/fr$/);
    } finally {
      await deleteCopy(expired);
    }
  });

  await test.step("a 410 answered to the page shows the expired page", async () => {
    await visitor.route(`**/api/explanations/${id}`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 410,
            json: { error: { code: "expired", message: "Ce lien a expiré." } },
          })
        : route.fallback(),
    );
    await visitor.goto(address);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
      message("Share.expired.title"),
    );
    await expect(visitor.locator("main")).toContainText(
      message("Share.expired.lead", { days: RETENTION_DAYS }),
    );
    await expect(visitor.locator("main")).toContainText(message("Share.expired.next"));
    await expect(askLink(visitor)).toBeVisible();
    await expect(visitor.getByRole("textbox")).toHaveCount(0);
    await expect(copyAction(visitor)).toHaveCount(0);
    await expectNoOverflow(visitor);
    await askLink(visitor).click();
    await expect(visitor).toHaveURL(/\/fr$/);
  });

  await visitor.context().close();
  expect(errors).toEqual([]);
  expect(visitorErrors).toEqual([]);
});

test("a reference opened by its link plays and can be shared", async ({
  page,
  browser,
  baseURL,
}) => {
  const entries = (await (await page.request.get("/api/reference?language=fr")).json()) as {
    slug: string;
    explanation_id: string;
  }[];
  const reference = entries.find((entry) => entry.slug === CONCEPT);
  expect(reference).toBeDefined();
  const address = new URL(`/fr/e/${reference?.explanation_id}`, baseURL).href;

  const visitor = await newVisitor(browser, baseURL);
  const errors = trackConsole(visitor);
  try {
    await grantClipboard(visitor);
    const response = await visitor.goto(address);
    expect(response?.status()).toBe(200);
    await expect(ruler(visitor)).toBeVisible({ timeout: GENERATION_MS });
    await expect(copyAction(visitor)).toBeVisible();
    await expect(visitor.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(visitor.getByRole("heading", { name: message("Params.title") })).toBeVisible();
    await expect(visitor.locator('[data-slot="level-choice"]')).toHaveCount(1);

    await expectPlays(visitor);
    await copyAction(visitor).click();
    await expect(shareStatus(visitor)).toHaveText(message("Share.copied"));
    expect(await clipboardText(visitor)).toBe(address);
    await expectNoOverflow(visitor);
  } finally {
    await visitor.context().close();
  }
  expect(errors).toEqual([]);
});

for (const [language, id] of [
  ["fr", "inconnu"],
  ["fr", newId()],
  ["en", newId()],
] as const) {
  test(`${language}: an unknown identifier (${id.length === 12 ? "well formed" : "malformed"}) shows the dedicated 404 page`, async ({
    page,
  }) => {
    const errors = trackConsole(page, NOT_FOUND_DOCUMENT);
    const response = await page.goto(`/${language}/e/${id}`);

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      message("Share.missing.title", {}, language),
    );
    await expect(page.locator("main")).toContainText(message("Share.missing.lead", {}, language));
    await expect(page.locator("main")).toContainText(message("Share.missing.next", {}, language));
    await expect(page).toHaveTitle(
      message(
        "Explanation.documentTitle",
        {
          title: message("Share.missing.title", {}, language),
          product: message("Common.productName", {}, language),
        },
        language,
      ),
    );
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("video, .__remotion-player")).toHaveCount(0);
    await expectNoOverflow(page);

    const ask = page.getByRole("link", { name: message("Share.ask", {}, language), exact: true });
    await expect(ask).toBeVisible();
    await ask.click();
    await expect(page).toHaveURL(new RegExp(`/${language}$`));
    expect(errors).toEqual([]);
  });
}
