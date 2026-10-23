import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env["BASE_URL"] ?? "http://localhost:3000";
const OUT = ".snapshots/quiz";
const SIZES = [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "360", width: 360, height: 740, phone: true },
] as const;
const THEMES = ["paper", "board"] as const;
const TOUCH_TARGET = 44;

type Size = (typeof SIZES)[number];
type Theme = (typeof THEMES)[number];

interface Question {
  prompt: string;
  choices: { id: string; text: string }[];
  answer_id: string;
  scene_id: string;
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

const reference = (await (await fetch(`${BASE}/api/reference?language=fr`)).json()) as {
  explanation_id: string;
  title: string;
}[];
const REF = reference.find((entry) => entry.title === "La gravitation universelle")!;
const record = (await (await fetch(`${BASE}/api/explanations/${REF.explanation_id}`)).json()) as {
  payload: { quiz: { questions: Question[] }; scenes: { id: string }[] };
};
const QUESTIONS = record.payload.quiz.questions;
const SCENE_IDS = record.payload.scenes.map((scene) => scene.id);

async function open(browser: Browser, size: Size, theme: Theme) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.phone,
    hasTouch: size.phone,
    locale: "fr",
    colorScheme: theme === "board" ? "dark" : "light",
  });
  await context.addInitScript((value) => localStorage.setItem("eureka.theme", value), theme);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource")) return;
    if (message.text().startsWith("Maximum update depth exceeded")) return;
    errors.push(message.text());
  });
  await page.goto(`${BASE}/fr/e/${REF.explanation_id}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("slider", { name: "Position dans l’explication" })
    .waitFor({ timeout: 60000 });
  return { context, page };
}

const entry = (page: Page) => page.getByRole("button", { name: "Vérifier ce que j’ai compris" });
const quiz = (page: Page) => page.getByRole("region", { name: "Quiz de vérification" });
const choices = (page: Page) => quiz(page).locator("ol[aria-labelledby] button");

async function height(locator: ReturnType<typeof entry>): Promise<number> {
  return (await locator.boundingBox())?.height ?? 0;
}

async function shoot(page: Page, size: Size, theme: Theme, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(horizontal <= 0, `${name} ${size.name} ${theme}: no horizontal overflow`, horizontal);
  await page.screenshot({ path: `${OUT}/${name}-${size.name}-${theme}.png` });
}

async function flow(browser: Browser, size: Size, theme: Theme): Promise<void> {
  const tag = `${size.name} ${theme}`;
  const { context, page } = await open(browser, size, theme);
  try {
    await entry(page).waitFor({ timeout: 15000 });
    await entry(page).scrollIntoViewIfNeeded();
    check((await height(entry(page))) >= TOUCH_TARGET, `${tag}: the entry is a 44 px target`);
    await shoot(page, size, theme, "1-entry");

    await entry(page).click();
    await quiz(page).waitFor();
    check(
      await page.evaluate(() => document.activeElement?.tagName === "P"),
      `${tag}: the focus is on the question`,
    );
    const tooSmall = await choices(page).evaluateAll(
      (all, minimum) => all.filter((b) => b.getBoundingClientRect().height < minimum).length,
      TOUCH_TARGET,
    );
    check(tooSmall === 0, `${tag}: every answer is at least 44 px high`, tooSmall);
    await shoot(page, size, theme, "2-question");

    const first = QUESTIONS[0]!;
    const wrong = first.choices.findIndex((choice) => choice.id !== first.answer_id);
    await choices(page).nth(wrong).click();
    await page.getByRole("button", { name: /^Revoir la scène/ }).waitFor();
    await page.getByRole("button", { name: /^Revoir la scène/ }).scrollIntoViewIfNeeded();
    await shoot(page, size, theme, "3-wrong");

    const scene = SCENE_IDS.indexOf(first.scene_id) + 1;
    await page.getByRole("button", { name: /^Revoir la scène/ }).click();
    await page.waitForTimeout(900);
    const figure = await page.locator("[data-slot=figure-caption]").innerText();
    check(
      figure.includes(String(scene).padStart(2, "0")),
      `${tag}: the review link lands on scene ${scene}`,
      figure,
    );
    const player = await page.locator("main#content .__remotion-player").boundingBox();
    check(
      player !== null && player.y >= 0 && player.y + player.height <= size.height,
      `${tag}: the player is wholly in the window after the review`,
      player,
    );
    await shoot(page, size, theme, "4-review");

    await page.getByRole("button", { name: /^Exercice suivant/ }).click();
    for (const [index, question] of QUESTIONS.entries()) {
      if (index === 0) continue;
      const right = question.choices.findIndex((choice) => choice.id === question.answer_id);
      await choices(page).nth(right).click();
      const last = index === QUESTIONS.length - 1;
      await page
        .getByRole("button", { name: last ? /^Voir mon score/ : /^Exercice suivant/ })
        .click();
    }
    await quiz(page).getByRole("heading", { level: 2 }).waitFor();
    const score = await quiz(page).getByRole("heading", { level: 2 }).innerText();
    check(
      score.includes(`${QUESTIONS.length - 1} sur ${QUESTIONS.length}`),
      `${tag}: score`,
      score,
    );
    await quiz(page).scrollIntoViewIfNeeded();
    await shoot(page, size, theme, "5-score");

    await quiz(page).getByRole("button", { name: "Fermer le quiz" }).click();
    check(
      await entry(page).evaluate((button) => button === document.activeElement),
      `${tag}: the focus returns to the entry`,
    );
    check(
      (await page.getByRole("list", { name: "Scènes", exact: true }).count()) === 1,
      `${tag}: the scene list is back`,
    );
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) for (const theme of THEMES) await flow(browser, size, theme);
} finally {
  await browser.close();
}

check(errors.length === 0, "no console error", errors);
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
