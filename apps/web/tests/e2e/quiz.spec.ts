import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

interface Messages {
  [key: string]: Messages | string;
}

interface Choice {
  id: string;
  text: string;
}

interface Question {
  prompt: string;
  choices: Choice[];
  answer_id: string;
  explanation: string;
  scene_id: string;
}

interface Block {
  event: string;
  data: Record<string, unknown>;
}

interface StoredRecord {
  id: string;
  payload: { quiz: { questions: Question[] } | null; scenes: { id: string; title: string }[] };
}

interface Quiz {
  id: string;
  questions: Question[];
  sceneTitles: string[];
  sceneIds: string[];
}

const QUESTION = "la loi de la gravité";
// The lycee gravity explanation of a development database may predate the quiz and would
// answer from the cache: another level always generates one with it.
const LEVEL = "superieur";
const LEVEL_KEY = "eureka.level";
const REFERENCE_SLUG = "physics/universal-gravitation";
const WARM_UP_MS = 60_000;
const GENERATION_MS = 90_000;
const FIGURE = "main#content .__remotion-player";

// Questions are rate limited per address: each worker is its own visitor.
const octet = (): number => 1 + Math.floor(Math.random() * 254);
const VISITOR = `10.${octet()}.${octet()}.${octet()}`;

test.use({ extraHTTPHeaders: { "X-Forwarded-For": VISITOR } });
test.describe.configure({ timeout: WARM_UP_MS + GENERATION_MS });

// React logs this in development only, from the playback loop of @remotion/player.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;

function loadMessages(): Messages {
  const dir = path.join(__dirname, "../../messages/fr");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  return Object.assign(
    {},
    ...files.map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Messages),
  );
}

const MESSAGES = loadMessages();

function message(key: string, values: Readonly<{ [name: string]: string | number }> = {}): string {
  let node: Messages | string | undefined = MESSAGES;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`No message ${key} in fr`);
  return node.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

function plural(key: string, count: number): string {
  const template = message(key);
  const branch = count === 1 ? "one" : "other";
  const found = new RegExp(`${branch} \\{([^}]*)\\}`).exec(template);
  if (!found) throw new Error(`No ${branch} form in ${key}`);
  return (found[1] ?? "").replace("#", String(count));
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

const entryOf = (page: Page): Locator =>
  page.getByRole("button", { name: message("Quiz.open"), exact: true });
const quizOf = (page: Page): Locator =>
  page.getByRole("region", { name: message("Quiz.label"), exact: true });
const choicesOf = (page: Page): Locator => quizOf(page).locator("ol[aria-labelledby] button");
const statusOf = (page: Page): Locator => quizOf(page).getByRole("status");
const scenesOf = (page: Page): Locator =>
  page.getByRole("list", { name: message("Scenes.label"), exact: true });
const ruler = (page: Page): Locator =>
  page.getByRole("slider", { name: message("Transport.ruler") });
const playButton = (page: Page): Locator =>
  page.getByRole("button", { name: message("Transport.play"), exact: true });
const pauseButton = (page: Page): Locator =>
  page.getByRole("button", { name: message("Transport.pause"), exact: true });
const figureCaption = (page: Page): Locator => page.locator("[data-slot=figure-caption]");

function caption(page: Page, current: number, total: number): Locator {
  return quizOf(page).getByText(message("Quiz.exercise", { current, total }), { exact: true });
}

function reviewLink(page: Page, sceneNumber: number): Locator {
  const number = String(sceneNumber).padStart(2, "0");
  return quizOf(page).getByRole("button", { name: message("Quiz.review", { number }) });
}

function figure(quiz: Quiz, sceneId: string): { number: number; text: string } {
  const position = quiz.sceneIds.indexOf(sceneId);
  const number = position + 1;
  const text = message("Scenes.figure", {
    number: String(number).padStart(2, "0"),
    title: quiz.sceneTitles[position] ?? "",
  });
  return { number, text };
}

function letterOf(index: number): string {
  return String.fromCharCode(65 + index);
}

function rightIndex(question: Question): number {
  return question.choices.findIndex((choice) => choice.id === question.answer_id);
}

function wrongIndex(question: Question): number {
  return question.choices.findIndex((choice) => choice.id !== question.answer_id);
}

async function clock(page: Page): Promise<number> {
  return Number(await ruler(page).getAttribute("aria-valuenow"));
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 150; presses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("the keyboard never reached the control");
}

async function readQuiz(page: Page, request: APIRequestContext): Promise<Quiz> {
  const id = /\/e\/([a-z0-9]+)$/.exec(page.url())?.[1] ?? "";
  const response = await request.get(`/api/explanations/${id}`);
  expect(response.status()).toBe(200);
  return quizOfRecord((await response.json()) as StoredRecord);
}

function quizOfRecord(record: StoredRecord): Quiz {
  const questions = record.payload.quiz?.questions ?? [];
  expect(questions.length, "questions of the stored quiz").toBeGreaterThanOrEqual(2);
  return {
    id: record.id,
    questions,
    sceneIds: record.payload.scenes.map((scene) => scene.id),
    sceneTitles: record.payload.scenes.map((scene) => scene.title),
  };
}

async function askGravity(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, level]) => localStorage.setItem(key as string, level as string),
    [LEVEL_KEY, LEVEL],
  );
  await page.goto("/fr");
  await expect(
    page.getByRole("radio", { name: message(`Level.${LEVEL}`), exact: true }),
  ).toBeChecked();
  await page.getByRole("textbox", { name: message("Ask.lead") }).fill(QUESTION);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/fr\/e\/[a-z0-9]+$/);
}

async function finishedGravity(page: Page): Promise<void> {
  await askGravity(page);
  await expect(entryOf(page)).toBeVisible({ timeout: GENERATION_MS });
}

async function openQuiz(page: Page): Promise<void> {
  await entryOf(page).click();
  await expect(quizOf(page)).toBeVisible();
  await expect(caption(page, 1, 3)).toBeVisible();
}

async function answer(page: Page, question: Question, index: number): Promise<void> {
  const choice = choicesOf(page).nth(index);
  await expect(choice).toContainText(question.choices[index]?.text ?? "");
  await choice.click();
  await expect(choice).toHaveAttribute("aria-disabled", "true");
}

async function next(page: Page, last: boolean): Promise<void> {
  const name = message(last ? "Quiz.seeScore" : "Quiz.next");
  await quizOf(page).getByRole("button", { name, exact: true }).click();
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

async function loadReference(
  request: APIRequestContext,
): Promise<{ id: string; record: StoredRecord; stream: Block[] }> {
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
  return {
    id,
    record: (await record.json()) as StoredRecord,
    stream: parseBlocks(await stream.text()),
  };
}

async function openReference(page: Page, id: string): Promise<void> {
  await page.goto(`/fr/e/${id}`);
  await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
}

test.describe("the quiz of an explanation that was just prepared", () => {
  test("is offered once the explanation is finished, opens beside a player that plays on", async ({
    page,
  }) => {
    const errors = trackConsole(page);
    await askGravity(page);

    await expect(ruler(page)).toBeVisible({ timeout: WARM_UP_MS });
    await expect(entryOf(page)).toBeVisible({ timeout: GENERATION_MS });
    await expect(
      page.getByRole("status").filter({ hasText: /\d+ scènes?$/ }),
      "the explanation is complete when the quiz is offered",
    ).toBeVisible();
    await expect(quizOf(page)).toHaveCount(0);
    await expect(scenesOf(page)).toBeVisible();

    await expect(pauseButton(page)).toBeVisible();
    const before = await clock(page);
    await entryOf(page).click();

    const quiz = quizOf(page);
    await expect(quiz).toBeVisible();
    await expect(caption(page, 1, 3)).toBeVisible();
    await expect(scenesOf(page), "the quiz takes the place of the scene list").toHaveCount(0);
    await expect(entryOf(page)).toHaveCount(0);
    await expect(page.locator(FIGURE)).toBeVisible();
    await expect(
      quiz.getByRole("button", { name: message("Quiz.exit"), exact: true }),
    ).toBeVisible();
    await expect(choicesOf(page)).toHaveCount(4);

    await expect(pauseButton(page), "opening the quiz does not stop the player").toBeVisible();
    await expect.poll(() => clock(page)).toBeGreaterThan(before);

    await pauseButton(page).click();
    await expect(playButton(page), "the player stays under control").toBeVisible();
    const paused = await clock(page);
    await page.waitForTimeout(1200);
    expect(await clock(page)).toBe(paused);
    await expect(quiz).toBeVisible();

    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });

  test("confirms a right answer with the reason", async ({ page, request }) => {
    const errors = trackConsole(page);
    await finishedGravity(page);
    const quiz = await readQuiz(page, request);
    const question = quiz.questions[0]!;
    await openQuiz(page);

    await expect(quizOf(page).getByText(question.prompt)).toBeVisible();
    for (const [index, choice] of question.choices.entries()) {
      await expect(choicesOf(page).nth(index)).toHaveText(
        new RegExp(`^\\s*${letterOf(index)}\\s*${choice.text}\\s*$`),
      );
    }
    await expect(statusOf(page)).toHaveText("");

    const right = rightIndex(question);
    await answer(page, question, right);

    await expect(statusOf(page)).toContainText(message("Quiz.verdict.correct"));
    await expect(statusOf(page)).toContainText(question.explanation);
    await expect(statusOf(page)).not.toContainText(message("Quiz.verdict.incorrect"));
    await expect(choicesOf(page).nth(right)).toContainText(message("Quiz.tag.right"));
    await expect(quizOf(page).getByText(message("Quiz.tag.yours"))).toHaveCount(0);
    await expect(
      quizOf(page).getByRole("button", { name: /^Revoir/ }),
      "no link back after a right answer",
    ).toHaveCount(0);
    await expect(
      quizOf(page).getByRole("button", { name: message("Quiz.next"), exact: true }),
    ).toBeVisible();

    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });

  test("corrects a wrong answer and sends the player back to the scene", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    await finishedGravity(page);
    const quiz = await readQuiz(page, request);
    const question = quiz.questions[0]!;
    const target = figure(quiz, question.scene_id);

    await pauseButton(page).click();
    await ruler(page).focus();
    await page.keyboard.press("Home");
    await expect(figureCaption(page)).toContainText(figure(quiz, quiz.sceneIds[0]!).text);
    await openQuiz(page);

    const wrong = wrongIndex(question);
    const right = rightIndex(question);
    await answer(page, question, wrong);

    await expect(statusOf(page)).toContainText(message("Quiz.verdict.incorrect"));
    await expect(statusOf(page)).toContainText(
      message("Quiz.rightAnswer", { letter: letterOf(right) }),
    );
    await expect(statusOf(page)).toContainText(question.explanation);
    await expect(choicesOf(page).nth(right)).toContainText(message("Quiz.tag.right"));
    await expect(choicesOf(page).nth(wrong)).toContainText(message("Quiz.tag.yours"));

    const link = reviewLink(page, target.number);
    await expect(link).toBeVisible();
    await expect(playButton(page)).toBeVisible();
    await link.click();

    await expect(figureCaption(page)).toContainText(target.text);
    await expect(pauseButton(page), "the scene plays from its start").toBeVisible();
    await expect(page.locator(FIGURE)).toBeInViewport();
    await expect(caption(page, 1, 3), "the quiz stays on the same question").toBeVisible();
    await expect(choicesOf(page).nth(wrong)).toContainText(message("Quiz.tag.yours"));
    await expect(link).toBeVisible();

    await pauseButton(page).click();
    await expect(playButton(page)).toBeVisible();
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });

  test("gives the score after the last exercise", async ({ page, request }) => {
    const errors = trackConsole(page);
    await finishedGravity(page);
    const quiz = await readQuiz(page, request);
    const total = quiz.questions.length;
    await openQuiz(page);

    const playedWrong = new Set([0, 2].filter((index) => index < total));
    const rightCount = total - playedWrong.size;
    for (const [number, question] of quiz.questions.entries()) {
      if (number > 0) await expect(caption(page, number + 1, total)).toBeVisible();
      await answer(
        page,
        question,
        playedWrong.has(number) ? wrongIndex(question) : rightIndex(question),
      );
      await next(page, number === total - 1);
    }

    const score = message("Quiz.score.value", { score: rightCount, total });
    await expect(
      quizOf(page).getByText(message("Quiz.score.caption"), { exact: true }),
    ).toBeVisible();
    await expect(quizOf(page).getByRole("heading", { level: 2, name: score })).toBeFocused();
    await expect(
      quizOf(page).getByText(plural("Quiz.score.missed", playedWrong.size), { exact: true }),
    ).toBeVisible();
    await expect(quizOf(page).getByText(message("Quiz.score.again"))).toBeVisible();

    const details = quizOf(page).getByRole("list", { name: message("Quiz.score.details") });
    await expect(details.getByRole("listitem")).toHaveCount(total);
    await expect(details.getByRole("button", { name: /^Revoir/ })).toHaveCount(playedWrong.size);
    await expect(
      quizOf(page).getByRole("button", { name: message("Quiz.close"), exact: true }),
    ).toBeVisible();

    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });

  test("keeps the answers given when the quiz is left and opened again", async ({
    page,
    request,
  }) => {
    const errors = trackConsole(page);
    await finishedGravity(page);
    const quiz = await readQuiz(page, request);
    const total = quiz.questions.length;
    await openQuiz(page);

    await answer(page, quiz.questions[0]!, wrongIndex(quiz.questions[0]!));
    await quizOf(page)
      .getByRole("button", { name: message("Quiz.exit"), exact: true })
      .click();

    await expect(quizOf(page)).toHaveCount(0);
    await expect(scenesOf(page)).toBeVisible();
    await expect(entryOf(page)).toBeFocused();

    await entryOf(page).click();
    await expect(caption(page, 2, total)).toBeVisible();
    await expect(quizOf(page).getByText(quiz.questions[1]!.prompt)).toBeVisible();

    for (const [number, question] of quiz.questions.entries()) {
      if (number === 0) continue;
      await answer(page, question, rightIndex(question));
      await next(page, number === total - 1);
    }
    await expect(
      quizOf(page).getByRole("heading", {
        level: 2,
        name: message("Quiz.score.value", { score: total - 1, total }),
      }),
    ).toBeVisible();

    await quizOf(page)
      .getByRole("button", { name: message("Quiz.close"), exact: true })
      .click();
    await expect(entryOf(page)).toBeFocused();
    await entryOf(page).click();
    await expect(
      quizOf(page).getByRole("heading", {
        level: 2,
        name: message("Quiz.score.value", { score: total - 1, total }),
      }),
    ).toBeFocused();

    expect(errors).toEqual([]);
  });

  test("does not let an answer given be changed", async ({ page, request }) => {
    const errors = trackConsole(page);
    await finishedGravity(page);
    const quiz = await readQuiz(page, request);
    const question = quiz.questions[0]!;
    await openQuiz(page);

    const wrong = wrongIndex(question);
    await answer(page, question, wrong);
    const choices = choicesOf(page);
    const count = await choices.count();
    for (let index = 0; index < count; index += 1) {
      await expect(choices.nth(index)).toHaveAttribute("aria-disabled", "true");
    }
    const status = (await statusOf(page).textContent()) ?? "";
    const marks = await choices.allTextContents();

    for (let index = 0; index < count; index += 1) {
      await choices.nth(index).dispatchEvent("click");
    }
    expect(await choices.allTextContents()).toEqual(marks);
    await expect(statusOf(page)).toHaveText(status);
    await expect(choices.nth(wrong)).toContainText(message("Quiz.tag.yours"));
    await expect(quizOf(page).getByText(message("Quiz.tag.yours"))).toHaveCount(1);
    await expect(caption(page, 1, quiz.questions.length)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("is reached and left with the keyboard, with motion reduced", async ({
    browser,
    baseURL,
    request,
  }) => {
    const context = await browser.newContext({
      baseURL,
      reducedMotion: "reduce",
      extraHTTPHeaders: { "X-Forwarded-For": VISITOR },
    });
    const page = await context.newPage();
    const errors = trackConsole(page);
    await finishedGravity(page);
    const quiz = await readQuiz(page, request);
    const question = quiz.questions[0]!;
    const target = figure(quiz, question.scene_id);

    const entry = entryOf(page);
    await tabTo(page, entry);
    await page.keyboard.press("Enter");
    await expect(quizOf(page).getByText(question.prompt)).toBeFocused();

    const wrong = wrongIndex(question);
    await tabTo(page, choicesOf(page).nth(wrong));
    await page.keyboard.press("Enter");
    await expect(choicesOf(page).nth(wrong)).toHaveAttribute("aria-disabled", "true");
    await expect(choicesOf(page).nth(wrong)).toBeFocused();

    const link = reviewLink(page, target.number);
    await tabTo(page, link);
    await page.keyboard.press("Enter");
    await expect(figureCaption(page)).toContainText(target.text);
    await expect(playButton(page), "with reduced motion the scene waits for a press").toBeVisible();
    await expect(page.locator(FIGURE)).toBeInViewport();
    await expect(caption(page, 1, quiz.questions.length)).toBeVisible();

    const exit = quizOf(page).getByRole("button", { name: message("Quiz.exit"), exact: true });
    await tabTo(page, exit);
    await page.keyboard.press("Enter");
    await expect(quizOf(page)).toHaveCount(0);
    await expect(entry).toBeFocused();

    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("the quiz of the gravitation reference", () => {
  test("is offered with the document and plays the same way", async ({ page, request }) => {
    const errors = trackConsole(page);
    const reference = await loadReference(request);
    const quiz = quizOfRecord(reference.record);
    const question = quiz.questions[0]!;
    await openReference(page, reference.id);

    await expect(entryOf(page)).toBeVisible();
    await openQuiz(page);
    await expect(quizOf(page).getByText(question.prompt)).toBeVisible();
    await expect(choicesOf(page)).toHaveCount(question.choices.length);

    await answer(page, question, wrongIndex(question));
    await expect(statusOf(page)).toContainText(message("Quiz.verdict.incorrect"));
    await expect(statusOf(page)).toContainText(question.explanation);

    const target = figure(quiz, question.scene_id);
    await reviewLink(page, target.number).click();
    await expect(figureCaption(page)).toContainText(target.text);
    await expect(page.locator(FIGURE)).toBeInViewport();

    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });
});

test.describe("an explanation without a quiz", () => {
  test("offers no entry", async ({ page, request }) => {
    const errors = trackConsole(page);
    const reference = await loadReference(request);
    const stream = reference.stream.filter((block) => block.event !== "quiz");
    expect(stream.length).toBe(reference.stream.length - 1);
    const scenes = stream.filter((block) => block.event === "scene").length;

    await page.route(new RegExp(`/api/explanations/${reference.id}$`), (route) =>
      route.fulfill({
        json: { ...reference.record, payload: { ...reference.record.payload, quiz: null } },
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

    await openReference(page, reference.id);
    await expect(scenesOf(page).locator("li[data-state=ready]")).toHaveCount(scenes);
    await page.waitForTimeout(800);
    await expect(entryOf(page)).toHaveCount(0);
    await expect(quizOf(page)).toHaveCount(0);
    await expect(scenesOf(page)).toBeVisible();

    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });
});
