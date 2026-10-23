import { headers } from "next/headers";
import { cache } from "react";
import { EXPLANATION_ID_PATTERN } from "@/server/container";
import { createExplanationStore, getDb } from "@/server/db";
import type { ExplanationRecord, ExplanationStore } from "@/server/pipeline/ports";
import { loadReferenceRecord } from "@/server/reference";

export type Availability = "available" | "missing" | "expired";

export interface AvailabilitySources {
  store: Pick<ExplanationStore, "get" | "isExpired">;
  findReference(id: string): Promise<ExplanationRecord | null>;
}

export async function availabilityOf(
  id: string,
  { store, findReference }: AvailabilitySources,
): Promise<Availability> {
  if (!EXPLANATION_ID_PATTERN.test(id)) return "missing";
  if ((await findReference(id)) !== null || (await store.get(id)) !== null) return "available";
  return (await store.isExpired(id)) ? "expired" : "missing";
}

// A fetch() is a navigation inside the app: the explanation it opens may be one the session
// still holds although the pipeline already dropped its row, so the client decides.
export function isDocumentRequest(fetchDest: string | null): boolean {
  return fetchDest !== "empty";
}

// When the database cannot be asked, the page opens and the client reports what it finds.
export const checkAvailability = cache(async (id: string): Promise<Availability> => {
  if (!isDocumentRequest((await headers()).get("sec-fetch-dest"))) return "available";
  try {
    return await availabilityOf(id, {
      store: createExplanationStore(getDb()),
      findReference: loadReferenceRecord,
    });
  } catch (error) {
    console.error("The availability of an explanation could not be checked.", error);
    return "available";
  }
});
