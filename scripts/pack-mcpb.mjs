/**
 * Build a production MCPB: copy the compiled server, install runtime
 * dependencies only, then pack to agentsearch-mcp.mcpb.
 * Caller runs `npm run build` first so dist/ exists.
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const stage = mkdtempSync(join(tmpdir(), "agentsearch-mcpb-"));
const output = join(root, "agentsearch-mcp.mcpb");

const files = [
  "package.json",
  "package-lock.json",
  "manifest.json",
  "README.md",
  "LICENSE",
  ".env.example",
  "server.json",
  "smithery.yaml",
  "glama.json",
  ".mcpbignore",
];

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  for (const file of files) {
    cpSync(join(root, file), join(stage, file));
  }
  cpSync(join(root, "dist"), join(stage, "dist"), { recursive: true });

  // Skip lifecycle scripts so `prepare` does not try to compile without tsc.
  run("npm", ["ci", "--omit=dev", "--ignore-scripts"], stage);
  run("mcpb", ["pack", stage, output], root);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
