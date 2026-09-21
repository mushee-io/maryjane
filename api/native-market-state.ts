import { createHash } from "node:crypto";

const PROGRAM_ID = "HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const ORDER_SIZE = 198;
const MARKET_SIZE = 420;
const ORDER_DISC = createHash("sha256").update("account:LimitOrder").digest().subarray(0, 8);
const MARKET_DISC = createHash("sha256").update("account:Market").digest().subarray(0, 8);
const FILL_DISC = createHash("sha256").update("event:LimitOrderFilled").digest().subarray(0, 8);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58(bytes: Buffer) {
  if (!bytes.length) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) + BigInt(byte);
  let out = "";
  while (n > 0n) {
    const r = Number(n % 58n);
    out = B58[r] + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + (out || "");
}

async function rpc(method: string, params: any[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok || body?.error) {
      throw new Error(body?.error?.message || `RPC ${response.status}`);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

function accountData(account: any) {
  const value = account?.data;
  const encoded = Array.isArray(value) ? value[0] : typeof value === "string" ? value : "";
  return encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
}

function decodeMarket(raw: Buffer) {
  if (raw.length !== MARKET_SIZE || !raw.subarray(0, 8).equals(MARKET_DISC)) return null;
  return {
    collateralMint: b58(raw.subarray(72, 104)),
    marketSeed: raw.subarray(104, 136).toString("hex"),
    closeTs: Number(raw.readBigInt64LE(200)),
    resolutionTs: Number(raw.readBigInt64LE(208)),
    status: ["OPEN", "CLOSED", "RESOLUTION_PENDING", "DISPUTED", "RESOLVED_YES", "RESOLVED_NO", "CANCELLED"][raw.readUInt8(216)] || "OPEN",
    feeBps: raw.readUInt16LE(217),
    yesMint: b58(raw.subarray(251, 283)),
    noMint: b58(raw.subarray(283, 315)),
    yesReserve: raw.readBigUInt64LE(379),
    noReserve: raw.readBigUInt64LE(387),
    volume: raw.readBigUInt64LE(403),
  };
}

function decodeOrder(address: string, raw: Buffer) {
  if (raw.length !== ORDER_SIZE || !raw.subarray(0, 8).equals(ORDER_DISC)) return null;
  return {
    order: address,
    maker: b58(raw.subarray(8, 40)),
    side: raw.readUInt8(104) === 0 ? "YES" : "NO",
    kind: raw.readUInt8(105) === 0 ? "BUY" : "SELL",
    priceBps: raw.readUInt16LE(106),
    originalShares: raw.readBigUInt64LE(108).toString(),
    remainingShares: raw.readBigUInt64LE(116).toString(),
    createdAt: Number(raw.readBigInt64LE(188)),
    status: raw.readUInt8(196) === 0 ? "ACTIVE" : "FILLED",
  };
}

function decodeFill(data: Buffer, signature: string, blockTime: number) {
  if (data.length < 164 || !data.subarray(0, 8).equals(FILL_DISC)) return null;
  const side = data.readUInt8(136) === 0 ? "YES" : "NO";
  const priceBps = data.readUInt16LE(138);
  return {
    signature,
    order: b58(data.subarray(8, 40)),
    maker: b58(data.subarray(72, 104)),
    taker: b58(data.subarray(104, 136)),
    side,
    kind: data.readUInt8(137) === 0 ? "BUY" : "SELL",
    priceBps,
    yesPriceBps: side === "YES" ? priceBps : 10_000 - priceBps,
    shares: data.readBigUInt64LE(140).toString(),
    quoteAmount: data.readBigUInt64LE(148).toString(),
    remainingShares: data.readBigUInt64LE(156).toString(),
    blockTime,
  };
}

function fillsFromLogs(logs: string[], signature: string, blockTime: number) {
  const fills: any[] = [];
  for (const line of logs || []) {
    const marker = "Program data: ";
    const i = line.indexOf(marker);
    if (i < 0) continue;
    try {
      const data = Buffer.from(line.slice(i + marker.length).trim(), "base64");
      const fill = decodeFill(data, signature, blockTime);
      if (fill) fills.push(fill);
    } catch {}
  }
  return fills;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=2, stale-while-revalidate=3");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const address = String(req.query?.address || "").trim();
  if (!address) return res.status(400).json({ error: "address is required" });

  try {
    const marketInfo = await rpc("getAccountInfo", [address, { commitment: "confirmed", encoding: "base64" }]);
    if (!marketInfo?.value) return res.status(404).json({ error: "Market account not found" });
    const market = decodeMarket(accountData(marketInfo.value));
    if (!market) return res.status(400).json({ error: "Account is not a Mary Jane market" });

    const [orderRows, signatures] = await Promise.all([
      rpc("getProgramAccounts", [
        PROGRAM_ID,
        {
          commitment: "confirmed",
          encoding: "base64",
          filters: [
            { dataSize: ORDER_SIZE },
            { memcmp: { offset: 40, bytes: address } },
          ],
        },
      ]).catch(() => []),
      rpc("getSignaturesForAddress", [address, { limit: 80 }, "confirmed"]).catch(() => []),
    ]);

    const activeOrders = (orderRows || [])
      .map((row: any) => decodeOrder(String(row.pubkey), accountData(row.account)))
      .filter((order: any) => order && order.status === "ACTIVE" && BigInt(order.remainingShares) > 0n);

    const txSigs = (signatures || []).slice(0, 50);
    const fills: any[] = [];
    for (let i = 0; i < txSigs.length; i += 10) {
      const chunk = txSigs.slice(i, i + 10);
      const txs = await Promise.all(chunk.map((sig: any) =>
        rpc("getTransaction", [
          sig.signature,
          { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 },
        ]).catch(() => null)
      ));
      txs.forEach((tx: any, idx: number) => {
        if (!tx?.meta?.logMessages) return;
        fills.push(...fillsFromLogs(
          tx.meta.logMessages,
          chunk[idx].signature,
          Number(tx.blockTime || chunk[idx].blockTime || 0),
        ));
      });
    }

    fills.sort((a, b) => b.blockTime - a.blockTime);
    const cutoff = Math.floor(Date.now() / 1000) - 86_400;
    const volume24h = fills
      .filter((fill) => fill.blockTime >= cutoff)
      .reduce((sum, fill) => sum + BigInt(fill.quoteAmount), 0n);
    const traders = new Set<string>();
    for (const fill of fills) {
      traders.add(fill.maker);
      traders.add(fill.taker);
    }

    const sideBook = (side: "YES" | "NO") => {
      const bids = activeOrders
        .filter((order: any) => order.side === side && order.kind === "BUY")
        .sort((a: any, b: any) => b.priceBps - a.priceBps || a.createdAt - b.createdAt);
      const asks = activeOrders
        .filter((order: any) => order.side === side && order.kind === "SELL")
        .sort((a: any, b: any) => a.priceBps - b.priceBps || a.createdAt - b.createdAt);
      return {
        bids,
        asks,
        bestBidBps: bids[0]?.priceBps ?? null,
        bestAskBps: asks[0]?.priceBps ?? null,
      };
    };

    const last = fills[0] || null;
    const reserveTotal = market.yesReserve + market.noReserve;
    const reserveYesBps =
      reserveTotal === 0n ? 5_000 : Number((market.noReserve * 10_000n) / reserveTotal);

    return res.status(200).json({
      market: {
        address,
        ...market,
        reserveYesBps,
        totalVolumeBaseUnits: market.volume.toString(),
      },
      book: {
        yes: sideBook("YES"),
        no: sideBook("NO"),
        lastMatchedYesBps: last?.yesPriceBps ?? null,
        lastMatchedAt: last?.blockTime ?? null,
        volume24hBaseUnits: volume24h.toString(),
        totalMatchedVolumeBaseUnits: market.volume.toString(),
        tradeCount: fills.length,
        traderCount: traders.size,
        activeOrderCount: activeOrders.length,
      },
      recentTrades: fills.slice(0, 30),
      updatedAt: Date.now(),
    });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || "Unable to read market state" });
  }
}
