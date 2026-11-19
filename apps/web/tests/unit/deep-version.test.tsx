// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepVersion, type DeepInitial } from "@/components/player/DeepVersion";
import { MAX_POLL_FAILURES, parseDeep, POLL_MS, readDeep } from "@/components/player/deep-version";
import { messages } from "@/i18n/messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = messages.fr.Deep;
const QUEUED = "Version approfondie [en file]";
const RUNNING = "Version approfondie [rendu en cours]";
const UNAVAILABLE = "Version approfondie [non disponible]";
const FAILED = "Le rendu n’a pas abouti. L’explication ci-dessus reste complète.";
const DURATION = "2 à 4 min environ";
const ID = "kkkkkkkkkkk2";
const OTHER_ID = "mmmmmmmmmmm3";
const RESULT = `/media/${ID}/deep.mp4`;
const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const mounted: { root: Root; host: HTMLElement }[] = [];

type Step = Response | Error | Promise<Response>;

function reply(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();

interface Times {
  queued_at?: unknown;
  started_at?: unknown;
}

const answer = (status: string, result_url: string | null = null, times: Times = {}) =>
  reply(200, { status, result_url, ...times });

const queuedFor = (seconds: number) =>
  answer("queued", null, { queued_at: ago(seconds), started_at: null });

const runningFor = (seconds: number, startedSeconds = seconds - 5) =>
  answer("running", null, { queued_at: ago(seconds), started_at: ago(startedSeconds) });

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

type Locale = "fr" | "en";

function tree(explanationId: string, initial?: DeepInitial | null, locale: Locale = "fr") {
  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <DeepVersion explanationId={explanationId} initial={initial} />
    </NextIntlClientProvider>
  );
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(initial?: DeepInitial | null, explanationId = ID, locale: Locale = "fr") {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(tree(explanationId, initial, locale)));
  await settle();
  return {
    host,
    status: () => host.querySelector('[role="status"]'),
    estimate: () => host.querySelector('[data-slot="deep-estimate"]'),
    counter: () => host.querySelector('[aria-hidden="true"]'),
    link: () => host.querySelector("a"),
    rerender: (next: DeepInitial | null | undefined, id = explanationId) =>
      act(() => root.render(tree(id, next, locale))),
    unmount: () => {
      act(() => root.unmount());
      mounted.pop();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
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
  it("shows nothing and asks nothing when the status is none", async () => {
    const calls = stubServer([answer("queued")]);
    const { host } = await mount({ status: "none" });

    await settle(10 * POLL_MS);

    expect(host.innerHTML).toBe("");
    expect(calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says the version is unavailable, asks nothing and keeps no timer when the status is abandoned", async () => {
    const calls = stubServer([answer("queued")]);
    const { host, status, link } = await mount({ status: "abandoned" });

    await settle(10 * POLL_MS);

    expect(status()?.textContent).toContain(UNAVAILABLE);
    expect(status()?.textContent).toContain(FAILED);
    expect(status()?.className).toContain("text-caption");
    expect(host.querySelector('[data-slot="deep"]')?.className).toContain("min-h-11");
    expect(link()).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["queued", QUEUED],
    ["running", RUNNING],
  ])("shows the margin line, in a status region, while the status is %s", async (status, label) => {
    stubServer([answer(status)]);
    const { host, status: region, estimate, link } = await mount({ status });

    expect(host.querySelector('[data-slot="deep"]')).not.toBeNull();
    expect(region()?.textContent).toBe(label);
    expect(region()?.className).toContain("text-caption");
    expect(estimate()?.textContent).toBe(DURATION);
    expect(estimate()?.className).toContain("text-caption");
    expect(link()).toBeNull();
  });

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
    expect(status()?.textContent).toBe(RUNNING);
    expect(link()).toBeNull();

    await settle(POLL_MS);
    expect(host.querySelector('[data-slot="deep"]')?.className).toContain("min-h-11");
    expect(link()?.textContent).toBe(t.watch);
    expect(link()?.getAttribute("href")).toBe(RESULT);
    expect(link()?.getAttribute("target")).toBe("_blank");
    expect(link()?.getAttribute("rel")).toBe("noopener");
    expect(link()?.className).toContain("h-11");
    expect(link()?.className).toContain("underline");
    expect(host.textContent).not.toContain("Version approfondie [");
    expect(host.textContent).not.toContain(DURATION);
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

    expect(announced).toEqual([RUNNING, t.ready, t.ready]);
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
    expect(status()?.textContent).toBe(QUEUED);

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

  it("says the version is unavailable, in the same status region, when the work is abandoned", async () => {
    const calls = stubServer([runningFor(120), answer("abandoned")]);
    const { host, status, estimate, link } = await mount({ status: "queued" });
    const region = status();
    expect(region?.textContent).toBe(QUEUED);

    await settle(POLL_MS);
    expect(region?.textContent).toBe(RUNNING);
    await settle(POLL_MS);

    expect(status()).toBe(region);
    expect(region?.textContent).toContain(UNAVAILABLE);
    expect(region?.textContent).toContain(FAILED);
    expect(region?.textContent).not.toContain(RUNNING);
    expect(estimate()).toBeNull();
    expect(link()).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain(t.ready);
    expect(vi.getTimerCount()).toBe(0);

    await settle(10 * POLL_MS);
    expect(calls).toHaveLength(2);
  });

  it("says the version is unavailable when the single read at mount finds an abandoned job", async () => {
    const calls = stubServer([answer("abandoned", null, { queued_at: ago(400) })]);
    const { status, estimate, counter } = await mount(null);

    expect(status()?.textContent).toContain(UNAVAILABLE);
    expect(status()?.textContent).toContain(FAILED);
    expect(estimate()).toBeNull();
    expect(counter()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await settle(10 * POLL_MS);
    expect(calls).toHaveLength(1);
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
      expect(status()?.textContent).toBe(QUEUED);
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
    expect(status()?.textContent).toBe(RUNNING);
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
    expect(host.textContent).toContain(QUEUED);

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

describe("DeepVersion phases", () => {
  it("says it is queued, then rendering once a worker has taken the job", async () => {
    stubServer([answer("running")]);
    const { status } = await mount({ status: "queued" });
    const region = status();
    expect(region?.textContent).toBe(QUEUED);

    await settle(POLL_MS);

    expect(status()).toBe(region);
    expect(region?.textContent).toBe(RUNNING);
  });

  it("goes back to queued when a failed attempt sends the job back to the queue", async () => {
    stubServer([answer("running"), answer("queued")]);
    const { status } = await mount({ status: "queued" });

    await settle(POLL_MS);
    expect(status()?.textContent).toBe(RUNNING);
    await settle(POLL_MS);
    expect(status()?.textContent).toBe(QUEUED);
  });

  it("keeps the line hidden for a ready status that carries no address", async () => {
    stubServer([answer("ready", null, { queued_at: ago(100) })]);
    const { host } = await mount(null);

    expect(host.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("DeepVersion elapsed time", () => {
  it.each([
    [0, "depuis 0 s"],
    [45, "depuis 45 s"],
    [59, "depuis 59 s"],
    [60, "depuis 1 min 00"],
    [72, "depuis 1 min 12"],
    [243, "depuis 4 min 03"],
    [600, "depuis 10 min 00"],
  ])("tells %i seconds as « %s »", async (seconds, text) => {
    stubServer([queuedFor(seconds)]);
    const { estimate, counter } = await mount(null);

    expect(estimate()?.textContent).toBe(`${DURATION} · ${text}`);
    expect(counter()?.textContent).toBe(` · ${text}`);
  });

  it("counts from the time of queueing, whatever the phase", async () => {
    stubServer([runningFor(90, 30)]);
    const { status, estimate } = await mount(null);

    expect(status()?.textContent).toBe(RUNNING);
    expect(estimate()?.textContent).toBe(`${DURATION} · depuis 1 min 30`);
  });

  it("moves on every second, from 59 s to 1 min 00", async () => {
    stubServer([queuedFor(59)]);
    const { counter } = await mount(null);
    expect(counter()?.textContent).toContain("depuis 59 s");

    await settle(999);
    expect(counter()?.textContent).toContain("depuis 59 s");
    await settle(1);
    expect(counter()?.textContent).toContain("depuis 1 min 00");
    await settle(1000);
    expect(counter()?.textContent).toContain("depuis 1 min 01");
    await settle(2000);
    expect(counter()?.textContent).toContain("depuis 1 min 03");
  });

  it("keeps counting across the reads, and across the change of phase", async () => {
    stubServer([queuedFor(5), runningFor(5, 2)]);
    const { status, counter } = await mount(null);
    expect(status()?.textContent).toBe(QUEUED);
    expect(counter()?.textContent).toContain("depuis 5 s");

    await settle(POLL_MS);

    expect(status()?.textContent).toBe(RUNNING);
    expect(counter()?.textContent).toContain("depuis 15 s");
  });

  it("starts counting once a read tells when the job was queued", async () => {
    stubServer([queuedFor(100)]);
    const { estimate, counter } = await mount({ status: "queued" });
    expect(estimate()?.textContent).toBe(DURATION);
    expect(counter()).toBeNull();

    await settle(POLL_MS);

    expect(estimate()?.textContent).toBe(`${DURATION} · depuis 1 min 50`);
    await settle(1000);
    expect(estimate()?.textContent).toBe(`${DURATION} · depuis 1 min 51`);
  });

  it("gives the duration alone when the time of queueing is unknown", async () => {
    stubServer([answer("queued"), answer("running", null, { queued_at: null })]);
    const { estimate, counter } = await mount(null);

    expect(estimate()?.textContent).toBe(DURATION);
    expect(counter()).toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    await settle(POLL_MS);
    expect(estimate()?.textContent).toBe(DURATION);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["yesterday", "2026-13-45T99:00:00Z", "", 1763553600000, {}, []])(
    "gives the duration alone for a time of queueing that is not a date: %j",
    async (invalid) => {
      stubServer([answer("queued", null, { queued_at: invalid })]);
      const { estimate, counter } = await mount(null);

      expect(estimate()?.textContent).toBe(DURATION);
      expect(counter()).toBeNull();
    },
  );

  it("never counts backwards when the clock of the server is ahead", async () => {
    stubServer([queuedFor(-30)]);
    const { counter } = await mount(null);

    expect(counter()?.textContent).toContain("depuis 0 s");
    await settle(5000);
    expect(counter()?.textContent).toContain("depuis 0 s");
  });

  it("keeps the counter out of the status region, hidden from assistive technology", async () => {
    stubServer([queuedFor(59)]);
    const { host, status, counter, estimate } = await mount(null);

    const region = status();
    expect(counter()?.getAttribute("aria-hidden")).toBe("true");
    expect(region?.contains(counter())).toBe(false);
    expect(region?.textContent).not.toContain("depuis");
    expect(estimate()?.contains(counter())).toBe(true);
    expect(host.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(region?.closest('[aria-hidden="true"]')).toBeNull();
    expect(estimate()?.closest('[role="status"]')).toBeNull();
  });

  it("never touches the status region when the counter moves", async () => {
    stubServer([queuedFor(59)]);
    const { status, counter } = await mount(null);
    const region = status();
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(region as Element, { subtree: true, childList: true, characterData: true });

    await settle(5000);
    changes.push(...observer.takeRecords());
    observer.disconnect();

    expect(counter()?.textContent).toContain("depuis 1 min 04");
    expect(changes).toHaveLength(0);
  });

  it("changes the status region for a change of phase only", async () => {
    stubServer([queuedFor(20), runningFor(30, 25)]);
    const { status } = await mount(null);
    const region = status();
    const texts: string[] = [region?.textContent ?? ""];
    const observer = new MutationObserver(() => texts.push(region?.textContent ?? ""));
    observer.observe(region as Element, { subtree: true, childList: true, characterData: true });

    await settle(POLL_MS);
    await settle(0);
    observer.disconnect();

    expect(texts.at(0)).toBe(QUEUED);
    expect(texts.at(-1)).toBe(RUNNING);
    expect(new Set(texts)).toEqual(new Set([QUEUED, RUNNING]));
  });

  it("clears the one-second timer on unmount", async () => {
    const calls = stubServer([queuedFor(10)]);
    const { counter, unmount } = await mount(null);
    expect(counter()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(2);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await settle(10 * POLL_MS);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["ready", answer("ready", RESULT, { queued_at: ago(100) })],
    ["abandoned", answer("abandoned", null, { queued_at: ago(100) })],
    ["none", answer("none")],
    ["a status that is not announced", reply(404)],
  ])("stops the one-second timer once the status is %s", async (_label, last) => {
    stubServer([queuedFor(30), last]);
    const { host, counter } = await mount(null);
    expect(counter()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(2);

    await settle(POLL_MS);

    expect(counter()).toBeNull();
    expect(host.querySelector('[data-slot="deep-estimate"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the one-second timer when the follow-up gives up after three failures", async () => {
    stubServer([queuedFor(30), new Error("offline")]);
    const { host } = await mount(null);
    expect(vi.getTimerCount()).toBe(2);

    await settle(MAX_POLL_FAILURES * POLL_MS);

    expect(host.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds one timer for the counter however many times it is read", async () => {
    stubServer([queuedFor(5)]);
    await mount(null);

    await settle(5 * POLL_MS);

    expect(vi.getTimerCount()).toBe(2);
  });
});

describe("DeepVersion in English", () => {
  it.each([
    ["queued", "Deep version [queued]"],
    ["running", "Deep version [rendering]"],
  ])("labels the %s phase", async (status, label) => {
    stubServer([answer(status)]);
    const { status: region, estimate } = await mount({ status }, ID, "en");

    expect(region()?.textContent).toBe(label);
    expect(estimate()?.textContent).toBe("About 2 to 4 min");
  });

  it.each([
    [45, "for 45 s"],
    [72, "for 1 min 12"],
    [243, "for 4 min 03"],
  ])("tells %i seconds as « %s »", async (seconds, text) => {
    stubServer([queuedFor(seconds)]);
    const { estimate, counter } = await mount(null, ID, "en");

    expect(estimate()?.textContent).toBe(`About 2 to 4 min · ${text}`);
    expect(counter()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("moves on every second", async () => {
    stubServer([queuedFor(59)]);
    const { counter } = await mount(null, ID, "en");
    expect(counter()?.textContent).toContain("for 59 s");

    await settle(1000);
    expect(counter()?.textContent).toContain("for 1 min 00");
  });

  it("says the version is unavailable and the explanation complete", async () => {
    stubServer([answer("abandoned")]);
    const { status } = await mount(null, ID, "en");

    expect(status()?.textContent).toContain("Deep version [unavailable]");
    expect(status()?.textContent).toContain(
      "The rendering did not succeed. The explanation above is complete.",
    );
  });

  it("keeps the announcement and the link", async () => {
    stubServer([answer("ready", RESULT)]);
    const { status, link } = await mount({ status: "queued" }, ID, "en");

    await settle(POLL_MS);

    expect(status()?.textContent).toBe(messages.en.Deep.ready);
    expect(link()?.textContent).toBe(messages.en.Deep.watch);
  });
});

describe("parseDeep", () => {
  it("reads the status and the address of the video", () => {
    expect(parseDeep({ status: "ready", result_url: RESULT })).toEqual({
      status: "ready",
      resultUrl: RESULT,
      queuedAt: null,
      startedAt: null,
    });
    expect(parseDeep({ status: "none", result_url: null })).toEqual({
      status: "none",
      resultUrl: null,
      queuedAt: null,
      startedAt: null,
    });
    expect(parseDeep({ status: "queued" })).toEqual({
      status: "queued",
      resultUrl: null,
      queuedAt: null,
      startedAt: null,
    });
    expect(parseDeep({ status: "ready", result_url: "" })?.resultUrl).toBeNull();
  });

  it("reads the time of queueing and the time of taking, in milliseconds", () => {
    expect(
      parseDeep({
        status: "running",
        result_url: null,
        queued_at: "2026-11-19T11:58:00.000Z",
        started_at: "2026-11-19T11:58:30.250Z",
      }),
    ).toEqual({
      status: "running",
      resultUrl: null,
      queuedAt: Date.parse("2026-11-19T11:58:00.000Z"),
      startedAt: Date.parse("2026-11-19T11:58:30.250Z"),
    });
    expect(
      parseDeep({ status: "queued", queued_at: "2026-11-19T11:58:00Z", started_at: null }),
    ).toMatchObject({ queuedAt: Date.parse("2026-11-19T11:58:00Z"), startedAt: null });
  });

  it.each(["yesterday", "2026-13-45T99:00:00Z", "", 1763553600000, true, {}, [], null, undefined])(
    "gives null for a time that is not a date: %j",
    (invalid) => {
      expect(parseDeep({ status: "running", queued_at: invalid, started_at: invalid })).toEqual({
        status: "running",
        resultUrl: null,
        queuedAt: null,
        startedAt: null,
      });
    },
  );

  it("reads each time on its own", () => {
    expect(
      parseDeep({ status: "running", queued_at: "nonsense", started_at: "2026-11-19T11:58:30Z" }),
    ).toMatchObject({ queuedAt: null, startedAt: Date.parse("2026-11-19T11:58:30Z") });
  });

  it("refuses what is not an answer of the contract", () => {
    for (const value of [null, undefined, "ready", 3, [], {}, { status: "done" }, { status: 1 }]) {
      expect(parseDeep(value)).toBeNull();
    }
  });
});

describe("readDeep", () => {
  const signal = () => new AbortController().signal;

  it("hands over the times of the answer", async () => {
    stubServer([runningFor(120, 100)]);

    expect(await readDeep(ID, signal())).toEqual({
      kind: "answer",
      status: "running",
      resultUrl: null,
      queuedAt: NOW - 120_000,
      startedAt: NOW - 100_000,
    });
  });

  it.each([404, 410])("answers none, with no time, for a %i", async (status) => {
    stubServer([reply(status)]);

    expect(await readDeep(ID, signal())).toEqual({
      kind: "answer",
      status: "none",
      resultUrl: null,
      queuedAt: null,
      startedAt: null,
    });
  });

  it("fails on an answer that is not of the contract, whatever its times", async () => {
    stubServer([answer("exploded", null, { queued_at: ago(10) })]);

    expect(await readDeep(ID, signal())).toEqual({ kind: "failed" });
  });
});
