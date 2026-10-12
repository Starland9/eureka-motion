import { chromium, type Locator, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = ".snapshots/colophon";
const INSTANCES = ["complete", "mixed", "progress"] as const;

const WORDS = {
  fr: {
    heading: /Comment cette explication a été construite/,
    objective: "Savoir que deux masses",
    validated: /validée?/i,
    corrected: /corrigée, puis validée/i,
    dropped: /écartée/i,
    pending: /en préparation/i,
    attempts: "2 tentatives",
    reviewed: /Relue par/,
    reviewDate: "18 septembre 2026",
    total: "Préparation totale",
    secondsTotal: "42,4",
    secondsFirst: "14,1",
    secondsFirstMixed: "11,9",
  },
  en: {
    heading: /How this explanation was built/,
    objective: "Savoir que deux masses",
    validated: /validated/i,
    corrected: /corrected, then validated/i,
    dropped: /removed/i,
    pending: /in preparation/i,
    attempts: "2 attempts",
    reviewed: /Reviewed by/,
    reviewDate: "September 18, 2026",
    total: "Total preparation",
    secondsTotal: "42.4",
    secondsFirst: "14.1",
    secondsFirstMixed: "11.9",
  },
} as const;

let failures = 0;
const errors: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${message}`);
  } else {
    console.log(`ok   ${message}`);
  }
}

function panel(page: Page, name: (typeof INSTANCES)[number]): Locator {
  return page.getByTestId(`colophon-${name}`);
}

function trigger(page: Page, name: (typeof INSTANCES)[number], heading: RegExp): Locator {
  return panel(page, name).getByRole("button", { name: heading });
}

function narration(scope: Locator): Locator {
  return scope.getByRole("region", { name: /^Narration$/ }).locator("dt");
}

async function openAll(page: Page, heading: RegExp): Promise<void> {
  for (const name of INSTANCES) {
    const button = trigger(page, name, heading);
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    await page.waitForTimeout(350);
  }
}

async function overflow(page: Page): Promise<{ page: number; formula: number }> {
  return page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    formula: Math.max(
      0,
      ...[...document.querySelectorAll<HTMLElement>("[data-testid^=colophon-] .katex-display")]
        .map((element) => element.parentElement)
        .filter((element): element is HTMLElement => element !== null)
        .map((element) => element.scrollWidth - element.clientWidth),
    ),
  }));
}

const browser = await chromium.launch();

for (const locale of ["fr", "en"] as const) {
  const words = WORDS[locale];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`[${locale}] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`[${locale}] ${message.text()}`);
  });
  await page.goto(`${BASE}/${locale}/dev/colophon`, { waitUntil: "networkidle" });
  console.log(`--- ${locale}`);

  for (const name of INSTANCES) {
    const button = trigger(page, name, words.heading);
    check((await button.count()) === 1, `${locale} ${name}: one disclosure button`);
    check(
      (await button.getAttribute("aria-expanded")) === "false",
      `${locale} ${name}: closed on load`,
    );
    check(
      Boolean(await button.getAttribute("aria-controls")),
      `${locale} ${name}: aria-controls present`,
    );
    const tree = await panel(page, name).ariaSnapshot();
    check(
      !/Savoir|listitem|term:|Plan|Verification|Vérification/.test(tree),
      `${locale} ${name}: content absent from the accessibility tree`,
    );
    check(
      (await panel(page, name).getByText(words.objective).count()) === 0,
      `${locale} ${name}: no plan text in the DOM while closed`,
    );
  }

  for (const name of INSTANCES) {
    await page.keyboard.press("Tab");
    const button = trigger(page, name, words.heading);
    let focused = await button.evaluate((element) => element === document.activeElement);
    for (let hops = 0; !focused && hops < 6; hops += 1) {
      await page.keyboard.press("Tab");
      focused = await button.evaluate((element) => element === document.activeElement);
    }
    check(focused, `${locale} ${name}: Tab reaches the button`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(350);
    check(
      (await button.getAttribute("aria-expanded")) === "true",
      `${locale} ${name}: Enter opens (aria-expanded=true)`,
    );
    const controls = await button.getAttribute("aria-controls");
    check(
      controls !== null && (await page.locator(`[id="${controls}"]`).count()) === 1,
      `${locale} ${name}: aria-controls targets the open content`,
    );
    check(
      await panel(page, name).getByText(words.objective).isVisible(),
      `${locale} ${name}: plan visible once open`,
    );
    await page.keyboard.press("Space");
    await page.waitForTimeout(350);
    check(
      (await button.getAttribute("aria-expanded")) === "false",
      `${locale} ${name}: Space closes (aria-expanded=false)`,
    );
    check(
      (await panel(page, name).getByText(words.objective).count()) === 0,
      `${locale} ${name}: content removed again after closing`,
    );
  }

  await openAll(page, words.heading);

  const complete = panel(page, "complete");
  const mixed = panel(page, "mixed");
  const progress = panel(page, "progress");

  check(
    (await complete.locator("li[data-verdict]").count()) === 7,
    `${locale} complete: 7 verdict lines (plan + 6 scenes)`,
  );
  check(
    (await complete.locator("li[data-verdict][data-status=validated]").count()) === 7,
    `${locale} complete: all 7 validated`,
  );
  check(
    (await complete.locator("li[data-verdict=plan]").innerText()).match(words.validated) !== null,
    `${locale} complete: plan verdict in words`,
  );
  check(
    (await complete.locator("li[data-verdict=s3]").innerText()).match(words.validated) !== null,
    `${locale} complete: scene verdict in words`,
  );
  check(
    (await complete.getByText(words.reviewed).count()) === 1,
    `${locale} complete: review line present`,
  );
  const reviewLine = await complete.getByText(words.reviewed).innerText();
  check(
    reviewLine.includes("Claire Mercier") && reviewLine.includes(words.reviewDate),
    `${locale} complete: review line carries reviewer and localised date (${reviewLine})`,
  );
  const completeText = await complete.innerText();
  check(
    completeText.includes(words.secondsTotal) && completeText.includes(words.secondsFirst),
    `${locale} complete: timings in seconds with one decimal`,
  );
  check(
    (await complete.locator("[lang=fr]").count()) > 10,
    `${locale} complete: document text carries lang`,
  );
  check(
    (await complete.locator("dl dd[lang=fr] ").count()) > 6 &&
      (await complete.getByText("Une pomme lâchée tombe vers le sol").count()) === 1,
    `${locale} complete: narration text present`,
  );
  check((await complete.locator(".katex").count()) > 0, `${locale} complete: formula rendered`);

  check(
    (await mixed.locator("li[data-verdict]").count()) === 7,
    `${locale} mixed: 7 verdict lines`,
  );
  const corrected = mixed.locator("li[data-verdict=s2]");
  const correctedText = await corrected.innerText();
  check(
    (await corrected.getAttribute("data-status")) === "corrected" &&
      words.corrected.test(correctedText) &&
      correctedText.toLowerCase().includes(words.attempts) &&
      correctedText.includes("première version"),
    `${locale} mixed: s2 corrected, 2 attempts and reason`,
  );
  const dropped = mixed.locator("li[data-verdict=s4]");
  const droppedText = await dropped.innerText();
  check(
    (await dropped.getAttribute("data-status")) === "dropped" &&
      words.dropped.test(droppedText) &&
      droppedText.includes("3") &&
      droppedText.includes("écartée plutôt"),
    `${locale} mixed: s4 removed with its reason`,
  );
  for (const [name, expected] of [
    ["complete", 6],
    ["mixed", 5],
    ["progress", 2],
  ] as const) {
    check(
      (await narration(panel(page, name)).count()) === expected,
      `${locale} ${name}: ${expected} narrated scenes`,
    );
  }
  check((await mixed.getByText(words.reviewed).count()) === 0, `${locale} mixed: no review line`);
  const mixedText = await mixed.innerText();
  check(
    mixedText.includes(words.secondsFirstMixed) && !mixedText.includes(words.total),
    `${locale} mixed: partial timings (first scene only)`,
  );

  check(
    (await progress.locator("li[data-verdict]").count()) === 7,
    `${locale} progress: 7 verdict lines`,
  );
  check(
    (await progress.locator("li[data-verdict][data-status=pending]").count()) === 4,
    `${locale} progress: 4 scenes in preparation`,
  );
  check(
    words.pending.test(await progress.locator("li[data-verdict=s5]").innerText()),
    `${locale} progress: pending verdict in words`,
  );
  check(
    (await progress.getByText(words.reviewed).count()) === 0,
    `${locale} progress: no review line`,
  );
  check((await progress.getByText(words.total).count()) === 0, `${locale} progress: no timings`);

  await page.screenshot({ path: `${OUT}/${locale}-1280-paper-open.png`, fullPage: true });
  await context.close();
}

for (const locale of ["fr", "en"] as const) {
  const words = WORDS[locale];
  for (const [theme, scheme] of [
    ["paper", "light"],
    ["board", "dark"],
  ] as const) {
    for (const width of [1280, 360]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: scheme,
      });
      const page = await context.newPage();
      page.on("pageerror", (error) =>
        errors.push(`[${locale}/${theme}/${width}] ${error.message}`),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          errors.push(`[${locale}/${theme}/${width}] ${message.text()}`);
      });
      await page.goto(`${BASE}/${locale}/dev/colophon`, { waitUntil: "networkidle" });
      await openAll(page, words.heading);
      await page.evaluate(() => document.fonts.ready);
      const measure = await overflow(page);
      check(
        measure.page <= 0 && measure.formula <= 0,
        `${locale} ${theme} ${width}px: no horizontal overflow, panels open (page ${measure.page}, formula ${measure.formula})`,
      );
      await page.screenshot({
        path: `${OUT}/${locale}-${width}-${theme}.png`,
        fullPage: true,
      });
      await context.close();
    }
  }
}

check(errors.length === 0, `no console error (${JSON.stringify(errors.slice(0, 5))})`);
await browser.close();
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
