// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialExplanationState,
  type ExplanationState,
  type ExplanationStatus,
} from "@/components/explanation/types";
import { Export } from "@/components/player/Export";
import {
  announcedPercent,
  BUSY_AFTER_MS,
  exportFilename,
  parseJob,
  parseRetryAfter,
  parseSubmission,
  POLL_MS,
} from "@/components/player/export-job";
import { messages } from "@/i18n/messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = messages.fr.Export;
const ID = "kkkkkkkkkkk2";
const OTHER_ID = "mmmmmmmmmmm3";
const JOB = "7b0e1d52-3a54-4c1e-9d3c-0f6c5a1b2e11";
const OTHER_JOB = "c8a2f1d0-5b61-4f1c-8e2a-9d4b7c3a1f22";
const RESULT = `/media/${ID}/export.mp4`;
const mounted: { root: Root; host: HTMLElement }[] = [];

type Step = Response | Error | Promise<Response>;

interface Script {
  health?: Step[];
  post?: Step[];
  jobs?: Step[];
}

function reply(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as Response;
}

const WORKER_UP = [reply(200, { status: "ok", checks: { render_worker: true } })];
const job = (status: string, progress = 0, result_url: string | null = null) =>
  reply(200, { id: JOB, type: "export", status, progress, result_url });
const accepted = (status = "queued", job_id = JOB) => reply(200, { job_id, status });

function stubServer(script: Script) {
  const queues = {
    health: [...(script.health ?? WORKER_UP)],
    post: [...(script.post ?? [accepted()])],
    jobs: [...(script.jobs ?? [job("queued")])],
  };
  const calls = {
    all: [] as { url: string; method: string; signal: AbortSignal | undefined }[],
    health: 0,
    posts: 0,
    jobs: 0,
  };
  const take = (queue: Step[]): Step => (queue.length > 1 ? queue.shift()! : queue[0]!);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.all.push({ url, method, signal: init?.signal ?? undefined });
    let step: Step;
    if (url === "/api/health") {
      calls.health += 1;
      step = take(queues.health);
    } else if (method === "POST") {
      calls.posts += 1;
      step = take(queues.post);
    } else {
      calls.jobs += 1;
      step = take(queues.jobs);
    }
    if (step instanceof Error) throw step;
    return step;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, queues };
}

function stateOf(status: ExplanationStatus = "ready", id: string | null = ID): ExplanationState {
  return {
    ...initialExplanationState({
      question: "la loi de la gravité",
      language: "fr",
      level: "lycee",
    }),
    id,
    status,
    meta: {
      title: "La gravitation universelle",
      subject: "physics",
      conceptSlug: "physics/universal-gravitation",
      deepEligible: false,
      detectedLanguage: "fr",
    },
  };
}

function tree(state: ExplanationState | null) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages.fr}>
      <Export state={state} />
    </NextIntlClientProvider>
  );
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(state: ExplanationState | null = stateOf()) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(tree(state)));
  await settle();
  const control = (label: string): HTMLElement | null =>
    [...host.querySelectorAll<HTMLElement>("button, a")].find(
      (element) => element.textContent === label,
    ) ?? null;
  return {
    host,
    root,
    control,
    action: () => control(t.action),
    status: () => host.querySelector('[role="status"]'),
    alert: () => host.querySelector('[role="alert"]'),
    bar: () => host.querySelector('[role="progressbar"]'),
    rerender: (next: ExplanationState | null) => act(() => root.render(tree(next))),
    unmount: () => {
      act(() => root.unmount());
      mounted.pop();
    },
  };
}

async function press(element: HTMLElement | null): Promise<void> {
  element?.focus();
  await act(async () => {
    element?.click();
    await vi.advanceTimersByTimeAsync(0);
  });
}

const percentText = (percent: number): string =>
  t.progress.text.replace("{percent}", String(percent));

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

describe("Export", () => {
  it("renders nothing until the explanation is ready or partial and has an identifier", async () => {
    stubServer({});
    for (const state of [
      null,
      stateOf("streaming"),
      stateOf("failed"),
      stateOf("ready", null),
      stateOf("missing"),
    ]) {
      expect((await mount(state)).host.innerHTML).toBe("");
    }
    for (const status of ["ready", "partial"] as const) {
      expect((await mount(stateOf(status))).action()).not.toBeNull();
    }
  });

  it("reads the health once at mount, asks for nothing else, and offers a 44 px action", async () => {
    const { calls } = stubServer({});
    const { action, status, alert, host } = await mount();

    await settle(10 * POLL_MS);

    expect(calls.all.map(({ url, method }) => `${method} ${url}`)).toEqual(["GET /api/health"]);
    expect(action()?.getAttribute("type")).toBe("button");
    expect(action()?.className).toContain("h-11");
    expect(status()?.textContent).toBe("");
    expect(alert()?.textContent).toBe("");
    expect(host.querySelector("a")).toBeNull();
  });

  it("reads the health even while the explanation is being prepared, then offers the action", async () => {
    const { calls } = stubServer({});
    const { host, rerender, action } = await mount(stateOf("streaming"));
    expect(host.innerHTML).toBe("");
    expect(calls.health).toBe(1);

    rerender(stateOf("ready"));
    await settle();

    expect(action()).not.toBeNull();
    expect(calls.health).toBe(1);
  });

  it("reserves its room, without any text, while the health is being read", async () => {
    let answer: (response: Response) => void = () => undefined;
    stubServer({ health: [new Promise<Response>((resolve) => (answer = resolve))] });
    const { host, action, status } = await mount();

    expect(host.querySelector('[data-slot="export"]')?.className).toContain("min-h-");
    expect(host.textContent).toBe("");
    expect(host.querySelector("button, a, [role]")).toBeNull();

    answer(reply(200, { checks: { render_worker: true } }));
    await settle();
    expect(action()).not.toBeNull();
    expect(status()?.textContent).toBe("");
  });

  it.each([
    ["the worker is down", [reply(200, { checks: { render_worker: false } })]],
    ["the heartbeat is unknown", [reply(200, { checks: {} })]],
    ["the answer is not the expected one", [reply(200, "ok")]],
    ["the health cannot be read", [new Error("offline")]],
    ["the health answers an error", [reply(503, {})]],
  ])("shows a discreet line and no action when %s", async (_name, health) => {
    stubServer({ health });
    const { host, status, alert, action } = await mount();

    expect(action()).toBeNull();
    expect(host.querySelector("button, a")).toBeNull();
    expect(status()?.textContent).toBe(t.unavailable);
    expect(alert()).toBeNull();
    expect(host.querySelector('[data-slot="export"]')?.className).toContain("min-h-");
    expect(host.querySelector('[data-slot="export"]')?.className).not.toContain("border");
  });

  it("asks for the job on click, then follows it every 2 seconds up to the download link", async () => {
    const { calls } = stubServer({
      jobs: [job("queued"), job("running", 10), job("running", 60), job("succeeded", 100, RESULT)],
    });
    const { action, bar, status, control, host } = await mount();

    await press(action());
    expect(calls.posts).toBe(1);
    expect(calls.all.at(1)).toMatchObject({
      url: `/api/explanations/${ID}/export`,
      method: "POST",
    });
    expect(calls.jobs).toBe(1);
    expect(calls.all.at(2)?.url).toBe(`/api/jobs/${JOB}`);
    expect(bar()?.getAttribute("aria-valuenow")).toBe("0");

    await settle(POLL_MS - 1);
    expect(calls.jobs).toBe(1);
    await settle(1);
    expect(calls.jobs).toBe(2);
    expect(bar()?.getAttribute("aria-valuenow")).toBe("10");
    expect(host.textContent).toContain(percentText(10));

    await settle(POLL_MS);
    expect(calls.jobs).toBe(3);
    expect(bar()?.getAttribute("aria-valuenow")).toBe("60");
    expect(bar()?.getAttribute("aria-valuemax")).toBe("100");
    expect(bar()?.getAttribute("aria-label")).toBe(t.progress.label);
    expect(host.textContent).toContain(percentText(60));

    await settle(POLL_MS);
    const link = control(t.download);
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe(RESULT);
    expect(link?.getAttribute("download")).toBe("la-gravitation-universelle.mp4");
    expect(link?.className).toContain("h-11");
    expect(bar()).toBeNull();
    expect(control(t.cancel)).toBeNull();
    expect(status()?.textContent).toBe(t.ready);

    await settle(10 * POLL_MS);
    expect(calls.jobs).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("announces the progress by quarters, not at every percent", async () => {
    stubServer({
      jobs: [
        job("running", 3),
        job("running", 24),
        job("running", 26),
        job("running", 49),
        job("running", 50),
        job("running", 99),
      ],
    });
    const { action, status, host } = await mount();
    const announced: string[] = [];

    await press(action());
    for (let poll = 0; poll < 6; poll += 1) {
      announced.push(status()?.textContent ?? "");
      expect(host.querySelector("p[aria-hidden]")?.textContent).toContain("%");
      await settle(POLL_MS);
    }

    expect(announced).toEqual([
      t.progress.starting,
      t.progress.starting,
      percentText(25),
      percentText(25),
      percentText(50),
      percentText(75),
    ]);
    expect(announcedPercent(100)).toBe(100);
  });

  it("keeps the status node stable while the announced text does not change", async () => {
    stubServer({ jobs: [job("running", 30), job("running", 31), job("running", 40)] });
    const { action, status } = await mount();

    await press(action());
    const region = status();
    const node = region?.firstChild?.firstChild;
    await settle(2 * POLL_MS);

    expect(status()).toBe(region);
    expect(status()?.firstChild?.firstChild).toBe(node);
  });

  it("shows the link at once, without any progress, when the file already exists", async () => {
    const { calls } = stubServer({
      post: [accepted("succeeded")],
      jobs: [job("succeeded", 100, RESULT)],
    });
    const { action, bar, control, status } = await mount();

    await press(action());

    expect(bar()).toBeNull();
    expect(control(t.download)?.getAttribute("href")).toBe(RESULT);
    expect(status()?.textContent).toBe(t.ready);
    expect(calls.posts).toBe(1);
    expect(calls.jobs).toBe(1);
    await settle(3 * POLL_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never shows the progress bar between the answer and the first reading of a finished job", async () => {
    let finish: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => (finish = resolve));
    stubServer({ post: [accepted("succeeded")], jobs: [pending] });
    const { action, bar, control } = await mount();

    await press(action());
    expect(bar()).toBeNull();
    expect(control(t.cancel)).toBeNull();

    finish(job("succeeded", 100, RESULT));
    await settle();
    expect(control(t.download)).not.toBeNull();
  });

  it("falls back to the identifier for the file name when there is no title", async () => {
    stubServer({ jobs: [job("succeeded", 100, RESULT)] });
    const state = { ...stateOf(), meta: null, question: "" };
    const { action, control } = await mount(state);

    await press(action());

    expect(control(t.download)?.getAttribute("download")).toBe(`${ID}.mp4`);
  });

  it("says so in a calm alert and offers to try again when the job fails", async () => {
    const { calls } = stubServer({
      post: [accepted("queued", JOB), accepted("queued", OTHER_JOB)],
      jobs: [job("running", 20), job("failed", 20), job("running", 5)],
    });
    const { action, control, alert, status, bar } = await mount();

    await press(action());
    await settle(POLL_MS);

    expect(alert()?.textContent).toBe(t.errors.failed);
    expect(alert()?.textContent).not.toMatch(/error|exception|\d{3}/i);
    expect(status()?.textContent).toBe("");
    expect(bar()).toBeNull();
    expect(control(t.action)).toBeNull();
    await settle(3 * POLL_MS);
    expect(vi.getTimerCount()).toBe(0);

    await press(control(t.retry));

    expect(calls.posts).toBe(2);
    expect(alert()?.textContent).toBe("");
    expect(bar()).not.toBeNull();
    expect(calls.all.at(-1)?.url).toBe(`/api/jobs/${OTHER_JOB}`);
  });

  it("treats a finished job without a file as a failure", async () => {
    stubServer({ jobs: [job("succeeded", 100, null)] });
    const { action, alert } = await mount();

    await press(action());

    expect(alert()?.textContent).toBe(t.errors.failed);
  });

  it("treats an unknown job as a failure", async () => {
    stubServer({ jobs: [reply(404, {})] });
    const { action, alert, control } = await mount();

    await press(action());

    expect(alert()?.textContent).toBe(t.errors.failed);
    expect(control(t.retry)).not.toBeNull();
    await settle(3 * POLL_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["no delay", {}, "un peu plus tard"],
    ["a few seconds", { "Retry-After": "30" }, "30 secondes"],
    ["one second", { "Retry-After": "1" }, "1 seconde"],
    ["more than a minute", { "Retry-After": "130" }, "3 minutes"],
    ["a delay that is not a number", { "Retry-After": "soon" }, "un peu plus tard"],
  ])("tells the delay when the limit is reached (%s)", async (_name, headers, expected) => {
    const { calls } = stubServer({ post: [reply(429, {}, headers)] });
    const { action, alert, control, bar } = await mount();

    await press(action());

    expect(alert()?.textContent).toContain(expected);
    expect(alert()?.textContent).toContain("beaucoup de vidéos");
    expect(bar()).toBeNull();
    expect(calls.jobs).toBe(0);
    expect(control(t.retry)).not.toBeNull();
  });

  it("explains a 409 not_ready, then lets the student ask again", async () => {
    const { calls } = stubServer({ post: [reply(409, {}), accepted()] });
    const { action, alert, control } = await mount();

    await press(action());
    expect(alert()?.textContent).toBe(t.errors.notReady);

    await press(control(t.retry));
    expect(alert()?.textContent).toBe("");
    expect(calls.posts).toBe(2);
    expect(calls.jobs).toBe(1);
  });

  it.each([
    ["the request cannot be sent", [new Error("offline")], t.errors.unreachable],
    ["the server fails", [reply(500, {})], t.errors.failed],
    ["the answer is not a job", [reply(200, { job_id: 12 })], t.errors.failed],
  ])("is calm when %s", async (_name, post, expected) => {
    stubServer({ post });
    const { action, alert } = await mount();

    await press(action());

    expect(alert()?.textContent).toBe(expected);
  });

  it("does not create a duplicate request when the action is used twice in a row", async () => {
    const { calls } = stubServer({});
    const { action } = await mount();
    const button = action();

    await act(async () => {
      button?.click();
      button?.click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(calls.posts).toBe(1);
  });

  it("marks the action as busy while the request is in flight", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { calls } = stubServer({
      post: [new Promise<Response>((resolve) => (answer = resolve))],
    });
    const { action, status } = await mount();

    await press(action());
    expect(action()?.getAttribute("aria-disabled")).toBe("true");
    expect(status()?.textContent).toBe(t.progress.starting);
    await press(action());
    expect(calls.posts).toBe(1);

    answer(accepted());
    await settle();
    expect(action()).toBeNull();
  });

  it("stops following when cancelled, says the job goes on, and finds the same job again", async () => {
    const { calls } = stubServer({
      post: [accepted()],
      jobs: [job("running", 10), job("running", 20), job("succeeded", 100, RESULT)],
    });
    const { action, control, status, bar } = await mount();

    await press(action());
    expect(window.document.activeElement).toBe(control(t.cancel));
    await press(control(t.cancel));

    expect(bar()).toBeNull();
    expect(status()?.textContent).toBe(t.progress.cancelled);
    expect(calls.all.at(-1)?.signal?.aborted).toBe(true);
    expect(window.document.activeElement).toBe(action());
    await settle(3 * POLL_MS);
    expect(vi.getTimerCount()).toBe(0);

    const before = calls.all.length;
    await settle(10 * POLL_MS);
    expect(calls.all.length).toBe(before);

    await press(action());
    expect(calls.posts).toBe(2);
    expect(status()?.textContent).toBe(t.progress.starting);
  });

  it("keeps the focus on the control that replaces the one in use", async () => {
    stubServer({ jobs: [job("running", 10), job("succeeded", 100, RESULT)] });
    const { action, control } = await mount();

    await press(action());
    expect(window.document.activeElement).toBe(control(t.cancel));
    await settle(POLL_MS);

    expect(window.document.activeElement).toBe(control(t.download));
  });

  it("leaves the focus alone when it is elsewhere", async () => {
    stubServer({ jobs: [job("running", 10), job("succeeded", 100, RESULT)] });
    const { action } = await mount();
    const outside = window.document.createElement("button");
    window.document.body.append(outside);

    await act(async () => {
      action()?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    outside.focus();
    await settle(POLL_MS);

    expect(window.document.activeElement).toBe(outside);
    outside.remove();
  });

  it("clears its timer and aborts its request when it is removed", async () => {
    const { calls } = stubServer({ jobs: [job("running", 10)] });
    const { action, unmount } = await mount();

    await press(action());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();

    await settle(3 * POLL_MS);

    expect(vi.getTimerCount()).toBe(0);
    expect(calls.all.at(-1)?.signal?.aborted).toBe(true);
    const before = calls.all.length;
    await settle(10 * POLL_MS);
    expect(calls.all.length).toBe(before);
  });

  it("changes nothing when it is removed before the request is answered", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { calls } = stubServer({
      post: [new Promise<Response>((resolve) => (answer = resolve))],
    });
    const { action, unmount } = await mount();

    await press(action());
    unmount();
    answer(accepted());
    await settle(5 * POLL_MS);

    expect(calls.posts).toBe(1);
    expect(calls.jobs).toBe(0);
    await settle(3 * POLL_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never reads the job twice at the same time", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { calls } = stubServer({
      jobs: [new Promise<Response>((resolve) => (answer = resolve)), job("running", 30)],
    });
    const { action, bar } = await mount();

    await press(action());
    await settle(10 * POLL_MS);
    expect(calls.jobs).toBe(1);

    answer(job("running", 10));
    await settle();
    expect(bar()?.getAttribute("aria-valuenow")).toBe("10");
    expect(calls.jobs).toBe(1);
    await settle(POLL_MS);
    expect(calls.jobs).toBe(2);
    expect(bar()?.getAttribute("aria-valuenow")).toBe("30");
  });

  it("goes on after a short network failure", async () => {
    const { calls } = stubServer({
      jobs: [job("running", 10), new Error("offline"), reply(502, {}), job("running", 40)],
    });
    const { action, bar, alert } = await mount();

    await press(action());
    await settle(2 * POLL_MS);
    expect(alert()?.textContent).toBe("");
    expect(bar()?.getAttribute("aria-valuenow")).toBe("10");

    await settle(POLL_MS);
    expect(bar()?.getAttribute("aria-valuenow")).toBe("40");
    expect(calls.jobs).toBe(4);
  });

  it("stops cleanly after three failures in a row and lets the student pick the job up again", async () => {
    const { calls } = stubServer({
      post: [accepted(), accepted()],
      jobs: [new Error("offline"), new Error("offline"), new Error("offline"), job("running", 55)],
    });
    const { action, alert, control, bar } = await mount();

    await press(action());
    await settle(5 * POLL_MS);

    expect(calls.jobs).toBe(3);
    expect(alert()?.textContent).toBe(t.errors.lost);
    expect(bar()).toBeNull();
    await settle(3 * POLL_MS);
    expect(vi.getTimerCount()).toBe(0);

    await press(control(t.retry));
    expect(bar()?.getAttribute("aria-valuenow")).toBe("55");
    expect(calls.posts).toBe(2);
  });

  it("counts only failures in a row", async () => {
    stubServer({
      jobs: [
        new Error("offline"),
        new Error("offline"),
        job("running", 10),
        new Error("offline"),
        new Error("offline"),
        job("running", 20),
      ],
    });
    const { action, bar, alert } = await mount();

    await press(action());
    await settle(5 * POLL_MS);

    expect(alert()?.textContent).toBe("");
    expect(bar()?.getAttribute("aria-valuenow")).toBe("20");
  });

  it("says the renderer is busy once the job has waited 90 seconds, without any error", async () => {
    const { calls } = stubServer({ jobs: [job("queued")] });
    const { action, status, alert, bar, host } = await mount();

    await press(action());
    await settle(BUSY_AFTER_MS - POLL_MS);
    expect(status()?.textContent).toBe(t.progress.starting);

    await settle(POLL_MS);
    expect(status()?.textContent).toBe(t.progress.busy);
    expect(status()?.textContent).not.toContain("!");
    expect(alert()?.textContent).toBe("");
    expect(bar()).not.toBeNull();
    expect(host.textContent).toContain(percentText(0));
    expect(calls.jobs).toBeGreaterThan(40);
  });

  it("drops the busy message when the job starts", async () => {
    const { queues } = stubServer({ jobs: [job("queued")] });
    const { action, status, bar } = await mount();

    await press(action());
    await settle(BUSY_AFTER_MS);
    expect(status()?.textContent).toBe(t.progress.busy);

    queues.jobs.splice(0, queues.jobs.length, job("running", 10));
    await settle(POLL_MS);

    expect(status()?.textContent).toBe(t.progress.starting);
    expect(bar()?.getAttribute("aria-valuenow")).toBe("10");
  });

  it("does not call a job that is running for a long time busy", async () => {
    stubServer({ jobs: [job("running", 10)] });
    const { action, status } = await mount();

    await press(action());
    await settle(2 * BUSY_AFTER_MS);

    expect(status()?.textContent).not.toBe(t.progress.busy);
  });

  it("starts from a clean state for another explanation", async () => {
    stubServer({ jobs: [job("running", 10)] });
    const { action, bar, rerender } = await mount();

    await press(action());
    expect(bar()).not.toBeNull();
    rerender(stateOf("ready", OTHER_ID));
    await settle();

    expect(bar()).toBeNull();
    expect(action()).not.toBeNull();
    await settle(3 * POLL_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows nothing a screen reader would take for an alert while all goes well", async () => {
    stubServer({ jobs: [job("running", 10), job("succeeded", 100, RESULT)] });
    const { action, alert } = await mount();

    await press(action());
    await settle(POLL_MS);

    expect(alert()?.textContent).toBe("");
    expect(alert()?.children.length).toBe(0);
  });
});

describe("export helpers", () => {
  it("builds a readable file name from the title", () => {
    expect(exportFilename("La gravitation universelle", ID)).toBe("la-gravitation-universelle.mp4");
    expect(exportFilename("  Qu’est-ce que l’énergie ?  ", ID)).toBe("qu-est-ce-que-l-energie.mp4");
    expect(exportFilename("Théorème de Pythagore !!!", ID)).toBe("theoreme-de-pythagore.mp4");
    expect(exportFilename("??? ¿¿¿", ID)).toBe(`${ID}.mp4`);
    expect(exportFilename("", ID)).toBe(`${ID}.mp4`);
    expect(exportFilename("a".repeat(200), ID).length).toBeLessThanOrEqual(64);
  });

  it("reads the delay of a Retry-After header", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("-3")).toBeUndefined();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
  });

  it("accepts only well-formed answers", () => {
    expect(parseSubmission({ job_id: JOB, status: "queued" })).toEqual({
      jobId: JOB,
      status: "queued",
    });
    for (const bad of [null, "x", {}, { job_id: "", status: "queued" }, { job_id: JOB }]) {
      expect(parseSubmission(bad)).toBeNull();
    }
    expect(parseSubmission({ job_id: JOB, status: "abandoned" })).toBeNull();

    expect(parseJob({ id: JOB, status: "running", progress: 40, result_url: null })).toEqual({
      status: "running",
      progress: 40,
      resultUrl: null,
    });
    expect(parseJob({ status: "succeeded", result_url: RESULT })).toEqual({
      status: "succeeded",
      progress: 0,
      resultUrl: RESULT,
    });
    expect(parseJob({ status: "weird" })).toBeNull();
    expect(parseJob(null)).toBeNull();
  });
});
