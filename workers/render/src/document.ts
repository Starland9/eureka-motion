import { DocumentSchema, typesetTexts, type ExplanationDocument, type Language } from "scene";

// DocumentSchema fills the defaults the composition relies on, and a stored null quiz is absent.
export function prepareDocument(
  payload: { quiz?: unknown },
  language: Language,
): ExplanationDocument {
  return typesetTexts(
    DocumentSchema.parse({ ...payload, quiz: payload.quiz ?? undefined }),
    language,
  );
}
