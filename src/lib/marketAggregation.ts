import type { IndexedEvent, IndexedMarket } from "./marketIndexer";

export type DiscoverySource = "maryjane" | "polymarket" | "manifold";
export type DiscoveryCategory = "Crypto" | "Sports" | "Tech" | "World" | "Other";

export type DiscoveryMarket = {
  id: string;
  source: DiscoverySource;
  sourceMarketId: string;
  title: string;
  description?: string;
  category: DiscoveryCategory;
  outcomes: Array<{ id: string; label: string; probability: number }>;
  volume24h?: number;
  volumeTotal?: number;
  traders?: number;
  tradeCount?: number;
  createdAt?: string;
  closesAt?: string;
  resolved: boolean;
  externalUrl?: string;
  nativeAddress?: string;
  nativeMarketSeed?: string;
  status?: string;
  probabilitySource: "last-match" | "external" | "pool-reference" | "unknown";
};

type Report = {
  input?: {
    question?: string;
    description?: string;
    category?: string;
    source?: string;
    deadline?: string;
  };
  hashes?: { marketSeed?: string };
  certifiedAt?: number;
};

export type BookOrder = {
  order: string;
  maker: string;
  side: "YES" | "NO";
  kind: "BUY" | "SELL";
  priceBps: number;
  originalShares: string;
  remainingShares: string;
  createdAt: number;
};

export type OrderBook = {
  yes: { bids: BookOrder[]; asks: BookOrder[]; bestBidBps: number | null; bestAskBps: number | null };
  no: { bids: BookOrder[]; asks: BookOrder[]; bestBidBps: number | null; bestAskBps: number | null };
  lastMatchedYesBps: number | null;
  lastMatchedAt: number | null;
  volume24hBaseUnits: string;
  totalMatchedVolumeBaseUnits: string;
  tradeCount: number;
  traderCount: number;
};

function categoryFromText(value: unknown): DiscoveryCategory {
  const text = String(value || "").toLowerCase();
  if (/crypto|bitcoin|btc|ethereum|eth|solana|sol\b|token|defi|blockchain/.test(text)) return "Crypto";
  if (/sport|football|soccer|nba|nfl|mlb|nhl|tennis|f1|ufc|cricket/.test(text)) return "Sports";
  if (/tech|ai\b|artificial intelligence|apple|google|microsoft|openai|nvidia|software/.test(text)) return "Tech";
  if (/world|politic|election|government|war|country|president|minister|geopolit/.test(text)) return "World";
  return "Other";
}

function number(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function probability(value: unknown): number | undefined {
  const parsed = number(value);
  if (parsed === undefined) return undefined;
  if (parsed > 1) return Math.max(0, Math.min(1, parsed / 100));
  return Math.max(0, Math.min(1, parsed));
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "MaryJane-Market-Aggregator/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePolymarket(raw: any): DiscoveryMarket | null {
  const title = String(raw?.question || raw?.title || "").trim();
  if (!title) return null;
  const labels = parseJsonArray(raw?.outcomes).map(String);
  const prices = parseJsonArray(raw?.outcomePrices);
  const yesIndex = labels.findIndex((label) => label.toLowerCase() === "yes");
  const noIndex = labels.findIndex((label) => label.toLowerCase() === "no");
  const yes = probability(prices[yesIndex >= 0 ? yesIndex : 0]) ?? probability(raw?.probability);
  const no = probability(prices[noIndex >= 0 ? noIndex : 1]) ?? (yes === undefined ? undefined : 1 - yes);
  const id = String(raw?.id || raw?.conditionId || raw?.slug || title);
  return {
    id: `polymarket:${id}`,
    source: "polymarket",
    sourceMarketId: id,
    title,
    description: String(raw?.description || "") || undefined,
    category: categoryFromText(`${raw?.category || ""} ${raw?.tags || ""} ${title}`),
    outcomes: [
      { id: "yes", label: "YES", probability: yes ?? 0.5 },
      { id: "no", label: "NO", probability: no ?? 0.5 },
    ],
    volume24h: number(raw?.volume24hr ?? raw?.volume24h),
    volumeTotal: number(raw?.volume),
    createdAt: raw?.createdAt || raw?.created_at || undefined,
    closesAt: raw?.endDate || raw?.end_date_iso || undefined,
    resolved: Boolean(raw?.closed || raw?.resolved),
    externalUrl: raw?.slug ? `https://polymarket.com/event/${raw.slug}` : "https://polymarket.com",
    probabilitySource: "external",
  };
}

function normalizeManifold(raw: any): DiscoveryMarket | null {
  const title = String(raw?.question || "").trim();
  if (!title) return null;
  const p = probability(raw?.probability) ?? 0.5;
  const id = String(raw?.id || raw?.slug || title);
  return {
    id: `manifold:${id}`,
    source: "manifold",
    sourceMarketId: id,
    title,
    description: String(raw?.textDescription || raw?.description || "") || undefined,
    category: categoryFromText(`${raw?.groupSlugs || ""} ${raw?.tags || ""} ${title}`),
    outcomes: [
      { id: "yes", label: "YES", probability: p },
      { id: "no", label: "NO", probability: 1 - p },
    ],
    volume24h: number(raw?.volume24Hours),
    volumeTotal: number(raw?.volume),
    traders: number(raw?.uniqueBettorCount),
    createdAt: raw?.createdTime ? new Date(Number(raw.createdTime)).toISOString() : undefined,
    closesAt: raw?.closeTime ? new Date(Number(raw.closeTime)).toISOString() : undefined,
    resolved: Boolean(raw?.isResolved || raw?.resolution),
    externalUrl: raw?.url || (raw?.slug ? `https://manifold.markets/market/${raw.slug}` : "https://manifold.markets"),
    probabilitySource: "external",
  };
}

export async function fetchExternalMarkets(limit = 80): Promise<{ items: DiscoveryMarket[]; errors: string[] }> {
  const errors: string[] = [];
  const [poly, manifold] = await Promise.allSettled([
    getJson(`https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${Math.min(100, limit)}`),
    getJson(`https://api.manifold.markets/v0/markets?limit=${Math.min(100, limit)}`),
  ]);

  const items: DiscoveryMarket[] = [];
  if (poly.status === "fulfilled") {
    const rows = Array.isArray(poly.value) ? poly.value : poly.value?.data || [];
    for (const row of rows) {
      const item = normalizePolymarket(row);
      if (item) items.push(item);
    }
  } else {
    errors.push(`polymarket:${poly.reason?.message || "unavailable"}`);
  }

  if (manifold.status === "fulfilled") {
    const rows = Array.isArray(manifold.value) ? manifold.value : [];
    for (const row of rows) {
      const item = normalizeManifold(row);
      if (item) items.push(item);
    }
  } else {
    errors.push(`manifold:${manifold.reason?.message || "unavailable"}`);
  }

  return { items, errors };
}

export function buildOrderBook(events: IndexedEvent[]): OrderBook {
  const orders = new Map<string, BookOrder>();
  let total = 0n;
  let volume24h = 0n;
  let tradeCount = 0;
  let lastMatchedYesBps: number | null = null;
  let lastMatchedAt: number | null = null;
  const traders = new Set<string>();
  const cutoff = Math.floor(Date.now() / 1000) - 86_400;

  for (const event of [...events].sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot)) {
    if (event.type === "LimitOrderPlaced") {
      const order = String(event.data.order || "");
      if (!order) continue;
      orders.set(order, {
        order,
        maker: String(event.data.maker || event.actor || ""),
        side: String(event.data.side) === "NO" ? "NO" : "YES",
        kind: String(event.data.kind) === "SELL" ? "SELL" : "BUY",
        priceBps: Number(event.data.priceBps || 0),
        originalShares: String(event.data.shares || "0"),
        remainingShares: String(event.data.shares || "0"),
        createdAt: event.blockTime,
      });
    } else if (event.type === "LimitOrderFilled") {
      const order = String(event.data.order || "");
      const existing = orders.get(order);
      if (existing) existing.remainingShares = String(event.data.remainingShares || "0");
      const quote = BigInt(String(event.data.quoteAmount || "0"));
      total += quote;
      if (event.blockTime >= cutoff) volume24h += quote;
      tradeCount += 1;
      if (event.actor) traders.add(event.actor);
      if (event.data.maker) traders.add(String(event.data.maker));
      const px = Number(event.data.priceBps || 0);
      lastMatchedYesBps = String(event.data.side) === "NO" ? 10_000 - px : px;
      lastMatchedAt = event.blockTime;
    } else if (event.type === "LimitOrderCancelled") {
      const order = String(event.data.order || "");
      const existing = orders.get(order);
      if (existing) existing.remainingShares = "0";
    }
  }

  const active = [...orders.values()].filter((order) => BigInt(order.remainingShares) > 0n);
  const side = (outcome: "YES" | "NO") => {
    const bids = active.filter((o) => o.side === outcome && o.kind === "BUY").sort((a, b) => b.priceBps - a.priceBps || a.createdAt - b.createdAt);
    const asks = active.filter((o) => o.side === outcome && o.kind === "SELL").sort((a, b) => a.priceBps - b.priceBps || a.createdAt - b.createdAt);
    return {
      bids,
      asks,
      bestBidBps: bids[0]?.priceBps ?? null,
      bestAskBps: asks[0]?.priceBps ?? null,
    };
  };

  return {
    yes: side("YES"),
    no: side("NO"),
    lastMatchedYesBps,
    lastMatchedAt,
    volume24hBaseUnits: volume24h.toString(),
    totalMatchedVolumeBaseUnits: total.toString(),
    tradeCount,
    traderCount: traders.size,
  };
}

export function normalizeNativeMarkets(markets: IndexedMarket[], reports: Report[], eventsFor: (address: string) => IndexedEvent[]): DiscoveryMarket[] {
  const reportsBySeed = new Map(reports.map((report) => [report.hashes?.marketSeed, report]));
  return markets.map((market) => {
    const report = reportsBySeed.get(market.marketSeed);
    const book = buildOrderBook(eventsFor(market.address));
    const yesBps = book.lastMatchedYesBps ?? market.yesProbabilityBps;
    const hasMatchedPrice = book.lastMatchedYesBps !== null;
    return {
      id: `maryjane:${market.address}`,
      source: "maryjane",
      sourceMarketId: market.address,
      title: report?.input?.question || `Market ${market.address.slice(0, 8)}…`,
      description: report?.input?.description,
      category: categoryFromText(report?.input?.category || report?.input?.question),
      outcomes: [
        { id: "yes", label: "YES", probability: yesBps / 10_000 },
        { id: "no", label: "NO", probability: 1 - yesBps / 10_000 },
      ],
      volume24h: Number(book.volume24hBaseUnits) / 1_000_000,
      volumeTotal: Number(market.volume) / 1_000_000,
      traders: book.traderCount,
      tradeCount: book.tradeCount,
      createdAt: report?.certifiedAt ? new Date(report.certifiedAt).toISOString() : undefined,
      closesAt: new Date(market.closeTs * 1000).toISOString(),
      resolved: market.status.startsWith("RESOLVED") || market.status === "CANCELLED",
      nativeAddress: market.address,
      nativeMarketSeed: market.marketSeed,
      status: market.status,
      probabilitySource: hasMatchedPrice ? "last-match" : "pool-reference",
    };
  });
}
