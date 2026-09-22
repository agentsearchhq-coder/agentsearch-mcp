/**
 * Pack a production MCPB: built dist/ plus runtime node_modules only.
 * Dev tooling (TypeScript, the mcpb CLI) stays out of the archive.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, ".mcpb-stage");
const output = join(root, "agentsearch-mcp.mcpb");
const mcpb = join(root, "node_modules", ".bin", "mcpb");

const files = [
  "package.json",
  "package-lock.json",
  "manifest.json",
  "README.md",
  "LICENSE",
  "server.json",
  "smithery.yaml",
  "glama.json",
];

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

try {
  for (const file of files) {
    cpSync(join(root, file), join(stage, file));
  }
  cpSync(join(root, "dist"), join(stage, "dist"), { recursive: true });

  execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts"], {
    cwd: stage,
    stdio: "inherit",
  });

  execFileSync(mcpb, ["pack", stage, output], { stdio: "inherit" });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
