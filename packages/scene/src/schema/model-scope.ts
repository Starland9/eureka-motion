import { buildScope, defaultParamValues, type ModelDefinition, type Scope } from "../expr";
import type { Outline, Scene } from "./document";

export interface ModelSource {
  params: readonly Outline["params"][number][];
  model: {
    constants: readonly Outline["model"]["constants"][number][];
    derived: readonly Outline["model"]["derived"][number][];
  };
}

export function toModelDefinition(source: ModelSource): ModelDefinition {
  return {
    params: source.params,
    constants: source.model.constants,
    derived: source.model.derived,
  };
}

export function withSceneValues(source: ModelSource, scene: Pick<Scene, "derived">): ModelSource {
  if (scene.derived.length === 0) return source;
  return {
    params: source.params,
    model: {
      constants: source.model.constants,
      derived: [...source.model.derived, ...scene.derived],
    },
  };
}

export interface ScopeSample {
  label: string;
  scope: Scope;
}

export function sampleScopes(source: ModelSource): ScopeSample[] {
  const model = toModelDefinition(source);
  const defaults = defaultParamValues(model.params);
  const samples: ScopeSample[] = [
    { label: "the default values", scope: buildScope(model, defaults) },
  ];
  for (const param of model.params) {
    samples.push({
      label: `${param.id} = ${param.min} (its minimum)`,
      scope: buildScope(model, { ...defaults, [param.id]: param.min }),
    });
    samples.push({
      label: `${param.id} = ${param.max} (its maximum)`,
      scope: buildScope(model, { ...defaults, [param.id]: param.max }),
    });
  }
  return samples;
}
