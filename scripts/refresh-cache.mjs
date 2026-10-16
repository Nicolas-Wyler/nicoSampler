import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { root } from "./public-files.mjs";
const file = path.join(root, "sw.js");
let source = await fs.readFile(file, "utf8");
const header = source.split("self.addEventListener")[0],
  hash = createHash("sha256");
for (const match of header.matchAll(/"\.\/([^"\n]*)"/g)) {
  const name = match[1];
  hash.update(name);
  hash.update(await fs.readFile(path.join(root, name || "index.html")));
}
source = source.replace(
  /const CACHE = "[^"]+"/,
  `const CACHE = "nico-sampler-classic-v2-${hash.digest("hex").slice(0, 12)}"`,
);
await fs.writeFile(file, source);
