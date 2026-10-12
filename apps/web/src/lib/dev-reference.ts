import { DocumentSchema, typesetTexts, type ExplanationDocument } from "scene";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";

export function devReferenceDocument(): ExplanationDocument {
  return typesetTexts(DocumentSchema.parse(reference.payload), "fr");
}

export function isDevRouteEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
