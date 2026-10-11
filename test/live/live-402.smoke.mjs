// Live, UNPAID smoke test: asks the real portal for its 402 terms and checks they parse and pass
// this server's signing policy. Uses a throwaway random key with no funds and stops before
// anything is sent with a payment header. Run: npm run smoke:live
import { test } from "node:test";
import assert from "node:assert/strict";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PORTAL_SERVICES, DEFAULT_PORTAL_URL, selectAccept, MAX_PER_CALL_ATOMIC, USDC_BASE, PORTAL_PAYEE } from "../../dist/pocket.js";

const bodies = {
  search: { query: "Pocket Network", max_results: 1 },
  extract: { url: "https://example.com" },
  render: { url: "https://example.com" },
};

for (const [op, { serviceId, path }] of Object.entries(PORTAL_SERVICES)) {
  test(`live 402 challenge parses for ${serviceId}`, async () => {
    const throwaway = privateKeyToAccount(generatePrivateKey()); // never funded, never sent
    const res = await fetch(`${DEFAULT_PORTAL_URL}/v1/${serviceId}${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodies[op]),
    });
    assert.equal(res.status, 402);
    const body = await res.json();
    const pr = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((n) => res.headers.get(n), body);
    assert.equal(pr.x402Version, 2);
    assert.ok(pr.resource.url.endsWith(`/v1/${serviceId}`));
    const a = selectAccept(pr.accepts, MAX_PER_CALL_ATOMIC);
    assert.equal(a.amount, "5000");
    assert.equal(a.asset.toLowerCase(), USDC_BASE.toLowerCase());
    assert.equal(a.payTo.toLowerCase(), PORTAL_PAYEE.toLowerCase());
    console.log(`${serviceId}: 402 ok, exact ${a.network} ${a.amount} -> ${a.payTo}, extra=${JSON.stringify(a.extra)}; throwaway payer ${throwaway.address} (unfunded, nothing signed or sent)`);
  });
}
