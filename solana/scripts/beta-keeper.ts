import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HermesClient } from "@pythnetwork/hermes-client";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const USDG_DEVNET_MINT = new PublicKey("4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7");

const INIT_BETA_CONFIG_DISC = Buffer.from("f36eda7d3f0e0101", "hex");
const OPEN_BETA_ROUND_DISC = Buffer.from("46d74eca0ef3c785", "hex");
const LOCK_BETA_ROUND_DISC = Buffer.from("fe83abe6faa439cf", "hex");
const SETTLE_BETA_ROUND_DISC = Buffer.from("2e58235b305d9a3b", "hex");
const BETA_ROUND_DISC = Buffer.from("cde37f64f671e03d", "hex");

type FeedConfig = {
  symbol: string;
  priceId: string;
  durations?: number[];
};

type RoundState = {
  address: PublicKey;
  assetHash: Buffer;
  roundId: bigint;
  openTs: number;
  lockTs: number;
  closeTs: number;
  status: 0 | 1 | 2;
};

type PricePoint = {
  id: string;
  price: bigint;
  exponent: number;
  publishTime: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function expandHome(value: string): string {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function loadKeypair(): Keypair {
  const keypairPath = expandHome(
    process.env.BETA_ORACLE_KEYPAIR || "~/.config/solana/id.json",
  );
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadFeeds(): FeedConfig[] {
  const raw = requireEnv("BETA_FEEDS_JSON");
  const feeds = JSON.parse(raw) as FeedConfig[];
  if (!Array.isArray(feeds) || feeds.length === 0) {
    throw new Error("BETA_FEEDS_JSON must be a non-empty array");
  }

  for (const feed of feeds) {
    if (!feed.symbol || !feed.priceId) {
      throw new Error("Each beta feed needs symbol and priceId");
    }
    const durations = feed.durations ?? [300, 600, 900, 3600];
    for (const duration of durations) {
      if (![300, 600, 900, 3600].includes(duration)) {
        throw new Error(`Unsupported duration ${duration} for ${feed.symbol}`);
      }
    }
  }

  return feeds;
}

function normalizePriceId(id: string): string {
  return id.toLowerCase().replace(/^0x/, "");
}

function betaAssetHash(symbol: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`33milady:beta:asset:${symbol.trim().toUpperCase()}`)
    .digest();
}

function observationHash(point: PricePoint): Buffer {
  return crypto
    .createHash("sha256")
    .update(`${point.id}:${point.price}:${point.exponent}:${point.publishTime}`)
    .digest();
}

function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}

function i32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value);
  return b;
}

function u64(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

function i64(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(value);
  return b;
}

function deriveBetaConfig(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("beta-config")], PROGRAM_ID)[0];
}

function deriveProtocolConfig(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

function deriveRound(assetHash: Buffer, roundId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("beta-round"), assetHash, u64(roundId)],
    PROGRAM_ID,
  )[0];
}

function deriveRoundVault(round: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("beta-vault"), round.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function makeRoundId(duration: number, now: number): bigint {
  const bucket = BigInt(Math.floor(now / duration));
  return (BigInt(duration) << 48n) | bucket;
}

function decodeRound(address: PublicKey, data: Buffer): RoundState | null {
  if (data.length < 263 || !data.subarray(0, 8).equals(BETA_ROUND_DISC)) return null;

  let o = 8;
  const assetHash = Buffer.from(data.subarray(o, o + 32)); o += 32;
  const roundId = data.readBigUInt64LE(o); o += 8;
  o += 32; // collateral mint
  o += 32; // vault
  o += 8; // start price
  o += 8; // end price
  o += 4; // exponent
  o += 8; // start observed
  o += 8; // end observed
  o += 32; // open observation
  o += 32; // close observation
  const openTs = Number(data.readBigInt64LE(o)); o += 8;
  const lockTs = Number(data.readBigInt64LE(o)); o += 8;
  const closeTs = Number(data.readBigInt64LE(o)); o += 8;
  o += 8; // up pool
  o += 8; // down pool
  o += 8; // fees
  o += 1; // outcome
  const status = data.readUInt8(o) as 0 | 1 | 2;

  return { address, assetHash, roundId, openTs, lockTs, closeTs, status };
}

async function getRounds(connection: Connection): Promise<RoundState[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID);
  return accounts
    .map(({ pubkey, account }) => decodeRound(pubkey, Buffer.from(account.data)))
    .filter((round): round is RoundState => Boolean(round));
}

async function getPricePoints(
  hermes: HermesClient,
  feeds: FeedConfig[],
): Promise<Map<string, PricePoint>> {
  const ids = [...new Set(feeds.map((feed) => feed.priceId))];
  const response = await hermes.getLatestPriceUpdates(ids) as any;
  const parsed = response?.parsed ?? [];
  const result = new Map<string, PricePoint>();

  for (const item of parsed) {
    if (!item?.id || !item?.price) continue;
    const point: PricePoint = {
      id: normalizePriceId(String(item.id)),
      price: BigInt(item.price.price),
      exponent: Number(item.price.expo),
      publishTime: Number(item.price.publish_time),
    };
    result.set(point.id, point);
  }

  return result;
}

async function send(
  connection: Connection,
  keeper: Keypair,
  ix: TransactionInstruction,
): Promise<string> {
  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(connection, tx, [keeper], {
    commitment: "confirmed",
  });
}

async function initBeta(connection: Connection, keeper: Keypair) {
  const betaConfig = deriveBetaConfig();
  if (await connection.getAccountInfo(betaConfig, "confirmed")) {
    console.log(`BetaConfig already exists: ${betaConfig.toBase58()}`);
    return;
  }

  const protocolConfig = deriveProtocolConfig();
  if (!(await connection.getAccountInfo(protocolConfig, "confirmed"))) {
    throw new Error(
      `ProtocolConfig ${protocolConfig.toBase58()} does not exist. Initialize Milestone 1 first.`,
    );
  }

  const lockBufferSecs = Number(process.env.BETA_LOCK_BUFFER_SECS || "15");
  const maxOracleDelaySecs = Number(process.env.BETA_MAX_ORACLE_DELAY_SECS || "120");
  const feeBps = Number(process.env.BETA_FEE_BPS || "30");

  const data = Buffer.concat([
    INIT_BETA_CONFIG_DISC,
    keeper.publicKey.toBuffer(),
    i64(BigInt(lockBufferSecs)),
    i64(BigInt(maxOracleDelaySecs)),
    u16(feeBps),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: betaConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const signature = await send(connection, keeper, ix);
  console.log(`BetaConfig initialized: ${signature}`);
}

async function openRound(
  connection: Connection,
  keeper: Keypair,
  tokenProgram: PublicKey,
  feed: FeedConfig,
  duration: number,
  point: PricePoint,
  now: number,
) {
  const assetHash = betaAssetHash(feed.symbol);
  const roundId = makeRoundId(duration, now);
  const round = deriveRound(assetHash, roundId);
  if (await connection.getAccountInfo(round, "confirmed")) return;

  const betaConfig = deriveBetaConfig();
  const protocolConfig = deriveProtocolConfig();
  const roundVault = deriveRoundVault(round);

  const data = Buffer.concat([
    OPEN_BETA_ROUND_DISC,
    assetHash,
    u64(roundId),
    i64(BigInt(duration)),
    i64(point.price),
    i32(point.exponent),
    i64(BigInt(point.publishTime)),
    observationHash(point),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
      { pubkey: betaConfig, isSigner: false, isWritable: false },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: USDG_DEVNET_MINT, isSigner: false, isWritable: false },
      { pubkey: round, isSigner: false, isWritable: true },
      { pubkey: roundVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const signature = await send(connection, keeper, ix);
  console.log(
    `Opened ${feed.symbol} ${duration / 60}m round ${roundId}: ${signature}`,
  );
}

async function lockRound(
  connection: Connection,
  keeper: Keypair,
  round: RoundState,
) {
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: round.address, isSigner: false, isWritable: true }],
    data: LOCK_BETA_ROUND_DISC,
  });
  const signature = await send(connection, keeper, ix);
  console.log(`Locked ${round.address.toBase58()}: ${signature}`);
}

async function settleRound(
  connection: Connection,
  keeper: Keypair,
  round: RoundState,
  point: PricePoint,
) {
  const betaConfig = deriveBetaConfig();
  const data = Buffer.concat([
    SETTLE_BETA_ROUND_DISC,
    i64(point.price),
    i64(BigInt(point.publishTime)),
    observationHash(point),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: keeper.publicKey, isSigner: true, isWritable: false },
      { pubkey: betaConfig, isSigner: false, isWritable: false },
      { pubkey: round.address, isSigner: false, isWritable: true },
    ],
    data,
  });

  const signature = await send(connection, keeper, ix);
  console.log(`Settled ${round.address.toBase58()}: ${signature}`);
}

async function tick() {
  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const pythApiKey = requireEnv("PYTH_API_KEY");
  const hermesEndpoint =
    process.env.PYTH_HERMES_ENDPOINT || "https://pyth.dourolabs.app/hermes";

  const connection = new Connection(rpc, "confirmed");
  const keeper = loadKeypair();
  const feeds = loadFeeds();
  const hermes = new HermesClient(hermesEndpoint, { accessToken: pythApiKey });

  const betaConfig = deriveBetaConfig();
  if (!(await connection.getAccountInfo(betaConfig, "confirmed"))) {
    throw new Error("BetaConfig is not initialized. Run npm run beta:init first.");
  }

  const mintAccount = await connection.getAccountInfo(USDG_DEVNET_MINT, "confirmed");
  if (!mintAccount) throw new Error("USDG Devnet mint is unavailable");
  const tokenProgram = mintAccount.owner;

  const now = Math.floor(Date.now() / 1000);
  const points = await getPricePoints(hermes, feeds);
  let rounds = await getRounds(connection);

  for (const round of rounds.filter((item) => item.status !== 2)) {
    const feed = feeds.find((candidate) =>
      betaAssetHash(candidate.symbol).equals(round.assetHash),
    );
    if (!feed) continue;

    const point = points.get(normalizePriceId(feed.priceId));
    if (!point) {
      console.warn(`No Pyth update for ${feed.symbol}; skipping round`);
      continue;
    }

    if (round.status === 0 && now >= round.lockTs && now < round.closeTs) {
      await lockRound(connection, keeper, round);
    }

    if (now >= round.closeTs) {
      if (point.publishTime < round.closeTs) {
        console.warn(
          `${feed.symbol} Pyth publish time ${point.publishTime} is before close ${round.closeTs}; waiting`,
        );
        continue;
      }
      await settleRound(connection, keeper, round, point);
    }
  }

  rounds = await getRounds(connection);

  for (const feed of feeds) {
    const point = points.get(normalizePriceId(feed.priceId));
    if (!point) {
      console.warn(`No Pyth update for ${feed.symbol}; cannot open new round`);
      continue;
    }

    const assetHash = betaAssetHash(feed.symbol);
    for (const duration of feed.durations ?? [300, 600, 900, 3600]) {
      const active = rounds.some(
        (round) =>
          round.status !== 2 &&
          round.assetHash.equals(assetHash) &&
          round.closeTs - round.openTs === duration,
      );
      if (!active) {
        await openRound(connection, keeper, tokenProgram, feed, duration, point, now);
      }
    }
  }
}

async function main() {
  const command = process.argv[2] || "watch";
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed",
  );
  const keeper = loadKeypair();

  if (command === "init") {
    await initBeta(connection, keeper);
    return;
  }

  if (command === "tick") {
    await tick();
    return;
  }

  if (command !== "watch") {
    throw new Error("Usage: beta-keeper.ts [init|tick|watch]");
  }

  const intervalMs = Number(process.env.BETA_KEEPER_INTERVAL_MS || "10000");
  if (!Number.isFinite(intervalMs) || intervalMs < 5_000) {
    throw new Error("BETA_KEEPER_INTERVAL_MS must be at least 5000");
  }

  console.log(
    `33 Beta keeper running as ${keeper.publicKey.toBase58()} every ${intervalMs}ms`,
  );
  for (;;) {
    try {
      await tick();
    } catch (error) {
      console.error("[33 Beta keeper] tick failed", error);
    }
    await sleep(intervalMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
