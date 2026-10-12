import { DocumentSchema, type Outline, type Scene } from "scene";
import reference from "../../../../../../content/reference/physics.universal-gravitation.fr.json";

const document = DocumentSchema.parse(reference.payload);

export const EXAMPLE_QUESTION = reference.question;

export const EXAMPLE_OUTLINE: Outline = {
  plan: document.plan,
  params: document.params,
  model: document.model,
};

const byId = (id: string): Scene => document.scenes.find((scene) => scene.id === id) as Scene;

export const EXAMPLE_SCENES: readonly Scene[] = [byId("s3"), byId("s5"), byId("s6")];
