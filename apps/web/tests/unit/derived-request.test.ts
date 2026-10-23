import { describe, expect, it } from "vitest";
import { startBody } from "../../src/components/explanation/request-body";
import {
  createExplanationClient,
  type ExplanationClient,
  type ExplanationSnapshot,
} from "../../src/components/explanation/stream";
import type { StartRequest } from "../../src/components/explanation/types";
import { parseVersions } from "../../src/components/explanation/versions-list";
import { encodeEvent } from "../../src/server/http/sse";
import type { PipelineEvent, SequencedEvent } from "../../src/server/pipeline/events";

const PARENT = "kkkkkkkkkkk2";
const CHILD = "mmmmmmmmmmm3";
const OTHER = "nnnnnnnnnnn4";
const BASE = { language: "fr", level: "lycee" } as const;

describe("startBody", () => {
  it("keeps the body of a free question, with the interpretation of a clarification", () => {
    expect(startBody({ question: "la gravité", ...BASE, interpretation: "La planète" })).toEqual({
      question: "la gravité",
      ...BASE,
      interpretation: "La planète",
    });
  });

  it.each(["another_analogy", "simpler"] as const)(
    "sends the parent only for %s, without any question",
    (mode) => {
      const request: StartRequest = {
        question: "",
        ...BASE,
        derive: { mode, parentId: PARENT },
      };
      expect(JSON.parse(JSON.stringify(startBody(request)))).toEqual({
        mode,
        parent_id: PARENT,
        ...BASE,
      });
    },
  );

  it("sends the designated scene for a zoom", () => {
    const request: StartRequest = {
      question: "",
      ...BASE,
      derive: { mode: "zoom", parentId: PARENT, sceneId: "s3" },
    };
    expect(startBody(request)).toEqual({
      mode: "zoom",
      parent_id: PARENT,
      scene_id: "s3",
      ...BASE,
    });
  });

  it("sends the question of a follow-up", () => {
    const request: StartRequest = {
      question: "la distance double",
      ...BASE,
      derive: { mode: "followup", parentId: PARENT },
    };
    expect(startBody(request)).toEqual({
      mode: "followup",
      parent_id: PARENT,
      question: "la distance double",
      ...BASE,
    });
  });
});

describe("parseVersions", () => {
  it("keeps the identifier, the kind and the title of the zoomed scene", () => {
    expect(
      parseVersions([
        { id: "a", kind: "initial", title: "T", created_at: "x", scene_title: null },
        { id: "b", kind: "zoom", title: "T", created_at: "x", scene_title: "Deux masses" },
        { id: "c", kind: "zoom", title: "T", created_at: "x", scene_title: "" },
        { id: "d", kind: "followup", title: "T", created_at: "x", scene_title: null },
      ]),
    ).toEqual([
      { id: "a", kind: "initial" },
      { id: "b", kind: "zoom", scene: "Deux masses" },
      { id: "c", kind: "zoom" },
      { id: "d", kind: "followup" },
    ]);
  });

  it("lists a reference as the initial version and skips what it does not know", () => {
    expect(
      parseVersions([
        { id: "r", kind: "reference" },
        { id: "x", kind: "mystery" },
        { kind: "simpler" },
        null,
        "text",
      ]),
    ).toEqual([{ id: "r", kind: "initial" }]);
  });

  it("answers an empty list when the body is not a list", () => {
    expect(parseVersions({ error: { code: "not_found" } })).toEqual([]);
    expect(parseVersions(undefined)).toEqual([]);
  });
});

const encoder = new TextEncoder();

function stream(events: PipelineEvent[]): Response {
  const items: SequencedEvent[] = events.map((event, index) => ({ seq: index + 1, event }));
  return new Response(encoder.encode(items.map(encodeEvent).join("")), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

function clientFor(handler: (request: Recorded) => Response) {
  const requests: Recorded[] = [];
  const client = createExplanationClient({
    fetch: async (input, init) => {
      const request: Recorded = {
        method: init?.method ?? "GET",
        url: String(input),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);
      return handler(request);
    },
    wait: async () => undefined,
    interfaceLanguage: () => "fr",
  });
  return { client, requests };
}

function until(
  client: ExplanationClient,
  predicate: (snapshot: ExplanationSnapshot) => boolean,
): Promise<ExplanationSnapshot> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (!predicate(client.getSnapshot())) return;
      unsubscribe();
      resolve(client.getSnapshot());
    };
    const unsubscribe = client.subscribe(check);
    check();
  });
}

const record = (level: string) =>
  Response.json({ id: CHILD, kind: "simpler", language: "fr", level, provider: "p", model: "m" });

describe("a derived request through the client", () => {
  it("posts the mode and the parent, then shows the level of the stored version", async () => {
    const { client, requests } = clientFor((request) =>
      request.method === "POST"
        ? stream([
            { type: "accepted", explanation_id: CHILD, cached: false },
            { type: "done", status: "ready", share_url: `/fr/e/${CHILD}` },
          ])
        : record("college"),
    );
    const outcome = await client.start({
      question: "",
      ...BASE,
      derive: { mode: "simpler", parentId: PARENT },
    });
    expect(outcome).toEqual({ kind: "accepted", id: CHILD });
    expect(requests[0]?.body).toEqual({ mode: "simpler", parent_id: PARENT, ...BASE });

    const { state } = await until(client, (snapshot) => snapshot.state?.level === "college");
    expect(state).toMatchObject({ id: CHILD, status: "ready", level: "college" });
    expect(requests.at(-1)?.url).toBe(`/api/explanations/${CHILD}`);
  });

  it("notes a redirection and keeps it when the concept is served from the cache", async () => {
    const { client } = clientFor((request) =>
      request.method === "POST"
        ? stream([
            { type: "accepted", explanation_id: CHILD, cached: false },
            { type: "redirected", reason: "unrelated_followup" },
            { type: "cached", explanation_id: OTHER },
          ])
        : request.url.includes("/events")
          ? stream([])
          : record("lycee"),
    );
    await client.start({
      question: "comment les plantes fabriquent-elles leur sucre ?",
      ...BASE,
      derive: { mode: "followup", parentId: PARENT },
    });
    const redirected = await until(client, (snapshot) => snapshot.state?.redirectTo === OTHER);
    expect(redirected.state).toMatchObject({ id: CHILD, redirected: true });

    client.open(OTHER);
    client.open(OTHER);
    const opened = await until(client, (snapshot) => snapshot.state?.id === OTHER);
    expect(opened.state?.redirected).toBe(true);

    client.open(PARENT);
    const elsewhere = await until(client, (snapshot) => snapshot.state?.id === PARENT);
    expect(elsewhere.state?.redirected).toBe(false);
  });
});
