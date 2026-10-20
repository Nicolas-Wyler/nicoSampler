// CI-only publication. Credentials stay in the runner environment.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  commit = process.env.GITHUB_SHA;
if (
  !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
  !token ||
  !/^[a-f0-9]{40}$/.test(commit ?? "")
)
  throw Error("Missing CI release identity");
const manifest = JSON.parse(
  await fs.readFile("dist/release-manifest.json", "utf8"),
);
const tag = "v" + manifest.version,
  endpoint = `https://api.github.com/repos/${repository}`;
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok)
    throw Error(`GitHub release request failed: ${response.status}`);
  return response.json();
}
let release;
const existing = await fetch(
  `${endpoint}/releases/tags/${encodeURIComponent(tag)}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (existing.ok) release = await existing.json();
else if (existing.status === 404)
  release = await api(`${endpoint}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: commit,
      name: `nicoSampler ${manifest.version}`,
      prerelease: true,
      body: `Version ${manifest.version}\n\nSource commit: ${commit}\n\nBuilt browser app, examples, documentation and source. Any portable downloads are listed in the release assets. SHA256SUMS.txt verifies the downloads. License terms are included. Each build is archived separately for rollback.`,
    }),
  });
else throw Error(`Cannot inspect release: ${existing.status}`);
for (const name of [
  ...manifest.assets.map((a) => a.file),
  "SHA256SUMS.txt",
  "release-manifest.json",
]) {
  if (path.basename(name) !== name) throw Error("Invalid release asset path");
  const bytes = await fs.readFile(path.join("dist", name)),
    digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  const prior = release.assets.find((a) => a.name === name);
  if (prior) {
    if (prior.digest !== digest)
      throw Error(`Existing release asset differs: ${name}`);
    continue;
  }
  await api(
    release.upload_url.split("{")[0] + "?name=" + encodeURIComponent(name),
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    },
  );
  console.log("Published " + name);
}
console.log(release.html_url);
