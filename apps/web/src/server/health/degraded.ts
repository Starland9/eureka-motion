import type { Language } from "scene";
import { errorResponse } from "../http/errors";
import { listReferences } from "../reference";

async function referenceSummaries(language: Language) {
  try {
    const entries = await listReferences(language);
    return entries.map(({ slug, subject, title, reference_level, explanation_id }) => ({
      slug,
      subject,
      title,
      reference_level,
      explanation_id,
    }));
  } catch (error) {
    console.error("The reference explanations could not be listed.", error);
    return [];
  }
}

export async function generationUnavailableResponse(language: Language): Promise<Response> {
  return errorResponse("generation_unavailable", language, {
    extra: { references: await referenceSummaries(language) },
  });
}
