import { describe, expect, it, vi } from "vitest";
import { availabilityOf, isDocumentRequest } from "../../src/app/[locale]/e/[id]/availability";
import type { ExplanationRecord } from "../../src/server/pipeline/ports";

const ID = "kkkkkkkkkkk2";
const DAY = 24 * 60 * 60 * 1000;

function record(id: string, expiresAt: Date | null): ExplanationRecord {
  return { id, expires_at: expiresAt } as ExplanationRecord;
}

// Same rule as the database store: an explanation past its expiry date is not returned.
function sources(records: ExplanationRecord[], references: string[] = []) {
  const byId = new Map(records.map((item) => [item.id, item]));
  const isPast = (item: ExplanationRecord | undefined) =>
    item?.expires_at != null && item.expires_at.getTime() <= Date.now();
  const store = {
    get: vi.fn(async (id: string) => {
      const found = byId.get(id);
      return found && !isPast(found) ? found : null;
    }),
    isExpired: vi.fn(async (id: string) => isPast(byId.get(id))),
  };
  const findReference = vi.fn(async (id: string) =>
    references.includes(id) ? record(id, null) : null,
  );
  return { store, findReference };
}

describe("availabilityOf", () => {
  it("finds a stored explanation, with or without an expiry date", async () => {
    const live = sources([record(ID, new Date(Date.now() + DAY))]);
    expect(await availabilityOf(ID, live)).toBe("available");
    const kept = sources([record(ID, null)]);
    expect(await availabilityOf(ID, kept)).toBe("available");
  });

  it("finds a reference without asking the database", async () => {
    const reference = sources([], [ID]);
    expect(await availabilityOf(ID, reference)).toBe("available");
    expect(reference.store.get).not.toHaveBeenCalled();
  });

  it("reports an unknown identifier as missing", async () => {
    expect(await availabilityOf(ID, sources([]))).toBe("missing");
  });

  it("reports an identifier that cannot exist as missing, without any lookup", async () => {
    const none = sources([]);
    expect(await availabilityOf("inconnu", none)).toBe("missing");
    expect(none.findReference).not.toHaveBeenCalled();
  });

  it("reports an explanation past its expiry date as expired", async () => {
    const gone = sources([record(ID, new Date(Date.now() - 1000))]);
    expect(await availabilityOf(ID, gone)).toBe("expired");
  });

  it("never reports a reference as expired", async () => {
    const reference = sources([record(ID, new Date(0))], [ID]);
    expect(await availabilityOf(ID, reference)).toBe("available");
  });
});

describe("isDocumentRequest", () => {
  it("is true for a page load, a frame and a client without Fetch Metadata", () => {
    expect(isDocumentRequest("document")).toBe(true);
    expect(isDocumentRequest("iframe")).toBe(true);
    expect(isDocumentRequest(null)).toBe(true);
  });

  it("is false for the fetch of a navigation inside the app", () => {
    expect(isDocumentRequest("empty")).toBe(false);
  });
});
