/**
 * Durable Smithery MCPB publish helper.
 *
 * MCPB manifests must omit tool inputSchema (mcpb validate rejects it), but the
 * Smithery CLI expects every tool to have an inputSchema object when building
 * the deploy payload. This script idempotently patches the resolved global
 * smithery dist/index.js (IQ + Dne) before publishing.
 *
 * Usage:
 *   node scripts/publish-smithery.mjs            # pack if needed, patch, publish
 *   node scripts/publish-smithery.mjs --dry-patch # report/apply patches only
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const mcpbPath = join(root, "agentsearch-mcp.mcpb");
const qualifiedName = "agentsearchhq/agentsearch-mcp";
const dryPatch = process.argv.includes("--dry-patch");

/** Unpatched IQ: pass tools through unchanged. */
const IQ_UNPATCHED = "...r.tools?{tools:r.tools}:{}";
/** Patched IQ: ensure each tool has an inputSchema object. */
const IQ_PATCHED =
  '...r.tools?{tools:r.tools.map(t=>Object.assign({},t,{inputSchema:t.inputSchema&&typeof t.inputSchema=="object"?t.inputSchema:{type:"object",properties:{}}}))}:{}';

/** Unpatched Dne: always send module/sourcemap (undefined breaks multipart). */
const DNE_UNPATCHED =
  "a={payload:JSON.stringify(r),module:n,sourcemap:i,bundle:o},c;try{";
/** Patched Dne: omit undefined module/sourcemap from the deploy form. */
const DNE_PATCHED =
  "a={payload:JSON.stringify(r),bundle:o},c;if(n!==void 0)a.module=n;if(i!==void 0)a.sourcemap=i;try{";

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resolveSmitheryDist() {
  const which = spawnSync("which", ["smithery"], { encoding: "utf8" });
  if (which.status !== 0 || !which.stdout.trim()) {
    throw new Error(
      "smithery not found on PATH (expected ~/.local/bin/smithery or similar)",
    );
  }
  const bin = which.stdout.trim();
  let target;
  try {
    target = realpathSync(bin);
  } catch {
    target = bin;
  }
  if (!existsSync(target)) {
    throw new Error(`Resolved smithery path does not exist: ${target}`);
  }
  return target;
}

/**
 * Idempotently apply IQ + Dne patches to smithery dist/index.js.
 * @returns {{ path: string, iq: "patched"|"already", dne: "patched"|"already" }}
 */
function patchSmitheryCli(distPath) {
  let src = readFileSync(distPath, "utf8");
  const result = { path: distPath, iq: /** @type {"patched"|"already"|"missing"} */ ("missing"), dne: /** @type {"patched"|"already"|"missing"} */ ("missing") };
  let changed = false;

  if (src.includes(IQ_PATCHED)) {
    result.iq = "already";
  } else if (src.includes(IQ_UNPATCHED)) {
    src = src.replace(IQ_UNPATCHED, IQ_PATCHED);
    changed = true;
    result.iq = "patched";
  }

  if (src.includes(DNE_PATCHED)) {
    result.dne = "already";
  } else if (src.includes(DNE_UNPATCHED)) {
    src = src.replace(DNE_UNPATCHED, DNE_PATCHED);
    changed = true;
    result.dne = "patched";
  }

  if (result.iq === "missing" || result.dne === "missing") {
    const parts = [];
    if (result.iq === "missing") parts.push("IQ (tools inputSchema)");
    if (result.dne === "missing") {
      parts.push("Dne (omit undefined module/sourcemap)");
    }
    throw new Error(
      `Could not find expected Smithery CLI patterns for: ${parts.join(", ")}. ` +
        `Checked ${distPath}. Smithery may have changed; update scripts/publish-smithery.mjs.`,
    );
  }

  if (changed) writeFileSync(distPath, src);
  return result;
}

function ensureMcpb() {
  if (existsSync(mcpbPath)) {
    console.log(`✓ Found ${mcpbPath}`);
    return;
  }
  console.log("agentsearch-mcp.mcpb missing — running npm run mcpb:pack …");
  run("npm", ["run", "mcpb:pack"]);
  if (!existsSync(mcpbPath)) {
    throw new Error(
      "mcpb:pack finished but agentsearch-mcp.mcpb was not created",
    );
  }
}

function main() {
  const distPath = resolveSmitheryDist();
  console.log(`Smithery CLI: ${distPath}`);

  const status = patchSmitheryCli(distPath);
  console.log(`IQ patch:  ${status.iq}`);
  console.log(`Dne patch: ${status.dne}`);

  if (dryPatch) {
    console.log("--dry-patch: skipping mcpb ensure + publish");
    return;
  }

  ensureMcpb();
  console.log(`Publishing ${mcpbPath} as ${qualifiedName} …`);
  run("smithery", [
    "mcp",
    "publish",
    "./agentsearch-mcp.mcpb",
    "-n",
    qualifiedName,
  ]);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
