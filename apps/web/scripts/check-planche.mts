import { chromium } from "@playwright/test";

const out = ".snapshots/planche";
const browser = await chromium.launch();
const errors: string[] = [];
for (const [name, width, height, dark] of [
  ["desktop", 1280, 860, false],
  ["mobile", 390, 780, false],
  ["board", 1280, 860, true],
] as const) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("http://localhost:3000/fr/dev/planche", { waitUntil: "networkidle" });
  console.log(name, "initial", await page.getByTestId("status").textContent());
  await page.getByTestId("scene3").click();
  await page.waitForTimeout(300);
  await page.getByTestId("toggle").click();
  await page.waitForTimeout(4000);
  console.log(name, "playing", await page.getByTestId("status").textContent());
  await page.getByTestId("toggle").click();
  await page.waitForTimeout(300);
  console.log(name, "paused", await page.getByTestId("status").textContent());
  await page.screenshot({ path: `${out}/${name}.png` });
  await context.close();
}
console.log("errors:", JSON.stringify(errors.slice(0, 5)));
await browser.close();
