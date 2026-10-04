# Shutter Confidential Markets

Mary Jane is the first reference implementation of a reusable confidential-market layer powered by Shutter threshold encryption.

## Scope

The first release provides sealed market intents: the trader's side, action, price, size, and wallet-bound intent are encrypted before submission and become revealable only after a configured Shutter time trigger. The market identifier and the existence/timing of an encrypted commitment may remain public for routing.

Mary Jane remains a Solana settlement application. Shutter is used as the application-layer threshold-encryption and timed-reveal service. V1 intentionally uses time-based triggers because Shutter event triggers currently observe EVM events, not Solana program events.

This is not permanent transaction privacy. It is cryptographic pre-reveal confidentiality / fairness.

## Milestones

1. **Protocol boundary + threat model** — define what is public, encrypted, revealed, and explicitly out of scope.
2. **Shutter adapter** — typed client for identity registration, encryption data, key retrieval, testnet configuration, and errors.
3. **Canonical confidential intent** — chain-neutral payload format, validation, nonce, commitment hash, and replay/expiry rules.
4. **Local Shutter encryption** — integrate the Shutter SDK so plaintext intent never leaves the browser before encryption.
5. **Commitment transport + storage** — submit ciphertext envelopes without persisting plaintext; expose status by commitment hash.
6. **Reveal worker** — obtain the threshold decryption key after the trigger, decrypt, verify the commitment, and mark it revealed.
7. **Settlement adapter interface** — convert a revealed canonical intent into chain-specific execution; Solana is the first adapter.
8. **Mary Jane private-order UX** — "Confidential" order mode, reveal countdown, sealed-order receipt, and lifecycle states.
9. **Fairness verification + tests** — prove ciphertext differs from plaintext, early reveal fails, tampering is rejected, and post-trigger reveal reproduces the exact intent.
10. **Reusable package + grant demo** — extract the adapter/intent lifecycle into a documented module other market apps can integrate; publish architecture, demo flow, evidence, and Mary Jane reference integration.

## Lifecycle

```
Trader
  -> canonical intent
  -> local Shutter encryption
  -> ciphertext commitment
  -> wait for reveal trigger
  -> threshold decryption key becomes available
  -> verify + decrypt
  -> Solana settlement adapter
  -> Mary Jane order/position state
```

## V1 confidentiality boundary

Encrypted:
- trader wallet-bound intent
- YES/NO side
- BUY/SELL action
- limit price
- order size
- nonce / expiry metadata

Public:
- ciphertext
- commitment hash
- reveal timestamp
- Shutter identity/eon metadata
- market ID (V1 routing choice)
- submission timing/network metadata

Out of scope for V1:
- hiding Solana gas payer / transaction metadata after settlement
- permanently private balances
- private market resolution
- Solana-native event-triggered Shutter key release
- anonymity against all network observers

## First implementation

The implementation lives under `src/lib/shutter/` and should remain independent of Mary Jane UI and Solana settlement code. Mary Jane imports it through an adapter, so another market can reuse the same protocol layer without adopting Mary Jane's contracts.
