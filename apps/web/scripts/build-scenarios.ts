import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import type { Scenario } from "../src/server/llm/fixture";
import {
  modeScenarios,
  scenarioFromReference,
  type ReferenceFile,
} from "../tests/helpers/scenario";

const root = path.resolve(import.meta.dirname, "../../..");
const source = path.join(root, "content/reference/physics.universal-gravitation.fr.json");
const directory = path.join(root, "apps/web/tests/fixtures/scenarios");
const target = path.join(directory, "gravity.fr.json");

async function write(scenario: Scenario, file: string): Promise<void> {
  const options = await resolveConfig(file);
  const text = await format(JSON.stringify(scenario), { ...options, filepath: file });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`${path.relative(root, file)}: ${scenario.steps.length} steps`);
}

async function main(): Promise<void> {
  const reference = JSON.parse(readFileSync(source, "utf8")) as ReferenceFile;
  await write(scenarioFromReference(reference, { name: "gravity.fr", quiz: {} }), target);
  for (const scenario of modeScenarios(reference)) {
    await write(scenario, path.join(directory, `${scenario.name}.json`));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
