# 33milady Security Model

Milestone 9 makes security checks part of the protocol workflow rather than a release-only checklist.

## Trust boundaries

### Solana program
The program is the source of truth for:
- collateral custody
- outcome-token mint/burn authority
- AMM reserve accounting
- limit-order escrow
- market lifecycle
- bonded resolution/disputes
- settlement/redemption
- 33 Beta round accounting
- MarketLint certification consumption

### MarketLint
MarketLint is advisory intelligence plus a signed certification gate.

It does not decide a market outcome and it is not a consensus oracle.

A certification is only a statement that a specific creator, active attestor, market seed, question hash, metadata hash, compiled spec hash, MarketLint report hash, resolution source hash, close timestamp, and resolution timestamp passed the configured publication policy at a specific time.

### Oracle/resolution layer
Objective external facts are still resolved through explicit source/oracle observations and the bonded challenge/finalization system.

## MarketLint certification invariants

A market cannot consume a certification unless:

1. MarketLint config is enabled.
2. The certification was signed by the configured attestor.
3. Certification creator equals transaction creator.
4. Market seed matches exactly.
5. Question hash matches exactly.
6. Metadata hash matches exactly.
7. Close timestamp matches exactly.
8. Resolution timestamp matches exactly.
9. Certification attestor is still the active configured attestor.
10. Certification is not expired.
11. Certification has not previously been consumed.
12. Overall score meets the configured minimum.
13. Duplicate probability is at or below the configured maximum.
14. Resolution clarity meets the configured minimum.
15. GREEN verdict is present when require_green is enabled.

The score/duplicate/clarity/verdict policy is enforced once when the certification is issued and again when the market consumes it.

The certification is marked consumed and permanently linked to the created market in the same instruction.

## Key security properties

### Collateral
- Complete-set collateral is never created from nothing.
- Winner settlement checks vault solvency before transfer.
- Winning shares are burned before payout.
- INVALID refunds burn outcome shares before payout.
- 33 Beta protocol fees are isolated from user payout obligations.

### AMM
- Checked integer arithmetic is used.
- Buy math preserves or increases constant-product k.
- Sell output cannot exceed opposite reserve.
- Slippage protection is enforced on user trades.
- Fee basis points are protocol bounded.

### Limit orders
- BUY orders escrow collateral.
- SELL orders escrow outcome tokens.
- Escrow authority is the deterministic order PDA.
- Partial fills cannot exceed remaining shares.
- Cancellation returns only the order's own remaining escrow.

### Resolution
- Proposal and dispute bonds are explicit.
- Proposer cannot self-dispute.
- Uncontested resolution waits for the full challenge window.
- Disputed markets have a liveness timeout.
- Stalled disputes resolve INVALID rather than trapping funds forever.

### 33 Beta
- Opening/closing oracle observations have freshness bounds.
- Future-dated closing observations are rejected.
- Equal start/end price resolves PUSH.
- A round with no stake on the winning side resolves PUSH.
- Position claims are one-time.

### Indexer
- Failed Solana transactions are ignored.
- Backfilled failed signatures are ignored.
- Indexed events are deduplicated by signature plus ordinal.
- Index data is derived public-chain data only and never controls custody.

## Automated security gates

Run from solana:

    npm test
    npm run security:fuzz
    cargo test -p milady_market --lib
    cargo check --workspace

Run from repository root:

    npm run lint
    npm run test:indexer
    npm run test:marketlint

The deterministic security fuzz suite currently exercises tens of thousands of randomized cases for AMM buy invariants, AMM sell bounds, fee bounds, Beta payout conservation, INVALID refund bounds, and limit-order quote bounds.

Rust property loops separately exercise AMM constant-product preservation, sell reserve bounds, fee bounds, and integer-square-root correctness.

## Coverage-guided fuzzing

Anchor 1.2 supports coverage-guided program fuzzing through anchor fuzz / Crucible.

Before a production deployment, initialize and run a stateful Crucible harness against the built IDL:

    anchor fuzz init milady_market
    anchor fuzz run milady_market protocol --release --stateful --cores 4 --timeout 600

High-value stateful sequences:

1. create → add liquidity → buy/sell → remove liquidity
2. split → trade → merge
3. place order → partial fill → cancel
4. close → propose → dispute → finalize
5. resolve → redeem repeated attempts
6. INVALID → partial refund repeated attempts
7. Beta open → multi-user enter → lock → settle → multi-user claim
8. MarketLint certify → mutate one hash → create attempt
9. MarketLint certify → consume → replay create attempt
10. expired certification → create attempt

## Operational key separation

Use separate keys for:
- protocol upgrade authority
- protocol configuration authority
- MarketLint attestor
- Beta oracle keeper
- dispute adjudicator

Do not commit any of these keys.

Recommended server secrets:
- MARKETLINT_ATTESTOR_KEYPAIR
- MARKETLINT_CERTIFY_TOKEN
- BETA_ORACLE_KEYPAIR
- PYTH_API_KEY
- INDEXER_ADMIN_TOKEN

## Non-goals

The current code has not yet received an independent third-party audit.

Passing CI, deterministic fuzzing, Rust property tests and MarketLint certification reduces risk but does not replace independent audit, coverage-guided SBF fuzzing, adversarial local-validator integration tests, upgrade-authority operational review, or incident-response rehearsal.
