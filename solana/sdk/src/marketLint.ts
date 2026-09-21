import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export type MarketLintVerdict = "green" | "yellow" | "red";

export type MarketLintCertificationHashes = {
  marketSeed: Uint8Array;
  questionHash: Uint8Array;
  metadataHash: Uint8Array;
  specHash: Uint8Array;
  reportHash: Uint8Array;
  sourceHash: Uint8Array;
};

export function marketLintHash32(value: string): Uint8Array {
  return createHash("sha256").update(value, "utf8").digest();
}

export function deriveMarketLintConfigPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("marketlint-config")],
    programId,
  );
}

export function deriveMarketLintCertificationPda(
  marketSeed: Uint8Array,
  programId: PublicKey,
): [PublicKey, number] {
  if (marketSeed.length !== 32) {
    throw new Error("marketSeed must be exactly 32 bytes");
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("marketlint-cert"), Buffer.from(marketSeed)],
    programId,
  );
}

export function marketLintVerdictIndex(verdict: MarketLintVerdict): number {
  if (verdict === "green") return 0;
  if (verdict === "yellow") return 1;
  return 2;
}

export function assertMarketLintPublishReady(input: {
  overallScore: number;
  verdict: MarketLintVerdict;
  duplicateProbability: number;
  resolutionClarityScore: number;
}, thresholds: {
  minScore?: number;
  maxDuplicateProbability?: number;
  minResolutionClarityScore?: number;
  requireGreen?: boolean;
} = {}) {
  const minScore = thresholds.minScore ?? 80;
  const maxDuplicateProbability = thresholds.maxDuplicateProbability ?? 60;
  const minResolutionClarityScore = thresholds.minResolutionClarityScore ?? 70;
  const requireGreen = thresholds.requireGreen ?? true;

  for (const value of [
    input.overallScore,
    input.duplicateProbability,
    input.resolutionClarityScore,
    minScore,
    maxDuplicateProbability,
    minResolutionClarityScore,
  ]) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error("MarketLint scores and thresholds must be integers from 0 to 100");
    }
  }

  if (input.overallScore < minScore) {
    throw new Error("MarketLint score is below publish threshold");
  }
  if (input.duplicateProbability > maxDuplicateProbability) {
    throw new Error("MarketLint duplicate probability is above publish threshold");
  }
  if (input.resolutionClarityScore < minResolutionClarityScore) {
    throw new Error("MarketLint resolution clarity is below publish threshold");
  }
  if (requireGreen && input.verdict !== "green") {
    throw new Error("MarketLint verdict must be green");
  }

  return true;
}
