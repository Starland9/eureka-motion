// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepVersion, type DeepInitial } from "@/components/player/DeepVersion";
import { MAX_POLL_FAILURES, parseDeep, POLL_MS } from "@/components/player/deep-version";
import { messages } from "@/i18n/messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = messages.fr.Deep;
const ID = "kkkkkkkkkkk2";
const OTHER_ID = "mmmmmmmmmmm3";
const RESULT = `/media/${ID}/deep.mp4`;
const mounted: { root: Root; host: HTMLElement }[] = [];

type Step = Response | Error | Promise<Response>;

function reply(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const answer = (status: string, result_url: string | null = null) =>
  reply(200, { status, result_url });

function stubServer(steps: Step[]) {
  const calls: { url: string; signal: AbortSignal | undefined }[] = [];
  const queue = [...steps];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), signal: init?.signal ?? undefined });
    const step = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (step instanceof Error) throw step;
    return step;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function tree(explanationId: string, initial?: DeepInitial | null) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages.fr}>
      <DeepVersion explanationId={explanationId} initial={initial} />
    </NextIntlClientProvider>
  );
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(initial?: DeepInitial | null, explanationId = ID) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(tree(explanationId, initial)));
  await settle();
  return {
    host,
    status: () => host.querySelector('[role="status"]'),
    link: () => host.querySelector("a"),
    rerender: (next: DeepInitial | null | undefined, id = explanationId) =>
      act(() => root.render(tree(id, next))),
    unmount: () => {
      act(() => root.unmount());
      mounted.pop();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DeepVersion", () => {
  it.each(["none", "abandoned"])(
    "shows nothing and asks nothing when the status is %s",
    async (status) => {
      const calls = stubServer([answer("queued")]);
      const { host } = await mount({ status });

      await settle(10 * POLL_MS);

      expect(host.innerHTML).toBe("");
      expect(calls).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["queued", "running"])(
    "shows the margin line, in a status region, while the status is %s",
    async (status) => {
      stubServer([answer(status)]);
      const { host, status: region, link } = await mount({ status });

      expect(host.querySelector('[data-slot="deep"]')).not.toBeNull();
      expect(region()?.textContent).toBe(t.preparing);
      expect(region()?.className).toContain("text-caption");
      expect(link()).toBeNull();
    },
  );

  it("reserves a 44 px line from the first render when a job is announced", async () => {
    stubServer([answer("queued")]);
    const { host } = await mount({ status: "queued" });

    expect(host.querySelector('[data-slot="deep"]')?.className).toContain("min-h-11");
  });

  it("reads the status every 10 seconds, one read at a time", async () => {
    const calls = stubServer([answer("queued"), answer("running"), answer("running")]);
    await mount({ status: "queued" });
    expect(POLL_MS).toBe(10_000);

    expect(calls).toHaveLength(0);
    await settle(POLL_MS - 1);
    expect(calls).toHaveLength(0);
    await settle(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/explanations/${ID}/deep`);

    await settle(POLL_MS);
    expect(calls).toHaveLength(2);
    await settle(POLL_MS);
    expect(calls).toHaveLength(3);
  });

  it("waits for a slow answer before arming the next read", async () => {
    let finish: (response: Response) => void = () => undefined;
    const calls = stubServer([new Promise<Response>((resolve) => (finish = resolve))]);
    await mount({ status: "running" });

    await settle(5 * POLL_MS);
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    finish(answer("running"));
    await settle(POLL_MS);
    expect(calls).toHaveLength(2);
  });

  it("turns into the link, opened in a new tab, once it is ready, and reads no more", async () => {
    const calls = stubServer([answer("running"), answer("ready", RESULT)]);
    const { host, status, link } = await mount({ status: "queued" });

    await settle(POLL_MS);
    expect(status()?.textContent).toBe(t.preparing);
    expect(link()).toBeNull();

    await settle(POLL_MS);
    expect(host.querySelector('[data-slot="deep"]')?.className).toContain("min-h-11");
    expect(link()?.textContent).toBe(t.watch);
    expect(link()?.getAttribute("href")).toBe(RESULT);
    expect(link()?.getAttribute("target")).toBe("_blank");
    expect(link()?.getAttribute("rel")).toBe("noopener");
    expect(link()?.className).toContain("h-11");
    expect(link()?.className).toContain("underline");
    expect(host.textContent).not.toContain(t.preparing);
    expect(vi.getTimerCount()).toBe(0);

    await settle(10 * POLL_MS);
    expect(calls).toHaveLength(2);
  });

  it("tells that the link opens in a new tab through its description, not its name", async () => {
    stubServer([answer("ready", RESULT)]);
    const { link } = await mount(null);

    const hint = document.getElementById(link()?.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe(t.newTab);
    expect(link()?.textContent).toBe(t.watch);
  });

  it("announces the passage to ready once, in the same status region", async () => {
    stubServer([answer("running"), answer("ready", RESULT)]);
    const { status } = await mount({ status: "queued" });
    const region = status();
    const announced: string[] = [];

    for (let beat = 0; beat < 3; beat += 1) {
      await settle(POLL_MS);
      announced.push(status()?.textContent ?? "");
    }

    expect(announced).toEqual([t.preparing, t.ready, t.ready]);
    expect(status()).toBe(region);
  });

  it("announces nothing when the video was already ready at mount", async () => {
    stubServer([answer("ready", RESULT)]);
    const { status, link } = await mount(null);

    expect(link()?.getAttribute("href")).toBe(RESULT);
    expect(status()?.textContent).toBe("");
  });

  it("does not follow the job when nothing was announced and the single read finds no work", async () => {
    const calls = stubServer([answer("none")]);
    const { host } = await mount(undefined);

    expect(calls).toHaveLength(1);
    await settle(10 * POLL_MS);

    expect(calls).toHaveLength(1);
    expect(host.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads once at mount when the status is unknown, then follows only a job", async () => {
    const calls = stubServer([answer("queued"), answer("running"), answer("ready", RESULT)]);
    const { status, link } = await mount(null);

    expect(calls).toHaveLength(1);
    expect(status()?.textContent).toBe(t.preparing);

    await settle(POLL_MS);
    expect(calls).toHaveLength(2);
    await settle(POLL_MS);
    expect(calls).toHaveLength(3);
    expect(link()?.getAttribute("href")).toBe(RESULT);
    expect(status()?.textContent).toBe(t.ready);

    await settle(10 * POLL_MS);
    expect(calls).toHaveLength(3);
  });

  it("reads once for a status it does not know", async () => {
    const calls = stubServer([answer("none")]);
    await mount({ status: "unheard-of" });

    await settle(10 * POLL_MS);
    expect(calls).toHaveLength(1);
  });

  it("reads once to find the video of an announced ready status that carries no address", async () => {
    const calls = stubServer([answer("ready", RESULT)]);
    const { link } = await mount({ status: "ready" });

    expect(calls).toHaveLength(1);
    expect(link()?.getAttribute("href")).toBe(RESULT);
  });

  it("makes the line disappear without any message when the work is abandoned", async () => {
    stubServer([answer("running"), answer("abandoned")]);
    const { host, status } = await mount({ status: "queued" });
    expect(status()?.textContent).toBe(t.preparing);

    await settle(2 * POLL_MS);

    expect(host.innerHTML).toBe("");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("makes the line disappear when the work or the explanation is gone, or the video has no address", async () => {
    for (const second of [answer("none"), reply(404), reply(410), answer("ready")]) {
      stubServer([second]);
      const { host } = await mount({ status: "running" });
      await settle(POLL_MS);
      expect(host.innerHTML).toBe("");
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("stops quietly after three failures in a row, and the line disappears", async () => {
    const calls = stubServer([new Error("offline")]);
    const { host, status } = await mount({ status: "queued" });
    expect(MAX_POLL_FAILURES).toBe(3);

    for (let failure = 1; failure < MAX_POLL_FAILURES; failure += 1) {
      await settle(POLL_MS);
      expect(calls).toHaveLength(failure);
      expect(status()?.textContent).toBe(t.preparing);
    }
    await settle(POLL_MS);

    expect(calls).toHaveLength(MAX_POLL_FAILURES);
    expect(host.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    await settle(10 * POLL_MS);
    expect(calls).toHaveLength(MAX_POLL_FAILURES);
  });

  it.each([
    ["a server error", reply(500)],
    ["an unreadable answer", { ...reply(200), json: () => Promise.reject(new Error("x")) }],
    ["an unknown status", answer("exploded")],
    ["a body that is not an object", reply(200, "ok")],
  ])("counts %s as a failure", async (_name, failure) => {
    const calls = stubServer([failure]);
    const { host } = await mount({ status: "running" });

    await settle(MAX_POLL_FAILURES * POLL_MS);

    expect(calls).toHaveLength(MAX_POLL_FAILURES);
    expect(host.innerHTML).toBe("");
  });

  it("counts only failures in a row", async () => {
    const calls = stubServer([
      new Error("offline"),
      new Error("offline"),
      answer("running"),
      new Error("offline"),
      new Error("offline"),
      answer("ready", RESULT),
    ]);
    const { link, status } = await mount({ status: "queued" });

    await settle(5 * POLL_MS);
    expect(status()?.textContent).toBe(t.preparing);
    await settle(POLL_MS);

    expect(calls).toHaveLength(6);
    expect(link()?.getAttribute("href")).toBe(RESULT);
  });

  it("shows nothing and stops when the single read fails", async () => {
    const calls = stubServer([new Error("offline")]);
    const { host } = await mount(null);

    await settle(10 * POLL_MS);

    expect(calls).toHaveLength(1);
    expect(host.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the follow-up on unmount: no timer, no read, the pending one aborted", async () => {
    let finish: (response: Response) => void = () => undefined;
    const calls = stubServer([
      answer("running"),
      new Promise<Response>((resolve) => (finish = resolve)),
    ]);
    const { unmount } = await mount({ status: "queued" });
    await settle(POLL_MS);
    expect(calls).toHaveLength(1);
    await settle(POLL_MS);
    expect(calls).toHaveLength(2);

    unmount();
    expect(calls[1]?.signal?.aborted).toBe(true);
    finish(answer("running"));
    await settle(10 * POLL_MS);

    expect(calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the waiting timer on unmount", async () => {
    const calls = stubServer([answer("running")]);
    const { unmount } = await mount({ status: "queued" });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await settle(10 * POLL_MS);
    expect(calls).toHaveLength(0);
  });

  it("starts following when the stream announces the job after a single read found none", async () => {
    const calls = stubServer([answer("none"), answer("ready", RESULT)]);
    const { host, rerender, link } = await mount(null);
    expect(host.innerHTML).toBe("");

    rerender({ status: "queued" });
    await settle();
    expect(host.textContent).toContain(t.preparing);

    await settle(POLL_MS);
    expect(calls).toHaveLength(2);
    expect(link()?.getAttribute("href")).toBe(RESULT);
  });

  it("follows the explanation shown: another identifier restarts the line", async () => {
    const calls = stubServer([answer("ready", RESULT)]);
    const { rerender, link } = await mount({ status: "queued" });

    rerender({ status: "queued" }, OTHER_ID);
    await settle(POLL_MS);

    expect(calls.map(({ url }) => url)).toEqual([`/api/explanations/${OTHER_ID}/deep`]);
    expect(link()?.getAttribute("href")).toBe(RESULT);
  });

  it("escapes the identifier in the address it reads", async () => {
    const calls = stubServer([answer("none")]);
    await mount(null, "a/b c");

    expect(calls[0]?.url).toBe("/api/explanations/a%2Fb%20c/deep");
  });
});

describe("parseDeep", () => {
  it("reads the status and the address of the video", () => {
    expect(parseDeep({ status: "ready", result_url: RESULT })).toEqual({
      status: "ready",
      resultUrl: RESULT,
    });
    expect(parseDeep({ status: "none", result_url: null })).toEqual({
      status: "none",
      resultUrl: null,
    });
    expect(parseDeep({ status: "queued" })).toEqual({ status: "queued", resultUrl: null });
    expect(parseDeep({ status: "ready", result_url: "" })?.resultUrl).toBeNull();
  });

  it("refuses what is not an answer of the contract", () => {
    for (const value of [null, undefined, "ready", 3, [], {}, { status: "done" }, { status: 1 }]) {
      expect(parseDeep(value)).toBeNull();
    }
  });
});
