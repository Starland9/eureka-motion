import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3000/fr/proto/player";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.goto(url, { waitUntil: "networkidle" });
await page.getByTestId("play").click();
for (let second = 0; second <= 24; second += 2) {
  const status = await page.getByTestId("status").textContent();
  console.log(`${String(second).padStart(2)}s ${status}`);
  await page.waitForTimeout(2000);
}
console.log("log:", await page.getByTestId("log").textContent());
console.log("errors:", JSON.stringify(errors.slice(0, 5)));
await browser.close();
