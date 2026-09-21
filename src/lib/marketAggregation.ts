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
  address?: string;
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

const LEGACY_NATIVE_METADATA: Record<string, {
  question: string;
  description?: string;
  category?: string;
  source?: string;
  deadline?: string;
}> = {
  "B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF": {
    question: "Will SOL/USD be above $250 at 12:00 UTC on 30 September 2026?",
    description: "YES if the Pyth SOL/USD price is at or above $250.00 at the stated resolution time. NO if it is below $250.00. Use the published Pyth price observation closest to the resolution time.",
    category: "Crypto",
    source: "Pyth Oracle · SOL/USD · target 250",
    deadline: "30 September 2026, 12:00 UTC",
  },
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

async function getJson(url: string, timeoutMs = 9_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "MaryJane-Market-Aggregator/1.1",
      },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`upstream ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new Error(`unexpected content-type ${contentType || "unknown"}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function firstSuccessful(
  source: string,
  urls: string[],
): Promise<{ value: any; url: string; attempts: string[] }> {
  const attempts: string[] = [];
  for (const url of urls) {
    try {
      return { value: await getJson(url), url, attempts };
    } catch (error: any) {
      attempts.push(`${url} -> ${error?.name === "AbortError" ? "timeout" : error?.message || String(error)}`);
    }
  }
  throw new Error(`${source} failed: ${attempts.join(" | ")}`);
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
  const id = String(raw?.id || raw?.conditionId || raw?.conditionID || raw?.slug || title);
  const eventSlug = String(raw?.__eventSlug || raw?.eventSlug || "");
  const marketSlug = String(raw?.slug || "");
  const urlSlug = eventSlug || marketSlug;

  const tagText = Array.isArray(raw?.__eventTags)
    ? raw.__eventTags.map((tag: any) => tag?.label || tag?.slug || tag).join(" ")
    : "";

  return {
    id: `polymarket:${id}`,
    source: "polymarket",
    sourceMarketId: id,
    title,
    description: String(raw?.description || raw?.__eventDescription || "") || undefined,
    category: categoryFromText(
      `${raw?.category || ""} ${raw?.tags || ""} ${tagText} ${raw?.__eventTitle || ""} ${title}`,
    ),
    outcomes: [
      { id: "yes", label: "YES", probability: yes ?? 0.5 },
      { id: "no", label: "NO", probability: no ?? 0.5 },
    ],
    volume24h: number(raw?.volume24hr ?? raw?.volume24h ?? raw?.volume24Hr),
    volumeTotal: number(raw?.volumeNum ?? raw?.volume),
    createdAt: raw?.createdAt || raw?.created_at || raw?.startDate || undefined,
    closesAt: raw?.endDate || raw?.end_date_iso || undefined,
    resolved: Boolean(raw?.closed || raw?.resolved),
    externalUrl: urlSlug ? `https://polymarket.com/event/${urlSlug}` : "https://polymarket.com",
    probabilitySource: "external",
  };
}

function normalizeManifold(raw: any): DiscoveryMarket | null {
  const title = String(raw?.question || "").trim();
  if (!title) return null;
  if (raw?.outcomeType && raw.outcomeType !== "BINARY") return null;

  const p = probability(raw?.probability);
  if (p === undefined) return null;

  const id = String(raw?.id || raw?.slug || title);
  return {
    id: `manifold:${id}`,
    source: "manifold",
    sourceMarketId: id,
    title,
    description: String(raw?.textDescription || "") || undefined,
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
    resolved: Boolean(raw?.isResolved),
    externalUrl: raw?.url || "https://manifold.markets",
    probabilitySource: "external",
  };
}

async function fetchPolymarketRows(limit: number) {
  const count = Math.min(100, Math.max(20, limit));
  const primary =
    `https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=${count}`;
  const fallback =
    `https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volumeNum&ascending=false&limit=${count}`;

  const result = await firstSuccessful("polymarket", [primary, fallback]);
  if (result.url.includes("/events?")) {
    const events = Array.isArray(result.value) ? result.value : result.value?.data || [];
    return events.flatMap((event: any) => {
      const markets = Array.isArray(event?.markets) ? event.markets : [];
      return markets.map((market: any) => ({
        ...market,
        __eventSlug: event?.slug,
        __eventTitle: event?.title,
        __eventDescription: event?.description,
        __eventTags: event?.tags,
      }));
    });
  }
  return Array.isArray(result.value) ? result.value : result.value?.data || [];
}

async function fetchManifoldRows(limit: number) {
  const count = Math.min(100, Math.max(20, limit));
  const primary =
    `https://api.manifold.markets/v0/search-markets?term=&sort=24-hour-vol&filter=open&contractType=BINARY&limit=${count}`;
  const fallback =
    `https://api.manifold.markets/v0/markets?limit=${count}&sort=last-bet-time&order=desc`;

  const result = await firstSuccessful("manifold", [primary, fallback]);
  return Array.isArray(result.value) ? result.value : [];
}

export async function fetchExternalMarkets(
  limit = 80,
): Promise<{ items: DiscoveryMarket[]; errors: string[] }> {
  const errors: string[] = [];
  const [poly, manifold] = await Promise.allSettled([
    fetchPolymarketRows(limit),
    fetchManifoldRows(limit),
  ]);

  const items: DiscoveryMarket[] = [];
  if (poly.status === "fulfilled") {
    for (const row of poly.value) {
      const item = normalizePolymarket(row);
      if (item && !item.resolved) items.push(item);
    }
  } else {
    errors.push(`polymarket:${poly.reason?.message || "unavailable"}`);
  }

  if (manifold.status === "fulfilled") {
    for (const row of manifold.value) {
      const item = normalizeManifold(row);
      if (item && !item.resolved) items.push(item);
    }
  } else {
    errors.push(`manifold:${manifold.reason?.message || "unavailable"}`);
  }

  const deduped = new Map<string, DiscoveryMarket>();
  for (const item of items) {
    if (!deduped.has(item.id)) deduped.set(item.id, item);
  }

  return {
    items: [...deduped.values()]
      .sort(
        (a, b) =>
          (b.volume24h ?? b.volumeTotal ?? 0) -
          (a.volume24h ?? a.volumeTotal ?? 0),
      )
      .slice(0, Math.max(limit, 20)),
    errors,
  };
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

export function normalizeNativeMarkets(
  markets: IndexedMarket[],
  reports: Report[],
  eventsFor: (address: string) => IndexedEvent[],
): DiscoveryMarket[] {
  const reportsBySeed = new Map(reports.map((report) => [report.hashes?.marketSeed, report]));

  return markets.map((market) => {
    const events = eventsFor(market.address);
    const report = reportsBySeed.get(market.marketSeed);
    const metadataEvent = events.find((event) => event.type === "MarketMetadataPublished");
    const createdEvent = events.find((event) => event.type === "MarketCreated");
    const legacy = LEGACY_NATIVE_METADATA[market.address];

    const metadata = metadataEvent
      ? {
          question: String(metadataEvent.data.question || ""),
          description: undefined,
          category: String(metadataEvent.data.category || ""),
          source: String(metadataEvent.data.source || ""),
          deadline: String(metadataEvent.data.deadline || ""),
        }
      : legacy;

    const book = buildOrderBook(events);
    const yesBps = book.lastMatchedYesBps ?? market.yesProbabilityBps;
    const hasMatchedPrice = book.lastMatchedYesBps !== null;

    const question =
      metadata?.question ||
      report?.input?.question ||
      `Market ${market.address.slice(0, 8)}…`;
    const categoryText =
      metadata?.category ||
      report?.input?.category ||
      question;

    return {
      id: `maryjane:${market.address}`,
      source: "maryjane",
      sourceMarketId: market.address,
      title: question,
      description: metadata?.description || report?.input?.description,
      category: categoryFromText(categoryText),
      outcomes: [
        { id: "yes", label: "YES", probability: yesBps / 10_000 },
        { id: "no", label: "NO", probability: 1 - yesBps / 10_000 },
      ],
      volume24h: Number(book.volume24hBaseUnits) / 1_000_000,
      volumeTotal: Number(market.volume) / 1_000_000,
      traders: book.traderCount,
      tradeCount: book.tradeCount,
      createdAt: createdEvent?.blockTime
        ? new Date(createdEvent.blockTime * 1000).toISOString()
        : report?.certifiedAt
          ? new Date(report.certifiedAt).toISOString()
          : undefined,
      closesAt: new Date(market.closeTs * 1000).toISOString(),
      resolved: market.status.startsWith("RESOLVED") || market.status === "CANCELLED",
      nativeAddress: market.address,
      nativeMarketSeed: market.marketSeed,
      status: market.status,
      probabilitySource: hasMatchedPrice ? "last-match" : "pool-reference",
    };
  });
}
