import type { ShutterMarketIntent } from "./types";

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function assertIntent(intent: ShutterMarketIntent) {
  if (!intent.market.trim()) throw new Error("market is required.");
  if (!intent.trader.trim()) throw new Error("trader is required.");
  if (!Number.isInteger(intent.priceBps) || intent.priceBps <= 0 || intent.priceBps >= 10_000) {
    throw new Error("priceBps must be an integer between 1 and 9,999.");
  }

  const shares = BigInt(intent.sharesBaseUnits);
  if (shares <= 0n) throw new Error("sharesBaseUnits must be positive.");

  if (!Number.isInteger(intent.createdAt) || intent.createdAt <= 0) {
    throw new Error("createdAt must be a positive Unix timestamp.");
  }

  if (intent.expiresAt != null && intent.expiresAt <= intent.createdAt) {
    throw new Error("expiresAt must be later than createdAt.");
  }
}

export function encodeMarketIntent(intent: ShutterMarketIntent): string {
  assertIntent(intent);

  // Keep field order explicit so the same intent always produces the same bytes.
  const payload = JSON.stringify({
    version: intent.version,
    chain: intent.chain,
    market: intent.market,
    trader: intent.trader,
    side: intent.side,
    action: intent.action,
    priceBps: intent.priceBps,
    sharesBaseUnits: intent.sharesBaseUnits,
    nonce: intent.nonce,
    createdAt: intent.createdAt,
    ...(intent.expiresAt == null ? {} : { expiresAt: intent.expiresAt }),
  });

  return bytesToHex(new TextEncoder().encode(payload));
}

export async function hashEncodedIntent(encodedIntent: string): Promise<string> {
  const body = encodedIntent.startsWith("0x") ? encodedIntent.slice(2) : encodedIntent;
  if (body.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(body)) {
    throw new Error("encodedIntent must be hex.");
  }

  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }

  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export function createIntentNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
