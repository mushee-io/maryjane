import assert from "node:assert/strict";
import {
  analyzeMarketLint,
  compileMarketLintReport,
} from "./marketLint";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const goodInput = {
  question:
    "Will SOL/USD close above $300 by 23:59 UTC on 31 December 2026, as determined by Pyth SOL/USD?",
  description:
    "Resolve YES if the Pyth SOL/USD price is above $300 at the final valid observation at or before 23:59 UTC. If the feed is unavailable, resolve INVALID.",
  source: "Pyth SOL/USD",
  category: "Crypto",
  deadline: "31 December 2026, 23:59 UTC",
  closeTs: 1798761540,
  resolutionTs: 1798761600,
};

test("good deterministic market is publish-ready", () => {
  const report = compileMarketLintReport(goodInput);
  assert.equal(report.analysis.verdict, "green");
  assert.ok(report.analysis.overallScore >= 80);
  assert.ok(report.analysis.resolutionClarityScore >= 70);
  assert.equal(report.analysis.missingSource, false);
});

test("compiler hashes are deterministic", () => {
  const a = compileMarketLintReport(goodInput);
  const b = compileMarketLintReport(goodInput);
  assert.deepEqual(a.hashes, b.hashes);
  assert.equal(a.spec.version, "33milady-market-spec-v1");
});

test("metadata changes are cryptographically bound", () => {
  const a = compileMarketLintReport(goodInput);
  const b = compileMarketLintReport({
    ...goodInput,
    source: "Coinbase SOL/USD",
  });
  assert.notEqual(a.hashes.metadataHash, b.hashes.metadataHash);
  assert.notEqual(a.hashes.sourceHash, b.hashes.sourceHash);
  assert.notEqual(a.hashes.specHash, b.hashes.specHash);
  assert.notEqual(a.hashes.reportHash, b.hashes.reportHash);
});

test("market schedule changes alter the certified bundle", () => {
  const a = compileMarketLintReport(goodInput);
  const b = compileMarketLintReport({
    ...goodInput,
    closeTs: goodInput.closeTs + 3600,
    resolutionTs: goodInput.resolutionTs + 3600,
  });

  assert.notEqual(a.hashes.marketSeed, b.hashes.marketSeed);
  assert.notEqual(a.hashes.specHash, b.hashes.specHash);
  assert.notEqual(a.hashes.reportHash, b.hashes.reportHash);
  assert.equal(a.hashes.questionHash, b.hashes.questionHash);
  assert.equal(a.hashes.metadataHash, b.hashes.metadataHash);
});

test("exact indexed question hash is rejected as duplicate", () => {
  const first = compileMarketLintReport(goodInput);
  const duplicate = compileMarketLintReport(
    goodInput,
    [
      {
        questionHash: first.hashes.questionHash,
        address: "Market111111111111111111111111111111111",
      },
    ],
    [],
  );
  assert.equal(duplicate.analysis.duplicateProbability, 100);
  assert.notEqual(duplicate.analysis.verdict, "green");
  assert.ok(duplicate.analysis.issues.some((issue) => issue.type === "duplicate"));
});

test("ambiguous source-less market is not publish-ready", () => {
  const result = analyzeMarketLint({
    question: "Will SOL pump big soon?",
    category: "Crypto",
  });
  assert.notEqual(result.verdict, "green");
  assert.ok(result.ambiguityScore > 0);
  assert.equal(result.missingSource, true);
  assert.ok(result.issues.some((issue) => issue.type === "deadline"));
  assert.ok(result.issues.some((issue) => issue.type === "source"));
});

test("uncertified draft analyses do not poison a later certification attempt", () => {
  const draft = compileMarketLintReport(goodInput);
  const again = compileMarketLintReport(goodInput, [], [draft]);
  assert.equal(again.analysis.duplicateProbability, 0);
  assert.equal(again.analysis.verdict, "green");
});

test("identical certified draft can be retried before market creation", () => {
  const certified = {
    ...compileMarketLintReport(goodInput),
    certifiedAt: Date.now(),
  };
  const retry = compileMarketLintReport(goodInput, [], [certified]);
  assert.equal(retry.analysis.duplicateProbability, 0);
  assert.equal(retry.analysis.verdict, "green");
});

test("certified reports contribute semantic duplicate risk", () => {
  const prior = {
    ...compileMarketLintReport(goodInput),
    certifiedAt: Date.now(),
  };
  const next = compileMarketLintReport(
    {
      ...goodInput,
      question:
        "Will SOL/USD close above $300 by 23:59 UTC on December 31 2026 according to Pyth SOL/USD?",
    },
    [],
    [prior],
  );
  assert.ok(next.analysis.duplicateProbability > 50);
  assert.ok(next.analysis.similarMarkets.length > 0);
});

test("compiler rejects oversized public inputs", () => {
  assert.throws(() =>
    compileMarketLintReport({
      question: "x".repeat(513),
      source: "Pyth SOL/USD",
      deadline: "31 December 2026, 23:59 UTC",
    }),
  );
});

console.log("MILESTONE 9 MARKETLINT TESTS: PASS");
