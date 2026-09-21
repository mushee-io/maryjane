export * from "./marketLint.js";
export * from "./dataClient.js";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const MILADY_MARKET_PROGRAM_ID = new PublicKey(
  "9tELwXSuJCP5vNrvBfo1PxGorDbMCGBQBEcsWTJtpHMy",
);

export const USDG_DEVNET_MINT = new PublicKey(
  "4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7",
);

export const BPS_DENOMINATOR = 10_000n;
export const DEFAULT_FEE_BPS = 30n;

export type Side = "YES" | "NO";

export type MarketAddresses = {
  market: PublicKey;
  collateralVault: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  yesReserveVault: PublicKey;
  noReserveVault: PublicKey;
};

export type AddLiquidityQuote = {
  yesAdded: bigint;
  noAdded: bigint;
  excessYes: bigint;
  excessNo: bigint;
  lpShares: bigint;
};

export function hash32(value: string): Uint8Array {
  return createHash("sha256").update(value, "utf8").digest();
}

export function marketSeedFromSlug(slug: string): Uint8Array {
  return hash32(`33milady:market:${slug.trim().toLowerCase()}`);
}

export function questionHash(question: string): Uint8Array {
  return hash32(question.trim());
}

export function metadataHash(metadataJson: string): Uint8Array {
  return hash32(metadataJson);
}

export function deriveConfigPda(
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
}

export function deriveMarketPda(
  marketSeed: Uint8Array,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  if (marketSeed.length !== 32) {
    throw new Error("marketSeed must be exactly 32 bytes");
  }
  const [config] = deriveConfigPda(programId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), config.toBuffer(), Buffer.from(marketSeed)],
    programId,
  );
}

export function deriveMarketAddresses(
  marketSeed: Uint8Array,
  programId = MILADY_MARKET_PROGRAM_ID,
): MarketAddresses {
  const [market] = deriveMarketPda(marketSeed, programId);
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral-vault"), market.toBuffer()],
    programId,
  );
  const [yesMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes-mint"), market.toBuffer()],
    programId,
  );
  const [noMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("no-mint"), market.toBuffer()],
    programId,
  );
  const [yesReserveVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes-vault"), market.toBuffer()],
    programId,
  );
  const [noReserveVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("no-vault"), market.toBuffer()],
    programId,
  );

  return {
    market,
    collateralVault,
    yesMint,
    noMint,
    yesReserveVault,
    noReserveVault,
  };
}

export function deriveLpPositionPda(
  market: PublicKey,
  owner: PublicKey,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), market.toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function feeAmount(amount: bigint, feeBps: bigint): bigint {
  if (amount < 0n || feeBps < 0n || feeBps > BPS_DENOMINATOR) {
    throw new Error("invalid amount or fee");
  }
  return (amount * feeBps) / BPS_DENOMINATOR;
}

export function quoteBuy(
  outcomeReserve: bigint,
  otherReserve: bigint,
  grossCollateralIn: bigint,
  feeBps = DEFAULT_FEE_BPS,
): { netIn: bigint; fee: bigint; outcomeOut: bigint } {
  assertPositive(outcomeReserve, "outcomeReserve");
  assertPositive(otherReserve, "otherReserve");
  assertPositive(grossCollateralIn, "grossCollateralIn");

  const fee = feeAmount(grossCollateralIn, feeBps);
  const netIn = grossCollateralIn - fee;
  assertPositive(netIn, "netIn");

  const k = outcomeReserve * otherReserve;
  const newOther = otherReserve + netIn;
  const newOutcomeBefore = outcomeReserve + netIn;
  const newOutcomeAfter = divCeil(k, newOther);
  const outcomeOut = newOutcomeBefore - newOutcomeAfter;

  assertPositive(outcomeOut, "outcomeOut");
  return { netIn, fee, outcomeOut };
}

export function quoteSell(
  outcomeReserve: bigint,
  otherReserve: bigint,
  outcomeIn: bigint,
  feeBps = DEFAULT_FEE_BPS,
): { grossCollateralOut: bigint; fee: bigint; netCollateralOut: bigint } {
  assertPositive(outcomeReserve, "outcomeReserve");
  assertPositive(otherReserve, "otherReserve");
  assertPositive(outcomeIn, "outcomeIn");

  const sum = outcomeReserve + otherReserve + outcomeIn;
  const discriminant = sum * sum - 4n * outcomeIn * otherReserve;
  const sqrtFloor = integerSqrt(discriminant);
  const sqrtCeil =
    sqrtFloor * sqrtFloor === discriminant ? sqrtFloor : sqrtFloor + 1n;
  const grossCollateralOut = (sum - sqrtCeil) / 2n;

  if (grossCollateralOut > otherReserve) {
    throw new Error("insufficient liquidity");
  }

  const fee = feeAmount(grossCollateralOut, feeBps);
  const netCollateralOut = grossCollateralOut - fee;
  return { grossCollateralOut, fee, netCollateralOut };
}

export function quoteAddLiquidity(
  yesReserve: bigint,
  noReserve: bigint,
  lpSupply: bigint,
  amount: bigint,
): AddLiquidityQuote {
  assertPositive(amount, "amount");

  if (lpSupply === 0n) {
    if (yesReserve !== 0n || noReserve !== 0n) {
      throw new Error("invalid zero-LP pool state");
    }
    return {
      yesAdded: amount,
      noAdded: amount,
      excessYes: 0n,
      excessNo: 0n,
      lpShares: amount,
    };
  }

  assertPositive(yesReserve, "yesReserve");
  assertPositive(noReserve, "noReserve");

  if (yesReserve <= noReserve) {
    const yesAdded = (amount * yesReserve) / noReserve;
    return {
      yesAdded,
      noAdded: amount,
      excessYes: amount - yesAdded,
      excessNo: 0n,
      lpShares: (amount * lpSupply) / noReserve,
    };
  }

  const noAdded = (amount * noReserve) / yesReserve;
  return {
    yesAdded: amount,
    noAdded,
    excessYes: 0n,
    excessNo: amount - noAdded,
    lpShares: (amount * lpSupply) / yesReserve,
  };
}

export function impliedYesProbabilityBps(
  yesReserve: bigint,
  noReserve: bigint,
): bigint {
  assertPositive(yesReserve, "yesReserve");
  assertPositive(noReserve, "noReserve");
  return (noReserve * BPS_DENOMINATOR) / (yesReserve + noReserve);
}

export function impliedNoProbabilityBps(
  yesReserve: bigint,
  noReserve: bigint,
): bigint {
  return BPS_DENOMINATOR - impliedYesProbabilityBps(yesReserve, noReserve);
}

export type OrderKind = "BUY" | "SELL";
export type ResolutionOutcome = "UNRESOLVED" | "YES" | "NO" | "INVALID";

export function orderSeedFromNonce(nonce: string): Uint8Array {
  return hash32(`33milady:order:${nonce}`);
}

export function deriveOrderPda(
  market: PublicKey,
  maker: PublicKey,
  orderSeed: Uint8Array,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  if (orderSeed.length !== 32) {
    throw new Error("orderSeed must be exactly 32 bytes");
  }
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      market.toBuffer(),
      maker.toBuffer(),
      Buffer.from(orderSeed),
    ],
    programId,
  );
}

export function deriveOrderVaultPda(
  order: PublicKey,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order-vault"), order.toBuffer()],
    programId,
  );
}

export function quoteLimitOrder(
  shares: bigint,
  priceBps: bigint,
): bigint {
  assertPositive(shares, "shares");
  if (priceBps < 1n || priceBps > 9_999n) {
    throw new Error("priceBps must be between 1 and 9,999");
  }
  return (shares * priceBps) / BPS_DENOMINATOR;
}

export function deriveResolutionConfigPda(
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("resolution-config")],
    programId,
  );
}

export function deriveResolutionStatePda(
  market: PublicKey,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("resolution"), market.toBuffer()],
    programId,
  );
}

export function deriveResolutionBondVaultPda(
  market: PublicKey,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("resolution-bond"), market.toBuffer()],
    programId,
  );
}

export type SettledMarketStatus =
  | "OPEN"
  | "CLOSED"
  | "RESOLUTION_PENDING"
  | "DISPUTED"
  | "RESOLVED_YES"
  | "RESOLVED_NO"
  | "CANCELLED";

export type PortfolioSettlement = {
  yesBalance: bigint;
  noBalance: bigint;
  claimableCollateral: bigint;
  winningBalance: bigint;
  losingBalance: bigint;
  isClaimable: boolean;
  claimKind: "WINNINGS" | "INVALID_REFUND" | "NONE";
};

export function deriveSettlementReceiptPda(
  market: PublicKey,
  owner: PublicKey,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("settlement"), market.toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function portfolioSettlement(
  status: SettledMarketStatus,
  yesBalance: bigint,
  noBalance: bigint,
): PortfolioSettlement {
  if (yesBalance < 0n || noBalance < 0n) {
    throw new Error("outcome balances cannot be negative");
  }

  if (status === "RESOLVED_YES") {
    return {
      yesBalance,
      noBalance,
      claimableCollateral: yesBalance,
      winningBalance: yesBalance,
      losingBalance: noBalance,
      isClaimable: yesBalance > 0n,
      claimKind: yesBalance > 0n ? "WINNINGS" : "NONE",
    };
  }

  if (status === "RESOLVED_NO") {
    return {
      yesBalance,
      noBalance,
      claimableCollateral: noBalance,
      winningBalance: noBalance,
      losingBalance: yesBalance,
      isClaimable: noBalance > 0n,
      claimKind: noBalance > 0n ? "WINNINGS" : "NONE",
    };
  }

  if (status === "CANCELLED") {
    const claimableCollateral = (yesBalance + noBalance) / 2n;
    return {
      yesBalance,
      noBalance,
      claimableCollateral,
      winningBalance: 0n,
      losingBalance: 0n,
      isClaimable: claimableCollateral > 0n,
      claimKind: claimableCollateral > 0n ? "INVALID_REFUND" : "NONE",
    };
  }

  return {
    yesBalance,
    noBalance,
    claimableCollateral: 0n,
    winningBalance: 0n,
    losingBalance: 0n,
    isClaimable: false,
    claimKind: "NONE",
  };
}

export type BetaSide = "UP" | "DOWN";
export type BetaOutcome = "UNRESOLVED" | "UP" | "DOWN" | "PUSH";
export type BetaDurationSeconds = 300 | 600 | 900 | 3600;

export const BETA_DURATIONS: readonly BetaDurationSeconds[] = [
  300,
  600,
  900,
  3600,
] as const;

export function betaAssetHash(symbol: string): Uint8Array {
  return hash32(`33milady:beta:asset:${symbol.trim().toUpperCase()}`);
}

function u64Le(value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("value does not fit in u64");
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

export function deriveBetaConfigPda(
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("beta-config")],
    programId,
  );
}

export function deriveBetaRoundPda(
  assetHash: Uint8Array,
  roundId: bigint,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  if (assetHash.length !== 32) {
    throw new Error("assetHash must be exactly 32 bytes");
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("beta-round"), Buffer.from(assetHash), u64Le(roundId)],
    programId,
  );
}

export function deriveBetaVaultPda(
  round: PublicKey,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("beta-vault"), round.toBuffer()],
    programId,
  );
}

export function deriveBetaPositionPda(
  round: PublicKey,
  owner: PublicKey,
  programId = MILADY_MARKET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("beta-position"), round.toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function betaImpliedUpBps(
  upPool: bigint,
  downPool: bigint,
): bigint {
  if (upPool < 0n || downPool < 0n) {
    throw new Error("beta pools cannot be negative");
  }
  const total = upPool + downPool;
  if (total === 0n) return 5_000n;
  return (upPool * BPS_DENOMINATOR) / total;
}

export function betaImpliedDownBps(
  upPool: bigint,
  downPool: bigint,
): bigint {
  return BPS_DENOMINATOR - betaImpliedUpBps(upPool, downPool);
}

export function betaPariMutuelPayout(
  userWinningStake: bigint,
  winningPool: bigint,
  totalPool: bigint,
): bigint {
  if (userWinningStake < 0n || winningPool < 0n || totalPool < 0n) {
    throw new Error("beta payout inputs cannot be negative");
  }
  if (userWinningStake === 0n) return 0n;
  if (winningPool === 0n) {
    throw new Error("winningPool must be > 0");
  }
  return (userWinningStake * totalPool) / winningPool;
}

export type BetaEntryQuote = {
  grossCollateralIn: bigint;
  fee: bigint;
  netStake: bigint;
  upPoolAfter: bigint;
  downPoolAfter: bigint;
  impliedUpBpsAfter: bigint;
  impliedDownBpsAfter: bigint;
  projectedPayoutIfWin: bigint;
};

export function quoteBetaEntry(
  side: BetaSide,
  grossCollateralIn: bigint,
  upPool: bigint,
  downPool: bigint,
  feeBps = DEFAULT_FEE_BPS,
): BetaEntryQuote {
  assertPositive(grossCollateralIn, "grossCollateralIn");
  if (upPool < 0n || downPool < 0n) {
    throw new Error("beta pools cannot be negative");
  }

  const fee = feeAmount(grossCollateralIn, feeBps);
  const netStake = grossCollateralIn - fee;
  assertPositive(netStake, "netStake");

  const upPoolAfter = side === "UP" ? upPool + netStake : upPool;
  const downPoolAfter = side === "DOWN" ? downPool + netStake : downPool;
  const totalAfter = upPoolAfter + downPoolAfter;
  const winningPoolAfter = side === "UP" ? upPoolAfter : downPoolAfter;
  const projectedPayoutIfWin = betaPariMutuelPayout(
    netStake,
    winningPoolAfter,
    totalAfter,
  );

  return {
    grossCollateralIn,
    fee,
    netStake,
    upPoolAfter,
    downPoolAfter,
    impliedUpBpsAfter: betaImpliedUpBps(upPoolAfter, downPoolAfter),
    impliedDownBpsAfter: betaImpliedDownBps(upPoolAfter, downPoolAfter),
    projectedPayoutIfWin,
  };
}

export function betaOutcomeFromPrices(
  startPrice: bigint,
  endPrice: bigint,
  upPool: bigint,
  downPool: bigint,
): BetaOutcome {
  assertPositive(startPrice, "startPrice");
  assertPositive(endPrice, "endPrice");

  if (endPrice === startPrice) return "PUSH";
  if (endPrice > startPrice) {
    return upPool === 0n ? "PUSH" : "UP";
  }
  return downPool === 0n ? "PUSH" : "DOWN";
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
  assertPositive(denominator, "denominator");
  if (numerator === 0n) return 0n;
  return (numerator - 1n) / denominator + 1n;
}

export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("sqrt of negative value");
  if (value < 2n) return value;

  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

function assertPositive(value: bigint, label: string): void {
  if (value <= 0n) throw new Error(`${label} must be > 0`);
}
