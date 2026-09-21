import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  MILADY_MARKET_PROGRAM_ID,
  deriveConfigPda,
  deriveLpPositionPda,
  deriveMarketAddresses,
  deriveResolutionBondVaultPda,
  deriveResolutionConfigPda,
  deriveResolutionStatePda,
} from "./index.js";
import {
  deriveMarketLintCertificationPda,
  deriveMarketLintConfigPda,
} from "./marketLint.js";

export type CreateCertifiedMarketArgs = {
  marketSeed: Uint8Array;
  questionHash: Uint8Array;
  metadataHash: Uint8Array;
  closeTs: bigint;
  resolutionTs: bigint;
};

export type MarketRuntimeAccounts = {
  authority: PublicKey;
  collateralMint: PublicKey;
  tokenProgram: PublicKey;
  marketSeed: Uint8Array;
};

export type Outcome = "YES" | "NO" | "INVALID";
export type TradeSide = "YES" | "NO";
export type TradeDirection = "BUY" | "SELL";

function assertBytes32(value: Uint8Array, label: string) {
  if (value.length !== 32) throw new Error(`${label} must be exactly 32 bytes`);
}

function u64(value: bigint) {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("u64 overflow");
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function i64(value: bigint) {
  if (
    value < -0x8000_0000_0000_0000n ||
    value > 0x7fff_ffff_ffff_ffffn
  ) {
    throw new Error("i64 overflow");
  }
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value);
  return out;
}

function u16(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("u16 overflow");
  }
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

export function instructionDiscriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function meta(pubkey: PublicKey, isSigner = false, isWritable = false): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

export function buildInitializeConfigInstruction(params: {
  authority: PublicKey;
  collateralMint: PublicKey;
  feeBps: number;
  programId?: PublicKey;
}) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.authority, true, true),
      meta(config, false, true),
      meta(params.collateralMint),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([
      instructionDiscriminator("initialize_config"),
      u16(params.feeBps),
    ]),
  });
}

export function buildInitializeResolutionConfigInstruction(params: {
  authority: PublicKey;
  proposalBond: bigint;
  disputeBond: bigint;
  challengePeriodSecs: bigint;
  escalationPeriodSecs: bigint;
  programId?: PublicKey;
}) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  const [protocolConfig] = deriveConfigPda(programId);
  const [resolutionConfig] = deriveResolutionConfigPda(programId);
  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.authority, true, true),
      meta(protocolConfig),
      meta(resolutionConfig, false, true),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([
      instructionDiscriminator("initialize_resolution_config"),
      u64(params.proposalBond),
      u64(params.disputeBond),
      i64(params.challengePeriodSecs),
      i64(params.escalationPeriodSecs),
    ]),
  });
}

export function buildCreateCertifiedMarketInstruction(
  params: MarketRuntimeAccounts &
    CreateCertifiedMarketArgs & {
      programId?: PublicKey;
    },
) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  assertBytes32(params.marketSeed, "marketSeed");
  assertBytes32(params.questionHash, "questionHash");
  assertBytes32(params.metadataHash, "metadataHash");
  if (params.closeTs <= 0n || params.resolutionTs < params.closeTs) {
    throw new Error("invalid market schedule");
  }

  const [config] = deriveConfigPda(programId);
  const [marketLintConfig] = deriveMarketLintConfigPda(programId);
  const [certification] = deriveMarketLintCertificationPda(
    params.marketSeed,
    programId,
  );
  const addresses = deriveMarketAddresses(params.marketSeed, programId);

  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.authority, true, true),
      meta(config),
      meta(params.collateralMint),
      meta(marketLintConfig),
      meta(certification, false, true),
      meta(addresses.market, false, true),
      meta(addresses.collateralVault, false, true),
      meta(addresses.yesMint, false, true),
      meta(addresses.noMint, false, true),
      meta(addresses.yesReserveVault, false, true),
      meta(addresses.noReserveVault, false, true),
      meta(params.tokenProgram),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([
      instructionDiscriminator("create_market"),
      Buffer.from(params.marketSeed),
      Buffer.from(params.questionHash),
      Buffer.from(params.metadataHash),
      i64(params.closeTs),
      i64(params.resolutionTs),
    ]),
  });
}

export function buildAddLiquidityInstruction(
  params: MarketRuntimeAccounts & {
    userCollateral: PublicKey;
    userYes: PublicKey;
    userNo: PublicKey;
    amount: bigint;
    programId?: PublicKey;
  },
) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const addresses = deriveMarketAddresses(params.marketSeed, programId);
  const [lpPosition] = deriveLpPositionPda(
    addresses.market,
    params.authority,
    programId,
  );

  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.authority, true, true),
      meta(config),
      meta(addresses.market, false, true),
      meta(lpPosition, false, true),
      meta(params.collateralMint),
      meta(params.userCollateral, false, true),
      meta(addresses.collateralVault, false, true),
      meta(addresses.yesMint, false, true),
      meta(addresses.noMint, false, true),
      meta(addresses.yesReserveVault, false, true),
      meta(addresses.noReserveVault, false, true),
      meta(params.userYes, false, true),
      meta(params.userNo, false, true),
      meta(params.tokenProgram),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([
      instructionDiscriminator("add_liquidity"),
      u64(params.amount),
    ]),
  });
}

export function buildTradeInstruction(
  params: MarketRuntimeAccounts & {
    userCollateral: PublicKey;
    userYes: PublicKey;
    userNo: PublicKey;
    side: TradeSide;
    direction: TradeDirection;
    amountIn: bigint;
    minAmountOut: bigint;
    programId?: PublicKey;
  },
) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const addresses = deriveMarketAddresses(params.marketSeed, programId);

  const instructionName =
    params.direction === "BUY"
      ? params.side === "YES"
        ? "buy_yes"
        : "buy_no"
      : params.side === "YES"
        ? "sell_yes"
        : "sell_no";

  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.authority, true, true),
      meta(config),
      meta(addresses.market, false, true),
      meta(params.collateralMint),
      meta(params.userCollateral, false, true),
      meta(addresses.collateralVault, false, true),
      meta(addresses.yesMint, false, true),
      meta(addresses.noMint, false, true),
      meta(addresses.yesReserveVault, false, true),
      meta(addresses.noReserveVault, false, true),
      meta(params.userYes, false, true),
      meta(params.userNo, false, true),
      meta(params.tokenProgram),
    ],
    data: Buffer.concat([
      instructionDiscriminator(instructionName),
      u64(params.amountIn),
      u64(params.minAmountOut),
    ]),
  });
}


export type OrderSide = "YES" | "NO";
export type OrderKind = "BUY" | "SELL";

export function buildPlaceOrderInstruction(params: {
  maker: PublicKey;
  collateralMint: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  tokenProgram: PublicKey;
  marketSeed: Uint8Array;
  orderSeed: Uint8Array;
  side: OrderSide;
  kind: OrderKind;
  priceBps: number;
  shares: bigint;
  makerSource: PublicKey;
  programId?: PublicKey;
}) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  assertBytes32(params.marketSeed, "marketSeed");
  assertBytes32(params.orderSeed, "orderSeed");
  if (params.priceBps < 1 || params.priceBps > 9_999) throw new Error("invalid order price");
  if (params.shares <= 0n) throw new Error("shares must be positive");
  const [config] = deriveConfigPda(programId);
  const addresses = deriveMarketAddresses(params.marketSeed, programId);
  const [order] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), addresses.market.toBuffer(), params.maker.toBuffer(), Buffer.from(params.orderSeed)],
    programId,
  );
  const [escrowVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("order-vault"), order.toBuffer()],
    programId,
  );
  const escrowMint = params.kind === "BUY"
    ? params.collateralMint
    : params.side === "YES" ? params.yesMint : params.noMint;
  const data = Buffer.concat([
    instructionDiscriminator("place_limit_order"),
    Buffer.from(params.orderSeed),
    Buffer.from([params.side === "YES" ? 0 : 1]),
    Buffer.from([params.kind === "BUY" ? 0 : 1]),
    u16(params.priceBps),
    u64(params.shares),
  ]);
  return {
    order,
    escrowVault,
    instruction: new TransactionInstruction({
      programId,
      keys: [
        meta(params.maker, true, true),
        meta(config),
        meta(addresses.market),
        meta(params.collateralMint),
        meta(params.yesMint),
        meta(params.noMint),
        meta(escrowMint),
        meta(params.makerSource, false, true),
        meta(order, false, true),
        meta(escrowVault, false, true),
        meta(params.tokenProgram),
        meta(SystemProgram.programId),
      ],
      data,
    }),
  };
}

export function buildFillOrderInstruction(params: {
  taker: PublicKey;
  market: PublicKey;
  order: PublicKey;
  maker: PublicKey;
  collateralMint: PublicKey;
  outcomeMint: PublicKey;
  escrowMint: PublicKey;
  escrowVault: PublicKey;
  takerCollateral: PublicKey;
  takerOutcome: PublicKey;
  makerCollateral: PublicKey;
  makerOutcome: PublicKey;
  tokenProgram: PublicKey;
  shares: bigint;
  programId?: PublicKey;
}) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.taker, true, true),
      meta(config),
      meta(params.market, false, true),
      meta(params.order, false, true),
      meta(params.maker),
      meta(params.collateralMint),
      meta(params.outcomeMint),
      meta(params.escrowMint),
      meta(params.escrowVault, false, true),
      meta(params.takerCollateral, false, true),
      meta(params.takerOutcome, false, true),
      meta(params.makerCollateral, false, true),
      meta(params.makerOutcome, false, true),
      meta(params.tokenProgram),
    ],
    data: Buffer.concat([instructionDiscriminator("fill_limit_order"), u64(params.shares)]),
  });
}

export function buildCloseMarketInstruction(params: {
  caller: PublicKey;
  marketSeed: Uint8Array;
  programId?: PublicKey;
}) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const { market } = deriveMarketAddresses(params.marketSeed, programId);
  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.caller, true),
      meta(config),
      meta(market, false, true),
    ],
    data: instructionDiscriminator("close_market"),
  });
}

export function buildProposeResolutionInstruction(params: {
  proposer: PublicKey;
  marketSeed: Uint8Array;
  collateralMint: PublicKey;
  proposerCollateral: PublicKey;
  tokenProgram: PublicKey;
  outcome: Outcome;
  evidenceHash: Uint8Array;
  sourceHash: Uint8Array;
  observationHash: Uint8Array;
  programId?: PublicKey;
}) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  for (const [label, value] of [
    ["evidenceHash", params.evidenceHash],
    ["sourceHash", params.sourceHash],
    ["observationHash", params.observationHash],
  ] as const) {
    assertBytes32(value, label);
  }
  const [protocolConfig] = deriveConfigPda(programId);
  const [resolutionConfig] = deriveResolutionConfigPda(programId);
  const { market } = deriveMarketAddresses(params.marketSeed, programId);
  const [resolutionState] = deriveResolutionStatePda(market, programId);
  const [bondVault] = deriveResolutionBondVaultPda(market, programId);
  const outcomeIndex =
    params.outcome === "YES" ? 1 : params.outcome === "NO" ? 2 : 3;

  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.proposer, true, true),
      meta(protocolConfig),
      meta(resolutionConfig),
      meta(market, false, true),
      meta(params.collateralMint),
      meta(params.proposerCollateral, false, true),
      meta(resolutionState, false, true),
      meta(bondVault, false, true),
      meta(params.tokenProgram),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([
      instructionDiscriminator("propose_resolution"),
      Buffer.from([outcomeIndex]),
      Buffer.from(params.evidenceHash),
      Buffer.from(params.sourceHash),
      Buffer.from(params.observationHash),
    ]),
  });
}

export function buildFinalizeUncontestedInstruction(params: {
  caller: PublicKey;
  proposer: PublicKey;
  marketSeed: Uint8Array;
  collateralMint: PublicKey;
  proposerCollateral: PublicKey;
  tokenProgram: PublicKey;
  programId?: PublicKey;
}) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  const [protocolConfig] = deriveConfigPda(programId);
  const { market } = deriveMarketAddresses(params.marketSeed, programId);
  const [resolutionState] = deriveResolutionStatePda(market, programId);
  const [bondVault] = deriveResolutionBondVaultPda(market, programId);

  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.caller, true),
      meta(protocolConfig),
      meta(market, false, true),
      meta(resolutionState, false, true),
      meta(params.proposer),
      meta(params.collateralMint),
      meta(params.proposerCollateral, false, true),
      meta(bondVault, false, true),
      meta(params.tokenProgram),
    ],
    data: instructionDiscriminator("finalize_uncontested"),
  });
}

export function buildRedeemWinningsInstruction(params: {
  owner: PublicKey;
  marketSeed: Uint8Array;
  collateralMint: PublicKey;
  collateralVault: PublicKey;
  winningMint: PublicKey;
  userWinning: PublicKey;
  userCollateral: PublicKey;
  receipt: PublicKey;
  tokenProgram: PublicKey;
  amount: bigint;
  programId?: PublicKey;
}) {
  const programId = params.programId ?? MILADY_MARKET_PROGRAM_ID;
  const [config] = deriveConfigPda(programId);
  const { market } = deriveMarketAddresses(params.marketSeed, programId);
  return new TransactionInstruction({
    programId,
    keys: [
      meta(params.owner, true, true),
      meta(config),
      meta(market, false, true),
      meta(params.collateralMint),
      meta(params.collateralVault, false, true),
      meta(params.winningMint, false, true),
      meta(params.userWinning, false, true),
      meta(params.userCollateral, false, true),
      meta(params.receipt, false, true),
      meta(params.tokenProgram),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([
      instructionDiscriminator("redeem_winnings"),
      u64(params.amount),
    ]),
  });
}

export const wire = {
  u64,
  i64,
  u16,
};
