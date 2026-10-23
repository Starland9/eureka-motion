import type { StartRequest } from "./types";

export function startBody(request: StartRequest): Record<string, unknown> {
  const { derive, language, level } = request;
  if (derive === undefined) {
    return {
      question: request.question,
      language,
      level,
      interpretation: request.interpretation,
    };
  }
  const base = { mode: derive.mode, parent_id: derive.parentId, language, level };
  switch (derive.mode) {
    case "zoom":
      return { ...base, scene_id: derive.sceneId };
    case "followup":
      return { ...base, question: request.question };
    default:
      return base;
  }
}
