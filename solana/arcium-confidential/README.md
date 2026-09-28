# Mary Jane Confidential Prediction Markets — Arcium Beta

This directory is a **separate confidential-compute rail** for the existing Mary Jane prediction market. It does not replace or mutate the deployed public `milady_market` program.

## What v1 is designed to keep private

Client-side plaintext is encrypted against the Arcium MXE before it leaves the browser:

- YES / NO side
- BUY / SELL direction
- limit price
- order size

The Arcium circuit stores only encrypted aggregate state and can reveal a public aggregate YES probability snapshot.

## What stays public

The current direct-wallet design still exposes:

- the Mary Jane public market address/question
- the wallet that signs the Arcium transaction
- transaction timing, compute fees and the existence of a computation
- aggregate YES/NO pressure when a snapshot is intentionally revealed

## What is **not private yet**

Do not describe these as private until the next settlement milestone is implemented:

- USDG token-account balance
- YES/NO SPL outcome-token balances
- collateral movement
- settlement/redemption
- sender identity
- full private order matching/fills

Standard SPL token accounts are public. Encrypting an order intent does not magically make those balances private.

## Architecture

```
Mary Jane public market
        |
        +-- Public mode --------> existing order-place / order-fill flow (unchanged)
        |
        +-- Confidential mode
              |
              +-- browser: @arcium-hq/client
              |      X25519 -> shared secret -> RescueCipher
              |      encrypt(side, kind, price_bps, shares)
              |
              +-- maryjane_confidential Anchor program
              |      submit_private_order()
              |      queue_computation()
              |
              +-- Arcium MPC
                     apply_private_order()
                     encrypted aggregate state
                     |
                     +--> reveal_aggregate()
                          public YES probability only
```

## Source layout

- `encrypted-ixs/src/lib.rs` — Arcis circuits
- `programs/maryjane_confidential/src/lib.rs` — Anchor + Arcium queue/callback program
- `../../src/lib/confidentialOrders.ts` — browser-side Arcium encryption adapter
- `../../src/components/NativeMarketTerminal.tsx` — feature-gated Public / Confidential UI

The confidential project is intentionally in its own nested Cargo workspace so the existing Mary Jane Solana CI/build remains untouched.

## Feature flags

The main app remains public-only unless explicitly enabled:

```env
VITE_CONFIDENTIAL_MARKETS=true
VITE_ARCIUM_PROGRAM_ID=<deployed maryjane_confidential program id>
VITE_ARCIUM_CLUSTER_OFFSET=<Arcium cluster offset>
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
```

If the Arcium program ID or cluster offset is absent, the UI accurately reports that the rail is coded but not deployed/configured.

## Deployment sequence

Use the Arcium CLI/toolchain that matches the pinned v0.13.2 program dependencies.

1. Build the encrypted instructions / `.arcis` circuits.
2. Build and deploy `maryjane_confidential`.
3. Replace the placeholder program ID in `Anchor.toml` and `declare_id!` with the deployed keypair's program ID.
4. Initialize the MXE.
5. Initialize and upload the three computation definitions:
   - `init_confidential_state`
   - `apply_private_order`
   - `reveal_aggregate`
6. Set the Vercel feature flags above.
7. Create a confidential state PDA for each Mary Jane public market that should accept private orders.
8. Wire the generated IDL into the browser submit step so encrypted envelopes are queued directly to `submit_private_order`.
9. Refresh aggregate snapshots periodically or after a batch of confidential orders.

## Current honest status

Implemented:

- Arcium TypeScript dependency
- browser X25519 + RescueCipher encryption
- no plaintext order fields persisted by the confidential adapter
- feature-gated confidential order UI inside the existing prediction terminal
- Arcis encrypted aggregate-state circuit
- Anchor/Arcium queue + callback program source
- public aggregate snapshot design
- explicit privacy-boundary disclosure

Still required before calling a confidential order **live on Devnet**:

- deploy the separate Arcium program/MXE
- upload computation definitions
- generate the deployed IDL
- connect the browser encrypted envelope to the deployed `submit_private_order` instruction
- add confidential collateral + settlement if private balances/positions are desired

That separation is intentional: Mary Jane's working public prediction market stays stable while the privacy rail is brought online independently.
