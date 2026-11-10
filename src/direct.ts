/**
 * Direct x402 route (the default paid route since 1.6.0; opt-in in 1.5.0): call AgentSearch's own x402 API on Base mainnet
 * (https://api.agentsearchhq.com/x402/v1/{search,extract,render,search_and_read}) instead of the Pocket portal.
 *
 * Same safety model as pocket.ts: unpaid POST -> 402 with PAYMENT-REQUIRED -> every limit is checked
 * BEFORE signing (scheme exact, Base, USDC, pinned AgentSearch payee, per-call ceiling $0.020, session cap)
 * -> retry once with PAYMENT-SIGNATURE -> 200 with the raw result and the receipt in PAYMENT-RESPONSE.
 * The API settles only after a successful answer; 400/502 and empty results are not charged.
 *
 * The private key is read from env, used only to sign, and never logged or returned.
 */
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { isSecureOrLocalUrl } from "./client.js";
import { paidRoute } from "./route.js";
import {
  type Accept, atomicToUsd, BASE_NETWORK, DEFAULT_SESSION_CAP_ATOMIC, eqAddr, PortalError, portalErrorInfo,
  post, type PortalOperation, type PortalResult, readWalletKey, selectAccept, sessionBudget, USDC_BASE,
} from "./pocket.js";

export type DirectOperation = PortalOperation | "search_and_read";

export const DIRECT_ENV_VAR = "AGENTSEARCH_X402_DIRECT";
export const DEFAULT_DIRECT_URL = "https://api.agentsearchhq.com";
/** AgentSearch's own payee for the direct API (published in /.well-known/x402 and the 402 terms). */
export const DIRECT_PAYEE = "0xC49B157887e51c21CB655f39CF65D6a4c2a4C337";
/** $0.020 in USDC atomic units: hard ceiling per direct call (search_and_read is $0.015, render $0.010, search $0.008, extract $0.007). */
export const DIRECT_MAX_PER_CALL_ATOMIC = 20_000n;
/** Published direct prices, for messages only (the 402 is authoritative, the ceiling is the guard). */
export const DIRECT_PRICES_USD: Record<DirectOperation, string> = { search: "$0.008", extract: "$0.007", render: "$0.010", search_and_read: "$0.015" };

/** True unless AGENTSEARCH_PAYMENT_ROUTE=pocket (or AGENTSEARCH_X402_DIRECT=0). An invalid route value is refused in runOperation. */
export function directEnabled(): boolean {
  return paidRoute() !== "pocket";
}

export const DIRECT_SETUP_MESSAGE = [
  "This paid call needs a wallet: no wallet key is configured (agentsearch_web_search is free by default and only pays when AGENTSEARCH_MODE=paid or auto).",
  "Set AGENTSEARCH_WALLET_PRIVATE_KEY (or POCKET_PRIVATE_KEY) to the 64-hex private key of a NEW wallet made only for this, fund it with a little USDC on Base (no ETH needed), and restart the client.",
  `Paid calls go to AgentSearch's own x402 API by default: search ${DIRECT_PRICES_USD.search}, extract ${DIRECT_PRICES_USD.extract}, render ${DIRECT_PRICES_USD.render}, search_and_read ${DIRECT_PRICES_USD.search_and_read} per call, paid to AgentSearch at ${DEFAULT_DIRECT_URL} (docs: https://agentsearchhq.com/docs/x402). Spending is capped at $0.020 per call and AGENTSEARCH_MAX_TOTAL_ATOMIC per session (default $1.00). Search + Read is direct-only.`,
  "Set AGENTSEARCH_PAYMENT_ROUTE=pocket to pay through the Pocket Network Agentic Portal instead ($0.005 per call). Or set AGENTSEARCH_BASE_URL to your own self-hosted AgentSearch-compatible API.",
  "Wallet setup takes about 2 minutes: https://agentsearchhq.com/wallet-setup",
].join(" ");

function atomicEnv(names: string[], fallback: bigint): bigint {
  for (const name of names) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    if (!/^\d+$/.test(raw)) throw new PortalError(`${name} must be a whole number of USDC atomic units (1000000 = $1.00). Nothing was signed.`);
    return BigInt(raw);
  }
  return fallback;
}

export interface DirectSettings { baseUrl: string; sessionCapAtomic: bigint; perCallCapAtomic: bigint }

export function loadDirectSettings(): DirectSettings {
  const baseUrl = (process.env.AGENTSEARCH_X402_DIRECT_URL?.trim() || DEFAULT_DIRECT_URL).replace(/\/+$/, "");
  if (!isSecureOrLocalUrl(baseUrl)) throw new PortalError("AGENTSEARCH_X402_DIRECT_URL must be https:// (http only for localhost). Nothing was signed.");
  const session = atomicEnv(["AGENTSEARCH_MAX_TOTAL_ATOMIC", "POCKET_MAX_TOTAL_ATOMIC"], DEFAULT_SESSION_CAP_ATOMIC);
  const perCall = atomicEnv(["AGENTSEARCH_MAX_PER_CALL_ATOMIC", "POCKET_MAX_PER_CALL_ATOMIC"], DIRECT_MAX_PER_CALL_ATOMIC);
  // A per-call setting can only lower the hard $0.020 ceiling, never raise it.
  return { baseUrl, sessionCapAtomic: session, perCallCapAtomic: perCall < DIRECT_MAX_PER_CALL_ATOMIC ? perCall : DIRECT_MAX_PER_CALL_ATOMIC };
}

/** Only the fields the direct API reads: search {query, max_results}; extract/render {url}; search_and_read {query, num_results, max_results, max_chars, render_fallback}. */
export function directBody(op: DirectOperation, body: Record<string, unknown>): { body: Record<string, unknown>; dropped: string[] } {
  const keep = op === "search" ? ["query", "max_results"]
    : op === "search_and_read" ? ["query", "num_results", "max_results", "max_chars", "render_fallback"]
    : ["url"];
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    if (keep.includes(k)) out[k] = v; else dropped.push(k);
  }
  return { body: out, dropped };
}

export async function callDirect(op: DirectOperation, input: Record<string, unknown>): Promise<PortalResult & { dropped?: string[] }> {
  const settings = loadDirectSettings();
  const key = readWalletKey();
  if (!key) throw new PortalError(DIRECT_SETUP_MESSAGE);
  const { body, dropped } = directBody(op, input);
  const url = `${settings.baseUrl}/x402/v1/${op}`;
  const budget = sessionBudget();

  // 1) Unpaid request -> expect 402 terms.
  const unpaid = await post(url, body, {});
  if (unpaid.status !== 402) {
    const info = portalErrorInfo(unpaid);
    throw new PortalError(`The AgentSearch x402 API answered ${unpaid.status} ${info.code} before payment: ${info.message} (retryable: ${info.retryable}). Nothing was signed.`, { error: info });
  }
  const http = new x402HTTPClient(new x402Client());
  let required: { x402Version: number; resource?: { url?: string }; accepts: Accept[] };
  try {
    required = http.getPaymentRequiredResponse((n) => unpaid.headers.get(n), unpaid.body) as never;
  } catch (e) {
    throw new PortalError(`The 402 is not valid x402 v2 (${e instanceof Error ? e.message : String(e)}). Nothing was signed.`);
  }
  if (required.x402Version !== 2) throw new PortalError(`Unsupported x402Version ${required.x402Version}. Nothing was signed.`);
  const resUrl = required.resource?.url ?? "";
  if (!resUrl.replace(/\/+$/, "").endsWith(`/x402/v1/${op}`)) {
    throw new PortalError(`The 402 is for resource ${resUrl}, not /x402/v1/${op}. Nothing was signed.`);
  }

  // 2) Limits, checked before anything is signed.
  const remaining = budget.remaining(settings.sessionCapAtomic);
  const ceiling = settings.perCallCapAtomic < remaining ? settings.perCallCapAtomic : remaining;
  if (ceiling <= 0n) {
    throw new PortalError(`Session spend cap reached: ${atomicToUsd(budget.spent)} of ${atomicToUsd(settings.sessionCapAtomic)} signed. Raise AGENTSEARCH_MAX_TOTAL_ATOMIC and restart to spend more. Nothing was signed.`);
  }
  let chosen: Accept;
  try {
    chosen = selectAccept(required.accepts, ceiling, DIRECT_PAYEE, "AgentSearch's payee");
  } catch (e) {
    if (e instanceof PortalError && settings.perCallCapAtomic < DIRECT_MAX_PER_CALL_ATOMIC && ceiling === settings.perCallCapAtomic) {
      throw new PortalError(`${e.message} Your per-call cap (AGENTSEARCH_MAX_PER_CALL_ATOMIC=${settings.perCallCapAtomic}) is below this route's price; since 1.7.0 paid calls go to AgentSearch's own x402 API (search $0.008, extract $0.007, render $0.010, search_and_read $0.015). Raise the cap to 20000, remove it, or set AGENTSEARCH_PAYMENT_ROUTE=pocket for the $0.005 Pocket route (search, extract and render only; search_and_read is direct-only).`, e.detail);
    }
    throw e;
  }
  const amount = BigInt(chosen.amount);

  // 3) Sign with the reference x402 client, restricted to the option chosen above.
  const account = privateKeyToAccount(key);
  const selector = (_v: number, options: Accept[]) => {
    const match = options.find((o) => o.scheme === chosen.scheme && o.network === chosen.network && eqAddr(o.asset, chosen.asset) && eqAddr(o.payTo, chosen.payTo) && o.amount === chosen.amount);
    if (!match) throw new PortalError("Selected option disappeared. Nothing was signed.");
    return match;
  };
  const client = new x402Client(selector as never).setSpendControls(false);
  registerExactEvmScheme(client, { signer: account, paymentRequirementsSelector: selector as never });
  const payer = new x402HTTPClient(client);

  budget.reserved += amount;
  let signedPayload: { accepted?: Accept; payload?: { authorization?: Record<string, string> } };
  try {
    signedPayload = (await payer.createPaymentPayload(required as never)) as never;
  } catch (e) {
    budget.reserved -= amount;
    if (e instanceof PortalError) throw e;
    throw new PortalError(`Could not build the payment (${e instanceof Error ? e.message : String(e)}). Nothing was signed.`);
  }
  const auth = signedPayload.payload?.authorization;
  if (!auth || !eqAddr(auth.to, DIRECT_PAYEE) || BigInt(auth.value ?? "0") !== amount || signedPayload.accepted?.network !== BASE_NETWORK || !eqAddr(signedPayload.accepted?.asset, USDC_BASE)) {
    budget.reserved -= amount;
    throw new PortalError("The signed authorization does not match the approved terms; it was discarded and not sent.");
  }
  budget.reserved -= amount;
  budget.spent += amount; // counted at signing: a signed authorization may be settled.

  // 4) Retry once with PAYMENT-SIGNATURE.
  let paid;
  try {
    paid = await post(url, body, payer.encodePaymentSignatureHeader(signedPayload as never));
  } catch (e) {
    throw new PortalError(`A payment of ${atomicToUsd(amount)} was signed but the paid request failed (${e instanceof Error ? e.message : String(e)}). It is settled only after a successful answer, so it is most likely unused; check the wallet before retrying.`, { paymentSigned: true });
  }
  const spend = {
    sessionSpentAtomic: budget.spent.toString(),
    sessionCapAtomic: settings.sessionCapAtomic.toString(),
    sessionRemainingAtomic: budget.remaining(settings.sessionCapAtomic).toString(),
  };
  if (paid.status < 200 || paid.status >= 300) {
    const info = portalErrorInfo(paid);
    throw new PortalError(`The AgentSearch x402 API answered ${paid.status} ${info.code}: ${info.message} (retryable: ${info.retryable}${info.retryAfter ? `, retry after ${info.retryAfter}s` : ""}). Non-2xx answers are not settled, so you should not be charged; the signed ${atomicToUsd(amount)} still counts against this session's cap.`, { error: info, paymentSigned: true, settled: false, spend });
  }
  let receipt: { success?: boolean; transaction?: string } | undefined;
  const header = paid.headers.get("PAYMENT-RESPONSE");
  if (header) {
    try { receipt = decodePaymentResponseHeader(header) as never; } catch { receipt = undefined; }
  }
  const tx = receipt?.transaction || null;
  const payment: Record<string, unknown> = {
    amountAtomic: amount.toString(), amountUsd: atomicToUsd(amount), asset: "USDC", assetAddress: USDC_BASE,
    network: BASE_NETWORK, payTo: DIRECT_PAYEE, payer: account.address, rail: "agentsearch-x402-direct", endpoint: `/x402/v1/${op}`,
    settled: receipt?.success ?? false, transaction: tx,
    ...(tx ? { explorer: `https://basescan.org/tx/${tx}` } : {}),
    ...(receipt ? {} : { note: "No settlement receipt (PAYMENT-RESPONSE) was returned, so this payment is unconfirmed." }),
  };
  return { payment, spend, response: paid.body, ...(dropped.length ? { dropped } : {}) };
}
