import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  checkReferences,
  compareEntries,
  INDEX_FILE,
  type ReferenceIndex,
} from "../apps/web/src/server/reference";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.INIT_CWD ?? process.cwd();

function option(name: string, fallback: string): string {
  const given = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return given ? path.resolve(base, given.slice(name.length + 3)) : fallback;
}

const dir = option("dir", path.join(root, "content/reference"));
const out = option("out", path.join(dir, INDEX_FILE));
function shown(target: string): string {
  const relative = path.relative(base, target);
  return relative.startsWith("..") ? target : relative || ".";
}

async function main(): Promise<number> {
  const results = await checkReferences(dir);
  if (results.length === 0) {
    console.error(`No reference file in ${shown(dir)}.`);
    return 1;
  }

  const failed = results.filter((result) => result.problems.length > 0);
  for (const { file, problems } of failed) {
    console.error(shown(path.join(dir, file)));
    for (const problem of problems) console.error(problem.replace(/^/gm, "  "));
  }
  if (failed.length > 0) {
    console.error(
      `${failed.length} of ${results.length} reference files rejected: no index written.`,
    );
    return 1;
  }

  const references = results.map((result) => result.entry!).sort(compareEntries);
  const index: ReferenceIndex = { references };
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(index, null, 2)}\n`);

  for (const { entry, beats, voiced } of results) {
    const { slug, language, reference_level: level } = entry!;
    console.log(`${slug} ${language} ${level}: ${voiced}/${beats} beats voiced`);
  }
  console.log(`${results.length} reference files valid, index written to ${shown(out)}.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
