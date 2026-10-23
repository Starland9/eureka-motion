import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = ".snapshots/home";
const SLOW = 700;

const failures: string[] = [];
const errors: string[] = [];
let layoutWarnings = 0;

// React dev warning raised by the inline theme script of the locale layout when the locale
// changes client-side; it does not come from the home page.
const LAYOUT_SCRIPT_WARNING = "Encountered a script tag while rendering React component";

function check(condition: boolean, message: string, detail?: unknown): void {
  if (condition) {
    console.log(`ok    ${message}`);
    return;
  }
  failures.push(message);
  console.log(`FAIL  ${message}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

type Reply =
  | { kind: "reject"; status: number; retryAfter?: string; code: string; message: string }
  | { kind: "network" }
  | { kind: "accept" };

interface Options {
  width: number;
  height: number;
  mobile?: boolean;
  board?: boolean;
  reply?: Reply;
  quiet?: boolean;
  tolerant?: boolean;
}

async function open(browser: Browser, locale: string, options: Options) {
  const {
    width,
    height,
    mobile = false,
    board = false,
    reply,
    quiet = false,
    tolerant = false,
  } = options;
  const context: BrowserContext = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    locale,
  });
  if (board) await context.addInitScript(() => localStorage.setItem("eureka.theme", "board"));
  const page = await context.newPage();
  const sink = tolerant ? [] : errors;
  page.on("pageerror", (error) => sink.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (quiet && message.text().startsWith("Failed to load resource")) return;
    if (message.text().startsWith(LAYOUT_SCRIPT_WARNING)) {
      layoutWarnings += 1;
      return;
    }
    sink.push(message.text());
  });
  if (reply) await mockStart(page, reply);
  await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
  if (!mobile) await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA");
  else await page.waitForTimeout(400);
  return { context, page };
}

async function mockStart(page: Page, reply: Reply): Promise<void> {
  await page.route("**/api/explanations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((resolve) => setTimeout(resolve, SLOW));
    if (reply.kind === "network") return route.abort("failed");
    if (reply.kind === "accept") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `id: 1\nevent: accepted\ndata: ${JSON.stringify({ explanation_id: "demo", cached: false })}\n\n`,
      });
    }
    return route.fulfill({
      status: reply.status,
      contentType: "application/json",
      headers: reply.retryAfter ? { "Retry-After": reply.retryAfter } : {},
      body: JSON.stringify({ error: { code: reply.code, message: reply.message } }),
    });
  });
}

const field = (page: Page) => page.getByRole("textbox");
const submit = (page: Page) => page.locator("main form button[type=submit]");
const status = (page: Page) => page.locator("main [role=status]");
const alert = (page: Page) => page.locator("main [role=alert]");
const choice = (page: Page, name: string) => page.locator("label", { hasText: name });
const checked = (page: Page, name: string) => page.getByRole("radio", { name }).isChecked();
const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));
const storage = (page: Page, key: string) =>
  page.evaluate((name) => sessionStorage.getItem(name), key);

async function waitText(page: Page, locator: ReturnType<typeof alert>, timeout = 5000) {
  await locator.filter({ hasText: /\S/ }).waitFor({ timeout });
  return (await locator.textContent()) ?? "";
}

async function structure(browser: Browser): Promise<void> {
  console.log("\n# structure, field and button (1440 x 900, fr)");
  const { context, page } = await open(browser, "fr", { width: 1440, height: 900 });
  check((await page.locator("h1").count()) === 1, "exactly one h1");
  check((await page.locator("main#content").count()) === 1, "main#content present");
  check(
    (await page.title()).includes("Eureka Motion"),
    "page title carries the product name",
    await page.title(),
  );
  check(
    ((await page.locator('meta[name="description"]').getAttribute("content")) ?? "").length > 20,
    "meta description present",
  );
  check(
    (await page.getByRole("textbox", { name: "Je n’ai pas compris" }).count()) === 1,
    "textarea is named by the fixed words of the sentence",
  );
  check(
    (await page.evaluate(() => document.activeElement?.tagName)) === "TEXTAREA",
    "field focused on load on a desktop pointer",
  );
  check(await submit(page).isDisabled(), "submit disabled while the field is empty");
  await field(page).fill("   ");
  check(await submit(page).isDisabled(), "submit disabled for whitespace only");
  await field(page).fill("la loi de la gravité");
  check(await submit(page).isEnabled(), "submit enabled after typing");
  check(((await submit(page).textContent()) ?? "").includes("Expliquer"), "button reads Expliquer");
  check((await field(page).getAttribute("maxlength")) === "500", "maxlength is 500");
  const described = (await field(page).getAttribute("aria-describedby")) ?? "";
  const ids = described.split(" ");
  const resolved = await page.evaluate(
    (list) => list.every((id) => document.getElementById(id) !== null),
    ids,
  );
  check(
    ids.length >= 2 && resolved,
    "aria-describedby points to existing hint, note and alert",
    described,
  );
  const fontSize = await field(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(fontSize >= 16, "field font size is at least 16 px", fontSize);

  await field(page).fill("");
  const noteBefore = await page
    .locator("main form p")
    .filter({ hasText: /Il reste/ })
    .count();
  check(noteBefore === 0, "no remaining-characters note while far from the limit");
  await field(page).fill("");
  await page.keyboard.insertText("x".repeat(460));
  const near = await page
    .locator("main form p")
    .filter({ hasText: /Il reste 40 caractères/ })
    .count();
  check(near === 1, "remaining-characters note appears near the limit");
  await field(page).fill("");
  await page.keyboard.insertText("x".repeat(560));
  const length = await field(page).evaluate((el: HTMLTextAreaElement) => el.value.length);
  check(length === 500, "field refuses more than 500 characters", length);
  check(
    (await page
      .locator("main form p")
      .filter({ hasText: /Il reste 0 caractère/ })
      .count()) === 1,
    "remaining-characters note shows 0 at the limit",
  );

  const height = () => field(page).evaluate((el) => el.getBoundingClientRect().height);
  await field(page).fill("");
  await field(page).pressSequentially("première ligne");
  const oneLine = await height();
  await page.keyboard.press("Shift+Enter");
  await field(page).pressSequentially("seconde ligne");
  const value = await field(page).inputValue();
  check(value === "première ligne\nseconde ligne", "Shift+Enter inserts a line break", value);
  check(
    (await alert(page).textContent())?.trim() === "" &&
      (await status(page).textContent())?.trim() === "",
    "Shift+Enter does not submit",
  );
  const twoLines = await height();
  check(twoLines > oneLine, "field grows with a line break", { oneLine, twoLines });
  await field(page).fill("");
  await field(page).pressSequentially("une question assez longue pour passer à la ligne, ok");
  const wrapped = await height();
  await field(page).pressSequentially(" et même encore plus longue que tout à l’heure, vraiment");
  const wrappedMore = await height();
  check(wrappedMore > wrapped, "field grows when the text wraps", { wrapped, wrappedMore });
  await field(page).fill("");
  await context.close();
}

async function preferences(browser: Browser): Promise<void> {
  console.log("\n# preferences, persistence, language switch (1440 x 900)");
  const { context, page } = await open(browser, "fr", { width: 1440, height: 900 });
  await choice(page, "Supérieur").click();
  await choice(page, "Tableau").click();
  check(await checked(page, "Supérieur"), "Supérieur checked after click");
  check(await checked(page, "Tableau"), "Tableau checked after click");
  check(await isDark(page), "<html> has class dark after choosing Tableau");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  check(await checked(page, "Supérieur"), "level kept after reload");
  check(await checked(page, "Tableau"), "theme radio kept after reload");
  check(await isDark(page), "<html> keeps class dark after reload");
  check(await checked(page, "Français"), "Français checked on /fr");

  await field(page).fill("la loi de la gravité");
  await choice(page, "English").click();
  await page.waitForURL(/\/en$/, { timeout: 15000 });
  await page.getByRole("textbox").waitFor();
  await page.waitForTimeout(400);
  check(page.url().endsWith("/en"), "switching to English lands on /en", page.url());
  check(
    (await field(page).inputValue()) === "la loi de la gravité",
    "typed text kept across the language switch",
  );
  check(await checked(page, "Higher education"), "level kept across the language switch");
  check(await isDark(page), "theme kept across the language switch");
  check((await page.locator("html").getAttribute("lang")) === "en", "html lang is en");
  check(
    (await page.getByRole("textbox", { name: "I didn’t understand" }).count()) === 1,
    "English label of the sentence",
  );
  const focused = await page.evaluate(() => (document.activeElement as HTMLInputElement).value);
  check(focused === "en", "focus stays on the language choice after the switch", focused);
  await field(page).fill("");
  await context.close();
}

async function submissions(browser: Browser): Promise<void> {
  console.log("\n# submission states (mocked POST /api/explanations)");
  const cases: { name: string; locale: string; reply: Reply; expect: RegExp }[] = [
    {
      name: "rate limit above a minute rounds up to minutes",
      locale: "fr",
      reply: { kind: "reject", status: 429, retryAfter: "130", code: "rate_limited", message: "x" },
      expect: /3 minutes/,
    },
    {
      name: "rate limit under a minute counts seconds",
      locale: "fr",
      reply: { kind: "reject", status: 429, retryAfter: "20", code: "rate_limited", message: "x" },
      expect: /20 secondes/,
    },
    {
      name: "rate limit in English",
      locale: "en",
      reply: { kind: "reject", status: 429, retryAfter: "20", code: "rate_limited", message: "x" },
      expect: /20 seconds/,
    },
    {
      name: "network failure shows the generic sentence",
      locale: "fr",
      reply: { kind: "network" },
      expect: /n’a pas pu démarrer/,
    },
    {
      name: "server message is shown when present",
      locale: "fr",
      reply: {
        kind: "reject",
        status: 500,
        code: "internal_error",
        message: "Le service est indisponible pour le moment.",
      },
      expect: /Le service est indisponible pour le moment\./,
    },
    {
      name: "empty server message falls back to the generic sentence",
      locale: "en",
      reply: { kind: "reject", status: 500, code: "internal_error", message: "" },
      expect: /could not start/,
    },
  ];
  for (const { name, locale, reply, expect } of cases) {
    const { context, page } = await open(browser, locale, {
      width: 1440,
      height: 900,
      reply,
      quiet: true,
    });
    const question = "pourquoi le ciel est bleu";
    await field(page).fill(question);
    await field(page).press("Enter");
    const pendingText = await waitText(page, status(page), 2000);
    const buttonDuring = await submit(page).isDisabled();
    check(
      pendingText.trim().length > 0 && buttonDuring,
      `${name}: pending text shown and button disabled`,
      pendingText,
    );
    const message = await waitText(page, alert(page));
    check(expect.test(message), `${name}: alert text`, message);
    check((await field(page).inputValue()) === question, `${name}: text kept`);
    check(((await status(page).textContent()) ?? "").trim() === "", `${name}: pending cleared`);
    check(await submit(page).isEnabled(), `${name}: button enabled again`);
    check(
      (await field(page).getAttribute("aria-invalid")) === "true",
      `${name}: field marked invalid`,
    );
    const alertId = await alert(page).getAttribute("id");
    const describedBy = (await field(page).getAttribute("aria-describedby")) ?? "";
    check(
      alertId !== null && describedBy.split(" ").includes(alertId),
      `${name}: alert tied to the field`,
    );
    if (name.startsWith("rate limit above")) {
      await page.screenshot({ path: `${OUT}/desktop-paper-fr-error.png` });
    }
    await field(page).fill("");
    await context.close();
  }

  const { context, page } = await open(browser, "fr", {
    width: 1440,
    height: 900,
    reply: { kind: "accept" },
    tolerant: true,
  });
  await field(page).fill("pourquoi le ciel est bleu");
  await submit(page).click();
  await page.waitForURL(/\/fr\/e\/demo$/, { timeout: 15000 });
  check(page.url().endsWith("/fr/e/demo"), "accepted outcome navigates to /fr/e/<id>", page.url());
  check((await storage(page, "eureka.draft")) === null, "draft cleared after an accepted submit");
  await context.close();
}

async function keyboard(browser: Browser): Promise<void> {
  console.log("\n# keyboard only (1440 x 900, fr)");
  const { context, page } = await open(browser, "fr", {
    width: 1440,
    height: 900,
    reply: { kind: "reject", status: 429, retryAfter: "20", code: "rate_limited", message: "x" },
    quiet: true,
  });
  await page.keyboard.type("la loi de la gravité");
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());

  const sequence: { label: string; top: number; left: number }[] = [];
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const target =
        element instanceof HTMLInputElement ? (element.closest("label") ?? element) : element;
      const box = target.getBoundingClientRect();
      const label =
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? (element.labels?.[0]?.textContent ?? element.name)
          : (element.textContent ?? "").trim();
      return {
        label: `${element.tagName.toLowerCase()}:${label.trim()}`,
        top: box.top,
        left: box.left,
      };
    });
    sequence.push(info);
  }
  console.log(`info  tab order: ${sequence.map((item) => item.label).join(" > ")}`);
  const labels = sequence.map((item) => item.label);
  check(
    labels[0]?.startsWith("a:") === true &&
      labels[1]?.startsWith("textarea:") === true &&
      labels[2]?.startsWith("button:") === true &&
      labels[3]?.includes("Français") === true &&
      labels[4]?.includes("Lycée") === true &&
      labels[5]?.includes("Papier") === true,
    "Tab order: skip link, field, button, language, level, theme",
    labels,
  );
  const visual = sequence.slice(1).every((item, index, list) => {
    const previous = list[index - 1];
    if (!previous) return true;
    return (
      item.top > previous.top + 1 ||
      (Math.abs(item.top - previous.top) < 2 && item.left > previous.left)
    );
  });
  check(visual, "Tab order follows the visual order", sequence);

  for (let step = 0; step < 4; step += 1) await page.keyboard.press("Shift+Tab");
  check(
    (await page.evaluate(() => document.activeElement?.tagName)) === "TEXTAREA",
    "Shift+Tab goes back to the field",
  );
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  const message = await waitText(page, alert(page));
  check(/20 secondes/.test(message), "keyboard: Enter on the button submits", message);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const onLevel = await page.evaluate(() => (document.activeElement as HTMLInputElement).value);
  check(onLevel === "lycee", "keyboard: reached the level group", onLevel);
  await page.keyboard.press("ArrowRight");
  check(await checked(page, "Supérieur"), "keyboard: ArrowRight picks Supérieur");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  check(await checked(page, "Tableau"), "keyboard: ArrowRight picks Tableau");
  check(await isDark(page), "keyboard: <html> has class dark");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("ArrowRight");
  await page.waitForURL(/\/en$/, { timeout: 15000 });
  await page.waitForTimeout(500);
  check(page.url().endsWith("/en"), "keyboard: ArrowRight on the language group lands on /en");
  check(await isDark(page), "keyboard: theme kept after the language switch");
  const focusAfter = await page.evaluate(() => (document.activeElement as HTMLInputElement).value);
  check(
    focusAfter === "en",
    "keyboard: focus stays on the language group after the switch",
    focusAfter,
  );
  check(
    (await field(page).inputValue()) === "la loi de la gravité",
    "keyboard: text kept after the switch",
  );
  await field(page).fill("");
  await context.close();
}

async function mobile(browser: Browser): Promise<void> {
  for (const locale of ["fr", "en"]) {
    console.log(`\n# phone (360 x 740, ${locale})`);
    const { context, page } = await open(browser, locale, {
      width: 360,
      height: 740,
      mobile: true,
    });
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    check(overflow.scroll <= overflow.client, "no horizontal overflow at 360 px", overflow);
    const box = await submit(page).boundingBox();
    check(
      box !== null && box.y >= 0 && box.y + box.height <= 740,
      "submit button inside the 360 x 740 viewport",
      box,
    );
    const fieldBox = await field(page).boundingBox();
    check(
      fieldBox !== null && fieldBox.y + fieldBox.height <= 740,
      "field inside the viewport",
      fieldBox,
    );
    check(
      (await page.evaluate(() => document.activeElement?.tagName)) !== "TEXTAREA",
      "field not focused on a touch device",
    );
    check((box?.height ?? 0) >= 44, "submit button is at least 44 px tall", box?.height);
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLLabelElement>("main fieldset label")].map((label) => {
        const rect = label.getBoundingClientRect();
        return {
          text: label.textContent?.trim() ?? "",
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      }),
    );
    check(
      sizes.length === 7 && sizes.every((size) => size.w >= 44 && size.h >= 44),
      "seven radio targets of at least 44 x 44 px",
      sizes,
    );
    await field(page).fill("");
    await page.keyboard.insertText("mot ".repeat(125));
    const long = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    check(long.scroll <= long.client, "no horizontal overflow with 500 characters typed", long);
    await field(page).fill("");
    await context.close();
  }

  console.log("\n# narrow phone (320 x 640, fr)");
  const { context, page } = await open(browser, "fr", { width: 320, height: 640, mobile: true });
  const narrow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(narrow.scroll <= narrow.client, "no horizontal overflow at 320 px", narrow);
  await context.close();
}

async function breakpoints(browser: Browser): Promise<void> {
  console.log("\n# breakpoints");
  for (const [width, height] of [
    [640, 900],
    [768, 1024],
    [1024, 768],
    [1280, 800],
  ] as const) {
    const { context, page } = await open(browser, "fr", { width, height });
    const size = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    check(size.scroll <= size.client, `no horizontal overflow at ${width} px`, size);
    const box = await submit(page).boundingBox();
    check(
      box !== null && box.y + box.height <= height,
      `submit visible at ${width} x ${height}`,
      box,
    );
    if (width === 768 || width === 1024) {
      await page.screenshot({ path: `${OUT}/width-${width}-paper-fr.png` });
    }
    await context.close();
  }
}

async function names(browser: Browser): Promise<void> {
  console.log("\n# accessible names");
  for (const locale of ["fr", "en"]) {
    const { context, page } = await open(browser, locale, { width: 1440, height: 900 });
    const snapshot = await page.locator("main").ariaSnapshot();
    const controls = snapshot
      .split("\n")
      .filter((line) => /^\s*- (textbox|radio|button|checkbox|combobox|slider)\b/.test(line));
    const unnamed = controls.filter((line) => !/"/.test(line));
    check(
      controls.length === 9 && unnamed.length === 0,
      `every form control has a name (${locale})`,
      {
        controls: controls.length,
        unnamed,
      },
    );
    const groups = await page.locator("fieldset legend").allTextContents();
    check(
      groups.length === 3 && groups.every((text) => text.trim() !== ""),
      `three radio groups with a legend (${locale})`,
      groups,
    );
    await context.close();
  }
}

async function screenshots(browser: Browser): Promise<void> {
  console.log("\n# screenshots");
  for (const [view, width, height, mobileView] of [
    ["desktop", 1440, 900, false],
    ["mobile", 360, 740, true],
  ] as const) {
    for (const board of [false, true]) {
      for (const locale of ["fr", "en"]) {
        const { context, page } = await open(browser, locale, {
          width,
          height,
          mobile: mobileView,
          board,
        });
        const theme = board ? "board" : "paper";
        check((await isDark(page)) === board, `${view} ${theme} ${locale}: theme applied`);
        await page.screenshot({ path: `${OUT}/${view}-${theme}-${locale}.png` });
        if (!mobileView && locale === "fr") {
          await page.evaluate(() => (document.activeElement as HTMLElement).blur());
          await page.screenshot({ path: `${OUT}/${view}-${theme}-${locale}-unfocused.png` });
        }
        const text =
          locale === "fr"
            ? "pourquoi la lune ne tombe pas sur la Terre alors que la pomme, elle, tombe sur le sol quand on la lâche d’une branche"
            : "why the moon does not fall onto the Earth while an apple falls to the ground when it is let go of a branch";
        await field(page).fill(text);
        await page.screenshot({ path: `${OUT}/${view}-${theme}-${locale}-typed.png` });
        await field(page).fill("");
        await context.close();
      }
    }
  }
  for (const [name, locale, width, height, mobileView, board] of [
    ["mobile-board-fr-error", "fr", 360, 740, true, true],
    ["mobile-paper-en-error", "en", 360, 740, true, false],
  ] as const) {
    const { context, page } = await open(browser, locale, {
      width,
      height,
      mobile: mobileView,
      board,
      reply: { kind: "reject", status: 429, retryAfter: "130", code: "rate_limited", message: "x" },
      quiet: true,
    });
    await field(page).fill(locale === "fr" ? "pourquoi le ciel est bleu" : "why the sky is blue");
    await submit(page).tap();
    await waitText(page, status(page), 2000);
    await page.screenshot({ path: `${OUT}/${name.replace("error", "pending")}.png` });
    await waitText(page, alert(page));
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await field(page).fill("");
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  await structure(browser);
  await preferences(browser);
  await submissions(browser);
  await keyboard(browser);
  await mobile(browser);
  await breakpoints(browser);
  await names(browser);
  await screenshots(browser);
} finally {
  await browser.close();
}

console.log(`info  layout script warnings ignored (client-side locale switch): ${layoutWarnings}`);
check(errors.length === 0, "no console error", errors.slice(0, 5));
console.log(failures.length === 0 ? "\nall checks passed" : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
