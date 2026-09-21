import assert from "node:assert/strict";
import {
  BPS_DENOMINATOR,
  MILADY_MARKET_PROGRAM_ID,
  USDG_DEVNET_MINT,
  deriveConfigPda,
  deriveMarketAddresses,
  impliedYesProbabilityBps,
  marketSeedFromSlug,
  orderSeedFromNonce,
  deriveOrderPda,
  deriveOrderVaultPda,
  deriveResolutionConfigPda,
  deriveResolutionStatePda,
  deriveResolutionBondVaultPda,
  deriveSettlementReceiptPda,
  portfolioSettlement,
  betaAssetHash,
  deriveBetaConfigPda,
  deriveBetaRoundPda,
  deriveBetaVaultPda,
  deriveBetaPositionPda,
  betaImpliedUpBps,
  betaImpliedDownBps,
  betaPariMutuelPayout,
  betaOutcomeFromPrices,
  quoteBetaEntry,
  quoteLimitOrder,
  deriveMarketLintConfigPda,
  deriveMarketLintCertificationPda,
  assertMarketLintPublishReady,
  quoteAddLiquidity,
  quoteBuy,
  quoteSell,
} from "../sdk/src/index.js";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("USDG devnet mint is configured", () => {
  assert.equal(
    USDG_DEVNET_MINT.toBase58(),
    "4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7",
  );
});

test("PDAs are deterministic", () => {
  const seed = marketSeedFromSlug("sol-above-300-dec-2026");
  const a = deriveMarketAddresses(seed);
  const b = deriveMarketAddresses(seed);
  assert.equal(a.market.toBase58(), b.market.toBase58());
  assert.equal(a.yesMint.toBase58(), b.yesMint.toBase58());
  assert.equal(a.noMint.toBase58(), b.noMint.toBase58());
  assert.notEqual(a.yesMint.toBase58(), a.noMint.toBase58());
  assert.ok(deriveConfigPda()[0]);
});

test("balanced pool starts at 50/50", () => {
  assert.equal(impliedYesProbabilityBps(1_000_000n, 1_000_000n), 5_000n);
});

test("YES buy returns more than one share per net dollar at 50/50", () => {
  const q = quoteBuy(1_000_000n, 1_000_000n, 100_000n, 30n);
  assert.ok(q.outcomeOut > q.netIn);
  const newYes = 1_000_000n + q.netIn - q.outcomeOut;
  const newNo = 1_000_000n + q.netIn;
  assert.ok(newYes * newNo >= 1_000_000n * 1_000_000n);
  assert.ok(impliedYesProbabilityBps(newYes, newNo) > 5_000n);
});

test("sell quote cannot pull more collateral than opposite reserve", () => {
  const q = quoteSell(900_000n, 1_100_000n, 100_000n, 30n);
  assert.ok(q.grossCollateralOut > 0n);
  assert.ok(q.grossCollateralOut <= 1_100_000n);
  assert.ok(q.netCollateralOut < q.grossCollateralOut);
});

test("initial LP deposit mints one LP share per base unit", () => {
  const q = quoteAddLiquidity(0n, 0n, 0n, 1_000_000n);
  assert.deepEqual(q, {
    yesAdded: 1_000_000n,
    noAdded: 1_000_000n,
    excessYes: 0n,
    excessNo: 0n,
    lpShares: 1_000_000n,
  });
});

test("later LP deposit preserves reserve ratio and returns excess side", () => {
  const q = quoteAddLiquidity(500_000n, 1_000_000n, 1_000_000n, 100_000n);
  assert.equal(q.yesAdded, 50_000n);
  assert.equal(q.noAdded, 100_000n);
  assert.equal(q.excessYes, 50_000n);
  assert.equal(q.excessNo, 0n);
});


test("limit order quote is deterministic and bounded", () => {
  assert.equal(quoteLimitOrder(1_000_000n, 6_250n), 625_000n);
  assert.throws(() => quoteLimitOrder(1_000_000n, 10_000n));
});

test("order PDAs are maker + market + nonce scoped", () => {
  const marketSeed = marketSeedFromSlug("sol-above-300-dec-2026");
  const { market } = deriveMarketAddresses(marketSeed);
  const maker = USDG_DEVNET_MINT;
  const orderSeed = orderSeedFromNonce("maker-1-order-7");
  const [orderA] = deriveOrderPda(market, maker, orderSeed);
  const [orderB] = deriveOrderPda(market, maker, orderSeed);
  const [vault] = deriveOrderVaultPda(orderA);
  assert.equal(orderA.toBase58(), orderB.toBase58());
  assert.notEqual(orderA.toBase58(), vault.toBase58());
});

test("resolution PDAs are deterministic per market", () => {
  const marketSeed = marketSeedFromSlug("nvda-above-250");
  const { market } = deriveMarketAddresses(marketSeed);
  const [configA] = deriveResolutionConfigPda();
  const [configB] = deriveResolutionConfigPda();
  const [stateA] = deriveResolutionStatePda(market);
  const [stateB] = deriveResolutionStatePda(market);
  const [bond] = deriveResolutionBondVaultPda(market);
  assert.equal(configA.toBase58(), configB.toBase58());
  assert.equal(stateA.toBase58(), stateB.toBase58());
  assert.notEqual(stateA.toBase58(), bond.toBase58());
});

test("resolved YES portfolio exposes full YES balance as claimable", () => {
  const p = portfolioSettlement("RESOLVED_YES", 750_000n, 125_000n);
  assert.equal(p.claimableCollateral, 750_000n);
  assert.equal(p.winningBalance, 750_000n);
  assert.equal(p.losingBalance, 125_000n);
  assert.equal(p.claimKind, "WINNINGS");
  assert.equal(p.isClaimable, true);
});

test("resolved NO portfolio exposes full NO balance as claimable", () => {
  const p = portfolioSettlement("RESOLVED_NO", 125_000n, 900_000n);
  assert.equal(p.claimableCollateral, 900_000n);
  assert.equal(p.claimKind, "WINNINGS");
});

test("cancelled market refunds outcome shares at 50 cents each", () => {
  const p = portfolioSettlement("CANCELLED", 600_000n, 200_000n);
  assert.equal(p.claimableCollateral, 400_000n);
  assert.equal(p.claimKind, "INVALID_REFUND");
});

test("unresolved market has no claimable collateral", () => {
  const p = portfolioSettlement("DISPUTED", 600_000n, 200_000n);
  assert.equal(p.claimableCollateral, 0n);
  assert.equal(p.claimKind, "NONE");
  assert.equal(p.isClaimable, false);
});

test("settlement receipt PDA is deterministic per market and owner", () => {
  const { market } = deriveMarketAddresses(
    marketSeedFromSlug("portfolio-settlement-market"),
  );
  const owner = USDG_DEVNET_MINT;
  const [a] = deriveSettlementReceiptPda(market, owner);
  const [b] = deriveSettlementReceiptPda(market, owner);
  assert.equal(a.toBase58(), b.toBase58());
});

test("33 Beta starts at 50/50 with empty pools", () => {
  assert.equal(betaImpliedUpBps(0n, 0n), 5_000n);
  assert.equal(betaImpliedDownBps(0n, 0n), 5_000n);
});

test("33 Beta implied probability follows pari-mutuel pool share", () => {
  assert.equal(betaImpliedUpBps(750_000n, 250_000n), 7_500n);
  assert.equal(betaImpliedDownBps(750_000n, 250_000n), 2_500n);
});

test("33 Beta entry quote deducts fee and projects payout", () => {
  const q = quoteBetaEntry("UP", 100_000n, 500_000n, 500_000n, 30n);
  assert.equal(q.fee, 300n);
  assert.equal(q.netStake, 99_700n);
  assert.ok(q.upPoolAfter > 500_000n);
  assert.ok(q.impliedUpBpsAfter > 5_000n);
  assert.ok(q.projectedPayoutIfWin > q.netStake);
});

test("33 Beta payout is pro-rata across the winning pool", () => {
  const payout = betaPariMutuelPayout(250_000n, 1_000_000n, 2_000_000n);
  assert.equal(payout, 500_000n);
});

test("33 Beta equal close price resolves PUSH", () => {
  assert.equal(betaOutcomeFromPrices(100n, 100n, 500n, 500n), "PUSH");
});

test("33 Beta no-winner side resolves PUSH instead of trapping funds", () => {
  assert.equal(betaOutcomeFromPrices(100n, 120n, 0n, 1_000n), "PUSH");
  assert.equal(betaOutcomeFromPrices(100n, 80n, 1_000n, 0n), "PUSH");
});

test("33 Beta PDAs are deterministic", () => {
  const asset = betaAssetHash("SOL/USD");
  const [configA] = deriveBetaConfigPda();
  const [configB] = deriveBetaConfigPda();
  const [roundA] = deriveBetaRoundPda(asset, 42n);
  const [roundB] = deriveBetaRoundPda(asset, 42n);
  const [vault] = deriveBetaVaultPda(roundA);
  const [position] = deriveBetaPositionPda(roundA, USDG_DEVNET_MINT);

  assert.equal(configA.toBase58(), configB.toBase58());
  assert.equal(roundA.toBase58(), roundB.toBase58());
  assert.notEqual(roundA.toBase58(), vault.toBase58());
  assert.notEqual(roundA.toBase58(), position.toBase58());
});

test("MarketLint config and certification PDAs are deterministic", () => {
  const seed = marketSeedFromSlug("marketlint-certified-market");
  const [configA] = deriveMarketLintConfigPda(MILADY_MARKET_PROGRAM_ID);
  const [configB] = deriveMarketLintConfigPda(MILADY_MARKET_PROGRAM_ID);
  const [certA] = deriveMarketLintCertificationPda(seed, MILADY_MARKET_PROGRAM_ID);
  const [certB] = deriveMarketLintCertificationPda(seed, MILADY_MARKET_PROGRAM_ID);
  assert.equal(configA.toBase58(), configB.toBase58());
  assert.equal(certA.toBase58(), certB.toBase58());
});

test("MarketLint publish threshold helper rejects weak reports", () => {
  assert.equal(
    assertMarketLintPublishReady({
      overallScore: 90,
      verdict: "green",
      duplicateProbability: 20,
      resolutionClarityScore: 90,
    }),
    true,
  );
  assert.throws(() =>
    assertMarketLintPublishReady({
      overallScore: 75,
      verdict: "yellow",
      duplicateProbability: 70,
      resolutionClarityScore: 60,
    }),
  );
});

test("basis points denominator stays fixed", () => {
  assert.equal(BPS_DENOMINATOR, 10_000n);
});

console.log("MILESTONES 1-7 SDK/MATH SUITE: PASS");
