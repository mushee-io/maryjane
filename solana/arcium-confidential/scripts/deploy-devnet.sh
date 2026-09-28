#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
ARCIUM_CLUSTER_OFFSET="${ARCIUM_CLUSTER_OFFSET:-456}"

if ! command -v arcium >/dev/null 2>&1; then
  echo "Arcium CLI is required. Install it with arcup first."
  exit 1
fi
if ! command -v anchor >/dev/null 2>&1; then
  echo "Anchor CLI is required."
  exit 1
fi
if ! command -v solana >/dev/null 2>&1; then
  echo "Solana CLI is required."
  exit 1
fi
if [ ! -f "$WALLET" ]; then
  echo "Wallet not found: $WALLET"
  exit 1
fi

echo "[1/7] Solana devnet"
solana config set --url "$RPC_URL" --keypair "$WALLET" >/dev/null
solana balance

echo "[2/7] Build Arcium program + circuits"
arcium build

echo "[3/7] Sync generated program key into source/Anchor.toml"
anchor keys sync
arcium build

PROGRAM_KEYPAIR="$ROOT/target/deploy/maryjane_confidential-keypair.json"
PROGRAM_ID="$(solana address -k "$PROGRAM_KEYPAIR")"
echo "Program ID: $PROGRAM_ID"

echo "[4/7] Deploy confidential program"
anchor deploy --provider.cluster devnet --provider.wallet "$WALLET"

echo "[5/7] Initialize Arcium MXE (cluster offset $ARCIUM_CLUSTER_OFFSET)"
set +e
arcium mxe-info "$PROGRAM_ID" -u "$RPC_URL" >/tmp/maryjane-mxe-info.txt 2>&1
MXE_INFO_CODE=$?
set -e
if [ "$MXE_INFO_CODE" -ne 0 ] || ! grep -qi "active" /tmp/maryjane-mxe-info.txt; then
  arcium init-mxe \
    -k "$WALLET" \
    -p "$PROGRAM_ID" \
    -f "$ARCIUM_CLUSTER_OFFSET" \
    -r 4 \
    -u "$RPC_URL"
else
  echo "MXE already active."
fi

echo "[6/7] Install JS deployment helpers + register circuits"
npm install
ANCHOR_PROVIDER_URL="$RPC_URL" ANCHOR_WALLET="$WALLET" npm run init-comp-defs

echo "[7/7] Verify MXE"
arcium mxe-info "$PROGRAM_ID" -u "$RPC_URL"

echo
echo "Mary Jane confidential rail deployed."
echo "Add these to Vercel:"
echo "VITE_CONFIDENTIAL_MARKETS=true"
echo "VITE_ARCIUM_PROGRAM_ID=$PROGRAM_ID"
echo "VITE_ARCIUM_CLUSTER_OFFSET=$ARCIUM_CLUSTER_OFFSET"
echo "VITE_SOLANA_RPC_URL=$RPC_URL"
