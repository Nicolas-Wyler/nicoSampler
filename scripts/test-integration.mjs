import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
for (const file of [
  "input-monitor.mjs",
  "render-options.mjs",
  "render-sample.mjs",
  "sample-bundle.mjs",
  "sample-clipboard.mjs",
  "selection.mjs",
  "meters.test.mjs",
  "zoom-inertia.mjs",
]) {
  const run = spawnSync(process.execPath, ["tests/" + file], {
    cwd: root,
    stdio: "inherit",
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
