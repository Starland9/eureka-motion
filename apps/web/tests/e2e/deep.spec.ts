import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";

interface Messages {
  [key: string]: Messages | string;
}

type Reply = { status: string; result_url?: string } | "network-error";

interface Simulation {
  polls: number[];
  release: () => void;
}

const CONCEPT = "physics/universal-gravitation";
const POLL_MS = 10_000;
const FAILURES = 3;
const PAGE_MS = 60_000;
const ABORT_SETTLE_MS = 250;

// React logs this in development only, from the playback loop of @remotion/player.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;
const SIMULATED_NETWORK_ERROR = /Failed to load resource.*ERR_FAILED/;

test.describe.configure({ timeout: 3 * PAGE_MS });

function loadMessages(): Messages {
  const dir = path.join(__dirname, "../../messages/fr");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  return Object.assign(
    {},
    ...files.map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Messages),
  );
}

const MESSAGES = loadMessages();

function message(key: string): string {
  let node: Messages | string | undefined = MESSAGES;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`No message ${key} in fr`);
  return node;
}

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

const block = (page: Page): Locator => page.locator('[data-slot="deep"]');
const line = (page: Page): Locator => block(page).getByRole("status");
const watch = (page: Page): Locator =>
  page.getByRole("link", { name: message("Deep.watch"), exact: true });
const ruler = (page: Page): Locator =>
  page.getByRole("slider", { name: message("Transport.ruler") });

async function referenceId(page: Page): Promise<string> {
  const response = await page.request.get("/api/reference?language=fr");
  expect(response.ok(), await response.text()).toBe(true);
  const entries = (await response.json()) as { slug: string; explanation_id: string }[];
  const reference = entries.find((entry) => entry.slug === CONCEPT);
  expect(reference).toBeDefined();
  return reference?.explanation_id ?? "";
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// Every read of the deep status is answered here: the first one waits for `release` when asked.
// In development React runs the effects twice and aborts the first read: it is not counted.
async function simulate(
  page: Page,
  id: string,
  replies: Reply[],
  holdFirst = false,
): Promise<Simulation> {
  const polls: number[] = [];
  const aborted = new Set<Request>();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));

  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText.includes("ERR_ABORTED")) aborted.add(request);
  });
  await page.route(`**/api/explanations/${id}/deep`, async (route) => {
    const at = Date.now();
    await new Promise((resolve) => setTimeout(resolve, ABORT_SETTLE_MS));
    if (aborted.has(route.request())) return route.abort().catch(() => undefined);
    const index = polls.length;
    polls.push(at);
    if (index === 0 && holdFirst) await gate;
    const reply = replies[Math.min(index, replies.length - 1)] ?? { status: "none" };
    if (reply === "network-error") return route.abort("failed");
    return route.fulfill({ json: { result_url: null, ...reply } });
  });
  return { polls, release };
}

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/fr/e/${id}`);
  await expect(ruler(page)).toBeVisible({ timeout: PAGE_MS });
}

const top = (locator: Locator): Promise<number> =>
  locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);

async function layoutOf(page: Page) {
  const level = page.locator('[data-slot="level-choice"]');
  return {
    scenes: await top(page.locator('[data-slot="scene-list"]')),
    level: (await level.count()) === 0 ? null : await top(level),
    below: await top(page.locator('[data-slot="reformulate"], [data-slot="visitor-ask"]').first()),
  };
}

async function expectNoTrace(page: Page): Promise<void> {
  await expect(block(page)).toHaveCount(0);
  await expect(watch(page)).toHaveCount(0);
  await expect(page.locator('[role="alert"]:not(:empty)')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/approfondie|in-depth/i);
}

test("the margin line shows while the work is under way, then becomes the link, nothing moving", async ({
  page,
}) => {
  const errors = trackConsole(page);
  const id = await referenceId(page);
  const result = `/media/${id}/deep-simulated.mp4`;
  const simulation = await simulate(
    page,
    id,
    [{ status: "queued" }, { status: "ready", result_url: result }],
    true,
  );
  await page
    .context()
    .route(`**/media/${id}/deep-simulated.mp4`, (route) =>
      route.fulfill({ status: 200, contentType: "video/mp4", body: "" }),
    );

  await open(page, id);
  const before = await layoutOf(page);
  let released = 0;
  await expect(block(page)).toHaveCount(0);

  await test.step("the single read at mount shows the line in the margin, in capitals", async () => {
    await expect.poll(() => simulation.polls.length).toBe(1);
    released = Date.now();
    simulation.release();
    await expect(block(page)).toBeVisible();
    await expect(line(page)).toHaveText(message("Deep.preparing"));
    await expect(line(page)).toHaveText(message("Deep.preparing").toUpperCase(), {
      useInnerText: true,
    });
    await expect(watch(page)).toHaveCount(0);
    await expect(block(page).getByRole("alert")).toHaveCount(0);
    const style = await line(page).evaluate((element) => {
      const { textTransform, fontFamily } = getComputedStyle(element);
      return { textTransform, fontFamily };
    });
    expect(style.textTransform).toBe("uppercase");
    expect(style.fontFamily).toMatch(/mono/i);

    const after = await layoutOf(page);
    expect(after.scenes).toBeCloseTo(before.scenes, 0);
    expect(after.level).toEqual(before.level);
    await expectNoOverflow(page);
  });

  const preparing = await layoutOf(page);
  const lineBox = await block(page).boundingBox();

  await test.step("ten seconds later it turns into the link, announced once, without a jump", async () => {
    await expect(watch(page)).toBeVisible({ timeout: POLL_MS + 5000 });
    await expect(watch(page)).toHaveAttribute("href", result);
    await expect(watch(page)).toHaveAttribute("target", "_blank");
    await expect(watch(page)).toHaveAttribute("rel", /noopener/);
    await expect(line(page)).toHaveText(message("Deep.ready"));
    await expect(block(page)).not.toContainText(message("Deep.preparing"));
    const box = await watch(page).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    expect(simulation.polls).toHaveLength(2);
    expect(simulation.polls[1]! - released).toBeGreaterThanOrEqual(POLL_MS - 200);

    const ready = await layoutOf(page);
    expect(ready).toEqual(preparing);
    const readyBox = await block(page).boundingBox();
    expect(readyBox?.y).toBeCloseTo(lineBox?.y ?? 0, 0);
    expect(readyBox?.height).toBeCloseTo(lineBox?.height ?? 0, 0);
    await expectNoOverflow(page);
  });

  await test.step("the link opens the video in another tab, without the opener", async () => {
    const [popup] = await Promise.all([page.waitForEvent("popup"), watch(page).click()]);
    expect(new URL(popup.url()).pathname).toBe(result);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await expect(ruler(page)).toBeVisible();
  });

  await test.step("once ready, the status is read no more", async () => {
    await page.waitForTimeout(POLL_MS + 1000);
    expect(simulation.polls).toHaveLength(2);
  });

  expect(errors).toEqual([]);
});

test("an abandoned job removes the line without a trace", async ({ page }) => {
  const errors = trackConsole(page);
  const id = await referenceId(page);
  const simulation = await simulate(page, id, [{ status: "running" }, { status: "abandoned" }]);

  await open(page, id);
  await expect(line(page)).toHaveText(message("Deep.preparing"));

  await expect(block(page)).toHaveCount(0, { timeout: POLL_MS + 5000 });
  await expectNoTrace(page);
  expect(simulation.polls).toHaveLength(2);
  await page.waitForTimeout(1500);
  expect(simulation.polls).toHaveLength(2);
  await expectNoOverflow(page);

  expect(errors).toEqual([]);
});

test("without any deep version nothing is shown, reserved or read again", async ({ page }) => {
  const errors = trackConsole(page);
  const id = await referenceId(page);
  const simulation = await simulate(page, id, [{ status: "none" }], true);

  await open(page, id);
  const before = await layoutOf(page);
  simulation.release();
  await expect.poll(() => simulation.polls.length).toBe(1);
  await page.waitForTimeout(500);

  await expectNoTrace(page);
  expect(await layoutOf(page)).toEqual(before);

  await page.waitForTimeout(POLL_MS + 1000);
  expect(simulation.polls).toHaveLength(1);
  await expectNoTrace(page);

  expect(errors).toEqual([]);
});

test("an abandoned status found at the first read leaves no trace either", async ({ page }) => {
  const errors = trackConsole(page);
  const id = await referenceId(page);
  const simulation = await simulate(page, id, [{ status: "abandoned" }]);

  await open(page, id);
  await expect.poll(() => simulation.polls.length).toBe(1);
  await page.waitForTimeout(500);

  await expectNoTrace(page);
  expect(errors).toEqual([]);
});

test("a read that cannot be made at mount shows nothing and is not tried again", async ({
  page,
}) => {
  const errors = trackConsole(page, [SIMULATED_NETWORK_ERROR]);
  const id = await referenceId(page);
  const simulation = await simulate(page, id, ["network-error"]);

  await open(page, id);
  await expect.poll(() => simulation.polls.length).toBe(1);
  await page.waitForTimeout(1000);

  await expectNoTrace(page);
  await expect(ruler(page)).toBeVisible();
  expect(simulation.polls).toHaveLength(1);

  expect(errors).toEqual([]);
});

test("three failed reads in a row make the line disappear quietly", async ({ page }) => {
  const errors = trackConsole(page, [SIMULATED_NETWORK_ERROR]);
  const id = await referenceId(page);
  const simulation = await simulate(page, id, [{ status: "queued" }, "network-error"]);

  await open(page, id);
  await expect(line(page)).toHaveText(message("Deep.preparing"));

  await test.step("the line stays through the first failures", async () => {
    await expect.poll(() => simulation.polls.length, { timeout: POLL_MS + 5000 }).toBe(2);
    await expect(line(page)).toHaveText(message("Deep.preparing"));
  });

  await test.step("it goes after the third, with no message, and the page stays usable", async () => {
    await expect(block(page)).toHaveCount(0, { timeout: FAILURES * POLL_MS });
    expect(simulation.polls).toHaveLength(1 + FAILURES);
    await expectNoTrace(page);
    await expect(
      page.getByRole("button", { name: message("Transport.play"), exact: true }),
    ).toBeEnabled();
    await page.waitForTimeout(1500);
    expect(simulation.polls).toHaveLength(1 + FAILURES);
    await expectNoOverflow(page);
  });

  expect(errors).toEqual([]);
});
