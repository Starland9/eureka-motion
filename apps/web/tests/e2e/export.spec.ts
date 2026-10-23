import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

interface Messages {
  [key: string]: Messages | string;
}

interface JobReply {
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  result_url?: string;
}

interface Simulation {
  posts: number;
  polls: number[];
}

const CONCEPT = "physics/universal-gravitation";
const JOB = "7b0e1d52-3a54-4c1e-9d3c-0f6c5a1b2e11";
const NEXT_JOB = "c8a2f1d0-5b61-4f1c-8e2a-9d4b7c3a1f22";
const POLL_MS = 2000;
const PAGE_MS = 60_000;

// React logs this in development only, from the playback loop of @remotion/player.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;
const SIMULATED_429 = /Failed to load resource.*429/;

test.describe.configure({ timeout: 2 * PAGE_MS });

function loadMessages(): Messages {
  const dir = path.join(__dirname, "../../messages/fr");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  return Object.assign(
    {},
    ...files.map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Messages),
  );
}

const MESSAGES = loadMessages();

function message(key: string, values: Readonly<Record<string, string | number>> = {}): string {
  let node: Messages | string | undefined = MESSAGES;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`No message ${key} in fr`);
  return node
    .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, name, one, other) => {
      const count = Number(values[name]);
      return (count === 1 ? one : other).replace("#", String(count));
    })
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
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

const action = (page: Page): Locator =>
  page.getByRole("button", { name: message("Export.action"), exact: true });
const cancel = (page: Page): Locator =>
  page.getByRole("button", { name: message("Export.cancel"), exact: true });
const retry = (page: Page): Locator =>
  page.getByRole("button", { name: message("Export.retry"), exact: true });
const download = (page: Page): Locator =>
  page.getByRole("link", { name: message("Export.download"), exact: true });
const progress = (page: Page): Locator =>
  page.getByRole("progressbar", { name: message("Export.progress.label"), exact: true });
const block = (page: Page): Locator => page.locator('[data-slot="export"]');
const exportStatus = (page: Page): Locator => block(page).getByRole("status");
const exportAlert = (page: Page): Locator => block(page).getByRole("alert");
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

function health(renderWorker: boolean) {
  return {
    status: renderWorker ? "ok" : "degraded",
    checks: {
      database: true,
      generation: true,
      voice: true,
      render_worker: renderWorker,
      deep_worker: renderWorker,
    },
  };
}

interface Plan {
  renderWorker?: boolean;
  jobs?: JobReply[][];
  post?: (attempt: number) => { status: number; headers?: Record<string, string> } | null;
}

// Every request the export makes is answered here: nothing reaches the render worker.
async function simulate(page: Page, id: string, plan: Plan = {}): Promise<Simulation> {
  const simulation: Simulation = { posts: 0, polls: [] };
  const ids = [JOB, NEXT_JOB];
  let current = 0;
  const jobs = plan.jobs ?? [[{ status: "queued", progress: 0 }]];

  await page.route("**/api/health", (route) =>
    route.fulfill({ json: health(plan.renderWorker ?? true) }),
  );
  await page.route(`**/api/explanations/${id}/export`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    simulation.posts += 1;
    current = Math.min(simulation.posts, ids.length) - 1;
    const refusal = plan.post?.(simulation.posts) ?? null;
    if (refusal !== null) {
      return route.fulfill({
        status: refusal.status,
        headers: refusal.headers ?? {},
        json: { error: { code: "simulated", message: "simulated" } },
      });
    }
    return route.fulfill({ json: { job_id: ids[current], status: "queued" } });
  });
  const seen = new Map<string, number>();
  await page.route("**/api/jobs/*", (route: Route) => {
    const jobId = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    simulation.polls.push(Date.now());
    const script = jobs[Math.min(ids.indexOf(jobId), jobs.length - 1)] ?? [];
    const index = seen.get(jobId) ?? 0;
    seen.set(jobId, index + 1);
    const reply = script[Math.min(index, script.length - 1)] ?? { status: "queued", progress: 0 };
    return route.fulfill({
      json: {
        id: jobId,
        type: "export",
        status: reply.status,
        progress: reply.progress,
        result_url: reply.result_url ?? null,
      },
    });
  });
  return simulation;
}

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/fr/e/${id}`);
  await expect(ruler(page)).toBeVisible({ timeout: PAGE_MS });
}

test("the student follows the preparation of the video and downloads it", async ({ page }) => {
  const errors = trackConsole(page);
  const id = await referenceId(page);
  const result = `/media/${id}/export-simulated.mp4`;
  const simulation = await simulate(page, id, {
    jobs: [
      [
        { status: "queued", progress: 0 },
        { status: "running", progress: 10 },
        { status: "running", progress: 60 },
        { status: "succeeded", progress: 100, result_url: result },
      ],
    ],
  });

  await open(page, id);
  await expect(action(page)).toBeVisible();
  await action(page).scrollIntoViewIfNeeded();

  await test.step("nothing is asked before the student acts, and the action is a 44 px target", async () => {
    const box = await action(page).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await expect(exportStatus(page)).toHaveText("");
    await expect(progress(page)).toHaveCount(0);
    await page.waitForTimeout(POLL_MS + 500);
    expect(simulation.posts).toBe(0);
    expect(simulation.polls).toHaveLength(0);
  });

  await test.step("the rule fills as the job moves on, and the page stays usable", async () => {
    await action(page).click();
    await expect(progress(page)).toBeVisible();
    await expect(cancel(page)).toBeFocused();
    expect(simulation.posts).toBe(1);

    await expect(progress(page)).toHaveAttribute("aria-valuenow", "10", { timeout: 6000 });
    await expect(block(page)).toContainText(message("Export.progress.text", { percent: 10 }));
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "60", { timeout: 6000 });
    await expect(block(page)).toContainText(message("Export.progress.text", { percent: 60 }));
    await expect(exportAlert(page)).toHaveText("");
    await expect(
      page.getByRole("button", { name: message("Transport.play"), exact: true }),
    ).toBeEnabled();
    await expectNoOverflow(page);
  });

  await test.step("the link appears, points to the file and is announced", async () => {
    await expect(download(page)).toBeVisible({ timeout: 6000 });
    await expect(download(page)).toHaveAttribute("href", result);
    await expect(download(page)).toHaveAttribute("download", "la-gravitation-universelle.mp4");
    await expect(exportStatus(page)).toHaveText(message("Export.ready"));
    await expect(progress(page)).toHaveCount(0);
    await expect(cancel(page)).toHaveCount(0);
    await expect(download(page)).toBeFocused();
    const box = await download(page).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await expectNoOverflow(page);
  });

  await test.step("the job is read about every 2 seconds, and no more once it is done", async () => {
    expect(simulation.polls).toHaveLength(4);
    const gaps = simulation.polls.slice(1).map((time, index) => time - simulation.polls[index]!);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(POLL_MS - 200);
    await page.waitForTimeout(POLL_MS + 1000);
    expect(simulation.polls).toHaveLength(4);
    expect(simulation.posts).toBe(1);
  });

  expect(errors).toEqual([]);
});

test("cancelling stops the follow-up; asking again finds the job again", async ({ page }) => {
  const errors = trackConsole(page);
  const id = await referenceId(page);
  const simulation = await simulate(page, id, { jobs: [[{ status: "running", progress: 10 }]] });

  await open(page, id);
  await action(page).click();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "10");
  await expect.poll(() => simulation.polls.length, { timeout: 6000 }).toBeGreaterThanOrEqual(2);

  await cancel(page).click();
  await expect(progress(page)).toHaveCount(0);
  await expect(exportStatus(page)).toHaveText(message("Export.progress.cancelled"));
  await expect(action(page)).toBeFocused();
  const stopped = simulation.polls.length;
  await page.waitForTimeout(2 * POLL_MS + 500);
  expect(simulation.polls).toHaveLength(stopped);
  await expectNoOverflow(page);

  await action(page).click();
  await expect(cancel(page)).toBeVisible();
  expect(simulation.posts).toBe(2);
  await expect.poll(() => simulation.polls.length, { timeout: 6000 }).toBeGreaterThan(stopped);

  expect(errors).toEqual([]);
});

test("a failed job says so in plain words and can be tried again", async ({ page }) => {
  const errors = trackConsole(page);
  const id = await referenceId(page);
  const result = `/media/${id}/export-simulated.mp4`;
  const simulation = await simulate(page, id, {
    jobs: [
      [
        { status: "running", progress: 20 },
        { status: "failed", progress: 20 },
      ],
      [{ status: "succeeded", progress: 100, result_url: result }],
    ],
  });

  await open(page, id);
  await action(page).click();

  await expect(exportAlert(page)).toHaveText(message("Export.errors.failed"), { timeout: 6000 });
  await expect(retry(page)).toBeVisible();
  await expect(retry(page)).toBeFocused();
  await expect(progress(page)).toHaveCount(0);
  const box = await retry(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expectNoOverflow(page);
  const polled = simulation.polls.length;
  await page.waitForTimeout(POLL_MS + 500);
  expect(simulation.polls).toHaveLength(polled);

  await retry(page).click();
  await expect(download(page)).toHaveAttribute("href", result);
  await expect(exportAlert(page)).toHaveText("");
  expect(simulation.posts).toBe(2);

  expect(errors).toEqual([]);
});

test("the limit is told with its delay, without any technical text", async ({ page }) => {
  const errors = trackConsole(page, [SIMULATED_429]);
  const id = await referenceId(page);
  const simulation = await simulate(page, id, {
    post: (attempt) => (attempt === 1 ? { status: 429, headers: { "Retry-After": "45" } } : null),
  });

  await open(page, id);
  await action(page).click();

  await expect(exportAlert(page)).toHaveText(
    message("Export.errors.rateLimitedSeconds", { seconds: 45 }),
  );
  await expect(retry(page)).toBeVisible();
  expect(simulation.polls).toHaveLength(0);

  await retry(page).click();
  await expect(progress(page)).toBeVisible();
  await expect(exportAlert(page)).toHaveText("");

  expect(errors).toEqual([]);
});

test("without the render worker there is no action, only a discreet line", async ({ page }) => {
  const errors = trackConsole(page);
  const id = await referenceId(page);
  const simulation = await simulate(page, id, { renderWorker: false });

  await open(page, id);

  await expect(exportStatus(page)).toHaveText(message("Export.unavailable"));
  await expect(action(page)).toHaveCount(0);
  await expect(block(page).getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: message("Export.unavailable") }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: message("Share.copy"), exact: true }),
  ).toBeVisible();
  await expectNoOverflow(page);
  await page.waitForTimeout(POLL_MS);
  expect(simulation.posts).toBe(0);
  expect(simulation.polls).toHaveLength(0);

  expect(errors).toEqual([]);
});
