import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { GET as getEvents } from "../../src/app/api/explanations/[id]/events/route";
import { GET as getExplanation } from "../../src/app/api/explanations/[id]/route";
import { GET as getVersions } from "../../src/app/api/explanations/[id]/versions/route";
import { GET as getMedia } from "../../src/app/media/[...path]/route";
import { referenceId } from "../../src/server/reference";
import { eventsIn, readSse } from "../helpers/sse";

const database = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error("A reference explanation must not open the database.");
  }),
}));

vi.mock("../../src/server/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/db/client")>()),
  ...database,
}));

const ORIGIN = "http://localhost:3000";
const ID = referenceId(reference.slug, "fr");

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("reference explanations served with no database", () => {
  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://eureka:eureka@127.0.0.1:1/eureka");
    vi.stubEnv("REFERENCE_DIR", "");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("describes a reference explanation like a stored one", async () => {
    const response = await getExplanation(
      new Request(`${ORIGIN}/api/explanations/${ID}`),
      context(ID),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      payload: { scenes: unknown[] };
      verdicts: unknown;
    };
    expect(body).toMatchObject({
      id: ID,
      kind: "reference",
      question: reference.question,
      status: "ready",
      language: "fr",
      level: reference.reference_level,
      title: reference.title,
      subject: reference.subject,
      concept_slug: reference.slug,
    });
    expect(body.payload.scenes).toHaveLength(reference.payload.scenes.length);
    expect(body.verdicts).toEqual(reference.verdicts);
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it("replays a reference explanation as a finished stream", async () => {
    const response = await getEvents(
      new Request(`${ORIGIN}/api/explanations/${ID}/events`),
      context(ID),
    );
    expect(response.status).toBe(200);
    const events = eventsIn(await readSse(response));
    const types = events.map((event) => event.type);
    expect(types[0]).toBe("accepted");
    expect(events[0]!.data).toMatchObject({ explanation_id: ID, cached: true });
    expect(types).toContain("meta");
    expect(types).toContain("plan");
    expect(types.filter((type) => type === "scene")).toHaveLength(reference.payload.scenes.length);
    expect(types.at(-1)).toBe("done");
    expect(events.at(-1)!.data).toMatchObject({ status: "ready", share_url: `/fr/e/${ID}` });
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it("lists a reference as its own session while the database is down", async () => {
    const response = await getVersions(
      new Request(`${ORIGIN}/api/explanations/${ID}/versions`),
      context(ID),
    );
    expect(response.status).toBe(200);
    const versions = (await response.json()) as { id: string; kind: string; scene_title: null }[];
    expect(versions).toEqual([
      expect.objectContaining({ id: ID, kind: "reference", scene_title: null }),
    ]);
  });

  it("resumes the replay after a given event", async () => {
    const response = await getEvents(
      new Request(`${ORIGIN}/api/explanations/${ID}/events?after=2`),
      context(ID),
    );
    const events = eventsIn(await readSse(response));
    expect(events[0]!.id).toBeGreaterThan(2);
    expect(events.at(-1)!.type).toBe("done");
  });
});

describe("reference audio served from the repository content", () => {
  let content: string;
  let media: string;
  const audioId = "ab23cd45ef67";
  const bytes = Buffer.from("0123456789");

  beforeAll(async () => {
    content = await mkdtemp(path.join(tmpdir(), "reference-audio-"));
    media = await mkdtemp(path.join(tmpdir(), "reference-media-"));
    await mkdir(path.join(content, "audio", audioId), { recursive: true });
    await writeFile(path.join(content, "audio", audioId, "s1-b1.mp3"), bytes);
    vi.stubEnv("REFERENCE_DIR", content);
    vi.stubEnv("MEDIA_DIR", media);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(content, { recursive: true, force: true });
    await rm(media, { recursive: true, force: true });
  });

  function media_(segments: string[], headers: Record<string, string> = {}) {
    return getMedia(new Request(`${ORIGIN}/media/${segments.join("/")}`, { headers }), {
      params: Promise.resolve({ path: segments }),
    });
  }

  it("falls back on the reference audio when the media directory has no such file", async () => {
    const response = await media_([audioId, "s1-b1.mp3"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("honours byte ranges on reference audio", async () => {
    const response = await media_([audioId, "s1-b1.mp3"], { range: "bytes=2-4" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("234");
  });

  it("prefers the file of the media directory", async () => {
    await mkdir(path.join(media, audioId), { recursive: true });
    await writeFile(path.join(media, audioId, "s1-b1.mp3"), "generated");
    const response = await media_([audioId, "s1-b1.mp3"]);
    expect(await response.text()).toBe("generated");
  });

  it("answers 404 for a file neither directory holds", async () => {
    expect((await media_([audioId, "missing.mp3"])).status).toBe(404);
    expect((await media_(["..", "secret.mp3"])).status).toBe(404);
  });
});
