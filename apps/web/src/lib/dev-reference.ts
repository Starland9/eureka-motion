import { DocumentSchema, type ExplanationDocument } from "scene";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";

export function devReferenceDocument(): ExplanationDocument {
  return DocumentSchema.parse(reference.payload);
}

export function isDevRouteEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
