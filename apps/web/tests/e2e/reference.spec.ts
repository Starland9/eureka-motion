import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

type Language = "fr" | "en";

interface ReferenceItem {
  slug: string;
  subject: string;
  title: string;
  reference_level: string;
  explanation_id: string;
}

interface Messages {
  [key: string]: Messages | string;
}

const LANGUAGES: readonly Language[] = ["fr", "en"];
const COMPLETE = process.env.REFERENCE_EXPECT_COMPLETE === "1";
const EXPECTED_PER_LANGUAGE = 12;
const START_BUDGET_MS = 2000;
const WARM_UP_MS = 60_000;
const PLAYBACK_MS = 20_000;
const PER_REFERENCE_MS = 25_000;
const LOCAL_PROTOCOLS = new Set(["data:", "blob:", "about:"]);

// React logs this in development only, from the playback loop of @remotion/player.
const KNOWN_DEV_WARNING = /^Maximum update depth exceeded/;

function loadMessages(language: Language): Messages {
  const dir = path.join(__dirname, "../../messages", language);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  return Object.assign(
    {},
    ...files.map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Messages),
  );
}

const MESSAGES: Record<Language, Messages> = { fr: loadMessages("fr"), en: loadMessages("en") };

function message(language: Language, key: string): string {
  let node: Messages | string | undefined = MESSAGES[language];
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`No message ${key} in ${language}`);
  return node;
}

function watchPage(page: Page, origin: string): () => string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (entry) => {
    if (entry.type() === "error" && !KNOWN_DEV_WARNING.test(entry.text())) {
      problems.push(`console error: ${entry.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "unknown";
    if (reason !== "net::ERR_ABORTED") problems.push(`request failed (${reason}) ${request.url()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!LOCAL_PROTOCOLS.has(url.protocol) && url.origin !== origin) {
      problems.push(`external request ${request.url()}`);
    }
  });
  return () => problems;
}

async function listReferences(
  request: APIRequestContext,
  language: Language,
): Promise<ReferenceItem[]> {
  const response = await request.get(`/api/reference?language=${language}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as ReferenceItem[];
}

function contents(page: Page, language: Language): Locator {
  return page.getByRole("region", { name: message(language, "Ask.sommaire.title"), exact: true });
}

function ruler(page: Page, language: Language): Locator {
  return page.getByRole("slider", { name: message(language, "Transport.ruler") });
}

async function position(page: Page, language: Language): Promise<number> {
  return Number(await ruler(page, language).getAttribute("aria-valuenow"));
}

async function expectEveryScene(
  page: Page,
  request: APIRequestContext,
  language: Language,
  id: string,
): Promise<void> {
  const response = await request.get(`/api/explanations/${id}`);
  expect(response.status()).toBe(200);
  const { payload } = (await response.json()) as { payload: { scenes: { title: string }[] } };

  const list = page.getByRole("list", { name: message(language, "Scenes.label"), exact: true });
  const ready = list.locator("li[data-state=ready]");
  await expect(list.getByRole("listitem")).toHaveCount(payload.scenes.length);
  await expect(ready).toHaveCount(payload.scenes.length);
  for (const [index, scene] of payload.scenes.entries()) {
    await expect(ready.nth(index)).toContainText(scene.title);
  }
}

test.describe("with the database stopped", () => {
  test("health reports the database down while the reference list answers", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    const { checks } = (await health.json()) as { checks: { database: boolean } };
    expect(checks.database).toBe(false);

    for (const language of LANGUAGES) {
      expect(Array.isArray(await listReferences(request, language))).toBe(true);
    }
  });

  for (const language of LANGUAGES) {
    test.describe(language, () => {
      test("the contents lists the reference explanations", async ({ page, request }) => {
        const references = await listReferences(request, language);
        test.skip(
          references.length === 0 && !COMPLETE,
          `no ${language} reference document produced yet`,
        );

        await page.goto(`/${language}`);
        const links = contents(page, language).getByRole("link");
        expect(references.length).toBeGreaterThanOrEqual(1);
        await expect(links).toHaveCount(references.length);

        for (const reference of references) {
          const link = contents(page, language).locator(
            `a[href="/${language}/e/${reference.explanation_id}"]`,
          );
          await expect(link).toContainText(reference.title);
          await expect(link).toContainText(message(language, `Level.${reference.reference_level}`));
        }
      });

      test("every reference starts in under 2 seconds and plays", async ({
        page,
        request,
        baseURL,
      }) => {
        const references = await listReferences(request, language);
        test.skip(
          references.length === 0 && !COMPLETE,
          `no ${language} reference document produced yet`,
        );
        expect(references.length).toBeGreaterThanOrEqual(1);
        test.setTimeout(WARM_UP_MS + references.length * PER_REFERENCE_MS);

        const problems = watchPage(page, new URL(baseURL ?? "").origin);
        const play = page
          .getByRole("button", { name: message(language, "Explanation.play") })
          .or(
            page.getByRole("button", {
              name: message(language, "Transport.play"),
              exact: true,
            }),
          )
          .first();

        // The first request of a route compiles it in development: warm it up outside the measure.
        await page.goto(`/${language}/e/${references[0]?.explanation_id}`);
        await expect(ruler(page, language)).toBeVisible({ timeout: WARM_UP_MS });

        for (const reference of references) {
          const id = reference.explanation_id;
          await test.step(`${language} ${reference.slug}`, async () => {
            await page.goto(`/${language}`);
            const link = contents(page, language).locator(`a[href="/${language}/e/${id}"]`);
            await expect(link).toBeVisible();

            const started = Date.now();
            await link.click();
            await expect(page).toHaveURL(new RegExp(`/${language}/e/${id}$`));
            await ruler(page, language)
              .or(page.getByRole("button", { name: message(language, "Explanation.play") }))
              .first()
              .waitFor({ state: "visible", timeout: WARM_UP_MS });
            const elapsed = Date.now() - started;
            test.info().annotations.push({ type: "start", description: `${id}: ${elapsed} ms` });
            expect(elapsed, `SC-002: ${id} ready after ${elapsed} ms`).toBeLessThan(
              START_BUDGET_MS,
            );

            await expect(page.locator("html")).toHaveAttribute("lang", language);
            await expect(page.locator("main#content .__remotion-player")).toBeVisible();
            await expect(ruler(page, language)).toBeVisible();

            await play.click();
            await expect(
              page.getByRole("button", {
                name: message(language, "Transport.pause"),
                exact: true,
              }),
            ).toBeVisible();
            await expect
              .poll(() => position(page, language), { timeout: PLAYBACK_MS })
              .toBeGreaterThanOrEqual(1);

            await expectEveryScene(page, request, language, id);
            expect(problems()).toEqual([]);
          });
        }
      });
    });
  }

  test.describe("complete set", () => {
    test.skip(
      !COMPLETE,
      "REFERENCE_EXPECT_COMPLETE=1 is not set: the 24 documents are not all produced",
    );

    for (const language of LANGUAGES) {
      test(`${language} lists exactly ${EXPECTED_PER_LANGUAGE} references`, async ({
        page,
        request,
      }) => {
        expect(await listReferences(request, language)).toHaveLength(EXPECTED_PER_LANGUAGE);
        await page.goto(`/${language}`);
        await expect(contents(page, language).getByRole("link")).toHaveCount(EXPECTED_PER_LANGUAGE);
      });
    }
  });
});
