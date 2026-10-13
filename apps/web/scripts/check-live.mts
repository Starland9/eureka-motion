import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const out = ".snapshots/live";
mkdirSync(out, { recursive: true });

const CASES = [
  {
    locale: "fr",
    field: "Je n’ai pas compris",
    question: process.argv[2] ?? "pourquoi il y a des saisons",
  },
  { locale: "fr", field: "Je n’ai pas compris", question: process.argv[3] ?? "la loi d'Ohm" },
  { locale: "en", field: "I didn’t understand", question: process.argv[4] ?? "what inflation is" },
];

const browser = await chromium.launch();
for (const [index, item] of CASES.entries()) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { "X-Forwarded-For": `10.9.${Date.now() % 250}.${index + 1}` },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 160));
  });
  await page.goto(`http://localhost:3000/${item.locale}`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: item.field }).fill(item.question);
  const started = Date.now();
  const seconds = (): string => ((Date.now() - started) / 1000).toFixed(1);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/e\//, { timeout: 15_000 });
  const accepted = seconds();
  const ruler = page.getByRole("slider").first();
  let first: string;
  try {
    await page.waitForFunction(
      () =>
        Number(document.querySelector('[role="slider"]')?.getAttribute("aria-valuenow") ?? 0) > 0,
      undefined,
      { timeout: 70_000 },
    );
    first = seconds();
  } catch {
    first = "never";
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${index + 1}-playing.png` });
  let done: string;
  try {
    await page.waitForFunction(
      () => {
        const counter = document.querySelector('[data-slot="scene-list"] [role="status"]');
        const text = counter?.textContent ?? "";
        return text !== "" && !/ sur | out of /.test(text);
      },
      undefined,
      { timeout: 90_000 },
    );
    done = seconds();
  } catch {
    done = "never";
  }
  const audio = await page.evaluate(() => document.querySelectorAll("audio").length);
  const counter = await page
    .locator('[data-slot="scene-list"] [role="status"]')
    .textContent()
    .catch(() => null);
  const title = await page
    .locator("h1")
    .textContent()
    .catch(() => null);
  await page.screenshot({ path: `${out}/${index + 1}-done.png`, fullPage: true });
  console.log(
    JSON.stringify({
      question: item.question,
      accepted,
      first,
      done,
      audio,
      counter,
      title,
      value: await ruler.getAttribute("aria-valuetext").catch(() => null),
      errors: errors.slice(0, 3),
    }),
  );
  await context.close();
}
await browser.close();
