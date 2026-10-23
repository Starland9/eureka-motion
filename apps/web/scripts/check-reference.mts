import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = ".snapshots/reference";
const SIZES = [
  { name: "1440", width: 1440, height: 900 },
  { name: "360", width: 360, height: 740 },
] as const;

let failures = 0;

function check(condition: boolean, message: string, detail?: unknown): void {
  if (condition) {
    console.log(`ok    ${message}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${message}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
    });
    const page = await context.newPage();
    const failed: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().includes("favicon")) {
        failed.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    const links = page.locator("section[aria-labelledby] ul a");
    check((await links.count()) >= 1, `${size.name}: the home lists the reference explanations`);
    await page.screenshot({ path: `${OUT}/home-${size.name}.png`, fullPage: true });

    const started = Date.now();
    await links.first().click();
    await page.waitForURL(/\/fr\/e\//);
    const slider = page.getByRole("slider", { name: "Position dans l’explication" });
    await slider.waitFor({ timeout: 10000 });
    check(Date.now() - started < 2000, `${size.name}: the example starts in under 2 seconds`, {
      ms: Date.now() - started,
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/player-${size.name}.png` });
    check(failed.length === 0, `${size.name}: no request failed`, failed);
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
