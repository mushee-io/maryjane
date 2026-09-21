import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AccountInfo,
  Connection,
  PublicKey,
  VersionedTransactionResponse,
} from "@solana/web3.js";

export type MarketStatus =
  | "OPEN"
  | "CLOSED"
  | "RESOLUTION_PENDING"
  | "DISPUTED"
  | "RESOLVED_YES"
  | "RESOLVED_NO"
  | "CANCELLED";

export type BetaStatus = "OPEN" | "LOCKED" | "SETTLED";
export type BetaOutcome = "UNRESOLVED" | "UP" | "DOWN" | "PUSH";

export type IndexedMarket = {
  address: string;
  authority: string;
  config: string;
  collateralMint: string;
  marketSeed: string;
  questionHash: string;
  metadataHash: string;
  closeTs: number;
  resolutionTs: number;
  status: MarketStatus;
  feeBps: number;
  collateralVault: string;
  yesMint: string;
  noMint: string;
  yesReserveVault: string;
  noReserveVault: string;
  yesReserve: string;
  noReserve: string;
  lpSupply: string;
  volume: string;
  protocolFees: string;
  collateralVaultBalance: string;
  yesProbabilityBps: number;
  noProbabilityBps: number;
  slot: number;
  updatedAt: number;
};

export type IndexedBetaRound = {
  address: string;
  assetHash: string;
  roundId: string;
  collateralMint: string;
  vault: string;
  startPrice: string;
  endPrice: string;
  priceExponent: number;
  startObservedTs: number;
  endObservedTs: number;
  openTs: number;
  lockTs: number;
  closeTs: number;
  upPool: string;
  downPool: string;
  protocolFees: string;
  outcome: BetaOutcome;
  status: BetaStatus;
  vaultBalance: string;
  upProbabilityBps: number;
  downProbabilityBps: number;
  slot: number;
  updatedAt: number;
};

export type IndexedEvent = {
  id: string;
  signature: string;
  slot: number;
  blockTime: number;
  type: string;
  market?: string;
  round?: string;
  actor?: string;
  data: Record<string, string | number | boolean>;
};

export type MarketSnapshot = {
  timestamp: number;
  slot: number;
  yesProbabilityBps: number;
  yesReserve: string;
  noReserve: string;
  volume: string;
  collateralVaultBalance: string;
};

export type BetaSnapshot = {
  timestamp: number;
  slot: number;
  upProbabilityBps: number;
  upPool: string;
  downPool: string;
  status: BetaStatus;
  outcome: BetaOutcome;
  vaultBalance: string;
};

export type IndexerAnalytics = {
  updatedAt: number;
  totalMarkets: number;
  openMarkets: number;
  resolvedMarkets: number;
  disputedMarkets: number;
  cancelledMarkets: number;
  betaRounds: number;
  liveBetaRounds: number;
  totalVolumeBaseUnits: string;
  volume24hBaseUnits: string;
  totalCollateralLockedBaseUnits: string;
  totalProtocolFeesBaseUnits: string;
  outcomeLiquidityBaseUnits: string;
  activeTraders24h: number;
  events24h: number;
};

export type RealtimeUpdate =
  | { kind: "market"; market: IndexedMarket }
  | { kind: "beta"; round: IndexedBetaRound }
  | { kind: "event"; event: IndexedEvent }
  | { kind: "analytics"; analytics: IndexerAnalytics }
  | { kind: "sync"; at: number; slot: number; error?: string };

type IndexState = {
  version: 1;
  lastSignature?: string;
  lastSyncAt: number;
  lastSlot: number;
  markets: Record<string, IndexedMarket>;
  betaRounds: Record<string, IndexedBetaRound>;
  events: IndexedEvent[];
  marketSnapshots: Record<string, MarketSnapshot[]>;
  betaSnapshots: Record<string, BetaSnapshot[]>;
};

type MarketQuery = {
  q?: string;
  status?: MarketStatus;
  sort?: "volume" | "liquidity" | "newest" | "ending";
  limit?: number;
  offset?: number;
};

type EventQuery = {
  market?: string;
  round?: string;
  type?: string;
  limit?: number;
};

const MARKET_STATUS: MarketStatus[] = [
  "OPEN",
  "CLOSED",
  "RESOLUTION_PENDING",
  "DISPUTED",
  "RESOLVED_YES",
  "RESOLVED_NO",
  "CANCELLED",
];

const BETA_OUTCOME: BetaOutcome[] = ["UNRESOLVED", "UP", "DOWN", "PUSH"];
const BETA_STATUS: BetaStatus[] = ["OPEN", "LOCKED", "SETTLED"];

export const MARKET_ACCOUNT_DISCRIMINATOR = anchorDiscriminator("account", "Market");
export const BETA_ROUND_ACCOUNT_DISCRIMINATOR = anchorDiscriminator("account", "BetaRound");

function anchorDiscriminator(namespace: "account" | "event", name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`${namespace}:${name}`)
    .digest()
    .subarray(0, 8);
}

function eventDiscriminator(name: string): Buffer {
  return anchorDiscriminator("event", name);
}

function readPubkey(buffer: Buffer, offset: number): [string, number] {
  return [new PublicKey(buffer.subarray(offset, offset + 32)).toBase58(), offset + 32];
}

function readU64(buffer: Buffer, offset: number): [bigint, number] {
  return [buffer.readBigUInt64LE(offset), offset + 8];
}

function readI64(buffer: Buffer, offset: number): [bigint, number] {
  return [buffer.readBigInt64LE(offset), offset + 8];
}

function parseTokenAmount(account: AccountInfo<Buffer> | null): bigint {
  if (!account || account.data.length < 72) return 0n;
  return account.data.readBigUInt64LE(64);
}

function probabilityBps(numerator: bigint, denominatorOther: bigint): number {
  const total = numerator + denominatorOther;
  if (total === 0n) return 5_000;
  return Number((numerator * 10_000n) / total);
}

export function decodeMarketAccount(
  address: PublicKey,
  account: AccountInfo<Buffer>,
  slot: number,
  now = Date.now(),
): IndexedMarket | null {
  const raw = Buffer.from(account.data);
  if (raw.length < 420 || !raw.subarray(0, 8).equals(MARKET_ACCOUNT_DISCRIMINATOR)) {
    return null;
  }

  let o = 8;
  let authority: string; [authority, o] = readPubkey(raw, o);
  let config: string; [config, o] = readPubkey(raw, o);
  let collateralMint: string; [collateralMint, o] = readPubkey(raw, o);
  const marketSeed = raw.subarray(o, o + 32).toString("hex"); o += 32;
  const questionHash = raw.subarray(o, o + 32).toString("hex"); o += 32;
  const metadataHash = raw.subarray(o, o + 32).toString("hex"); o += 32;
  let closeTsRaw: bigint; [closeTsRaw, o] = readI64(raw, o);
  let resolutionTsRaw: bigint; [resolutionTsRaw, o] = readI64(raw, o);
  const status = MARKET_STATUS[raw.readUInt8(o++)] ?? "OPEN";
  const feeBps = raw.readUInt16LE(o); o += 2;
  let collateralVault: string; [collateralVault, o] = readPubkey(raw, o);
  let yesMint: string; [yesMint, o] = readPubkey(raw, o);
  let noMint: string; [noMint, o] = readPubkey(raw, o);
  let yesReserveVault: string; [yesReserveVault, o] = readPubkey(raw, o);
  let noReserveVault: string; [noReserveVault, o] = readPubkey(raw, o);
  let yesReserveRaw: bigint; [yesReserveRaw, o] = readU64(raw, o);
  let noReserveRaw: bigint; [noReserveRaw, o] = readU64(raw, o);
  let lpSupplyRaw: bigint; [lpSupplyRaw, o] = readU64(raw, o);
  let volumeRaw: bigint; [volumeRaw, o] = readU64(raw, o);
  let protocolFeesRaw: bigint; [protocolFeesRaw, o] = readU64(raw, o);

  const yesProbabilityBps = probabilityBps(noReserveRaw, yesReserveRaw);

  return {
    address: address.toBase58(),
    authority,
    config,
    collateralMint,
    marketSeed,
    questionHash,
    metadataHash,
    closeTs: Number(closeTsRaw),
    resolutionTs: Number(resolutionTsRaw),
    status,
    feeBps,
    collateralVault,
    yesMint,
    noMint,
    yesReserveVault,
    noReserveVault,
    yesReserve: yesReserveRaw.toString(),
    noReserve: noReserveRaw.toString(),
    lpSupply: lpSupplyRaw.toString(),
    volume: volumeRaw.toString(),
    protocolFees: protocolFeesRaw.toString(),
    collateralVaultBalance: "0",
    yesProbabilityBps,
    noProbabilityBps: 10_000 - yesProbabilityBps,
    slot,
    updatedAt: now,
  };
}

export function decodeBetaRoundAccount(
  address: PublicKey,
  account: AccountInfo<Buffer>,
  slot: number,
  now = Date.now(),
): IndexedBetaRound | null {
  const raw = Buffer.from(account.data);
  if (raw.length < 263 || !raw.subarray(0, 8).equals(BETA_ROUND_ACCOUNT_DISCRIMINATOR)) {
    return null;
  }

  let o = 8;
  const assetHash = raw.subarray(o, o + 32).toString("hex"); o += 32;
  let roundIdRaw: bigint; [roundIdRaw, o] = readU64(raw, o);
  let collateralMint: string; [collateralMint, o] = readPubkey(raw, o);
  let vault: string; [vault, o] = readPubkey(raw, o);
  let startPriceRaw: bigint; [startPriceRaw, o] = readI64(raw, o);
  let endPriceRaw: bigint; [endPriceRaw, o] = readI64(raw, o);
  const priceExponent = raw.readInt32LE(o); o += 4;
  let startObservedRaw: bigint; [startObservedRaw, o] = readI64(raw, o);
  let endObservedRaw: bigint; [endObservedRaw, o] = readI64(raw, o);
  o += 32;
  o += 32;
  let openTsRaw: bigint; [openTsRaw, o] = readI64(raw, o);
  let lockTsRaw: bigint; [lockTsRaw, o] = readI64(raw, o);
  let closeTsRaw: bigint; [closeTsRaw, o] = readI64(raw, o);
  let upPoolRaw: bigint; [upPoolRaw, o] = readU64(raw, o);
  let downPoolRaw: bigint; [downPoolRaw, o] = readU64(raw, o);
  let protocolFeesRaw: bigint; [protocolFeesRaw, o] = readU64(raw, o);
  const outcome = BETA_OUTCOME[raw.readUInt8(o++)] ?? "UNRESOLVED";
  const status = BETA_STATUS[raw.readUInt8(o++)] ?? "OPEN";

  const upProbabilityBps = probabilityBps(upPoolRaw, downPoolRaw);

  return {
    address: address.toBase58(),
    assetHash,
    roundId: roundIdRaw.toString(),
    collateralMint,
    vault,
    startPrice: startPriceRaw.toString(),
    endPrice: endPriceRaw.toString(),
    priceExponent,
    startObservedTs: Number(startObservedRaw),
    endObservedTs: Number(endObservedRaw),
    openTs: Number(openTsRaw),
    lockTs: Number(lockTsRaw),
    closeTs: Number(closeTsRaw),
    upPool: upPoolRaw.toString(),
    downPool: downPoolRaw.toString(),
    protocolFees: protocolFeesRaw.toString(),
    outcome,
    status,
    vaultBalance: "0",
    upProbabilityBps,
    downProbabilityBps: 10_000 - upProbabilityBps,
    slot,
    updatedAt: now,
  };
}

function eventReader(data: Buffer) {
  let o = 8;
  return {
    pubkey() {
      const value = new PublicKey(data.subarray(o, o + 32)).toBase58();
      o += 32;
      return value;
    },
    u8() {
      return data.readUInt8(o++);
    },
    bool() {
      return data.readUInt8(o++) !== 0;
    },
    u16() {
      const value = data.readUInt16LE(o);
      o += 2;
      return value;
    },
    u64() {
      const value = data.readBigUInt64LE(o).toString();
      o += 8;
      return value;
    },
    i64() {
      const value = Number(data.readBigInt64LE(o));
      o += 8;
      return value;
    },
    i32() {
      const value = data.readInt32LE(o);
      o += 4;
      return value;
    },
    bytes32() {
      const value = data.subarray(o, o + 32).toString("hex");
      o += 32;
      return value;
    },
  };
}

type EventDecoder = (data: Buffer) => Omit<IndexedEvent, "id" | "signature" | "slot" | "blockTime">;

const EVENT_DECODERS = new Map<string, EventDecoder>();

function registerEvent(name: string, decoder: EventDecoder) {
  EVENT_DECODERS.set(eventDiscriminator(name).toString("hex"), decoder);
}

registerEvent("MarketLintCertificationIssued", (data) => {
  const r = eventReader(data);
  const certification = r.pubkey();
  const creator = r.pubkey();
  const attestor = r.pubkey();
  const marketSeed = r.bytes32();
  const reportHash = r.bytes32();
  const specHash = r.bytes32();
  const sourceHash = r.bytes32();
  const closeTs = r.i64();
  const resolutionTs = r.i64();
  const overallScore = r.u8();
  const verdictIndex = r.u8();
  const duplicateProbability = r.u8();
  const resolutionClarityScore = r.u8();
  const expiresAt = r.i64();

  return {
    type: "MarketLintCertificationIssued",
    actor: creator,
    data: {
      certification,
      attestor,
      marketSeed,
      reportHash,
      specHash,
      sourceHash,
      closeTs,
      resolutionTs,
      overallScore,
      verdict: ["GREEN", "YELLOW", "RED"][verdictIndex] ?? "RED",
      duplicateProbability,
      resolutionClarityScore,
      expiresAt,
    },
  };
});

registerEvent("MarketLintCertificationConsumed", (data) => {
  const r = eventReader(data);
  const certification = r.pubkey();
  const market = r.pubkey();
  const reportHash = r.bytes32();
  const specHash = r.bytes32();
  const overallScore = r.u8();
  const verdictIndex = r.u8();

  return {
    type: "MarketLintCertificationConsumed",
    market,
    data: {
      certification,
      reportHash,
      specHash,
      overallScore,
      verdict: ["GREEN", "YELLOW", "RED"][verdictIndex] ?? "RED",
    },
  };
});

registerEvent("MarketCreated", (data) => {
  const r = eventReader(data);
  const market = r.pubkey();
  const authority = r.pubkey();
  const collateralMint = r.pubkey();
  const yesMint = r.pubkey();
  const noMint = r.pubkey();
  const closeTs = r.i64();
  return {
    type: "MarketCreated",
    market,
    actor: authority,
    data: { collateralMint, yesMint, noMint, closeTs },
  };
});

registerEvent("TradeExecuted", (data) => {
  const r = eventReader(data);
  const market = r.pubkey();
  const trader = r.pubkey();
  const side = r.u8() === 0 ? "YES" : "NO";
  const isBuy = r.bool();
  const amountIn = r.u64();
  const amountOut = r.u64();
  const fee = r.u64();
  const yesReserve = r.u64();
  const noReserve = r.u64();
  return {
    type: "TradeExecuted",
    market,
    actor: trader,
    data: { side, isBuy, amountIn, amountOut, fee, yesReserve, noReserve },
  };
});

registerEvent("LiquidityAdded", (data) => {
  const r = eventReader(data);
  const market = r.pubkey();
  const provider = r.pubkey();
  return {
    type: "LiquidityAdded",
    market,
    actor: provider,
    data: {
      collateralIn: r.u64(),
      lpShares: r.u64(),
      yesReserve: r.u64(),
      noReserve: r.u64(),
    },
  };
});

registerEvent("LiquidityRemoved", (data) => {
  const r = eventReader(data);
  const market = r.pubkey();
  const provider = r.pubkey();
  return {
    type: "LiquidityRemoved",
    market,
    actor: provider,
    data: {
      lpShares: r.u64(),
      collateralOut: r.u64(),
      yesOut: r.u64(),
      noOut: r.u64(),
    },
  };
});


registerEvent("LimitOrderPlaced", (data) => {
  const r = eventReader(data);
  const order = r.pubkey();
  const market = r.pubkey();
  const maker = r.pubkey();
  const side = r.u8() === 0 ? "YES" : "NO";
  const kind = r.u8() === 0 ? "BUY" : "SELL";
  return {
    type: "LimitOrderPlaced",
    market,
    actor: maker,
    data: {
      order,
      maker,
      side,
      kind,
      priceBps: r.u16(),
      shares: r.u64(),
      escrowAmount: r.u64(),
    },
  };
});

registerEvent("LimitOrderFilled", (data) => {
  const r = eventReader(data);
  const order = r.pubkey();
  const market = r.pubkey();
  const maker = r.pubkey();
  const taker = r.pubkey();
  const side = r.u8() === 0 ? "YES" : "NO";
  const kind = r.u8() === 0 ? "BUY" : "SELL";
  return {
    type: "LimitOrderFilled",
    market,
    actor: taker,
    data: {
      order,
      maker,
      side,
      kind,
      priceBps: r.u16(),
      shares: r.u64(),
      quoteAmount: r.u64(),
      remainingShares: r.u64(),
    },
  };
});


registerEvent("LimitOrderCancelled", (data) => {
  const r = eventReader(data);
  const order = r.pubkey();
  const market = r.pubkey();
  const maker = r.pubkey();
  return {
    type: "LimitOrderCancelled",
    market,
    actor: maker,
    data: {
      order,
      maker,
      returnedAmount: r.u64(),
      unfilledShares: r.u64(),
    },
  };
});

registerEvent("ResolutionFinalized", (data) => {
  const r = eventReader(data);
  const market = r.pubkey();
  const outcomeIndex = r.u8();
  const winner = r.pubkey();
  return {
    type: "ResolutionFinalized",
    market,
    actor: winner,
    data: {
      outcome: ["UNRESOLVED", "YES", "NO", "INVALID"][outcomeIndex] ?? "UNRESOLVED",
      bondPayout: r.u64(),
      adjudicationHash: r.bytes32(),
    },
  };
});

registerEvent("WinningsRedeemed", (data) => {
  const r = eventReader(data);
  const market = r.pubkey();
  const owner = r.pubkey();
  return {
    type: "WinningsRedeemed",
    market,
    actor: owner,
    data: {
      winningMint: r.pubkey(),
      tokensBurned: r.u64(),
      collateralPaid: r.u64(),
    },
  };
});

registerEvent("InvalidMarketRefunded", (data) => {
  const r = eventReader(data);
  const market = r.pubkey();
  const owner = r.pubkey();
  return {
    type: "InvalidMarketRefunded",
    market,
    actor: owner,
    data: {
      yesBurned: r.u64(),
      noBurned: r.u64(),
      collateralPaid: r.u64(),
    },
  };
});

registerEvent("BetaRoundOpened", (data) => {
  const r = eventReader(data);
  const round = r.pubkey();
  return {
    type: "BetaRoundOpened",
    round,
    data: {
      assetHash: r.bytes32(),
      roundId: r.u64(),
      startPrice: r.i64(),
      priceExponent: r.i32(),
      openTs: r.i64(),
      lockTs: r.i64(),
      closeTs: r.i64(),
      observationHash: r.bytes32(),
    },
  };
});

registerEvent("BetaPositionEntered", (data) => {
  const r = eventReader(data);
  const round = r.pubkey();
  const owner = r.pubkey();
  const side = r.u8() === 0 ? "UP" : "DOWN";
  return {
    type: "BetaPositionEntered",
    round,
    actor: owner,
    data: {
      side,
      collateralIn: r.u64(),
      netStake: r.u64(),
      fee: r.u64(),
      upPool: r.u64(),
      downPool: r.u64(),
    },
  };
});

registerEvent("BetaRoundSettled", (data) => {
  const r = eventReader(data);
  const round = r.pubkey();
  const startPrice = r.i64();
  const endPrice = r.i64();
  const outcomeIndex = r.u8();
  return {
    type: "BetaRoundSettled",
    round,
    data: {
      startPrice,
      endPrice,
      outcome: BETA_OUTCOME[outcomeIndex] ?? "UNRESOLVED",
      observedTs: r.i64(),
      observationHash: r.bytes32(),
      upPool: r.u64(),
      downPool: r.u64(),
    },
  };
});

registerEvent("BetaRoundClaimed", (data) => {
  const r = eventReader(data);
  const round = r.pubkey();
  const owner = r.pubkey();
  const outcomeIndex = r.u8();
  return {
    type: "BetaRoundClaimed",
    round,
    actor: owner,
    data: {
      outcome: BETA_OUTCOME[outcomeIndex] ?? "UNRESOLVED",
      upStake: r.u64(),
      downStake: r.u64(),
      collateralPaid: r.u64(),
    },
  };
});

export function decodeProgramDataEvents(
  logs: string[],
  signature: string,
  slot: number,
  blockTime: number,
  programId?: PublicKey | string,
): IndexedEvent[] {
  const events: IndexedEvent[] = [];
  let ordinal = 0;
  const targetProgram = programId ? String(programId) : undefined;
  const invocationStack: string[] = [];

  for (const line of logs) {
    const invoke = line.match(/^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/);
    if (invoke) {
      invocationStack.push(invoke[1]);
      continue;
    }

    const exit = line.match(/^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (?:success|failed:.*)$/);
    if (exit) {
      if (invocationStack[invocationStack.length - 1] === exit[1]) {
        invocationStack.pop();
      } else {
        const index = invocationStack.lastIndexOf(exit[1]);
        if (index >= 0) invocationStack.splice(index, 1);
      }
      continue;
    }

    const marker = "Program data: ";
    const index = line.indexOf(marker);
    if (index < 0) continue;
    if (
      targetProgram &&
      invocationStack[invocationStack.length - 1] !== targetProgram
    ) {
      continue;
    }

    try {
      const payload = Buffer.from(line.slice(index + marker.length).trim(), "base64");
      if (payload.length < 8) continue;
      const decoder = EVENT_DECODERS.get(payload.subarray(0, 8).toString("hex"));
      if (!decoder) continue;
      const decoded = decoder(payload);
      events.push({
        ...decoded,
        id: `${signature}:${ordinal++}`,
        signature,
        slot,
        blockTime,
      });
    } catch {
      // Ignore malformed or unrelated program-data log lines.
    }
  }

  return events;
}

function defaultState(): IndexState {
  return {
    version: 1,
    lastSyncAt: 0,
    lastSlot: 0,
    markets: {},
    betaRounds: {},
    events: [],
    marketSnapshots: {},
    betaSnapshots: {},
  };
}

export class MarketIndexer {
  private state: IndexState = defaultState();
  private readonly subscribers = new Set<(update: RealtimeUpdate) => void>();
  private timer: NodeJS.Timeout | null = null;
  private accountSubscriptionId: number | null = null;
  private logSubscriptionId: number | null = null;
  private syncing = false;
  private stopped = false;
  private lastError = "";

  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
    private readonly storagePath = path.join(process.cwd(), "data", "market-index.json"),
    private readonly pollMs = Number(process.env.MARKET_INDEXER_POLL_MS || "5000"),
  ) {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, "utf8")) as Partial<IndexState>;
      if (parsed.version !== 1) return;
      this.state = {
        ...defaultState(),
        ...parsed,
        markets: parsed.markets ?? {},
        betaRounds: parsed.betaRounds ?? {},
        events: parsed.events ?? [],
        marketSnapshots: parsed.marketSnapshots ?? {},
        betaSnapshots: parsed.betaSnapshots ?? {},
      };
    } catch (error) {
      console.warn("[MarketIndexer] Failed to load persisted index", error);
    }
  }

  private persist() {
    const directory = path.dirname(this.storagePath);
    fs.mkdirSync(directory, { recursive: true });
    const tmp = `${this.storagePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state), "utf8");
    fs.renameSync(tmp, this.storagePath);
  }

  subscribe(callback: (update: RealtimeUpdate) => void) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private emit(update: RealtimeUpdate) {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(update);
      } catch {
        // One client must not break the indexer.
      }
    }
  }

  async start() {
    this.stopped = false;
    await this.syncNow();

    try {
      this.accountSubscriptionId = this.connection.onProgramAccountChange(
        this.programId,
        async ({ accountId, accountInfo }, context) => {
          this.ingestProgramAccount(
            accountId,
            {
              ...accountInfo,
              data: Buffer.from(accountInfo.data),
            } as AccountInfo<Buffer>,
            context.slot,
          );
        },
        "confirmed",
      );
    } catch (error) {
      console.warn("[MarketIndexer] account subscription unavailable", error);
    }

    try {
      this.logSubscriptionId = this.connection.onLogs(
        this.programId,
        (logInfo, context) => {
          if (logInfo.err) return;
          const events = decodeProgramDataEvents(
            logInfo.logs,
            logInfo.signature,
            context.slot,
            Math.floor(Date.now() / 1000),
            this.programId,
          );
          this.addEvents(events);
        },
        "confirmed",
      );
    } catch (error) {
      console.warn("[MarketIndexer] log subscription unavailable", error);
    }

    this.timer = setInterval(() => {
      void this.syncNow();
    }, Math.max(2_000, this.pollMs));
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.accountSubscriptionId !== null) {
      await this.connection.removeProgramAccountChangeListener(this.accountSubscriptionId).catch(() => undefined);
    }
    if (this.logSubscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.logSubscriptionId).catch(() => undefined);
    }
  }

  async syncNow() {
    if (this.syncing || this.stopped) return;
    this.syncing = true;

    try {
      const slot = await this.connection.getSlot("confirmed");
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        commitment: "confirmed",
      });

      for (const { pubkey, account } of accounts) {
        this.ingestProgramAccount(
          pubkey,
          { ...account, data: Buffer.from(account.data) } as AccountInfo<Buffer>,
          slot,
          false,
        );
      }

      await this.refreshVaultBalances();
      await this.syncTransactions();

      this.state.lastSlot = slot;
      this.state.lastSyncAt = Date.now();
      this.lastError = "";
      this.persist();
      this.emit({ kind: "analytics", analytics: this.analytics() });
      this.emit({ kind: "sync", at: this.state.lastSyncAt, slot });
    } catch (error: any) {
      this.lastError = error?.message || String(error);
      this.emit({
        kind: "sync",
        at: Date.now(),
        slot: this.state.lastSlot,
        error: this.lastError,
      });
    } finally {
      this.syncing = false;
    }
  }

  private ingestProgramAccount(
    pubkey: PublicKey,
    account: AccountInfo<Buffer>,
    slot: number,
    persist = true,
  ) {
    const now = Date.now();
    const market = decodeMarketAccount(pubkey, account, slot, now);
    if (market) {
      const previous = this.state.markets[market.address];
      market.collateralVaultBalance = previous?.collateralVaultBalance ?? "0";
      this.state.markets[market.address] = market;
      this.captureMarketSnapshot(market);
      this.emit({ kind: "market", market });
      if (persist) this.persist();
      return;
    }

    const round = decodeBetaRoundAccount(pubkey, account, slot, now);
    if (round) {
      const previous = this.state.betaRounds[round.address];
      round.vaultBalance = previous?.vaultBalance ?? "0";
      this.state.betaRounds[round.address] = round;
      this.captureBetaSnapshot(round);
      this.emit({ kind: "beta", round });
      if (persist) this.persist();
    }
  }

  private async refreshVaultBalances() {
    const targets = [
      ...Object.values(this.state.markets).map((market) => ({
        kind: "market" as const,
        address: market.address,
        vault: market.collateralVault,
      })),
      ...Object.values(this.state.betaRounds).map((round) => ({
        kind: "beta" as const,
        address: round.address,
        vault: round.vault,
      })),
    ];

    const chunkSize = 100;
    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      const infos = await this.connection.getMultipleAccountsInfo(
        chunk.map((item) => new PublicKey(item.vault)),
        "confirmed",
      );

      infos.forEach((info, index) => {
        const item = chunk[index];
        const amount = parseTokenAmount(
          info ? ({ ...info, data: Buffer.from(info.data) } as AccountInfo<Buffer>) : null,
        ).toString();

        if (item.kind === "market" && this.state.markets[item.address]) {
          this.state.markets[item.address].collateralVaultBalance = amount;
          this.captureMarketSnapshot(this.state.markets[item.address]);
        }
        if (item.kind === "beta" && this.state.betaRounds[item.address]) {
          this.state.betaRounds[item.address].vaultBalance = amount;
          this.captureBetaSnapshot(this.state.betaRounds[item.address]);
        }
      });
    }
  }

  private async syncTransactions() {
    const max = Math.max(
      25,
      Number(process.env.MARKET_INDEXER_SIGNATURES_PER_SYNC || "200"),
    );
    const signatures: Awaited<ReturnType<Connection["getSignaturesForAddress"]>> = [];
    let before: string | undefined;

    while (signatures.length < max) {
      const limit = Math.min(100, max - signatures.length);
      const page = await this.connection.getSignaturesForAddress(
        this.programId,
        {
          limit,
          before,
          until: this.state.lastSignature,
        },
        "confirmed",
      );

      if (page.length === 0) break;
      signatures.push(...page);
      before = page[page.length - 1]?.signature;
      if (page.length < limit) break;
    }

    if (signatures.length === 0) return;

    const newestSignature = signatures[0].signature;
    const chronological = [...signatures].reverse();

    for (const signature of chronological) {
      if (signature.err) continue;
      const tx = await this.connection.getTransaction(signature.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta?.logMessages) continue;
      const events = decodeProgramDataEvents(
        tx.meta.logMessages,
        signature.signature,
        signature.slot,
        tx.blockTime ?? signature.blockTime ?? Math.floor(Date.now() / 1000),
        this.programId,
      );
      this.addEvents(events);
    }

    this.state.lastSignature = newestSignature;
  }

  private addEvents(events: IndexedEvent[]) {
    if (events.length === 0) return;
    const existing = new Set(this.state.events.map((event) => event.id));

    for (const event of events) {
      if (existing.has(event.id)) continue;
      this.state.events.push(event);
      existing.add(event.id);
      this.captureSnapshotFromEvent(event);
      this.emit({ kind: "event", event });
    }

    const maxEvents = Math.max(
      1_000,
      Number(process.env.MARKET_INDEXER_MAX_EVENTS || "10000"),
    );
    if (this.state.events.length > maxEvents) {
      this.state.events = this.state.events.slice(-maxEvents);
    }

    this.persist();
  }

  private captureSnapshotFromEvent(event: IndexedEvent) {
    if (event.type === "TradeExecuted" && event.market) {
      const market = this.state.markets[event.market];
      if (!market) return;
      const yesReserve = BigInt(String(event.data.yesReserve ?? market.yesReserve));
      const noReserve = BigInt(String(event.data.noReserve ?? market.noReserve));
      const yesProbabilityBps = probabilityBps(noReserve, yesReserve);
      const snapshot: MarketSnapshot = {
        timestamp: event.blockTime * 1000,
        slot: event.slot,
        yesProbabilityBps,
        yesReserve: yesReserve.toString(),
        noReserve: noReserve.toString(),
        volume: market.volume,
        collateralVaultBalance: market.collateralVaultBalance,
      };
      this.pushSnapshot(this.state.marketSnapshots, event.market, snapshot);
    }

    if (event.type === "BetaPositionEntered" && event.round) {
      const round = this.state.betaRounds[event.round];
      if (!round) return;
      const upPool = BigInt(String(event.data.upPool ?? round.upPool));
      const downPool = BigInt(String(event.data.downPool ?? round.downPool));
      const snapshot: BetaSnapshot = {
        timestamp: event.blockTime * 1000,
        slot: event.slot,
        upProbabilityBps: probabilityBps(upPool, downPool),
        upPool: upPool.toString(),
        downPool: downPool.toString(),
        status: round.status,
        outcome: round.outcome,
        vaultBalance: round.vaultBalance,
      };
      this.pushSnapshot(this.state.betaSnapshots, event.round, snapshot);
    }
  }

  private captureMarketSnapshot(market: IndexedMarket) {
    const snapshot: MarketSnapshot = {
      timestamp: market.updatedAt,
      slot: market.slot,
      yesProbabilityBps: market.yesProbabilityBps,
      yesReserve: market.yesReserve,
      noReserve: market.noReserve,
      volume: market.volume,
      collateralVaultBalance: market.collateralVaultBalance,
    };
    this.pushSnapshot(this.state.marketSnapshots, market.address, snapshot);
  }

  private captureBetaSnapshot(round: IndexedBetaRound) {
    const snapshot: BetaSnapshot = {
      timestamp: round.updatedAt,
      slot: round.slot,
      upProbabilityBps: round.upProbabilityBps,
      upPool: round.upPool,
      downPool: round.downPool,
      status: round.status,
      outcome: round.outcome,
      vaultBalance: round.vaultBalance,
    };
    this.pushSnapshot(this.state.betaSnapshots, round.address, snapshot);
  }

  private pushSnapshot<T extends { timestamp: number; slot: number }>(
    target: Record<string, T[]>,
    key: string,
    snapshot: T,
  ) {
    const series = target[key] ?? [];
    const last = series[series.length - 1];

    if (last) {
      const sameSlot = last.slot === snapshot.slot;
      const samePayload =
        JSON.stringify({ ...last, timestamp: 0, slot: 0 }) ===
        JSON.stringify({ ...snapshot, timestamp: 0, slot: 0 });
      if (sameSlot && samePayload) return;
      if (samePayload && snapshot.timestamp - last.timestamp < 30_000) return;
    }

    series.push(snapshot);
    const maxSnapshots = Math.max(
      500,
      Number(process.env.MARKET_INDEXER_MAX_SNAPSHOTS || "5000"),
    );
    target[key] = series.length > maxSnapshots ? series.slice(-maxSnapshots) : series;
  }

  status() {
    return {
      running: !this.stopped,
      syncing: this.syncing,
      lastSyncAt: this.state.lastSyncAt,
      lastSlot: this.state.lastSlot,
      lastSignature: this.state.lastSignature ?? null,
      markets: Object.keys(this.state.markets).length,
      betaRounds: Object.keys(this.state.betaRounds).length,
      events: this.state.events.length,
      error: this.lastError || null,
    };
  }

  listMarkets(query: MarketQuery = {}) {
    const q = query.q?.trim().toLowerCase();
    let items = Object.values(this.state.markets);

    if (query.status) {
      items = items.filter((market) => market.status === query.status);
    }

    if (q) {
      items = items.filter((market) =>
        [
          market.address,
          market.authority,
          market.questionHash,
          market.metadataHash,
          market.collateralMint,
        ].some((value) => value.toLowerCase().includes(q)),
      );
    }

    const sort = query.sort ?? "volume";
    items.sort((a, b) => {
      if (sort === "volume") return compareBigIntDesc(a.volume, b.volume);
      if (sort === "liquidity") {
        return compareBigIntDesc(
          (BigInt(a.yesReserve) + BigInt(a.noReserve)).toString(),
          (BigInt(b.yesReserve) + BigInt(b.noReserve)).toString(),
        );
      }
      if (sort === "ending") return a.closeTs - b.closeTs;
      return b.updatedAt - a.updatedAt;
    });

    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    return {
      total: items.length,
      offset,
      limit,
      items: items.slice(offset, offset + limit),
    };
  }

  getMarket(address: string) {
    return this.state.markets[address] ?? null;
  }

  marketFingerprints() {
    return Object.values(this.state.markets).map((market) => ({
      questionHash: market.questionHash,
      address: market.address,
      category: "onchain",
    }));
  }

  listBetaRounds(limit = 100) {
    return Object.values(this.state.betaRounds)
      .sort((a, b) => b.openTs - a.openTs)
      .slice(0, Math.min(250, Math.max(1, limit)));
  }

  getBetaRound(address: string) {
    return this.state.betaRounds[address] ?? null;
  }

  events(query: EventQuery = {}) {
    let items = [...this.state.events].reverse();
    if (query.market) items = items.filter((event) => event.market === query.market);
    if (query.round) items = items.filter((event) => event.round === query.round);
    if (query.type) items = items.filter((event) => event.type === query.type);
    return items.slice(0, Math.min(500, Math.max(1, query.limit ?? 100)));
  }

  marketChart(address: string, rangeMs?: number) {
    const points = this.state.marketSnapshots[address] ?? [];
    if (!rangeMs) return points;
    const cutoff = Date.now() - rangeMs;
    return points.filter((point) => point.timestamp >= cutoff);
  }

  betaChart(address: string, rangeMs?: number) {
    const points = this.state.betaSnapshots[address] ?? [];
    if (!rangeMs) return points;
    const cutoff = Date.now() - rangeMs;
    return points.filter((point) => point.timestamp >= cutoff);
  }

  analytics(): IndexerAnalytics {
    const markets = Object.values(this.state.markets);
    const betaRounds = Object.values(this.state.betaRounds);
    const cutoff = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const events24h = this.state.events.filter((event) => event.blockTime >= cutoff);
    const actors = new Set(
      events24h
        .map((event) => event.actor)
        .filter((actor): actor is string => Boolean(actor)),
    );

    let volume24h = 0n;
    for (const event of events24h) {
      if (event.type === "TradeExecuted") {
        volume24h += BigInt(String(event.data.isBuy ? event.data.amountIn : event.data.amountOut));
      } else if (event.type === "LimitOrderFilled") {
        volume24h += BigInt(String(event.data.quoteAmount ?? "0"));
      } else if (event.type === "BetaPositionEntered") {
        volume24h += BigInt(String(event.data.collateralIn ?? "0"));
      }
    }

    const totalMarketVolume = markets.reduce(
      (sum, market) => sum + BigInt(market.volume),
      0n,
    );
    const totalBetaVolume = betaRounds.reduce(
      (sum, round) => sum + BigInt(round.upPool) + BigInt(round.downPool) + BigInt(round.protocolFees),
      0n,
    );

    const totalCollateralLocked = markets.reduce(
      (sum, market) => sum + BigInt(market.collateralVaultBalance),
      0n,
    ) + betaRounds.reduce(
      (sum, round) => sum + BigInt(round.vaultBalance),
      0n,
    );

    const totalFees = markets.reduce(
      (sum, market) => sum + BigInt(market.protocolFees),
      0n,
    ) + betaRounds.reduce(
      (sum, round) => sum + BigInt(round.protocolFees),
      0n,
    );

    const outcomeLiquidity = markets.reduce(
      (sum, market) => sum + BigInt(market.yesReserve) + BigInt(market.noReserve),
      0n,
    );

    return {
      updatedAt: this.state.lastSyncAt || Date.now(),
      totalMarkets: markets.length,
      openMarkets: markets.filter((market) => market.status === "OPEN").length,
      resolvedMarkets: markets.filter((market) =>
        market.status === "RESOLVED_YES" || market.status === "RESOLVED_NO",
      ).length,
      disputedMarkets: markets.filter((market) => market.status === "DISPUTED").length,
      cancelledMarkets: markets.filter((market) => market.status === "CANCELLED").length,
      betaRounds: betaRounds.length,
      liveBetaRounds: betaRounds.filter((round) => round.status !== "SETTLED").length,
      totalVolumeBaseUnits: (totalMarketVolume + totalBetaVolume).toString(),
      volume24hBaseUnits: volume24h.toString(),
      totalCollateralLockedBaseUnits: totalCollateralLocked.toString(),
      totalProtocolFeesBaseUnits: totalFees.toString(),
      outcomeLiquidityBaseUnits: outcomeLiquidity.toString(),
      activeTraders24h: actors.size,
      events24h: events24h.length,
    };
  }
}

function compareBigIntDesc(a: string, b: string) {
  const left = BigInt(a);
  const right = BigInt(b);
  return left === right ? 0 : left > right ? -1 : 1;
}

export function rangeToMs(range: string | undefined): number | undefined {
  if (!range || range === "all") return undefined;
  if (range === "1h") return 60 * 60 * 1000;
  if (range === "24h") return 24 * 60 * 60 * 1000;
  if (range === "7d") return 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return 30 * 24 * 60 * 60 * 1000;
  return undefined;
}

export type { MarketQuery, EventQuery };
