import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { GET } from "../../src/app/api/reference/route";
import { errorMessage } from "../../src/server/http/errors";
import { referenceId } from "../../src/server/reference";

const database = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error("The reference route must not open the database.");
  }),
  pingDb: vi.fn(),
}));

vi.mock("../../src/server/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/db/client")>()),
  ...database,
}));

const UNREACHABLE = "postgresql://eureka:eureka@127.0.0.1:1/eureka";

function get(query = "", headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(`http://localhost/api/reference${query}`, { headers }));
}

describe("GET /api/reference with the repository content and no database", () => {
  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", UNREACHABLE);
    vi.stubEnv("REFERENCE_DIR", "");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("serves the reference explanations of the language", async () => {
    const response = await get("?language=fr");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const list = (await response.json()) as Record<string, unknown>[];
    expect(list).toContainEqual({
      slug: reference.slug,
      subject: reference.subject,
      title: reference.title,
      reference_level: reference.reference_level,
      explanation_id: referenceId(reference.slug, "fr"),
    });
    expect(list.every((item) => Object.keys(item).length === 5)).toBe(true);
    expect(database.getDb).not.toHaveBeenCalled();
    expect(database.pingDb).not.toHaveBeenCalled();
  });

  it("lists only the files of the asked language", async () => {
    const list = (await (await get("?language=en")).json()) as { slug: string }[];
    expect(list.map((item) => item.slug)).not.toContain(reference.slug);
  });

  it("falls back on the language of the browser when none is asked", async () => {
    const list = (await (await get("", { "accept-language": "fr-FR,fr;q=0.9" })).json()) as {
      slug: string;
    }[];
    expect(list.map((item) => item.slug)).toContain(reference.slug);
  });

  it("refuses a language that is not offered", async () => {
    const response = await get("?language=de");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: errorMessage("fr", "invalid_request") },
    });
  });
});

describe("GET /api/reference with another content folder", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reference-route-"));
    const copy = (slug: string, subject: string, title: string) =>
      JSON.stringify({ ...structuredClone(reference), slug, subject, title });
    await writeFile(
      path.join(dir, "physics.universal-gravitation.fr.json"),
      copy(reference.slug, "physics", "Gravitation"),
    );
    await writeFile(
      path.join(dir, "maths.pythagoras.fr.json"),
      copy("maths/pythagoras", "maths", "Pythagore"),
    );
    vi.stubEnv("REFERENCE_DIR", dir);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers in subject order", async () => {
    const list = (await (await get("?language=fr")).json()) as { title: string }[];
    expect(list.map((item) => item.title)).toEqual(["Pythagore", "Gravitation"]);
  });

  it("answers 500 without leaking the cause when the folder is unreadable", async () => {
    vi.stubEnv("REFERENCE_DIR", path.join(dir, "missing"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await get("?language=fr");
    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("internal_error");
    expect(body).not.toContain("ENOENT");
    expect(body).not.toContain(dir);
  });
});
