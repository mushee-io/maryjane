import assert from "node:assert/strict";
import {
  BPS_DENOMINATOR,
  betaPariMutuelPayout,
  impliedYesProbabilityBps,
  portfolioSettlement,
  quoteBuy,
  quoteLimitOrder,
  quoteSell,
} from "../sdk/src/index.js";

let state = 0x9e3779b9;

function nextU32() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function between(min: bigint, max: bigint) {
  const span = max - min + 1n;
  return min + (BigInt(nextU32()) % span);
}

function runBuyInvariant(iterations: number) {
  for (let i = 0; i < iterations; i += 1) {
    const yes = between(10_000n, 5_000_000_000n);
    const no = between(10_000n, 5_000_000_000n);
    const input = between(10n, 50_000_000n);
    const feeBps = between(0n, 500n);

    const quote = quoteBuy(yes, no, input, feeBps);
    assert.ok(quote.netIn > 0n);
    assert.ok(quote.outcomeOut > 0n);

    const newYes = yes + quote.netIn - quote.outcomeOut;
    const newNo = no + quote.netIn;

    assert.ok(newYes > 0n);
    assert.ok(newNo > 0n);
    assert.ok(newYes * newNo >= yes * no);

    const probability = impliedYesProbabilityBps(newYes, newNo);
    assert.ok(probability >= 0n && probability <= BPS_DENOMINATOR);
  }
}

function runSellInvariant(iterations: number) {
  for (let i = 0; i < iterations; i += 1) {
    const outcomeReserve = between(10_000n, 5_000_000_000n);
    const otherReserve = between(10_000n, 5_000_000_000n);
    const outcomeIn = between(1n, 50_000_000n);
    const feeBps = between(0n, 500n);

    const quote = quoteSell(
      outcomeReserve,
      otherReserve,
      outcomeIn,
      feeBps,
    );

    assert.ok(quote.grossCollateralOut >= 0n);
    assert.ok(quote.grossCollateralOut <= otherReserve);
    assert.ok(quote.fee >= 0n);
    assert.ok(quote.fee <= quote.grossCollateralOut);
    assert.equal(
      quote.netCollateralOut + quote.fee,
      quote.grossCollateralOut,
    );
  }
}

function runBetaConservation(iterations: number) {
  for (let i = 0; i < iterations; i += 1) {
    const winnerCount = Number(between(1n, 25n));
    const stakes = Array.from({ length: winnerCount }, () =>
      between(1n, 25_000_000n),
    );
    const winningPool = stakes.reduce((sum, stake) => sum + stake, 0n);
    const losingPool = between(0n, 100_000_000n);
    const totalPool = winningPool + losingPool;

    const payouts = stakes.map((stake) =>
      betaPariMutuelPayout(stake, winningPool, totalPool),
    );
    const totalPaid = payouts.reduce((sum, payout) => sum + payout, 0n);

    assert.ok(totalPaid <= totalPool);
    const roundingDust = totalPool - totalPaid;
    assert.ok(roundingDust < BigInt(winnerCount));
  }
}

function runInvalidRefundInvariant(iterations: number) {
  for (let i = 0; i < iterations; i += 1) {
    const yes = between(0n, 1_000_000_000n);
    const no = between(0n, 1_000_000_000n);
    const settlement = portfolioSettlement("CANCELLED", yes, no);

    assert.equal(settlement.claimableCollateral, (yes + no) / 2n);
    assert.ok(settlement.claimableCollateral <= yes + no);
  }
}

function runLimitOrderInvariant(iterations: number) {
  for (let i = 0; i < iterations; i += 1) {
    const shares = between(10_000n, 1_000_000_000n);
    const priceBps = between(1n, 9_999n);
    const quote = quoteLimitOrder(shares, priceBps);

    assert.ok(quote > 0n);
    assert.ok(quote < shares);
    assert.equal(quote, (shares * priceBps) / BPS_DENOMINATOR);
  }
}

runBuyInvariant(20_000);
runSellInvariant(20_000);
runBetaConservation(10_000);
runInvalidRefundInvariant(10_000);
runLimitOrderInvariant(10_000);

console.log("MILESTONE 9 SECURITY FUZZ SUITE: PASS");
