import { expect, test, type Page } from "@playwright/test";

const VIDEO = "/demo/eureka-motion-demo.mp4";
const POSTER = "/demo/eureka-motion-demo.jpg";

const PAGES = {
  fr: {
    link: "Voir la démo en vidéo (1 min 52) →",
    submit: "Expliquer →",
    heading: "La démo en vidéo",
    label: "Vidéo de démonstration d’Eureka Motion",
    back: "← Poser ma propre question",
    title: "Démonstration — Eureka Motion",
  },
  en: {
    link: "Watch the demo video (1 min 52) →",
    submit: "Explain →",
    heading: "The demo on video",
    label: "Eureka Motion demo video",
    back: "← Ask my own question",
    title: "Demo — Eureka Motion",
  },
} as const;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const language of ["fr", "en"] as const) {
  const t = PAGES[language];

  test.describe(`in ${language}`, () => {
    test(`the home page leads to the demo page and back`, async ({ page, request }) => {
      await page.goto(`/${language}`);
      await page.getByRole("link", { name: t.link }).click();
      await expect(page).toHaveURL(new RegExp(`/${language}/demo$`));
      await expect(page).toHaveTitle(t.title);
      await expect(page.getByRole("heading", { level: 1, name: t.heading })).toBeVisible();

      const video = page.getByLabel(t.label);
      await expect(video).toBeVisible();
      await expect(video).toHaveAttribute("controls", "");
      await expect(video).toHaveAttribute("poster", POSTER);
      expect(await video.evaluate((element: HTMLVideoElement) => element.autoplay)).toBe(false);
      expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
      await expect(video.locator("source")).toHaveAttribute("src", VIDEO);

      const file = await request.get(VIDEO);
      expect(file.status()).toBe(200);
      expect(file.headers()["content-type"]).toBe("video/mp4");

      await page.getByRole("link", { name: t.back }).click();
      await expect(page).toHaveURL(new RegExp(`/${language}$`));
    });

    test("the demo page has no horizontal scroll and a 16:9 frame the width of the column", async ({
      page,
    }) => {
      await page.goto(`/${language}/demo`);
      const box = await page.getByLabel(t.label).boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs(box!.width / box!.height - 16 / 9)).toBeLessThan(0.01);
      await expectNoHorizontalScroll(page);
    });

    test("the demo link follows the field and the button in the tab order", async ({ page }) => {
      await page.goto(`/${language}`);
      const field = page.getByRole("textbox");
      const submit = page.getByRole("button", { name: t.submit });
      // The button enables once React has hydrated and taken the text in.
      await expect(async () => {
        await field.fill("la loi de la gravité");
        await expect(submit).toBeEnabled({ timeout: 1000 });
      }).toPass();
      await field.focus();
      await page.keyboard.press("Tab");
      await expect(submit).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: t.link })).toBeFocused();
    });

    test("the home page has no horizontal scroll with the link", async ({ page }) => {
      await page.goto(`/${language}`);
      await expect(page.getByRole("link", { name: t.link })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
}

test("the video file is served in ranges", async ({ request }) => {
  const response = await request.get(VIDEO, { headers: { Range: "bytes=0-99" } });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-type"]).toBe("video/mp4");
  expect((await response.body()).length).toBe(100);
});
