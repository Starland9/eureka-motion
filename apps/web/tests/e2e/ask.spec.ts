import { expect, test, type Locator, type Page } from "@playwright/test";

const QUESTION = "la loi de la gravité";
const UNKNOWN_QUESTION = "un sujet que le simulateur ne connaît pas";
const RULER = "Position dans l’explication";
const COLOPHON = /Comment cette explication a été construite/;
const FEEDBACK_MS = 1000;
const SCENE_COUNT = 6;

// Questions are rate limited per address: each worker is its own visitor.
const octet = (): number => 1 + Math.floor(Math.random() * 254);
const VISITOR = `10.${octet()}.${octet()}.${octet()}`;

test.use({ extraHTTPHeaders: { "X-Forwarded-For": VISITOR } });

// React logs this in development only, from the playback loop of @remotion/player, whenever
// the player is running.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;

function trackConsole(page: Page, ignore: RegExp[] = []): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (KNOWN_DEV_WARNING.test(text) || ignore.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  return errors;
}

async function ask(page: Page, question: string): Promise<void> {
  await page.goto("/fr");
  await page.getByRole("textbox", { name: "Je n’ai pas compris" }).fill(question);
  await page.keyboard.press("Enter");
}

async function startExplanation(page: Page): Promise<void> {
  await ask(page, QUESTION);
  await expect(page).toHaveURL(/\/fr\/e\/[a-z0-9]+$/);
  await expect(ruler(page)).toBeVisible();
}

function ruler(page: Page): Locator {
  return page.getByRole("slider", { name: RULER });
}

async function position(page: Page): Promise<number> {
  return Number(await ruler(page).getAttribute("aria-valuenow"));
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 120; presses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("the keyboard never reached the control");
}

test("a first explanation takes two actions and plays by itself", async ({ page }) => {
  const errors = trackConsole(page);

  const actions = [
    () => page.getByRole("textbox", { name: "Je n’ai pas compris" }).fill(QUESTION),
    () => page.keyboard.press("Enter"),
  ];
  await page.goto("/fr");
  for (const action of actions) await action();
  expect(actions, "SC-005: typing the question and submitting it").toHaveLength(2);

  const pending = page.getByRole("status").filter({ hasText: "Je prépare l’explication" });
  const explanationPage = page.getByRole("link", { name: "Nouvelle question" });
  await expect(pending.or(explanationPage).first()).toBeVisible({ timeout: FEEDBACK_MS });

  await expect(page).toHaveURL(/\/fr\/e\/[a-z0-9]+$/);
  await expect(page.locator("main#content .__remotion-player")).toBeVisible();
  await expect(ruler(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await expect.poll(() => position(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Lire l’explication/ })).toHaveCount(0);

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("pause, scene change, sound and colophon obey", async ({ page }) => {
  const errors = trackConsole(page);
  await startExplanation(page);
  await expect.poll(() => position(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Lecture" })).toBeVisible();
  const paused = await position(page);
  await page.waitForTimeout(1200);
  expect(await position(page)).toBe(paused);

  const scenes = page.getByRole("list", { name: "Scènes" }).getByRole("button");
  await expect(scenes).toHaveCount(SCENE_COUNT);
  const caption = page.locator("[data-slot=figure-caption]");
  const before = await caption.textContent();
  await scenes.nth(2).click();
  await expect(scenes.nth(2)).toHaveAttribute("aria-current", "true");
  await expect(scenes.nth(0)).not.toHaveAttribute("aria-current", "true");
  await expect(caption).not.toHaveText(before ?? "");
  await expect(caption).toContainText("03");

  const sound = page.getByRole("button", { name: "Son", exact: true });
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("m");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");

  const colophon = page.getByRole("button", { name: COLOPHON });
  await expect(colophon).toHaveAttribute("aria-expanded", "false");
  await tabTo(page, colophon);
  await page.keyboard.press("Enter");
  await expect(colophon).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("li[data-verdict]:not([data-verdict=plan])")).toHaveCount(SCENE_COUNT);
  await expect(page.locator("li[data-verdict=plan]")).toHaveCount(1);

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("a page opened from a link waits for a press", async ({ page }) => {
  const errors = trackConsole(page);
  await startExplanation(page);
  await expect.poll(() => position(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

  await page.reload();
  const play = page.getByRole("button", { name: /Lire l’explication/ });
  await expect(play).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(await position(page)).toBe(0);
  await expect(page.getByRole("button", { name: "Lecture" })).toBeVisible();

  await play.click();
  await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await expect(play).toHaveCount(0);

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("an unknown explanation shows the missing state with a link home", async ({ page }) => {
  // React logs the script of the theme in development on any 404 page, Next's own included.
  const errors = trackConsole(page, [/Failed to load resource.*404/, /Encountered a script tag/]);
  await page.goto("/fr/e/doesnotexist1");

  const home = page.getByRole("link", { name: /Poser ma propre question/ });
  await expect(home).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Cette explication n’existe pas, ou le lien est incomplet."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await home.click();
  await expect(page).toHaveURL(/\/fr$/);

  expect(errors).toEqual([]);
});

test("a question the provider does not know shows the failure and a retry", async ({ page }) => {
  const errors = trackConsole(page);
  await ask(page, UNKNOWN_QUESTION);

  await expect(page).toHaveURL(/\/fr\/e\/[a-z0-9]+$/);
  await expect(page.getByText("La génération est momentanément indisponible")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeEnabled();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(UNKNOWN_QUESTION);

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});
