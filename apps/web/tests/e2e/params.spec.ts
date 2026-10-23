import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

interface Messages {
  [key: string]: Messages | string;
}

interface Param {
  id: string;
  symbol: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

interface Named {
  id: string;
}

interface Model {
  constants: Named[];
  derived: Named[];
}

interface Block {
  event: string;
  data: Record<string, unknown>;
}

interface Reference {
  id: string;
  params: Param[];
  record: { payload: Record<string, unknown> } & Record<string, unknown>;
  stream: Block[];
}

const REFERENCE_SLUG = "physics/universal-gravitation";
const DISTANCE = "r";
const MASS = "m1";
const SCENE_WITH_SIMULATION = 2;
const THUMB_PX = 16;
const SECONDS_PLAYED = 2;
const WARM_UP_MS = 60_000;
const FIGURE = "main#content .__remotion-player";
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

// React logs this in development only, from the playback loop of @remotion/player.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;

test.describe.configure({ timeout: WARM_UP_MS + 30_000 });

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

function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() === "error" && !KNOWN_DEV_WARNING.test(entry.text())) {
      errors.push(entry.text());
    }
  });
  return errors;
}

function parseBlocks(text: string): Block[] {
  return text
    .split(/\r?\n\r?\n/)
    .filter((chunk) => chunk.includes("event:"))
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/);
      const field = (name: string): string =>
        lines
          .find((line) => line.startsWith(`${name}:`))
          ?.slice(name.length + 1)
          .trim() ?? "";
      return { event: field("event"), data: JSON.parse(field("data")) as Block["data"] };
    });
}

function encodeBlocks(blocks: readonly Block[], after: number): string {
  return blocks
    .map((block, index) => ({ block, seq: index + 1 }))
    .filter(({ seq }) => seq > after)
    .map(
      ({ block, seq }) =>
        `id: ${seq}\nevent: ${block.event}\ndata: ${JSON.stringify(block.data)}\n\n`,
    )
    .join("");
}

// The one reference document has quantities: the scenes that read none of them are kept.
function withoutQuantities(blocks: readonly Block[]): Block[] {
  const plan = blocks.find((block) => block.event === "plan")?.data as
    { plan: { steps: unknown[] }; params: Named[]; model: Model } | undefined;
  if (!plan) throw new Error("the event stream has no plan");

  const names = [...plan.params, ...plan.model.constants, ...plan.model.derived].map(
    (item) => item.id,
  );
  const readsQuantity = (scene: unknown): boolean => {
    const json = JSON.stringify(scene);
    if (/\{\{|"param":|"type":"(?:sim\.[\w-]+|readout)"/.test(json)) return true;
    return [...json.matchAll(/"expr":"([^"]*)"/g)].some(([, expr = ""]) =>
      names.some((name) => new RegExp(`\\b${name}\\b`).test(expr)),
    );
  };

  const kept = blocks
    .filter((block) => block.event === "scene")
    .map((block) => block.data as { index: number; scene: Record<string, unknown> })
    .filter(({ scene }) => !readsQuantity(scene))
    .map(({ index }) => index);
  expect(kept.length, "scenes without any quantity").toBeGreaterThan(0);

  const result: Block[] = [];
  for (const block of blocks) {
    const { event, data } = block;
    if (event === "plan") {
      result.push({
        event,
        data: {
          ...data,
          plan: { ...plan.plan, steps: plan.plan.steps.filter((_, index) => kept.includes(index)) },
          params: [],
          model: { constants: [], derived: [] },
          scene_count: kept.length,
        },
      });
    } else if (event === "scene") {
      const { index, scene } = data as { index: number; scene: Record<string, unknown> };
      const position = kept.indexOf(index);
      if (position >= 0)
        result.push({ event, data: { index: position, scene: { ...scene, index: position } } });
    } else if (event === "verdict") {
      const target = String(data["target"]);
      const scene = /^s(\d+)$/.exec(target);
      if (!scene) result.push(block);
      else if (kept.includes(Number(scene[1]) - 1)) {
        result.push({
          event,
          data: { ...data, target: `s${kept.indexOf(Number(scene[1]) - 1) + 1}` },
        });
      }
    } else if (event !== "scene_dropped" && event !== "quiz") {
      result.push(block);
    }
  }
  return result;
}

async function loadReference(request: APIRequestContext): Promise<Reference> {
  const list = await request.get("/api/reference?language=fr");
  expect(list.status()).toBe(200);
  const entries = (await list.json()) as { slug: string; explanation_id: string }[];
  const entry = entries.find((item) => item.slug === REFERENCE_SLUG);
  if (!entry) throw new Error(`no reference explanation ${REFERENCE_SLUG}`);

  const id = entry.explanation_id;
  const record = await request.get(`/api/explanations/${id}`);
  expect(record.status()).toBe(200);
  const stream = await request.get(`/api/explanations/${id}/events?after=0`);
  expect(stream.status()).toBe(200);

  const body = (await record.json()) as Reference["record"];
  return {
    id,
    params: (body.payload["params"] as Param[]) ?? [],
    record: body,
    stream: parseBlocks(await stream.text()),
  };
}

async function serveWithoutQuantities(page: Page, reference: Reference): Promise<number> {
  const stream = withoutQuantities(reference.stream);
  const scenes = stream
    .filter((block) => block.event === "scene")
    .map((block) => block.data["scene"]);
  const plan = stream.find((block) => block.event === "plan")?.data ?? {};

  await page.route(new RegExp(`/api/explanations/${reference.id}$`), (route) =>
    route.fulfill({
      json: {
        ...reference.record,
        payload: {
          ...reference.record.payload,
          plan: plan["plan"],
          params: plan["params"],
          model: plan["model"],
          scenes,
          quiz: null,
        },
        scene_count_planned: scenes.length,
      },
    }),
  );
  await page.route(new RegExp(`/api/explanations/${reference.id}/events(\\?.*)?$`), (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get("after") ?? "0");
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: encodeBlocks(stream, after),
    });
  });
  return scenes.length;
}

function param(reference: Reference, id: string): Param {
  const found = reference.params.find((item) => item.id === id);
  if (!found) throw new Error(`no parameter ${id}`);
  return found;
}

const ruler = (page: Page): Locator =>
  page.getByRole("slider", { name: message("Transport.ruler") });
const rangeOf = (page: Page, item: Param): Locator =>
  page.getByRole("slider", { name: item.label });
const fieldOf = (page: Page, item: Param): Locator =>
  page.getByRole("textbox", { name: item.label });
const results = (page: Page): Locator =>
  page.getByRole("group", { name: message("Params.results.title") }).locator("output");
const scenesOf = (page: Page): Locator =>
  page.getByRole("list", { name: message("Scenes.label"), exact: true });
const playButton = (page: Page): Locator =>
  page.getByRole("button", { name: message("Transport.play"), exact: true });
const pauseButton = (page: Page): Locator =>
  page.getByRole("button", { name: message("Transport.pause"), exact: true });

async function clock(page: Page): Promise<number> {
  return Number(await ruler(page).getAttribute("aria-valuenow"));
}

async function resultText(page: Page): Promise<string> {
  return (await results(page).textContent()) ?? "";
}

async function valueOf(range: Locator): Promise<number> {
  return Number(await range.inputValue());
}

function fractionOf(item: Param, value: number): number {
  return (value - item.min) / (item.max - item.min);
}

async function openReference(page: Page, id: string): Promise<void> {
  await page.goto(`/fr/e/${id}`);
  await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
}

async function openWithQuantities(page: Page, reference: Reference): Promise<void> {
  await openReference(page, reference.id);
  await expect(page.getByRole("heading", { name: message("Params.title") })).toBeVisible();
}

async function playScene(page: Page, index: number): Promise<void> {
  await scenesOf(page).getByRole("button").nth(index).click();
  await expect(scenesOf(page).getByRole("button").nth(index)).toHaveAttribute(
    "aria-current",
    "true",
  );
  const start = await clock(page);
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect.poll(() => clock(page)).toBeGreaterThanOrEqual(start + SECONDS_PLAYED);
}

async function digest(page: Page): Promise<string> {
  const image = await page.locator(FIGURE).screenshot({ animations: "disabled" });
  return createHash("sha1").update(image).digest("hex");
}

async function markFigure(page: Page): Promise<Locator> {
  await page
    .locator(`${FIGURE} svg`)
    .first()
    .evaluate((svg) => svg.setAttribute("data-kept", "1"));
  return page.locator(`${FIGURE} svg[data-kept="1"]`);
}

async function pointerOn(range: Locator, fraction: number): Promise<{ x: number; y: number }> {
  await range.scrollIntoViewIfNeeded();
  const box = await range.boundingBox();
  if (!box) throw new Error("the slider has no box");
  return { x: box.x + THUMB_PX / 2 + fraction * (box.width - THUMB_PX), y: box.y + box.height / 2 };
}

async function clickAt(page: Page, range: Locator, fraction: number): Promise<void> {
  const { x, y } = await pointerOn(range, fraction);
  await page.mouse.click(x, y);
}

async function dragTo(page: Page, range: Locator, from: number, to: number): Promise<void> {
  const start = await pointerOn(range, from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((await pointerOn(range, to)).x, start.y, { steps: 8 });
  await page.mouse.up();
}

function parseScientific(text: string): number {
  const match = /(\d+(?:,\d+)?)\s*×\s*10(⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)/.exec(text);
  if (!match) throw new Error(`no scientific number in "${text}"`);
  const digits = [...(match[2] ?? "")].filter((char) => char !== "⁻");
  const exponent = Number(digits.map((char) => SUPERSCRIPTS.indexOf(char)).join(""));
  return (
    Number((match[1] ?? "").replace(",", ".")) *
    10 ** ((match[2] ?? "").startsWith("⁻") ? -exponent : exponent)
  );
}

async function force(page: Page): Promise<number> {
  return parseScientific(await resultText(page));
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("the parameter panel of the gravitation reference", () => {
  test("shows one slider per quantity with its name, unit, bounds and value", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    const reference = await loadReference(request);
    expect(reference.params.length).toBeGreaterThanOrEqual(1);
    expect(reference.params.length).toBeLessThanOrEqual(4);
    await openWithQuantities(page, reference);

    const heading = await page
      .getByRole("heading", { name: message("Params.title") })
      .boundingBox();
    const player = await page.locator(FIGURE).boundingBox();
    expect(heading?.y ?? 0, "the panel sits below the player").toBeGreaterThan(
      (player?.y ?? 0) + (player?.height ?? 0),
    );
    await expect(page.getByRole("button", { name: message("Params.reset") })).toBeVisible();

    for (const item of reference.params) {
      const range = rangeOf(page, item);
      await expect(range).toHaveCount(1);
      await expect(range).toHaveAttribute("min", String(item.min));
      await expect(range).toHaveAttribute("max", String(item.max));
      await expect(range).toHaveAttribute("step", String(item.step));
      await expect(range).toHaveAttribute("aria-valuetext", new RegExp(`${item.unit}$`));
      expect(Math.abs((await valueOf(range)) - item.default)).toBeLessThanOrEqual(item.step / 2);
      await expect(fieldOf(page, item)).toHaveCount(1);
      await expect(fieldOf(page, item)).not.toHaveValue("");
    }
    await expect(results(page).first()).toBeVisible();

    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });

  test("the mouse sets a slider by click and by drag while the scene plays on", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    const reference = await loadReference(request);
    const distance = param(reference, DISTANCE);
    await openWithQuantities(page, reference);
    await playScene(page, SCENE_WITH_SIMULATION);

    const range = rangeOf(page, distance);
    const field = fieldOf(page, distance);
    const figure = await markFigure(page);
    const before = {
      value: await valueOf(range),
      field: await field.inputValue(),
      result: await resultText(page),
      clock: await clock(page),
    };

    await clickAt(page, range, 0.85);
    await expect.poll(async () => fractionOf(distance, await valueOf(range))).toBeCloseTo(0.85, 1);
    await expect(field).not.toHaveValue(before.field);
    await expect(results(page)).not.toHaveText(before.result);
    await expect(figure).toHaveCount(1);
    expect(await clock(page), "playback did not restart").toBeGreaterThanOrEqual(before.clock);

    const afterClick = { field: await field.inputValue(), result: await resultText(page) };
    await dragTo(page, range, 0.85, 0.2);
    await expect.poll(async () => fractionOf(distance, await valueOf(range))).toBeCloseTo(0.2, 1);
    await expect(field).not.toHaveValue(afterClick.field);
    await expect(results(page)).not.toHaveText(afterClick.result);
    await expect(figure).toHaveCount(1);

    const moved = await clock(page);
    expect(moved).toBeGreaterThanOrEqual(before.clock);
    await expect.poll(() => clock(page)).toBeGreaterThan(moved);
    await expect(pauseButton(page)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("the keyboard sets a slider with the arrows, Home and End", async ({ page, request }) => {
    const errors = trackConsole(page);
    const reference = await loadReference(request);
    const distance = param(reference, DISTANCE);
    await openWithQuantities(page, reference);
    await playScene(page, SCENE_WITH_SIMULATION);
    await pauseButton(page).click();
    await expect(playButton(page)).toBeVisible();

    const range = rangeOf(page, distance);
    const field = fieldOf(page, distance);
    const paused = await clock(page);
    const start = await valueOf(range);
    const startResult = await resultText(page);
    const startForce = await force(page);
    const startField = await field.inputValue();
    const startFigure = await digest(page);

    await range.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Math.abs((await valueOf(range)) - (start + distance.step)))
      .toBeLessThanOrEqual(distance.step / 2);
    await expect(field).not.toHaveValue(startField);
    await expect(results(page)).not.toHaveText(startResult);
    await expect.poll(() => digest(page)).not.toBe(startFigure);

    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => Math.abs((await valueOf(range)) - start))
      .toBeLessThanOrEqual(distance.step / 2);
    expect(Math.abs((await force(page)) / startForce - 1)).toBeLessThan(0.02);

    await page.keyboard.press("End");
    await expect
      .poll(async () => Math.abs((await valueOf(range)) - distance.max))
      .toBeLessThanOrEqual(distance.step / 2);
    const farForce = await force(page);
    await expect(range).toHaveAttribute("aria-valuetext", new RegExp(`${distance.unit}$`));
    const farFigure = await digest(page);
    expect(farFigure).not.toBe(startFigure);

    await page.keyboard.press("Home");
    await expect
      .poll(async () => Math.abs((await valueOf(range)) - distance.min))
      .toBeLessThanOrEqual(distance.step / 2);
    const nearForce = await force(page);
    expect(await digest(page)).not.toBe(farFigure);

    const expected = (distance.max / distance.min) ** 2;
    expect(
      Math.abs(nearForce / farForce / expected - 1),
      "force follows 1 / r squared",
    ).toBeLessThan(0.03);
    expect(await clock(page), "the paused clock did not move").toBe(paused);

    expect(errors).toEqual([]);
  });

  test("the force falls to a quarter when the distance doubles", async ({ page, request }) => {
    const errors = trackConsole(page);
    const reference = await loadReference(request);
    const distance = param(reference, DISTANCE);
    const near = distance.min * 2;
    const far = near * 2;
    expect(far).toBeLessThanOrEqual(distance.max);
    await openWithQuantities(page, reference);

    const range = rangeOf(page, distance);
    const field = fieldOf(page, distance);
    const forces: number[] = [];
    for (const value of [near, far]) {
      await field.fill(String(value));
      await field.press("Enter");
      await expect(range).toHaveValue(String(value));
      forces.push(await force(page));
    }

    const [atNear = 0, atFar = 0] = forces;
    expect(Math.abs(atNear / atFar / 4 - 1)).toBeLessThan(0.03);
    expect(errors).toEqual([]);
  });

  test("reset restores every default value at once", async ({ page, request }) => {
    const errors = trackConsole(page);
    const reference = await loadReference(request);
    const mass = param(reference, MASS);
    const distance = param(reference, DISTANCE);
    await openWithQuantities(page, reference);
    await playScene(page, SCENE_WITH_SIMULATION);
    const figure = await markFigure(page);

    const initial = new Map<string, { range: string; field: string }>();
    for (const item of reference.params) {
      initial.set(item.id, {
        range: await rangeOf(page, item).inputValue(),
        field: await fieldOf(page, item).inputValue(),
      });
    }
    const initialResult = await resultText(page);
    const clockBefore = await clock(page);

    await rangeOf(page, mass).focus();
    await page.keyboard.press("Home");
    await rangeOf(page, distance).focus();
    await page.keyboard.press("End");
    for (const item of [mass, distance]) {
      await expect(rangeOf(page, item)).not.toHaveValue(initial.get(item.id)?.range ?? "");
    }
    await expect(results(page)).not.toHaveText(initialResult);

    await page.getByRole("button", { name: message("Params.reset") }).click();
    for (const item of reference.params) {
      await expect(rangeOf(page, item)).toHaveValue(initial.get(item.id)?.range ?? "");
      await expect(fieldOf(page, item)).toHaveValue(initial.get(item.id)?.field ?? "");
    }
    await expect(results(page)).toHaveText(initialResult);
    await expect(
      page.getByRole("status").filter({ hasText: message("Params.resetDone") }),
    ).toHaveCount(1);

    await expect(figure).toHaveCount(1);
    expect(await clock(page), "playback did not restart").toBeGreaterThanOrEqual(clockBefore);
    await expect(pauseButton(page)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("an explanation without any quantity shows no slider and no panel", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    const reference = await loadReference(request);
    const sceneCount = await serveWithoutQuantities(page, reference);

    await openReference(page, reference.id);
    const ready = scenesOf(page).locator("li[data-state=ready]");
    await expect(ready).toHaveCount(sceneCount);
    await expect(scenesOf(page).getByRole("listitem")).toHaveCount(sceneCount);

    await expect(page.getByRole("heading", { name: message("Params.title") })).toHaveCount(0);
    await expect(page.getByRole("button", { name: message("Params.reset") })).toHaveCount(0);
    await expect(page.getByRole("group", { name: message("Params.results.title") })).toHaveCount(0);
    for (const item of reference.params) {
      await expect(rangeOf(page, item)).toHaveCount(0);
      await expect(fieldOf(page, item)).toHaveCount(0);
    }
    const transport = [message("Transport.ruler"), message("Transport.volume")];
    const sliders = await page
      .getByRole("slider")
      .evaluateAll((all) => all.map((slider) => slider.getAttribute("aria-label")));
    expect(sliders.filter((name) => !transport.includes(name ?? ""))).toEqual([]);

    const start = await clock(page);
    await playButton(page).click();
    await expect.poll(() => clock(page)).toBeGreaterThan(start);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });
});
