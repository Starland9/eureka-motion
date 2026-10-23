// @vitest-environment jsdom
import { DocumentSchema } from "scene";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { ReformulatePanel } from "@/components/explanation/ReformulatePanel";
import {
  initialExplanationState,
  type ExplanationState,
  type StartOutcome,
  type StartRequest,
} from "@/components/explanation/types";
import { messages } from "@/i18n/messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ push: vi.fn() }));
const playing = vi.hoisted(() => ({ sceneId: null as string | null }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/player/PlaybackProvider", () => ({
  usePlaybackPosition: () => ({
    frame: 0,
    location: playing.sceneId === null ? null : { scene: { id: playing.sceneId } },
  }),
}));

const document = DocumentSchema.parse(reference.payload);
const ID = "kkkkkkkkkkk2";
const OTHER_ID = "mmmmmmmmmmm3";
const t = messages.fr;

const VERSIONS = [
  { id: ID, kind: "reference", title: "T", created_at: "x", scene_title: null },
  { id: "v2", kind: "another_analogy", title: "T", created_at: "x", scene_title: null },
  { id: "v3", kind: "zoom", title: "T", created_at: "x", scene_title: "Deux masses" },
];

const mounted: { root: Root; host: HTMLElement }[] = [];

function stateOf(overrides: Partial<ExplanationState> = {}): ExplanationState {
  return {
    ...initialExplanationState({ question: "", language: "fr", level: "college" }),
    id: ID,
    status: "ready",
    scenes: document.scenes,
    ...overrides,
  };
}

function mount(
  state: ExplanationState | null,
  restart: (request: StartRequest) => Promise<StartOutcome>,
) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  const render = (next: ExplanationState | null): ReactNode => (
    <NextIntlClientProvider locale="fr" messages={messages.fr}>
      <ReformulatePanel state={next} restart={restart} />
    </NextIntlClientProvider>
  );
  act(() => root.render(render(state)));
  return {
    host,
    rerender: (next: ExplanationState | null) => act(() => root.render(render(next))),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function plain(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((candidate) =>
    plain(candidate.textContent).includes(plain(name)),
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

function typeInto(field: HTMLTextAreaElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter(field: Element): void {
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

const accepted = (): Promise<StartOutcome> => Promise.resolve({ kind: "accepted", id: OTHER_ID });

beforeEach(() => {
  router.push.mockReset();
  playing.sceneId = "s3";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(VERSIONS)),
  );
});

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.unstubAllGlobals();
});

describe("ReformulatePanel", () => {
  it.each(["connecting", "preparing", "streaming", "failed", "refused", "clarify"] as const)(
    "shows nothing while the explanation is %s",
    async (status) => {
      const { host } = mount(stateOf({ status }), accepted);
      await flush();
      expect(host.innerHTML).toBe("");
    },
  );

  it("shows nothing without an explanation or without a scene", async () => {
    expect(mount(null, accepted).host.innerHTML).toBe("");
    expect(mount(stateOf({ scenes: [] }), accepted).host.innerHTML).toBe("");
    expect(mount(stateOf({ id: null }), accepted).host.innerHTML).toBe("");
  });

  it.each(["ready", "partial"] as const)(
    "offers the three choices, the follow-up and the versions of a %s explanation",
    async (status) => {
      const { host } = mount(stateOf({ status }), accepted);
      await flush();

      expect(plain(host.querySelector("h2")?.textContent)).toBe(t.Reformulate.title);
      for (const label of Object.values(t.Reformulate.choices)) {
        expect(button(host, label).disabled).toBe(false);
      }
      expect(host.querySelector("textarea")).not.toBeNull();
      expect(plain(host.textContent)).toContain(t.Reformulate.followUp.lead);

      const entries = [...host.querySelectorAll("ol li")].map((item) => plain(item.textContent));
      expect(entries).toEqual([
        `V1 ${t.Reformulate.versions.current}`,
        "V2 — autre image",
        "V3 — zoom : Deux masses",
      ]);
      expect(fetch).toHaveBeenCalledWith(
        `/api/explanations/${ID}/versions`,
        expect.objectContaining({ headers: { "Accept-Language": "fr" } }),
      );
    },
  );

  it("asks for another image or a simpler one from the displayed explanation", async () => {
    const restart = vi.fn(accepted);
    const { host } = mount(stateOf(), restart);
    await flush();

    act(() => button(host, t.Reformulate.choices.another_analogy).click());
    act(() => button(host, t.Reformulate.choices.simpler).click());
    await flush();

    expect(restart).toHaveBeenNthCalledWith(1, {
      question: "",
      language: "fr",
      level: "college",
      derive: { mode: "another_analogy", parentId: ID },
    });
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("zooms on the scene being played by default", async () => {
    const restart = vi.fn(accepted);
    const { host } = mount(stateOf(), restart);
    await flush();
    const zoom = button(host, t.Reformulate.choices.zoom);
    expect(plain(zoom.textContent)).toContain(document.scenes[2]!.title);

    act(() => zoom.click());

    expect(restart).toHaveBeenCalledWith({
      question: "",
      language: "fr",
      level: "college",
      derive: { mode: "zoom", parentId: ID, sceneId: "s3" },
    });
  });

  it("zooms on the scene chosen in the list", async () => {
    const restart = vi.fn(accepted);
    const { host } = mount(stateOf(), restart);
    await flush();

    const select = host.querySelector("select")!;
    act(() => {
      select.value = "s5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => button(host, t.Reformulate.choices.zoom).click());

    expect(restart).toHaveBeenCalledWith(
      expect.objectContaining({ derive: { mode: "zoom", parentId: ID, sceneId: "s5" } }),
    );
  });

  it("leaves the zoom unavailable until a scene is designated", async () => {
    playing.sceneId = null;
    const { host } = mount(stateOf(), accepted);
    await flush();
    expect(button(host, t.Reformulate.choices.zoom).disabled).toBe(true);
    expect(button(host, t.Reformulate.choices.simpler).disabled).toBe(false);
  });

  it("sends the follow-up question", async () => {
    const restart = vi.fn(accepted);
    const { host } = mount(stateOf(), restart);
    await flush();

    const field = host.querySelector("textarea")!;
    typeInto(field, "la distance double");
    pressEnter(field);

    expect(restart).toHaveBeenCalledWith({
      question: "la distance double",
      language: "fr",
      level: "college",
      derive: { mode: "followup", parentId: ID },
    });
  });

  it("disables every control while the request is being made, with the reason", async () => {
    let finish!: (outcome: StartOutcome) => void;
    const restart = vi.fn(() => new Promise<StartOutcome>((resolve) => (finish = resolve)));
    const { host } = mount(stateOf(), restart);
    await flush();

    act(() => button(host, t.Reformulate.choices.simpler).click());
    for (const label of Object.values(t.Reformulate.choices)) {
      expect(button(host, label).disabled).toBe(true);
    }
    expect(plain(host.textContent)).toContain(plain(t.Reformulate.busy));
    expect(button(host, t.Reformulate.followUp.submit).disabled).toBe(true);

    await act(async () => finish({ kind: "accepted", id: OTHER_ID }));
    expect(button(host, t.Reformulate.choices.simpler).disabled).toBe(true);
  });

  it("keeps the explanation and the typed text on a refusal, and explains it", async () => {
    const restart = vi.fn(async (): Promise<StartOutcome> => ({
      kind: "rejected",
      code: "rate_limited",
      message: "",
      retryAfterSeconds: 30,
    }));
    const { host } = mount(stateOf(), restart);
    await flush();
    const field = host.querySelector("textarea")!;
    typeInto(field, "la distance double");

    act(() => button(host, t.Reformulate.choices.another_analogy).click());
    await flush();

    const alerts = [...host.querySelectorAll('[role="alert"]')].map((item) =>
      plain(item.textContent),
    );
    expect(alerts.filter(Boolean)).toEqual([expect.stringContaining("Réessaie dans 30 secondes")]);
    expect(host.querySelector("textarea")!.value).toBe("la distance double");
    expect(button(host, t.Reformulate.choices.another_analogy).disabled).toBe(false);
    expect(host.querySelector("h2")).not.toBeNull();
  });

  it("puts a refused follow-up under the follow-up field", async () => {
    const restart = vi.fn(async (): Promise<StartOutcome> => ({
      kind: "rejected",
      code: "parent_not_found",
      message: "Cette explication n’existe plus.",
    }));
    const { host } = mount(stateOf(), restart);
    await flush();
    typeInto(host.querySelector("textarea")!, "et la Lune");
    pressEnter(host.querySelector("textarea")!);
    await flush();

    const form = host.querySelector("form")!;
    expect(plain(form.querySelector('[role="alert"]')?.textContent)).toBe(
      "Cette explication n’existe plus.",
    );
  });

  it("clears the follow-up field when another version is displayed", async () => {
    const { host, rerender } = mount(stateOf(), accepted);
    await flush();
    typeInto(host.querySelector("textarea")!, "la distance double");

    rerender(stateOf({ id: OTHER_ID }));
    await flush();

    expect(host.querySelector("textarea")!.value).toBe("");
  });

  it("replays another version from the list, and does nothing for the displayed one", async () => {
    const { host } = mount(stateOf(), accepted);
    await flush();

    act(() => button(host, "V1").click());
    expect(router.push).not.toHaveBeenCalled();
    act(() => button(host, "V2").click());
    expect(router.push).toHaveBeenCalledWith("/e/v2", { locale: "fr" });
  });

  it("hides the list while the session holds a single version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(VERSIONS.slice(0, 1))),
    );
    const { host } = mount(stateOf(), accepted);
    await flush();
    expect(host.querySelector("ol")).toBeNull();
  });
});
