import fs from "node:fs/promises";
import path from "node:path";
import { publicFiles, root } from "./public-files.mjs";
const files = await publicFiles();
const findings = [];
for (const file of files) {
  if (
    /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|protected-before\.json)$/.test(
      file,
    )
  )
    findings.push(file + ": private filename");
  const bytes = await fs.readFile(path.join(root, file));
  if (
    /\.(?:js|mjs|json|md|txt|sh|ps1|cmd|command|go|html|css|yml|yaml)$/.test(
      file,
    ) ||
    /LICENSE$/.test(file)
  ) {
    const text = bytes.toString("utf8");
    if (/\/(?:Users|home)\/[^\s/'"<>]+\//.test(text))
      findings.push(file + ": absolute personal home path");
    if (
      /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{40,}/.test(
        text,
      )
    )
      findings.push(file + ": credential-like string");
    if (/Aaah\.wav|Program 1\.nicoprog/.test(text))
      findings.push(file + ": personal sample reference");
  }
}
if (findings.length) throw Error(findings.join("\n"));
console.log(
  `Public source scan passed: ${files.length} files. Generated example archives are intentional; private logs, caches and user audio are excluded.`,
);
