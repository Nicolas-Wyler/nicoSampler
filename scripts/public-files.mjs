import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("..", import.meta.url));
const excluded = new Set([
  "node_modules",
  "dist",
  "artifacts",
  "verification",
  ".git",
  ".DS_Store",
]);
export async function publicFiles(dir = root, prefix = "") {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (excluded.has(entry.name) || rel === "portable/bin") continue;
    if (entry.isSymbolicLink())
      throw Error(`Public source cannot include a symlink: ${rel}`);
    if (entry.isDirectory())
      result.push(
        ...(await publicFiles(path.join(dir, entry.name), rel + "/")),
      );
    else if (entry.isFile()) result.push(rel);
  }
  return result.sort();
}
