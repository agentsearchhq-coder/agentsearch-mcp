// E2E: MCP (direct mode) -> local mock direct API (mainnet terms, MockFacilitator chain 8453, no chain).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generatePrivateKey } from "viem/accounts";
process.env.AGENTSEARCH_X402_DIRECT = "1";
process.env.AGENTSEARCH_X402_DIRECT_URL = "http://127.0.0.1:8397";
process.env.AGENTSEARCH_MODE = "paid";
process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = generatePrivateKey();
const { createServer } = await import("/workspace/agentsearch-mcp/dist/server.js");
const server = createServer(); const [c, s] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "e2e", version: "0" }); await Promise.all([server.connect(s), client.connect(c)]);
for (const [name, args] of [["agentsearch_web_search", { query: "x402 protocol" }], ["agentsearch_extract", { url: "https://example.com" }], ["agentsearch_render", { url: "https://example.com" }]]) {
  const r = await client.callTool({ name, arguments: args });
  const o = JSON.parse(r.content[0].text);
  console.log(name, r.isError ? "ERROR " + r.content[0].text.slice(0, 200) : `ok amount=${o.payment.amountAtomic} payTo=${o.payment.payTo} settled=${o.payment.settled} mock=${o.response.mock}`);
}
console.log(await (await fetch("http://127.0.0.1:8397/__mock/stats")).text());
process.exit(0);
