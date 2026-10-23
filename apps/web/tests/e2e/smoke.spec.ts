import { expect, test } from "@playwright/test";

const PAPER_SURFACE = "rgb(243, 238, 227)";
const BOARD_SURFACE = "rgb(20, 28, 25)";
const FONT_FAMILIES = ["Bodoni Moda", "STIX Two Text", "IBM Plex Mono"];

for (const locale of ["fr", "en"]) {
  test(`/ redirects to /${locale} from Accept-Language: ${locale}`, async ({ request }) => {
    const response = await request.get("/", {
      headers: { "Accept-Language": locale },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toMatch(new RegExp(`/${locale}$`));
  });

  test.describe(`browser language ${locale}`, () => {
    test.use({ locale });

    test(`/ lands on /${locale} and <html lang> matches`, async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(new RegExp(`/${locale}$`));
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("main#content")).toHaveCount(1);
    });
  });
}

test("the sentence is set in Bodoni Moda and every font request stays on the origin", async ({
  page,
  baseURL,
}) => {
  const fontUrls: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontUrls.push(request.url());
  });

  await page.goto("/fr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const family = await page
    .locator("label", { hasText: "Je n’ai pas compris" })
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family.replace(/^["']/, "").startsWith("Bodoni Moda")).toBe(true);

  const loadedFaces = await page.evaluate(
    (families) =>
      Promise.all(
        families.map(async (name) => (await document.fonts.load(`16px "${name}"`)).length),
      ),
    FONT_FAMILIES,
  );
  expect(loadedFaces.every((count) => count > 0)).toBe(true);

  expect(fontUrls.length).toBeGreaterThan(0);
  for (const url of fontUrls) {
    expect(new URL(url).origin).toBe(new URL(baseURL ?? "").origin);
  }
});

test("the class dark switches the page to the board surface", async ({ page }) => {
  await page.goto("/fr");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe(PAPER_SURFACE);

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  expect(await background()).toBe(BOARD_SURFACE);
});

test.describe("system preference is dark", () => {
  test.use({ colorScheme: "dark" });

  test("the paper theme still applies by default", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("a stored board choice applies before paint", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("eureka.theme", "board"));
    await page.goto("/fr");
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
