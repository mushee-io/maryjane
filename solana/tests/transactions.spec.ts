import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  MILADY_MARKET_PROGRAM_ID,
  USDG_DEVNET_MINT,
  deriveMarketAddresses,
  hash32,
} from "../sdk/src/index.js";
import {
  buildAddLiquidityInstruction,
  buildCloseMarketInstruction,
  buildCreateCertifiedMarketInstruction,
  buildInitializeConfigInstruction,
  buildInitializeResolutionConfigInstruction,
  buildProposeResolutionInstruction,
  buildTradeInstruction,
  instructionDiscriminator,
} from "../sdk/src/transactions.js";

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const authority = Keypair.generate().publicKey;
const marketSeed = hash32("milestone-10-e2e-market");
const question = hash32("Will SOL close above $300?");
const metadata = hash32('{"source":"Pyth SOL/USD"}');
const closeTs = 1_900_000_000n;
const resolutionTs = closeTs + 120n;

run("Anchor instruction discriminator is stable", () => {
  assert.equal(instructionDiscriminator("create_market").length, 8);
  assert.notDeepEqual(
    instructionDiscriminator("create_market"),
    instructionDiscriminator("buy_yes"),
  );
});

run("initialization builders target deterministic config PDAs", () => {
  const configIx = buildInitializeConfigInstruction({
    authority,
    collateralMint: USDG_DEVNET_MINT,
    feeBps: 30,
  });
  assert.equal(configIx.programId.toBase58(), MILADY_MARKET_PROGRAM_ID.toBase58());
  assert.equal(configIx.keys.length, 4);
  assert.equal(configIx.keys[0].isSigner, true);
  assert.equal(configIx.keys[1].isWritable, true);
  assert.equal(configIx.keys[3].pubkey.toBase58(), SystemProgram.programId.toBase58());

  const resolutionIx = buildInitializeResolutionConfigInstruction({
    authority,
    proposalBond: 1_000_000n,
    disputeBond: 2_000_000n,
    challengePeriodSecs: 60n,
    escalationPeriodSecs: 120n,
  });
  assert.equal(resolutionIx.keys.length, 4);
  assert.equal(resolutionIx.data.length, 8 + 8 + 8 + 8 + 8);
});

run("certified market creation binds all deterministic market accounts", () => {
  const ix = buildCreateCertifiedMarketInstruction({
    authority,
    collateralMint: USDG_DEVNET_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    marketSeed,
    questionHash: question,
    metadataHash: metadata,
    closeTs,
    resolutionTs,
  });
  const addresses = deriveMarketAddresses(marketSeed);

  assert.equal(ix.keys.length, 13);
  assert.equal(ix.keys[0].pubkey.toBase58(), authority.toBase58());
  assert.equal(ix.keys[5].pubkey.toBase58(), addresses.market.toBase58());
  assert.equal(ix.keys[6].pubkey.toBase58(), addresses.collateralVault.toBase58());
  assert.equal(ix.keys[7].pubkey.toBase58(), addresses.yesMint.toBase58());
  assert.equal(ix.keys[8].pubkey.toBase58(), addresses.noMint.toBase58());
  assert.equal(ix.keys[9].pubkey.toBase58(), addresses.yesReserveVault.toBase58());
  assert.equal(ix.keys[10].pubkey.toBase58(), addresses.noReserveVault.toBase58());
  assert.equal(ix.keys[11].pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(ix.keys[12].pubkey.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(ix.data.length, 8 + 32 + 32 + 32 + 8 + 8);
});

run("invalid certified market schedules are rejected before transaction build", () => {
  assert.throws(() =>
    buildCreateCertifiedMarketInstruction({
      authority,
      collateralMint: USDG_DEVNET_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      marketSeed,
      questionHash: question,
      metadataHash: metadata,
      closeTs: 200n,
      resolutionTs: 199n,
    }),
  );
});

run("liquidity and trade builders share the exact derived market accounts", () => {
  const addresses = deriveMarketAddresses(marketSeed);
  const userCollateral = Keypair.generate().publicKey;
  const userYes = Keypair.generate().publicKey;
  const userNo = Keypair.generate().publicKey;

  const liquidityIx = buildAddLiquidityInstruction({
    authority,
    collateralMint: USDG_DEVNET_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    marketSeed,
    userCollateral,
    userYes,
    userNo,
    amount: 10_000_000n,
  });
  assert.equal(liquidityIx.keys[2].pubkey.toBase58(), addresses.market.toBase58());
  assert.equal(liquidityIx.keys[6].pubkey.toBase58(), addresses.collateralVault.toBase58());
  assert.equal(liquidityIx.keys[9].pubkey.toBase58(), addresses.yesReserveVault.toBase58());
  assert.equal(liquidityIx.keys[10].pubkey.toBase58(), addresses.noReserveVault.toBase58());

  const tradeIx = buildTradeInstruction({
    authority,
    collateralMint: USDG_DEVNET_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    marketSeed,
    userCollateral,
    userYes,
    userNo,
    side: "YES",
    direction: "BUY",
    amountIn: 1_000_000n,
    minAmountOut: 1n,
  });
  assert.equal(tradeIx.keys[2].pubkey.toBase58(), addresses.market.toBase58());
  assert.equal(
    tradeIx.data.subarray(0, 8).toString("hex"),
    instructionDiscriminator("buy_yes").toString("hex"),
  );
});

run("close and resolution proposal builders address the same market", () => {
  const addresses = deriveMarketAddresses(marketSeed);
  const closeIx = buildCloseMarketInstruction({ caller: authority, marketSeed });
  assert.equal(closeIx.keys[2].pubkey.toBase58(), addresses.market.toBase58());

  const proposerCollateral = Keypair.generate().publicKey;
  const proposalIx = buildProposeResolutionInstruction({
    proposer: authority,
    marketSeed,
    collateralMint: USDG_DEVNET_MINT,
    proposerCollateral,
    tokenProgram: TOKEN_PROGRAM_ID,
    outcome: "YES",
    evidenceHash: hash32("evidence"),
    sourceHash: hash32("source"),
    observationHash: hash32("observation"),
  });
  assert.equal(proposalIx.keys[3].pubkey.toBase58(), addresses.market.toBase58());
  assert.equal(
    proposalIx.data.subarray(0, 8).toString("hex"),
    instructionDiscriminator("propose_resolution").toString("hex"),
  );
  assert.equal(proposalIx.data[8], 1);
});

console.log("MILESTONE 10 TRANSACTION SDK TESTS: PASS");
