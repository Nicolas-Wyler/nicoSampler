import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { zip } from "./lib/zip.mjs";
import { publicFiles, root } from "./public-files.mjs";
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const version = pkg.version,
  tag = "v" + version,
  dist = path.join(root, "dist"),
  web = path.join(dist, "web");
const run = spawnSync(process.execPath, ["scripts/build-examples.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (run.status !== 0) throw Error("Example build failed");
const scan = spawnSync(process.execPath, ["scripts/check-public.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (scan.status !== 0) throw Error("Public source validation failed");
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(web, { recursive: true });
const webParts = [
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "sw.js",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "src",
  "dsp",
  "icons",
  "licenses",
  "docs",
  "examples",
  "release-notes",
];
for (const name of webParts)
  await fs.cp(path.join(root, name), path.join(web, name), { recursive: true });
async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name,
      p = path.join(dir, entry.name);
    if (entry.isSymbolicLink())
      throw Error("Release symlink rejected: " + name);
    if (entry.isDirectory()) out.push(...(await walk(p, name + "/")));
    else {
      const st = await fs.stat(p);
      out.push({ name, data: await fs.readFile(p), mode: st.mode });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
}
const assets = (await walk(web))
  .filter((e) => e.name !== "sw.js")
  .map((e) => "./" + e.name);
assets.unshift("./");
let sw = await fs.readFile(path.join(web, "sw.js"), "utf8");
sw = sw.replace(
  /const ASSETS = \[[\s\S]*?\n\];/,
  "const ASSETS = " + JSON.stringify(assets, null, 2) + ";",
);
const hash = createHash("sha256");
for (const asset of assets) {
  const name = asset.slice(2);
  hash.update(name);
  hash.update(await fs.readFile(path.join(web, name || "index.html")));
}
// Worker logic changes must also invalidate the offline cache version.
hash.update(sw.replace(/const CACHE = "[^"]+"/, 'const CACHE = "CONTENT_HASH"'));
const cache = "nicosampler-" + version + "-" + hash.digest("hex").slice(0, 12);
sw = sw
  .replace(/const CACHE = "[^"]+"/, `const CACHE = "${cache}"`)
  .replaceAll(
    'k.startsWith("nico-sampler-classic-")',
    'k.startsWith("nicosampler-")',
  );
await fs.writeFile(path.join(web, "sw.js"), sw);
const records = [];
async function archive(name, entries) {
  const data = zip(entries);
  await fs.writeFile(path.join(dist, name), data);
  records.push({
    file: name,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const webEntries = await walk(web);
await archive(`nicoSampler-Web-${tag}.zip`, webEntries);
const exampleEntries = await walk(path.join(root, "examples"));
await archive(`nicoSampler-Examples-${tag}.zip`, [
  ...exampleEntries.map((e) => ({ ...e, name: "examples/" + e.name })),
  { name: "LICENSE", data: await fs.readFile(path.join(root, "LICENSE")) },
]);
const docEntries = webEntries.filter(
  (e) =>
    ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"].includes(e.name) ||
    e.name.startsWith("docs/") ||
    e.name.startsWith("release-notes/") ||
    e.name.startsWith("licenses/") ||
    e.name.startsWith("examples/"),
);
await archive(
  `nicoSampler-Documentation-${tag}.zip`,
  docEntries.filter((e) => !e.name.endsWith(".zip")),
);
const source = await publicFiles();
await archive(
  `nicoSampler-Source-${tag}.zip`,
  await Promise.all(
    source.map(async (name) => ({
      name,
      data: await fs.readFile(path.join(root, name)),
      mode: (await fs.stat(path.join(root, name))).mode,
    })),
  ),
);
if (!process.argv.includes("--web-only"))
  for (const [label, systems, wrapper] of [
    ["macOS", ["darwin-arm64", "darwin-amd64"], "Start.command"],
    ["Windows", ["windows-amd64", "windows-arm64"], "Start.cmd"],
  ]) {
    const bins = [];
    for (const system of systems) {
      const dir = path.join(root, "portable/bin", system);
      try {
        bins.push(
          ...(await walk(dir)).map((e) => ({
            ...e,
            name: "bin/" + system + "/" + e.name,
          })),
        );
      } catch {
        throw Error(
          "Missing portable binary " +
            system +
            "; run the launcher build or use --web-only",
        );
      }
    }
    const go = (await walk(path.join(root, "portable/third-party"))).map(
      (e) => ({ ...e, name: "third-party/" + e.name }),
    );
    const readme = Buffer.from(
      `nicoSampler ${version}\n\nExtract this entire folder. Double-click ${wrapper}; keep its terminal open.\nYour default browser opens localhost. No Python, Node or system installation is needed.\nUnsigned downloads may need OS approval. Browser device permissions still apply.\nSave project ZIP backups before stopping the server.\nSee app/docs/PORTABLE-LAUNCHER.md and LICENSE.\n`,
    );
    const entries = [
      {
        name: wrapper,
        data: await fs.readFile(path.join(root, "portable", wrapper)),
        mode: wrapper.endsWith(".command") ? 0o100755 : 0o100644,
      },
      { name: "README.txt", data: readme },
      { name: "LICENSE", data: await fs.readFile(path.join(root, "LICENSE")) },
      ...go,
      ...bins,
      ...webEntries.map((e) => ({ ...e, name: "app/" + e.name })),
    ];
    await archive(
      `nicoSampler-Portable-${label}-${tag}.zip`,
      entries.map((e) => ({ ...e, name: "nicoSampler/" + e.name })),
    );
  }
await fs.writeFile(
  path.join(dist, "SHA256SUMS.txt"),
  records.map((e) => e.sha256 + "  " + e.file).join("\n") + "\n",
);
await fs.writeFile(
  path.join(dist, "release-manifest.json"),
  JSON.stringify(
    {
      version,
      cache,
      offlineAssets: assets.length,
      publicSourceFiles: source.length,
      assets: records,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    { version, cache, offlineAssets: assets.length, assets: records },
    null,
    2,
  ),
);
