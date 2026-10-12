import type { PipelineEvent } from "../../src/server/pipeline/events";

export type SseMessage =
  | { kind: "comment"; text: string }
  | { kind: "event"; id: number; type: string; data: Record<string, unknown> };

export type SseEvent = Extract<SseMessage, { kind: "event" }>;

export function parseBlock(block: string): SseMessage {
  const lines = block.split("\n");
  if (lines.every((line) => line.startsWith(":"))) {
    return { kind: "comment", text: lines.map((line) => line.slice(1).trim()).join("\n") };
  }
  let id: number | undefined;
  let type: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = Number(value);
    else if (field === "event") type = value;
    else if (field === "data") data.push(value);
    else throw new Error(`Unexpected field in an event block: ${line}`);
  }
  if (id === undefined || type === undefined || data.length === 0) {
    throw new Error(`Incomplete event block: ${JSON.stringify(block)}`);
  }
  return { kind: "event", id, type, data: JSON.parse(data.join("\n")) as Record<string, unknown> };
}

export function parseSse(text: string): SseMessage[] {
  if (text !== "" && !text.endsWith("\n\n")) {
    throw new Error(`The last block does not end with a blank line: ${JSON.stringify(text)}`);
  }
  return text
    .split("\n\n")
    .filter((block) => block !== "")
    .map(parseBlock);
}

export function sseReader(response: Response) {
  if (!response.body) throw new Error("The response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;

  async function next(): Promise<SseMessage | null> {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return parseBlock(block);
      }
      if (ended) {
        if (buffer !== "") throw new Error(`Unterminated block: ${JSON.stringify(buffer)}`);
        return null;
      }
      const chunk = await reader.read();
      if (chunk.done) ended = true;
      else buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  async function until(type: string): Promise<SseMessage[]> {
    const seen: SseMessage[] = [];
    for (let message = await next(); message; message = await next()) {
      seen.push(message);
      if (message.kind === "event" && message.type === type) return seen;
    }
    throw new Error(`The stream ended before a "${type}" event`);
  }

  async function rest(): Promise<SseMessage[]> {
    const items: SseMessage[] = [];
    for (let message = await next(); message; message = await next()) items.push(message);
    return items;
  }

  return { next, until, rest, cancel: () => reader.cancel() };
}

export function readSse(response: Response): Promise<SseMessage[]> {
  return sseReader(response).rest();
}

export function eventsIn(messages: SseMessage[]): SseEvent[] {
  return messages.filter((message): message is SseEvent => message.kind === "event");
}

export function toPipelineEvent({ type, data }: SseEvent): PipelineEvent {
  return { type, ...data } as PipelineEvent;
}
