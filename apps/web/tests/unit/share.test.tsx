// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_MS, Share } from "@/components/player/Share";
import { messages } from "@/i18n/messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = messages.fr.Share;
const PATH = "/fr/e/kkkkkkkkkkk2";
const mounted: { root: Root; host: HTMLElement }[] = [];

type Clipboard = { writeText: (text: string) => Promise<void> };

function mount(path: string | null = PATH) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() =>
    root.render(
      <NextIntlClientProvider locale="fr" messages={messages.fr}>
        <Share path={path} />
      </NextIntlClientProvider>,
    ),
  );
  const button = () => host.querySelector("button");
  const status = () => host.querySelector('[role="status"]');
  const alert = () => host.querySelector('[role="alert"]');
  return { host, button, status, alert, root };
}

async function press(button: HTMLButtonElement | null): Promise<void> {
  button?.focus();
  await act(async () => {
    button?.click();
  });
}

function stubClipboard(clipboard: Clipboard | undefined): void {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}

function stubExecCommand(result: boolean | Error) {
  const command = vi.fn(() => {
    if (result instanceof Error) throw result;
    return result;
  });
  Object.defineProperty(document, "execCommand", { value: command, configurable: true });
  return command;
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
  stubClipboard(undefined);
  Reflect.deleteProperty(document, "execCommand");
});

describe("Share", () => {
  it("renders nothing while there is no link to share", () => {
    expect(mount(null).host.innerHTML).toBe("");
  });

  it("offers a 44 px action and an empty status region", () => {
    const { button, status, alert } = mount();
    expect(button()?.textContent).toBe(t.copy);
    expect(button()?.type).toBe("button");
    expect(button()?.className).toContain("h-11");
    expect(status()?.textContent).toBe("");
    expect(alert()?.textContent).toBe("");
  });

  it("copies the absolute address of the page, confirms it for 4 seconds, then clears it", async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard({ writeText });
    const { button, status } = mount();

    await press(button());

    expect(writeText).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}${PATH}`);
    expect(status()?.textContent).toBe(t.copied);
    expect(window.document.activeElement).toBe(button());

    act(() => vi.advanceTimersByTime(FEEDBACK_MS - 1));
    expect(status()?.textContent).toBe(t.copied);
    act(() => vi.advanceTimersByTime(1));
    expect(status()?.textContent).toBe("");
  });

  it("keeps an absolute address as it is", async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard({ writeText });
    await press(mount("https://eureka.test/en/e/kkkkkkkkkkk2").button());
    expect(writeText).toHaveBeenCalledWith("https://eureka.test/en/e/kkkkkkkkkkk2");
  });

  it("announces the confirmation once: the text is stable across renders", async () => {
    stubClipboard({ writeText: async () => undefined });
    const { button, status, root } = mount();
    await press(button());
    const region = status();
    const node = region?.firstChild;

    act(() =>
      root.render(
        <NextIntlClientProvider locale="fr" messages={messages.fr}>
          <Share path={PATH} />
        </NextIntlClientProvider>,
      ),
    );

    expect(status()).toBe(region);
    expect(status()?.firstChild).toBe(node);
  });

  it("restarts the 4 seconds when the action is used again", async () => {
    stubClipboard({ writeText: async () => undefined });
    const { button, status } = mount();

    await press(button());
    act(() => vi.advanceTimersByTime(3000));
    await press(button());
    act(() => vi.advanceTimersByTime(3000));
    expect(status()?.textContent).toBe(t.copied);
    act(() => vi.advanceTimersByTime(1000));
    expect(status()?.textContent).toBe("");
  });

  it("falls back to a selection when the clipboard is unavailable, without moving the focus", async () => {
    stubClipboard(undefined);
    const command = stubExecCommand(true);
    const { button, status } = mount();

    await press(button());

    expect(command).toHaveBeenCalledExactlyOnceWith("copy");
    expect(status()?.textContent).toBe(t.copied);
    expect(window.document.activeElement).toBe(button());
    expect(window.document.querySelector("textarea")).toBeNull();
  });

  it("falls back to a selection when the clipboard refuses", async () => {
    stubClipboard({
      writeText: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
    const command = stubExecCommand(true);
    const { button, status } = mount();

    await press(button());

    expect(command).toHaveBeenCalledOnce();
    expect(status()?.textContent).toBe(t.copied);
  });

  it.each([
    ["answers no", false],
    ["throws", new Error("blocked")],
  ])("says so when the clipboard is unavailable and the selection %s", async (_name, result) => {
    stubClipboard(undefined);
    stubExecCommand(result);
    const { button, status, alert } = mount();

    await press(button());

    expect(alert()?.textContent).toBe(t.copyFailed);
    expect(status()?.textContent).toBe("");
    expect(window.document.activeElement).toBe(button());
    act(() => vi.advanceTimersByTime(FEEDBACK_MS));
    expect(alert()?.textContent).toBe("");
  });

  it("clears its timer when it is removed", async () => {
    stubClipboard({ writeText: async () => undefined });
    const { button, root } = mount();
    const idle = vi.getTimerCount();
    await press(button());
    const armed = vi.getTimerCount();
    expect(armed).toBeGreaterThan(idle);

    act(() => root.unmount());
    mounted.pop();

    expect(vi.getTimerCount()).toBeLessThan(armed);
  });

  it("starts no timer when it is removed before the copy ends", async () => {
    let finish: () => void = () => undefined;
    stubClipboard({ writeText: () => new Promise<void>((resolve) => (finish = resolve)) });
    const { button, root } = mount();
    const idle = vi.getTimerCount();
    act(() => button()?.click());

    act(() => root.unmount());
    mounted.pop();
    await act(async () => finish());

    expect(vi.getTimerCount()).toBe(idle);
  });
});
