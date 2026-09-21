# 33milady Solana Prediction Market Core

This workspace contains the Milestones 1–10 implementation of the 33milady prediction-market protocol.

## Status

### Milestone 1 — Foundation
- Anchor 1.2.0 workspace
- Solana 3.x toolchain target
- deterministic ProtocolConfig and Market PDAs
- protocol pause control
- checked integer arithmetic
- official Paxos USDG Solana Devnet mint:
  `4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7`

### Milestone 2 — Permissionless binary market factory
- permissionless market creation
- immutable question + metadata hashes
- USDG collateral vault
- PDA-controlled YES and NO mints
- PDA-controlled YES and NO AMM reserve vaults
- explicit market close/resolution timestamps
- market creation events

### Milestone 3 — Complete sets + AMM + liquidity
- split USDG into one YES + one NO complete set
- merge one YES + one NO back into one USDG unit
- constant-product binary prediction AMM
- buy YES / buy NO
- sell YES / sell NO
- trading fees retained as excess collateral
- minimum-output slippage checks
- proportional LP share accounting
- reserve-ratio-preserving liquidity additions
- LP withdrawal with automatic complete-set merge plus residual outcome tokens
- Rust math tests and matching TypeScript quote SDK

### Milestone 4 — Escrowed onchain limit orders
- BUY and SELL limit orders for YES or NO
- prices represented as 1–9,999 basis points
- BUY orders escrow collateral
- SELL orders escrow outcome shares
- deterministic order PDA per maker / market / nonce
- dedicated PDA-controlled order vault
- partial fills
- overfill prevention
- maker cancellation
- automatic escrow return on cancellation
- quote volume accounted into market volume
- matching TypeScript order quote + PDA helpers

The order book is deliberately account-per-order rather than an unbounded vector stored inside the market. That keeps Solana compute and account growth bounded.

### Milestone 5 — Bonded optimistic resolution
- permissionless market close after expiry
- separate resolution configuration PDA
- bonded resolution proposal
- evidence hash
- source hash
- oracle/observation hash
- configurable challenge window
- larger dispute bond
- challenger evidence hash
- adjudicator escalation path
- final YES / NO / INVALID outcome
- bond payout to the winning resolution party
- stalled-dispute timeout that returns both bonds and marks the market INVALID
- INVALID maps to the market Cancelled state for refund handling in Milestone 6

The resolution layer intentionally stores hashes rather than large evidence payloads. Full evidence can live in indexed metadata/IPFS/Arweave while the onchain state commits to exactly what was used.

### Milestone 6 — Settlement, redemption, refunds + Portfolio data
- winning YES or NO shares redeem 1:1 into USDG after final resolution
- winning shares are burned atomically before collateral leaves the market vault
- repeated claims fail naturally because the user's winning token balance is consumed
- cancelled/INVALID markets refund YES and NO shares at 0.5 USDG per share
- settlement never depends on the protocol pause flag, so users can still exit resolved markets during an emergency pause
- explicit collateral-vault solvency guard before payout
- per-user / per-market SettlementReceipt PDA
- cumulative winning tokens burned
- cumulative invalid YES/NO shares burned
- cumulative collateral paid
- last settlement timestamp
- deterministic Portfolio SDK helpers for settlement receipt addresses
- Portfolio claimability helper for RESOLVED_YES / RESOLVED_NO / CANCELLED / unresolved states
- SDK tests for winner claims, invalid-market refunds and receipt PDA determinism

The outcome-token burn is the primary double-claim protection. SettlementReceipt is an audit/Portfolio record, not a trusted flag controlling whether a claim is allowed.

### Milestone 7 — 33 Beta fast UP/DOWN markets
- separate 33 Beta configuration PDA
- configurable authorized oracle signer
- independent Beta pause switch
- 5-minute, 10-minute, 15-minute and 60-minute round presets
- deterministic round PDA by asset hash + round id
- dedicated USDG vault per round
- oracle-attested opening price + observation hash
- configurable pre-expiry lock buffer
- permissionless time-based round locking
- UP and DOWN USDG positions
- stake-time protocol fee isolation
- pari-mutuel probability from live UP/DOWN pools
- projected payout math in the SDK
- oracle-attested closing price + observation hash
- automatic UP / DOWN / PUSH determination
- equal-price PUSH handling
- no-winning-liquidity PUSH fallback so funds cannot become ownerless
- pro-rata winner claims
- one-time BetaPosition claim protection
- protocol-fee sweep separated from user payout obligations
- TypeScript helpers for Beta config/round/vault/position PDAs
- SDK tests for probabilities, payouts, outcomes, entry quotes and deterministic addresses

33 Beta intentionally uses pari-mutuel pools rather than duplicating the main market AMM. That keeps short rounds cheap and simple while the main 33milady Markets surface retains AMM + limit-order price discovery.

### 33 Beta browser surface
The web app now exposes a dedicated `/33-beta` surface backed by Solana Devnet rather than hard-coded market fixtures.

Server endpoints:
- `GET /api/33-beta/rounds` — reads and decodes live BetaRound accounts from the program
- `GET /api/33-beta/position?round=&wallet=` — reads the wallet's BetaPosition PDA
- `POST /api/33-beta/enter-transaction` — builds an unsigned real Solana entry transaction for the connected wallet
- `POST /api/33-beta/claim-transaction` — builds an unsigned real claim transaction

The browser:
- connects an injected Solana wallet
- lists real Devnet rounds
- shows opening/closing oracle prices, countdown and round state
- shows live UP/DOWN pool probability
- calculates projected pari-mutuel payout
- signs and submits real UP/DOWN entry transactions
- reads the wallet's actual position PDA
- claims settled winnings
- links each round to Solana Explorer
- shows an explicit "no rounds yet" state when the program/keeper has not opened a market

No fake market data is used to make the Beta page look active.

### 33 Beta automatic Pyth keeper
`solana/scripts/beta-keeper.ts` automates the objective crypto rounds.

It:
- fetches current Pyth Core prices with `@pythnetwork/hermes-client`
- uses the upgraded Hermes endpoint and keeps `PYTH_API_KEY` server-side
- opens new configured 5/10/15/60-minute rounds when no active round exists
- records the Pyth price, exponent, publish timestamp and a deterministic observation hash
- permissionlessly locks rounds when the lock timestamp arrives
- settles expired rounds from a fresh post-close Pyth observation
- never opens/settles a round if the configured feed has no current Pyth update

Required environment:

```bash
export PYTH_API_KEY="..."
export BETA_ORACLE_KEYPAIR="~/.config/solana/id.json"
export BETA_FEEDS_JSON='[
  {
    "symbol": "BTC/USD",
    "priceId": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    "durations": [300, 600, 900, 3600]
  },
  {
    "symbol": "ETH/USD",
    "priceId": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    "durations": [300, 600, 900, 3600]
  }
]'
```

Initialize the Beta config once after the base protocol config is deployed:

```bash
npm run beta:init
```

Run one reconciliation pass:

```bash
npm run beta:tick
```

Or run the keeper loop:

```bash
npm run beta:keeper
```

The keeper key is never committed to the repository. The default upgraded Hermes endpoint is `https://pyth.dourolabs.app/hermes`; production deployments should inject the Pyth API key through server/worker secrets.

### Milestone 8 — Indexer, analytics, discovery, charts + realtime SDK
33milady now has a persistent Solana data plane in `src/lib/marketIndexer.ts`.

Indexer behavior:
- scans program-owned Market and BetaRound accounts
- decodes Anchor account layouts directly from discriminator + Borsh-compatible bytes
- tracks collateral-vault balances from token accounts
- incrementally backfills program transaction signatures
- decodes key Anchor events from `Program data:` logs
- stores a bounded persistent event ledger in `data/market-index.json`
- records probability/reserve/volume snapshots for chart history
- subscribes to program-account changes and program logs for realtime updates
- retains polling as a recovery/fallback path
- computes protocol analytics from indexed state + events
- deduplicates events by transaction signature + log ordinal

Indexed events currently include:
- MarketCreated
- TradeExecuted
- LiquidityAdded / LiquidityRemoved
- LimitOrderFilled
- ResolutionFinalized
- WinningsRedeemed
- InvalidMarketRefunded
- BetaRoundOpened
- BetaPositionEntered
- BetaRoundSettled
- BetaRoundClaimed

REST API:
- `GET /api/v1/indexer/status`
- `GET /api/v1/analytics/protocol`
- `GET /api/v1/markets?q=&status=&sort=&limit=&offset=`
- `GET /api/v1/markets/:address`
- `GET /api/v1/markets/:address/chart?range=1h|24h|7d|30d|all`
- `GET /api/v1/beta/rounds`
- `GET /api/v1/beta/:address/chart`
- `GET /api/v1/events?market=&round=&type=&limit=`
- `POST /api/v1/indexer/sync` when `INDEXER_ADMIN_TOKEN` is configured

Realtime:
- WebSocket: `/ws/markets`
- SSE fallback: `/api/v1/stream`

Realtime messages include:
- market account updates
- Beta round updates
- indexed events
- analytics snapshots
- sync/error state

SDK:
- `MiladyDataClient` in `solana/sdk/src/dataClient.ts`
- market discovery
- market detail
- chart history
- Beta history
- analytics
- recent events
- realtime WebSocket subscription
- injectable fetch/WebSocket transports for server, browser and tests

Browser:
- `/markets` and `/analytics`
- protocol KPI cards
- market search/status filters
- volume/liquidity/newest/ending sort modes
- selected-market probability history
- live indexed event tape
- recent 33 Beta activity
- Solana Explorer links
- automatic refresh from the WebSocket stream
- explicit empty states when no onchain markets are indexed

Runtime tuning:
```bash
export MARKET_INDEXER_POLL_MS=5000
export MARKET_INDEXER_SIGNATURES_PER_SYNC=200
export MARKET_INDEXER_MAX_EVENTS=10000
export MARKET_INDEXER_MAX_SNAPSHOTS=5000
export INDEXER_ADMIN_TOKEN="optional-secret-for-manual-sync"
```

The indexer writes only derived public-chain data. It does not hold user wallet keys or sign trading transactions.

## Important invariant

For each unit of collateral converted into outcome exposure, the protocol creates an equal YES/NO complete set. One complete set is always redeemable back into one collateral unit before resolution. Fees are never represented as new outcome liabilities.

## Workspace

```
solana/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/
│   └── milady_market/
│       ├── Cargo.toml
│       └── src/
│           ├── beta.rs
│           ├── lib.rs
│           ├── orders.rs
│           ├── resolution.rs
│           └── settlement.rs
├── sdk/
│   └── src/index.ts
└── tests/
    └── math.spec.ts
```

## Local setup

```bash
cd solana
pnpm install

# Anchor 1.2.0 and Solana/Agave 3.x
avm install 1.2.0
avm use 1.2.0

anchor keys sync
anchor build
pnpm test
```

`anchor keys sync` is mandatory after the first local build because Anchor generates the real deployment keypair. Commit the resulting program-id change only after the keypair is intentionally selected for the project.

## Devnet

The configured collateral is USDG on Solana Devnet. Do not use mainnet USDG while testing.

The first live end-to-end Devnet run should:

1. initialize ProtocolConfig with USDG and a fee,
2. initialize ResolutionConfig with proposal/dispute bonds and windows,
3. create a binary market,
4. create user USDG/YES/NO token accounts,
5. seed initial AMM liquidity,
6. execute YES and NO buys/sells,
7. split and merge a complete set,
8. place, partially fill and cancel a limit order,
9. close the market after expiry,
10. propose a bonded outcome,
11. test both uncontested and disputed finalization paths,
12. redeem winning shares into USDG,
13. run an INVALID-market refund path,
14. verify the SettlementReceipt PDA and wallet claimability summary,
15. verify vault balances against outstanding outcome liabilities and protocol fees,
16. initialize BetaConfig with a Devnet oracle signer,
17. open a 5-minute Beta round with an opening-price observation,
18. enter USDG on both UP and DOWN from separate wallets,
19. lock the round, submit a closing-price observation and settle,
20. claim the winning Beta position and sweep only isolated protocol fees.


### Milestone 9 — MarketLint certification + security hardening

MarketLint is now part of the market-creation trust boundary.

Flow:

    draft
      ↓
    POST /api/v1/marketlint/analyze
      ↓
    MarketLint report + deterministic market spec
      ↓
    protected MarketLint attestor
      ↓
    MarketLintCertification PDA
      ↓
    create_market()
      ↓
    certification consumed atomically
      ↓
    market opens

A certification binds:
- creator
- active MarketLint attestor
- market seed
- question hash
- metadata hash
- compiled spec hash
- MarketLint report hash
- resolution source hash
- exact close timestamp
- exact resolution timestamp
- score/verdict metrics
- issue time + expiry

The market factory rejects:
- wrong creator
- changed question or metadata
- expired certification
- replayed certification
- certification from a rotated/obsolete attestor
- changed close or resolution timestamps
- low score
- excessive duplicate probability
- weak resolution clarity
- non-GREEN verdict when required

MarketLint service:
- preserves the MarketLint-MSH score/verdict schema
- uses the complete live indexed 33milady question-hash set for exact duplicate detection
- uses previous compiled reports for semantic duplicate checks
- generates deterministic versioned market specs
- persists report audit records
- exposes /marketlint browser compiler
- keeps the attestor signer server-side
- requires MARKETLINT_CERTIFY_TOKEN + MARKETLINT_ATTESTOR_KEYPAIR for certification

Initialize on Devnet:

    export MARKETLINT_ADMIN_KEYPAIR=~/.config/solana/id.json
    export MARKETLINT_ATTESTOR_KEYPAIR=/secure/marketlint-attestor.json
    npm run marketlint:init

Security gates:
- TypeScript economic invariant fuzzing
- Rust economic property tests
- MarketLint compiler/hash tests
- certification PDA/threshold SDK tests
- failed-transaction filtering in the realtime indexer
- security threat model in SECURITY.md
- CI enforcement for all of the above

The MarketLint intelligence layer is not a market resolver. Outcome consensus remains in the explicit oracle/source + bonded resolution/dispute layer.


### Milestone 10 — Devnet launch, transaction SDK + complete lifecycle demo

Milestone 10 turns the protocol checklist into executable launch infrastructure.

#### Production transaction SDK
`solana/sdk/src/transactions.ts` now builds deterministic Anchor instructions for:
- ProtocolConfig initialization
- ResolutionConfig initialization
- MarketLint-certified market creation
- initial AMM liquidity
- YES / NO buy and sell transactions
- permissionless market close
- bonded resolution proposal
- uncontested finalization
- winning-token redemption

The SDK preserves the exact account order defined by the Anchor program and derives the same Market / vault / mint / LP / resolution PDAs used onchain.

#### Live creation surface
The web app now exposes:

- `/create` — connect an injected Solana wallet, run MarketLint, request server-side certification, sign the real `create_market` transaction, then seed initial USDG liquidity
- `/launch` — Devnet readiness console showing which required program/config/key components are actually available

No fake successful launch state is shown when the program, USDG mint, ProtocolConfig, ResolutionConfig, MarketLintConfig, or attestor is missing.

#### Server transaction API

New endpoints:

- `GET /api/v1/launch/readiness`
- `POST /api/v1/markets/prepare-create`
- `POST /api/v1/markets/seed-liquidity-transaction`
- `POST /api/v1/markets/trade-transaction`
- `POST /api/v1/markets/close-transaction`
- `POST /api/v1/markets/propose-resolution-transaction`
- `POST /api/v1/markets/finalize-transaction`
- `POST /api/v1/markets/redeem-transaction`

These endpoints build unsigned Solana transactions for the user's wallet. User wallet keys never enter the 33milady server.

MarketLint certification remains server-signed. Public certification is disabled by default. A controlled Devnet demo can enable `MARKETLINT_PUBLIC_CERTIFY=true`; unauthenticated public certification is rate-limited. Operator/E2E calls can authenticate with `MARKETLINT_CERTIFY_TOKEN`.

#### Semantic duplicate fix

Draft analysis records no longer make the same draft look like its own duplicate.

Only MarketLint reports that have actually received an onchain certification contribute to the previous-report semantic duplicate check. Indexed onchain markets remain the authoritative exact-duplicate set.

#### Devnet readiness

CLI:

    npm run launch:readiness

It verifies:
- executable 33milady program
- USDG Devnet mint
- ProtocolConfig
- ResolutionConfig
- MarketLintConfig
- readable MarketLint attestor key
- optional BetaConfig
- optional Beta oracle key
- optional Pyth API key

#### Resumable real E2E runner

`solana/scripts/devnet-e2e.ts` executes the real lifecycle in explicit phases and stores transaction signatures in a local manifest.

Commands:

    npm run e2e:devnet -- status
    npm run e2e:devnet -- create
    npm run e2e:devnet -- seed
    npm run e2e:devnet -- trade

After the real market close timestamp:

    npm run e2e:devnet -- close
    npm run e2e:devnet -- propose

After the real challenge window:

    npm run e2e:devnet -- finalize
    npm run e2e:devnet -- redeem

The runner deliberately does not bypass or simulate onchain time. It checkpoints after every submitted transaction so a demo can be resumed safely after the market and challenge windows elapse.

Required:

    export E2E_WALLET_KEYPAIR=~/.config/solana/id.json
    export MILADY_SERVER_URL=http://localhost:3000

If public certification is disabled:

    export MARKETLINT_CERTIFY_TOKEN="..."

The E2E wallet must already hold enough Devnet SOL for transaction fees and enough Devnet USDG for liquidity, trades, and resolution bonds.

#### Final acceptance path

A complete launch demonstration is now:

1. `npm run launch:readiness`
2. open `/create`
3. compile a market with MarketLint
4. certify the exact market spec
5. sign and submit `create_market`
6. seed initial USDG liquidity
7. submit real YES / NO trades
8. verify discovery/indexer activity in `/markets`
9. close after the real market deadline
10. propose the evidence-backed outcome
11. wait for the actual challenge window
12. finalize
13. redeem winning shares
14. verify SettlementReceipt and indexed settlement event

Milestone 10 completes the build surface. A third-party audit and a production-grade external rate limiter / durable queue are still required before mainnet operation.
