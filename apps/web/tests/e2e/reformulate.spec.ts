import { randomInt } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";

interface Messages {
  [key: string]: Messages | string;
}

const QUESTION = "la loi de la gravité";
const FOLLOWUP = "la distance double";
const UNRELATED = "comment les plantes fabriquent-elles leur sucre ?";
const CONCEPT = "physics/universal-gravitation";
const OTHER_CONCEPT = "biology/photosynthesis";
const LEVEL_KEY = "eureka.level";
const GENERATION_MS = 60_000;
const ID_PATTERN = /\/fr\/e\/([a-z0-9]{12})$/;

// Each project asks at its own level, so that the two never share a cached explanation.
const LEVELS: Record<string, string> = { desktop: "superieur", phone: "college" };

// React logs this in development only, from the playback loop of @remotion/player.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;

test.describe.configure({ mode: "serial", timeout: 3 * GENERATION_MS });

function loadMessages(): Messages {
  const dir = path.join(__dirname, "../../messages/fr");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  return Object.assign(
    {},
    ...files.map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Messages),
  );
}

const MESSAGES = loadMessages();

function message(key: string, values: Record<string, string | number> = {}): string {
  let node: Messages | string | undefined = MESSAGES;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`No message ${key} in fr`);
  return node
    .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, name, one, other) => {
      const count = Number(values[name]);
      return (count === 1 ? one : other).replace("#", String(count));
    })
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
    .replace(/<\/?v>/g, "");
}

function databaseUrl(): string {
  try {
    process.loadEnvFile(path.join(__dirname, "../../../../.env"));
  } catch {
    // No root .env: the environment provides the address.
  }
  return process.env.DATABASE_URL ?? "postgresql://eureka:eureka@127.0.0.1:54329/eureka";
}

// A finished question is served again to the next visitor who asks it: a session starts empty
// only if the explanation of its concept at this level is forgotten first.
async function forgetCached(concept: string, level: string): Promise<void> {
  const sql = postgres(databaseUrl(), { max: 1, onnotice: () => undefined });
  try {
    await sql`delete from question_cache where language = 'fr' and level = ${level}
      and explanation_id in (select id from explanations where concept_slug = ${concept})`;
    await sql`delete from concept_cache
      where language = 'fr' and level = ${level} and concept_slug = ${concept}`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

const levelOf = (project: string): string => LEVELS[project] ?? "lycee";

const octet = (): number => randomInt(1, 255);

test.beforeEach(async ({ page, context }, testInfo) => {
  const level = levelOf(testInfo.project.name);
  await forgetCached(CONCEPT, level);
  await context.setExtraHTTPHeaders({ "X-Forwarded-For": `10.${octet()}.${octet()}.${octet()}` });
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [LEVEL_KEY, level],
  );
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

interface Post {
  mode?: string;
  parent_id?: string;
  scene_id?: string;
  question?: string;
  level: string;
  language: string;
}

function trackPosts(page: Page): Post[] {
  const posts: Post[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/explanations") {
      posts.push(request.postDataJSON() as Post);
    }
  });
  return posts;
}

const sectionTitle = (page: Page): Locator =>
  page.getByRole("heading", { level: 2, name: message("Reformulate.title") });
const versionList = (page: Page): Locator =>
  page.getByRole("list", { name: message("Reformulate.versions.label") });
const sceneButtons = (page: Page): Locator =>
  page.getByRole("list", { name: message("Scenes.label") }).getByRole("button");
const choice = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: message(`Reformulate.choices.${name}`) });
const followUpField = (page: Page): Locator =>
  page.getByRole("textbox", { name: message("Reformulate.followUp.lead") });
const sceneSelect = (page: Page): Locator =>
  page.getByRole("combobox", { name: message("Reformulate.sceneLegend") });

function idOf(page: Page): string {
  const id = ID_PATTERN.exec(new URL(page.url()).pathname)?.[1];
  if (!id) throw new Error(`Not an explanation address: ${page.url()}`);
  return id;
}

async function ask(page: Page, question: string): Promise<string> {
  await page.goto("/fr");
  await page.getByRole("textbox", { name: message("Ask.lead") }).fill(question);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(ID_PATTERN);
  await expect(sectionTitle(page)).toBeVisible({ timeout: GENERATION_MS });
  return idOf(page);
}

async function expectNewVersion(page: Page, previous: string, scenes: number): Promise<string> {
  await expect(page).toHaveURL(new RegExp(`/fr/e/(?!${previous})[a-z0-9]{12}$`), {
    timeout: GENERATION_MS,
  });
  await expect(sectionTitle(page)).toBeVisible({ timeout: GENERATION_MS });
  await expect(sceneButtons(page)).toHaveCount(scenes);
  await expect(page.locator("main#content .__remotion-player")).toHaveCount(1);
  return idOf(page);
}

function versionText(number: number, kind?: string): string {
  return kind === undefined
    ? message("Reformulate.versions.entryInitial", { number })
    : message("Reformulate.versions.entry", { number, kind });
}

async function expectVersions(page: Page, labels: string[]): Promise<void> {
  const items = versionList(page).getByRole("listitem");
  await expect(items).toHaveCount(labels.length);
  const last = labels.length - 1;
  for (const [index, label] of labels.entries()) {
    const text = index === last ? `${label} ${message("Reformulate.versions.current")}` : label;
    await expect(items.nth(index)).toHaveText(text);
  }
  await expect(items.nth(last).getByRole("button")).toHaveAttribute("aria-current", "true");
  await expect(versionList(page).locator("[aria-current]")).toHaveCount(1);
}

function rateLimited(): string {
  return message("Ask.errors.rateLimitedSeconds", { seconds: 30 });
}

test("the four requests make five versions that can all be replayed", async ({ page }) => {
  const errors = trackConsole(page);
  const posts = trackPosts(page);
  const first = await ask(page, QUESTION);
  const title = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";

  await expect(versionList(page)).toHaveCount(0);
  await expect(choice(page, "zoom")).toBeEnabled();
  await expect(followUpField(page)).toHaveValue("");

  let hold: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (hold = resolve));
  await page.route("**/api/explanations", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await held;
    return route.continue();
  });
  await choice(page, "another_analogy").click();
  await expect(page.getByText(message("Reformulate.busy"))).toBeVisible();
  for (const name of ["another_analogy", "simpler", "zoom"]) {
    await expect(choice(page, name)).toBeDisabled();
  }
  await expect(
    page.getByRole("button", { name: message("Reformulate.followUp.submit") }),
  ).toBeDisabled();
  expect(idOf(page)).toBe(first);
  await expect(sceneButtons(page)).toHaveCount(6);
  hold();

  await expect(
    page.getByText(message("Explanation.preparation.label"), { exact: true }),
  ).toBeVisible();
  await expect(sectionTitle(page)).toHaveCount(0);
  const second = await expectNewVersion(page, first, 6);
  expect(posts.at(-1)).toMatchObject({ mode: "another_analogy", parent_id: first, language: "fr" });
  expect(posts.at(-1)).not.toHaveProperty("question");
  await expectVersions(page, [
    versionText(1),
    versionText(2, message("Reformulate.versions.kinds.another_analogy")),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

  await choice(page, "simpler").click();
  const third = await expectNewVersion(page, second, 5);
  expect(posts.at(-1)).toMatchObject({ mode: "simpler", parent_id: second });

  const option = sceneSelect(page).locator("option").nth(2);
  const designated = /^\d+\s+—\s+(.+)$/s.exec(await option.innerText())?.[1]?.trim() ?? "";
  expect(designated).not.toBe("");
  await sceneSelect(page).selectOption({ index: 2 });
  await expect(choice(page, "zoom")).toContainText(designated);
  await choice(page, "zoom").click();
  const fourth = await expectNewVersion(page, third, 2);
  expect(posts.at(-1)).toMatchObject({ mode: "zoom", parent_id: third, scene_id: "s3" });
  const stored = await page.request.get(`/api/explanations/${third}`);
  expect(posts.at(-1)?.level).toBe(((await stored.json()) as { level: string }).level);

  await followUpField(page).fill(FOLLOWUP);
  await followUpField(page).press("Enter");
  const fifth = await expectNewVersion(page, fourth, 2);
  expect(posts.at(-1)).toMatchObject({ mode: "followup", parent_id: fourth, question: FOLLOWUP });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Et si la distance double");
  await expect(followUpField(page)).toHaveValue("");

  await expectVersions(page, [
    versionText(1),
    versionText(2, message("Reformulate.versions.kinds.another_analogy")),
    versionText(3, message("Reformulate.versions.kinds.simpler")),
    versionText(4, message("Reformulate.versions.zoomOf", { scene: designated })),
    versionText(5, message("Reformulate.versions.kinds.followup")),
  ]);
  expect(new Set([first, second, third, fourth, fifth]).size).toBe(5);
  expect(posts).toHaveLength(5);

  await versionList(page).getByRole("listitem").first().getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`/fr/e/${first}$`));
  await expect(sceneButtons(page)).toHaveCount(6);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator("main#content .__remotion-player")).toHaveCount(1);
  await expect(sectionTitle(page)).toBeVisible();
  await expect(versionList(page).locator("[aria-current]")).toHaveCount(1);
  await expect(versionList(page).getByRole("listitem").first().getByRole("button")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(versionList(page).getByRole("listitem")).toHaveCount(5);
  await expect(followUpField(page)).toHaveValue("");
  expect(posts).toHaveLength(5);

  expect(errors).toEqual([]);
});

test("the arrow keys never start a request", async ({ page }) => {
  const errors = trackConsole(page);
  const posts = trackPosts(page);
  const first = await ask(page, QUESTION);
  posts.length = 0;

  for (const name of ["another_analogy", "simpler", "zoom"]) {
    await choice(page, name).focus();
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) {
      await page.keyboard.press(key);
    }
    await expect(choice(page, name)).toBeFocused();
  }
  await sceneSelect(page).focus();
  for (const key of ["ArrowDown", "ArrowDown", "ArrowUp"]) await page.keyboard.press(key);
  await followUpField(page).focus();
  await page.keyboard.type(FOLLOWUP);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"]) {
    await page.keyboard.press(key);
  }

  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
  expect(idOf(page)).toBe(first);
  await expect(followUpField(page)).toHaveValue(FOLLOWUP);
  expect(errors).toEqual([]);
});

test("an unrelated follow-up is announced and handled as a new question", async ({
  page,
}, testInfo) => {
  const errors = trackConsole(page);
  const posts = trackPosts(page);
  await forgetCached(OTHER_CONCEPT, levelOf(testInfo.project.name));

  // The second round finds the concept already explained and is served from the cache.
  for (const round of ["new concept", "known concept"]) {
    const first = await ask(page, QUESTION);
    await followUpField(page).fill(UNRELATED);
    await followUpField(page).press("Enter");

    const notice = page.getByText(message("Explanation.redirected.notice"));
    await expect(notice, round).toBeVisible({ timeout: GENERATION_MS });
    await expect(sectionTitle(page), round).toBeVisible({ timeout: GENERATION_MS });
    await expect(notice, round).toBeVisible();
    expect(posts.at(-1), round).toMatchObject({
      mode: "followup",
      parent_id: first,
      question: UNRELATED,
    });
    expect(idOf(page), round).not.toBe(first);
    await expect(sceneButtons(page), round).toHaveCount(6);
    await expect(page.getByRole("heading", { level: 1 }), round).toHaveText("La photosynthèse");
    await expect(versionList(page), round).toHaveCount(0);
    await expect(page.locator("main#content .__remotion-player"), round).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

test("a refused request leaves the explanation on screen and says why", async ({ page }) => {
  const errors = trackConsole(page, [/Failed to load resource.*(429|503)/]);
  const first = await ask(page, QUESTION);

  await page.route("**/api/explanations", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "30" },
      json: { error: { code: "rate_limited", message: "" } },
    });
  });
  await followUpField(page).fill(FOLLOWUP);
  await choice(page, "simpler").click();

  const alert = page.getByRole("alert").filter({ hasText: rateLimited() });
  await expect(alert).toBeVisible();
  expect(idOf(page)).toBe(first);
  await expect(sceneButtons(page)).toHaveCount(6);
  await expect(page.locator("main#content .__remotion-player")).toHaveCount(1);
  await expect(sectionTitle(page)).toBeVisible();
  await expect(choice(page, "simpler")).toBeEnabled();
  await expect(followUpField(page)).toHaveValue(FOLLOWUP);

  await followUpField(page).press("Enter");
  const form = followUpField(page).locator("xpath=ancestor::form");
  await expect(form.getByRole("alert").filter({ hasText: rateLimited() })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: rateLimited() })).toHaveCount(1);

  await page.unroute("**/api/explanations");
  await page.route("**/api/explanations", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 503,
      json: { error: { code: "generation_unavailable", message: "" } },
    });
  });
  await choice(page, "another_analogy").click();
  await expect(
    page.getByRole("alert").filter({ hasText: message("Ask.errors.generationUnavailable") }),
  ).toBeVisible();
  expect(idOf(page)).toBe(first);
  await expect(sceneButtons(page)).toHaveCount(6);
  expect(errors).toEqual([]);
});

test("a reference explanation can be reformulated too, next to its level choice", async ({
  page,
}) => {
  const errors = trackConsole(page, [/Failed to load resource.*503/]);
  const posts = trackPosts(page);
  const entries = (await (await page.request.get("/api/reference?language=fr")).json()) as {
    slug: string;
    explanation_id: string;
  }[];
  const reference = entries.find((entry) => entry.slug === CONCEPT);
  expect(reference).toBeDefined();

  await page.route("**/api/explanations", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 503,
      json: { error: { code: "generation_unavailable", message: "" } },
    });
  });
  await page.goto(`/fr/e/${reference?.explanation_id}`);
  await expect(sectionTitle(page)).toBeVisible({ timeout: GENERATION_MS });
  await expect(page.locator('[data-slot="level-choice"]')).toHaveCount(1);
  await expect(choice(page, "zoom")).toBeEnabled();

  await choice(page, "simpler").click();
  await expect(
    page.getByRole("alert").filter({ hasText: message("Ask.errors.generationUnavailable") }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ mode: "simpler", parent_id: reference?.explanation_id });
  expect(idOf(page)).toBe(reference?.explanation_id);
  await expect(sceneButtons(page)).toHaveCount(6);
  expect(errors).toEqual([]);
});
