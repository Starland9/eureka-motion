import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

// Every POST /api/explanations is answered here, never forwarded: the server behind this page
// has a real provider, and a level different from the reference would be a real generation.
const BASE = "http://localhost:3000";
const OUT = ".snapshots/level-change";
const NEW_ID = "kkkkkkkkkkk2";
const SIZES = [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "360", width: 360, height: 740, phone: true },
] as const;
const THEMES = ["paper", "board"] as const;

type Size = (typeof SIZES)[number];
type Theme = (typeof THEMES)[number];
interface Block {
  id: number;
  name: string;
  data: Record<string, unknown>;
}
interface Post {
  body: { question: string; language: string; level: string };
  language: string | undefined;
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

function encode(blocks: readonly Block[]): string {
  return blocks
    .map(({ id, name, data }) => `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

function decode(text: string): Block[] {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.includes("event:"))
    .map((chunk) => ({
      id: Number(/^id: (\d+)$/m.exec(chunk)?.[1] ?? 0),
      name: /^event: (.+)$/m.exec(chunk)?.[1] ?? "",
      data: JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? "{}") as Record<string, unknown>,
    }));
}

const reference = (await (await fetch(`${BASE}/api/reference?language=fr`)).json()) as {
  explanation_id: string;
  title: string;
}[];
const REF = reference.find((entry) => entry.title === "La gravitation universelle")!;
const referenceRecord = (await (
  await fetch(`${BASE}/api/explanations/${REF.explanation_id}`)
).json()) as Record<string, unknown>;
const referenceBlocks = decode(
  await (await fetch(`${BASE}/api/explanations/${REF.explanation_id}/events?after=0`)).text(),
);
const newBlocks: Block[] = referenceBlocks.map((block) => {
  if (block.name === "accepted") {
    return { ...block, data: { explanation_id: NEW_ID, cached: false } };
  }
  if (block.name === "done")
    return { ...block, data: { status: "ready", share_url: `/fr/e/${NEW_ID}` } };
  return block;
});
const FIRST_BODY = newBlocks.slice(0, 5);
const SCENES_IN_FIRST_BODY = FIRST_BODY.filter((block) => block.name === "scene").length;
const TOTAL_SCENES = referenceBlocks.filter((block) => block.name === "scene").length;

interface Mock {
  posts: Post[];
  onPost: (route: Route, count: number) => Promise<void>;
  release: () => void;
  gate: Promise<void>;
}

function createMock(): Mock {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    posts: [],
    onPost: (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "generation_unavailable", message: "" } },
      }),
    release,
    gate,
  };
}

async function install(context: BrowserContext, mock: Mock): Promise<void> {
  await context.route("**/api/explanations", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    mock.posts.push({
      body: request.postDataJSON() as Post["body"],
      language: request.headers()["accept-language"],
    });
    return mock.onPost(route, mock.posts.length).catch(() => undefined);
  });
  await context.route(`**/api/explanations/${NEW_ID}/events*`, async (route) => {
    await mock.gate;
    const after = Number(new URL(route.request().url()).searchParams.get("after") ?? 0);
    await route
      .fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: encode(newBlocks.filter((block) => block.id > after)),
      })
      .catch(() => undefined);
  });
  await context.route(`**/api/explanations/${NEW_ID}`, (route) =>
    route.fulfill({
      json: { ...referenceRecord, id: NEW_ID, kind: "initial", question: null, level: "college" },
    }),
  );
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
  const mock = createMock();
  await install(context, mock);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource")) return;
    errors.push(message.text());
  });
  await page.goto(`${BASE}/fr/e/${REF.explanation_id}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("slider", { name: "Position dans l’explication" })
    .waitFor({ timeout: 15000 });
  let probe = 0;
  for (let attempt = 0; attempt < 3 && probe === 0; attempt += 1) {
    try {
      probe = await page.evaluate(
        async () => (await fetch("/api/explanations", { method: "POST", body: "{}" })).status,
      );
    } catch {
      await page.waitForLoadState("load");
    }
  }
  if (probe !== 503 || mock.posts.length === 0) {
    console.log("FAIL  the interception of POST /api/explanations is not active, stopping");
    process.exit(2);
  }
  mock.posts.length = 0;
  return { context, page, mock };
}

const choice = (page: Page) => page.locator('[data-slot="level-choice"]');
const status = (page: Page) => choice(page).locator('[role="status"]');
const alert = (page: Page) => choice(page).locator('[role="alert"]');
const pick = (page: Page, level: string) => choice(page).locator("button", { hasText: level });

async function position(page: Page): Promise<number> {
  const slider = page.getByRole("slider", { name: "Position dans l’explication" });
  return Number(await slider.getAttribute("aria-valuenow"));
}

async function text(locator: ReturnType<typeof status>): Promise<string> {
  return ((await locator.innerText()) ?? "").replace(/\s+/g, " ").trim();
}

async function waitFor(what: string, condition: () => Promise<boolean>, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  check(false, `timeout: ${what}`);
  return false;
}

async function shoot(page: Page, size: Size, theme: Theme, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(horizontal <= 0, `${name} ${size.name} ${theme}: no horizontal overflow`, horizontal);
  const group = choice(page);
  if ((await group.count()) > 0) await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}-${size.name}-${theme}.png` });
}

async function partialBody(route: Route, delayMs: number): Promise<void> {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  await route.fulfill({ status: 200, contentType: "text/event-stream", body: encode(FIRST_BODY) });
}

async function levelFlow(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  const { context, page, mock } = await open(browser, size, theme);
  try {
    const buttons = choice(page).getByRole("button");
    check((await buttons.count()) === 3, `${tag}: three levels are offered as buttons`);
    check(
      (await choice(page).locator('input, [type="radio"]').count()) === 0,
      `${tag}: no radio button, so no arrow key selects a level`,
    );
    check(
      (await choice(page).getByRole("group", { name: "Expliquer à un autre niveau" }).count()) ===
        1,
      `${tag}: the buttons form a group named by its legend`,
    );
    const labels = (await buttons.allInnerTexts()).map((label) =>
      label.replace(/\s+/g, " ").trim(),
    );
    check(
      labels.join("|") === "COLLÈGE|LYCÉE [RÉFÉRENCE]|SUPÉRIEUR" ||
        labels.join("|") === "Collège|Lycée [Référence]|Supérieur",
      `${tag}: the level of the reference is marked`,
      labels,
    );
    const pressed = () =>
      buttons.evaluateAll((all) => all.map((b) => b.getAttribute("aria-pressed")));
    check(
      (await pressed()).join() === "false,true,false",
      `${tag}: the reference level is the pressed one`,
      await pressed(),
    );
    await shoot(page, size, theme, "base");

    const active = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    await pick(page, "Lycée").focus();
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(400);
    check(mock.posts.length === 0, `${tag}: the arrow keys send no request`, mock.posts.length);
    check(
      (await pressed()).join() === "false,true,false" && /Lycée/i.test(await active()),
      `${tag}: the arrow keys neither select nor move the focus`,
      { pressed: await pressed(), active: await active() },
    );
    await pick(page, "Collège").focus();
    await page.keyboard.press("Tab");
    check(/Lycée/i.test(await active()), `${tag}: Tab goes from the first button to the second`);
    await page.keyboard.press("Tab");
    check(/Supérieur/i.test(await active()), `${tag}: Tab goes on to the third button`);
    check(mock.posts.length === 0, `${tag}: Tab sends no request`);
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.getByRole("button", { name: "Lecture", exact: true }).click();
    await waitFor("playback starts", async () => (await position(page)) > 0);
    const started = await position(page);

    mock.onPost = (route) => partialBody(route, 3000);
    await pick(page, "Collège").focus();
    await page.keyboard.press("Enter");
    await waitFor("one POST", async () => mock.posts.length === 1);
    check(
      (await pressed()).join() === "true,false,false",
      `${tag}: Enter on a focused button sends the request and presses it`,
      await pressed(),
    );
    check(
      JSON.stringify(mock.posts[0]?.body) ===
        JSON.stringify({ question: "la loi de la gravité", language: "fr", level: "college" }),
      `${tag}: the POST carries the question, the language and the level chosen`,
      mock.posts[0],
    );
    check(
      mock.posts[0]?.language === "fr",
      `${tag}: the POST asks in the language of the explanation`,
    );
    check(
      (await text(status(page))) === "Préparation au niveau Collège…",
      `${tag}: a status line says the level is being prepared`,
      await text(status(page)),
    );
    check(
      (await page.getByRole("button", { name: "Pause", exact: true }).count()) === 1,
      `${tag}: the reference keeps playing while the request is sent`,
    );
    await shoot(page, size, theme, "pending");

    await waitFor("progress shows", async () =>
      (await text(status(page))).includes(`${SCENES_IN_FIRST_BODY} sur ${TOTAL_SCENES} scènes`),
    );
    const line = await text(status(page));
    check(
      line.startsWith(
        `Préparation au niveau Collège : ${SCENES_IN_FIRST_BODY} sur ${TOTAL_SCENES} scènes…`,
      ),
      `${tag}: the progress in scenes is shown`,
      line,
    );
    const link = status(page).getByRole("link", { name: "Ouvrir au niveau Collège →" });
    check((await link.count()) === 1, `${tag}: the link appears once a scene exists`);
    check(
      (await link.getAttribute("href")) === `/fr/e/${NEW_ID}`,
      `${tag}: the link leads to the new explanation`,
      await link.getAttribute("href"),
    );
    const moved = await position(page);
    check(moved > started, `${tag}: the reference kept playing (${started} to ${moved})`);
    check(
      page.url().endsWith(`/fr/e/${REF.explanation_id}`),
      `${tag}: the page is still the reference`,
    );
    await shoot(page, size, theme, "progress");

    await pick(page, "Lycée").click();
    await page.waitForTimeout(300);
    check(mock.posts.length === 1, `${tag}: choosing the level of the reference sends nothing`);
    check(
      (await text(status(page))).startsWith("Préparation au niveau Collège"),
      `${tag}: the preparation in progress stays displayed`,
    );

    mock.onPost = async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 503,
        json: { error: { code: "generation_unavailable", message: "" } },
      });
    };
    await pick(page, "Supérieur").focus();
    await page.keyboard.press("Space");
    await waitFor("second POST", async () => mock.posts.length === 2);
    check(mock.posts[1]?.body.level === "superieur", `${tag}: the second request is the new level`);
    const replaced = await text(status(page));
    check(
      replaced === "Préparation au niveau Supérieur…" &&
        (await status(page).getByRole("link").count()) === 0,
      `${tag}: the second request replaces the first in the display`,
      replaced,
    );
    await shoot(page, size, theme, "replaced");

    await waitFor("refusal shows", async () => (await alert(page).innerText()).trim() !== "");
    const unavailable = (await text(alert(page))).replace(/\s+/g, " ");
    check(
      unavailable.startsWith("La génération est momentanément indisponible."),
      `${tag}: generation unavailable is explained`,
      unavailable,
    );
    check((await text(status(page))) === "", `${tag}: the status line is empty after a refusal`);
    check(
      (await page.getByRole("button", { name: "Pause", exact: true }).count()) === 1,
      `${tag}: the reference still plays after a refusal`,
    );
    await shoot(page, size, theme, "unavailable");

    mock.onPost = (route) =>
      route.fulfill({
        status: 429,
        headers: { "Retry-After": "42" },
        json: { error: { code: "rate_limited", message: "" } },
      });
    await pick(page, "Collège").click();
    await waitFor("rate limit shows", async () => (await text(alert(page))).includes("42"));
    check(
      (await text(alert(page))).includes("42 secondes"),
      `${tag}: the rate limit tells how long to wait`,
      await text(alert(page)),
    );
    await shoot(page, size, theme, "rate-limited");

    mock.onPost = (route) => route.abort("failed");
    await pick(page, "Supérieur").click();
    await waitFor("network error shows", async () =>
      (await text(alert(page))).includes("connexion"),
    );
    check(
      (await text(alert(page))).startsWith("L’explication n’a pas pu démarrer."),
      `${tag}: an unreachable server is explained`,
      await text(alert(page)),
    );

    const pause = page.getByRole("button", { name: "Pause", exact: true });
    check((await pause.count()) === 1, `${tag}: the player controls are still active`);
    await pause.click();
    check(
      (await page.getByRole("button", { name: "Lecture", exact: true }).count()) === 1,
      `${tag}: pausing still works after the requests`,
    );
    check(
      mock.posts.length === 4,
      `${tag}: four requests were sent, all intercepted`,
      mock.posts.length,
    );
  } finally {
    await context.close();
  }
}

async function openFlow(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  const { context, page, mock } = await open(browser, size, theme);
  try {
    mock.onPost = (route) => partialBody(route, 0);
    await pick(page, "Collège").click();
    await waitFor("link", async () => (await status(page).getByRole("link").count()) === 1);
    mock.release();
    await waitFor("ready", async () => (await text(status(page))).includes("est prête"));
    const ready = await text(status(page));
    check(
      ready === "L’explication au niveau Collège est prête. Ouvrir au niveau Collège →",
      `${tag}: the status says the explanation is ready`,
      ready,
    );
    await shoot(page, size, theme, "ready");

    await status(page).getByRole("link").click();
    await page.waitForURL(`**/fr/e/${NEW_ID}`);
    await page
      .getByRole("slider", { name: "Position dans l’explication" })
      .waitFor({ timeout: 15000 });
    check(
      (await choice(page).count()) === 0,
      `${tag}: no level choice on an explanation that is not a reference`,
    );
    await shoot(page, size, theme, "opened");
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    await levelFlow(browser, size, "paper");
    for (const theme of THEMES) await openFlow(browser, size, theme);
  }
} finally {
  await browser.close();
}

check(errors.length === 0, "no page error in the console", errors);
if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
