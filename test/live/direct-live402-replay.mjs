// Replays the LIVE unpaid 402 terms from https://api.agentsearchhq.com (captured headers) through the MCP's direct
// path. The paid retry is answered locally (never sent anywhere), so nothing is paid. Usage: node <this> <dir with *.h>
import { generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
process.env.AGENTSEARCH_X402_DIRECT = "1"; process.env.AGENTSEARCH_MODE = "paid";
process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = generatePrivateKey(); // throwaway, unfunded
const hdr = (op) => readFileSync(`${dir}/${op}.h`, "utf8").split(/\r?\n/).find((l) => /^payment-required:/i.test(l)).split(/:\s*/)[1].trim();
let cur;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("https://api.agentsearchhq.com/x402/v1/")) throw new Error("unexpected url " + url);
  if (!init.headers["PAYMENT-SIGNATURE"]) return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": hdr(cur) } });
  const p = JSON.parse(Buffer.from(init.headers["PAYMENT-SIGNATURE"], "base64").toString());
  return new Response(JSON.stringify({ replay: true, to: p.payload.authorization.to, value: p.payload.authorization.value }), { status: 200 });
};
const { createServer } = await import("../../dist/server.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const server = createServer(); const [c, s] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "replay", version: "0" }); await Promise.all([server.connect(s), client.connect(c)]);
for (const [op, name, args] of [["search", "agentsearch_web_search", { query: "x402" }], ["extract", "agentsearch_extract", { url: "https://example.com" }], ["render", "agentsearch_render", { url: "https://example.com" }]]) {
  cur = op; const r = await client.callTool({ name, arguments: args });
  console.log(op, r.isError ? "REFUSED " + r.content[0].text.slice(0, 300) : "accepted live terms: " + JSON.stringify(JSON.parse(r.content[0].text).response));
}
process.exit(0);
