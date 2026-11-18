import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = path.join(root, "docs/finale/slides.html");
const target = path.join(root, "docs/finale/slides.pdf");
const shots = process.argv.find((arg) => arg.startsWith("--shots="))?.slice("--shots=".length);

async function main(): Promise<void> {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(pathToFileURL(source).href);
    const missing = await page.evaluate(async () => {
      await document.fonts.ready;
      const faces = [
        '600 64px "Bodoni Moda"',
        '400 34px "STIX Two Text"',
        '500 24px "IBM Plex Mono"',
      ];
      return faces.filter((face) => !document.fonts.check(face));
    });
    if (missing.length > 0) throw new Error(`Polices non chargées : ${missing.join(", ")}`);
    const broken = await page.evaluate(() =>
      [...document.images]
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.src),
    );
    if (broken.length > 0) throw new Error(`Images non chargées : ${broken.join(", ")}`);

    await page.pdf({ path: target, width: "1920px", height: "1080px", printBackground: true });
    console.log(`PDF : ${path.relative(root, target)}`);

    if (shots) {
      const slides = page.locator("section.slide");
      const count = await slides.count();
      for (let index = 0; index < count; index += 1) {
        const file = path.resolve(shots, `slide-${index + 1}.png`);
        await slides.nth(index).screenshot({ path: file });
        console.log(`Image : ${file}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
