import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PublicKey, SystemProgram, type AccountInfo } from "@solana/web3.js";
import {
  BETA_ROUND_ACCOUNT_DISCRIMINATOR,
  MARKET_ACCOUNT_DISCRIMINATOR,
  decodeBetaRoundAccount,
  decodeMarketAccount,
  decodeProgramDataEvents,
  rangeToMs,
} from "./marketIndexer";

function account(data: Buffer): AccountInfo<Buffer> {
  return {
    executable: false,
    owner: SystemProgram.programId,
    lamports: 1,
    rentEpoch: 0,
    data,
  };
}

function key(seed: number): PublicKey {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => seed));
}

function writePubkey(buffer: Buffer, offset: number, value: PublicKey) {
  value.toBuffer().copy(buffer, offset);
  return offset + 32;
}

function writeU64(buffer: Buffer, offset: number, value: bigint) {
  buffer.writeBigUInt64LE(value, offset);
  return offset + 8;
}

function writeI64(buffer: Buffer, offset: number, value: bigint) {
  buffer.writeBigInt64LE(value, offset);
  return offset + 8;
}

function eventDisc(name: string) {
  return crypto.createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
}

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("decodes Market account layout and implied YES probability", () => {
  const raw = Buffer.alloc(420);
  MARKET_ACCOUNT_DISCRIMINATOR.copy(raw, 0);
  let o = 8;
  o = writePubkey(raw, o, key(1));
  o = writePubkey(raw, o, key(2));
  o = writePubkey(raw, o, key(3));
  Buffer.alloc(32, 4).copy(raw, o); o += 32;
  Buffer.alloc(32, 5).copy(raw, o); o += 32;
  Buffer.alloc(32, 6).copy(raw, o); o += 32;
  o = writeI64(raw, o, 2_000_000_000n);
  o = writeI64(raw, o, 2_000_000_100n);
  raw.writeUInt8(0, o++);
  raw.writeUInt16LE(30, o); o += 2;
  o = writePubkey(raw, o, key(7));
  o = writePubkey(raw, o, key(8));
  o = writePubkey(raw, o, key(9));
  o = writePubkey(raw, o, key(10));
  o = writePubkey(raw, o, key(11));
  o = writeU64(raw, o, 250_000n);
  o = writeU64(raw, o, 750_000n);
  o = writeU64(raw, o, 1_000_000n);
  o = writeU64(raw, o, 9_000_000n);
  o = writeU64(raw, o, 27_000n);
  raw.writeUInt8(255, o);

  const decoded = decodeMarketAccount(key(42), account(raw), 123, 999);
  assert.ok(decoded);
  assert.equal(decoded.status, "OPEN");
  assert.equal(decoded.feeBps, 30);
  assert.equal(decoded.yesReserve, "250000");
  assert.equal(decoded.noReserve, "750000");
  assert.equal(decoded.yesProbabilityBps, 7500);
  assert.equal(decoded.noProbabilityBps, 2500);
  assert.equal(decoded.volume, "9000000");
  assert.equal(decoded.slot, 123);
});

run("decodes BetaRound account pools and probability", () => {
  const raw = Buffer.alloc(263);
  BETA_ROUND_ACCOUNT_DISCRIMINATOR.copy(raw, 0);
  let o = 8;
  Buffer.alloc(32, 12).copy(raw, o); o += 32;
  o = writeU64(raw, o, 44n);
  o = writePubkey(raw, o, key(13));
  o = writePubkey(raw, o, key(14));
  o = writeI64(raw, o, 123_450_000n);
  o = writeI64(raw, o, 124_000_000n);
  raw.writeInt32LE(-6, o); o += 4;
  o = writeI64(raw, o, 1000n);
  o = writeI64(raw, o, 1300n);
  Buffer.alloc(32, 15).copy(raw, o); o += 32;
  Buffer.alloc(32, 16).copy(raw, o); o += 32;
  o = writeI64(raw, o, 1000n);
  o = writeI64(raw, o, 1200n);
  o = writeI64(raw, o, 1300n);
  o = writeU64(raw, o, 800_000n);
  o = writeU64(raw, o, 200_000n);
  o = writeU64(raw, o, 3_000n);
  raw.writeUInt8(1, o++);
  raw.writeUInt8(2, o++);

  const decoded = decodeBetaRoundAccount(key(43), account(raw), 321, 1001);
  assert.ok(decoded);
  assert.equal(decoded.roundId, "44");
  assert.equal(decoded.status, "SETTLED");
  assert.equal(decoded.outcome, "UP");
  assert.equal(decoded.upProbabilityBps, 8000);
  assert.equal(decoded.downProbabilityBps, 2000);
  assert.equal(decoded.priceExponent, -6);
});

run("decodes Anchor TradeExecuted event from Program data log", () => {
  const payload = Buffer.alloc(8 + 32 + 32 + 1 + 1 + 8 * 5);
  eventDisc("TradeExecuted").copy(payload, 0);
  let o = 8;
  o = writePubkey(payload, o, key(20));
  o = writePubkey(payload, o, key(21));
  payload.writeUInt8(0, o++);
  payload.writeUInt8(1, o++);
  o = writeU64(payload, o, 100_000n);
  o = writeU64(payload, o, 180_000n);
  o = writeU64(payload, o, 300n);
  o = writeU64(payload, o, 900_000n);
  o = writeU64(payload, o, 1_100_000n);

  const events = decodeProgramDataEvents(
    [`Program data: ${payload.toString("base64")}`],
    "sig-test",
    77,
    1_700_000_000,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "TradeExecuted");
  assert.equal(events[0].actor, key(21).toBase58());
  assert.equal(events[0].data.side, "YES");
  assert.equal(events[0].data.isBuy, true);
  assert.equal(events[0].data.amountIn, "100000");
  assert.equal(events[0].data.yesReserve, "900000");
});

run("decodes MarketLint certification timestamps from event logs", () => {
  const payload = Buffer.alloc(260);
  eventDisc("MarketLintCertificationIssued").copy(payload, 0);
  let o = 8;
  o = writePubkey(payload, o, key(50));
  o = writePubkey(payload, o, key(51));
  o = writePubkey(payload, o, key(56));
  Buffer.alloc(32, 52).copy(payload, o); o += 32;
  Buffer.alloc(32, 53).copy(payload, o); o += 32;
  Buffer.alloc(32, 54).copy(payload, o); o += 32;
  Buffer.alloc(32, 55).copy(payload, o); o += 32;
  o = writeI64(payload, o, 1_800_000_000n);
  o = writeI64(payload, o, 1_800_000_120n);
  payload.writeUInt8(94, o++);
  payload.writeUInt8(0, o++);
  payload.writeUInt8(12, o++);
  payload.writeUInt8(91, o++);
  o = writeI64(payload, o, 1_799_900_000n);

  const events = decodeProgramDataEvents(
    [`Program data: ${payload.toString("base64")}`],
    "marketlint-cert-sig",
    901,
    1_799_800_000,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "MarketLintCertificationIssued");
  assert.equal(events[0].data.attestor, key(56).toBase58());
  assert.equal(events[0].data.closeTs, 1_800_000_000);
  assert.equal(events[0].data.resolutionTs, 1_800_000_120);
  assert.equal(events[0].data.overallScore, 94);
  assert.equal(events[0].data.verdict, "GREEN");
  assert.equal(events[0].data.duplicateProbability, 12);
  assert.equal(events[0].data.resolutionClarityScore, 91);
});

run("rejects event-shaped data emitted by a nested foreign program", () => {
  const payload = Buffer.alloc(8 + 32 * 5 + 8);
  eventDisc("MarketCreated").copy(payload, 0);
  let o = 8;
  o = writePubkey(payload, o, key(70));
  o = writePubkey(payload, o, key(71));
  o = writePubkey(payload, o, key(72));
  o = writePubkey(payload, o, key(73));
  o = writePubkey(payload, o, key(74));
  o = writeI64(payload, o, 1_900_000_000n);

  const target = SystemProgram.programId;
  const foreign = key(75);

  const spoofed = decodeProgramDataEvents(
    [
      `Program ${target.toBase58()} invoke [1]`,
      `Program ${foreign.toBase58()} invoke [2]`,
      `Program data: ${payload.toString("base64")}`,
      `Program ${foreign.toBase58()} success`,
      `Program ${target.toBase58()} success`,
    ],
    "spoofed-event",
    902,
    1_800_000_000,
    target,
  );
  assert.equal(spoofed.length, 0);

  const authentic = decodeProgramDataEvents(
    [
      `Program ${target.toBase58()} invoke [1]`,
      `Program data: ${payload.toString("base64")}`,
      `Program ${target.toBase58()} success`,
    ],
    "authentic-event",
    903,
    1_800_000_001,
    target,
  );
  assert.equal(authentic.length, 1);
  assert.equal(authentic[0].type, "MarketCreated");
});

run("range parser supports analytics windows", () => {
  assert.equal(rangeToMs("1h"), 3_600_000);
  assert.equal(rangeToMs("24h"), 86_400_000);
  assert.equal(rangeToMs("7d"), 604_800_000);
  assert.equal(rangeToMs("all"), undefined);
});

console.log("MILESTONE 8 INDEXER TESTS: PASS");
