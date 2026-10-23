import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { scenarioFromReference, type ReferenceFile } from "../tests/helpers/scenario";

const root = path.resolve(import.meta.dirname, "../../..");
const source = path.join(root, "content/reference/physics.universal-gravitation.fr.json");
const target = path.join(root, "apps/web/tests/fixtures/scenarios/gravity.fr.json");

async function main(): Promise<void> {
  const reference = JSON.parse(readFileSync(source, "utf8")) as ReferenceFile;
  const scenario = scenarioFromReference(reference, { name: "gravity.fr", quiz: {} });
  const options = await resolveConfig(target);
  const text = await format(JSON.stringify(scenario), { ...options, filepath: target });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`${path.relative(root, target)}: ${scenario.steps.length} steps`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
