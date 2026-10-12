import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "packages/scene/assets/fonts");
const target = join(root, "apps/web/public/fonts");

mkdirSync(target, { recursive: true });

const files = readdirSync(source).filter((name) => name.endsWith(".woff2"));
for (const name of files) {
  copyFileSync(join(source, name), join(target, name));
}

console.log(`sync-fonts: ${files.length} files copied to apps/web/public/fonts`);
