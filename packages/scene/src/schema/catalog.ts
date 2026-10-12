import { z } from "zod";
import {
  ActionSchema,
  ELEMENT_SLOTS,
  ElementSchema,
  LAYOUT_SLOTS,
  type ElementType,
} from "./document";

interface JsonNode {
  $ref?: string;
  type?: string;
  const?: unknown;
  enum?: unknown[];
  anyOf?: JsonNode[];
  oneOf?: JsonNode[];
  items?: JsonNode;
  prefixItems?: JsonNode[];
  properties?: Record<string, JsonNode>;
  required?: string[];
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  description?: string;
  $defs?: Record<string, JsonNode>;
}

function range(node: JsonNode): string {
  if (node.minItems === undefined && node.maxItems === undefined) return "";
  if (node.minItems === node.maxItems) return ` (${node.minItems})`;
  return ` (${node.minItems ?? 0}–${node.maxItems ?? "∞"})`;
}

export function typeOf(node: JsonNode): string {
  if (node.$ref) return node.$ref.split("/").at(-1) as string;
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map((value) => JSON.stringify(value)).join(" | ");
  const alternatives = node.anyOf ?? node.oneOf;
  if (alternatives) return alternatives.map(typeOf).join(" | ");
  if (node.type === "array") {
    if (node.prefixItems) return `[${node.prefixItems.map(typeOf).join(", ")}]`;
    return `${node.items ? typeOf(node.items) : "any"}[]${range(node)}`;
  }
  if (node.type === "object" && node.properties) {
    const required = new Set(node.required ?? []);
    const fields = Object.entries(node.properties).map(
      ([key, child]) => `${key}${required.has(key) ? "" : "?"}: ${typeOf(child)}`,
    );
    return `{ ${fields.join(", ")} }`;
  }
  if (node.type === "string") return node.maxLength ? `string(≤${node.maxLength})` : "string";
  return node.type ?? "any";
}

function notes(node: JsonNode): string[] {
  return Object.entries(node.properties ?? {})
    .filter(([, child]) => child.description && !child.$ref)
    .map(([key, child]) => `  - ${key}: ${child.description}`);
}

export interface CatalogOptions {
  types: readonly ElementType[];
}

export function describeCatalog(options: CatalogOptions): string {
  const allowed = new Set(options.types);
  const schema = z.toJSONSchema(ElementSchema, { io: "input" }) as JsonNode;
  const lines: string[] = ["## Shared types"];
  for (const [name, def] of Object.entries(schema.$defs ?? {})) {
    lines.push(
      `- ${name} = ${typeOf({ ...def, $ref: undefined })}${def.description ? ` — ${def.description}` : ""}`,
    );
  }

  lines.push("", "## Layouts and their slots");
  for (const [layout, slots] of Object.entries(LAYOUT_SLOTS))
    lines.push(`- ${layout}: ${slots.join(", ")}`);

  lines.push("", "## Primitives");
  for (const option of schema.oneOf ?? schema.anyOf ?? []) {
    const type = option.properties?.type?.const as ElementType | undefined;
    if (!type || !allowed.has(type)) continue;
    lines.push(`### ${type} — slots: ${ELEMENT_SLOTS[type].join(", ")}`);
    if (option.description) lines.push(option.description);
    lines.push(typeOf(option), ...notes(option), "");
  }

  lines.push("## Actions");
  const actions = z.toJSONSchema(ActionSchema, { io: "input" }) as JsonNode;
  for (const option of actions.oneOf ?? actions.anyOf ?? []) {
    lines.push(`- ${typeOf(option)}${option.description ? ` — ${option.description}` : ""}`);
  }
  return lines.join("\n");
}
