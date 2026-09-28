#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOYER_KEYPAIR="${ARCIUM_DEPLOYER_KEYPAIR:-$HOME/.config/solana/id.json}"
RPC_URL="${ARCIUM_DEVNET_RPC_URL:-}"

if ! command -v arcium >/dev/null 2>&1; then
  echo "Arcium CLI is missing."
  echo "Install it in WSL/Linux with:"
  echo "  curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash"
  exit 1
fi

if ! command -v solana >/dev/null 2>&1; then
  echo "Solana CLI is missing."
  exit 1
fi

if [[ -z "$RPC_URL" ]]; then
  echo "Set ARCIUM_DEVNET_RPC_URL to a reliable Solana Devnet RPC URL."
  echo "Example:"
  echo "  export ARCIUM_DEVNET_RPC_URL='https://...'"
  exit 1
fi

if [[ ! -f "$DEPLOYER_KEYPAIR" ]]; then
  echo "Deployer keypair not found: $DEPLOYER_KEYPAIR"
  exit 1
fi

PROGRAM_KEYPAIR="target/deploy/maryjane_confidential-keypair.json"
mkdir -p target/deploy

if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  solana-keygen new --no-bip39-passphrase --silent -o "$PROGRAM_KEYPAIR"
fi

PROGRAM_ID="$(solana address -k "$PROGRAM_KEYPAIR")"
echo "Confidential program ID: $PROGRAM_ID"

# Keep source IDs aligned with the deployment keypair without ever committing
# the secret program keypair.
python3 - "$PROGRAM_ID" <<'PY'
from pathlib import Path
import sys
pid=sys.argv[1]
for rel in ["Anchor.toml","programs/maryjane_confidential/src/lib.rs"]:
    p=Path(rel)
    text=p.read_text()
    import re
    if rel=="Anchor.toml":
        text=re.sub(r'(maryjane_confidential\s*=\s*")[^"]+(")', rf'\g<1>{pid}\2', text)
    else:
        text=re.sub(r'declare_id!\("[^"]+"\);', f'declare_id!("{pid}");', text)
    p.write_text(text)
PY

echo "Building Arcium circuits + program..."
arcium build

echo "Deployer SOL balance:"
solana balance -k "$DEPLOYER_KEYPAIR" --url "$RPC_URL"

echo "Deploying MXE to Arcium Devnet cluster 456..."
arcium deploy \
  --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path "$DEPLOYER_KEYPAIR" \
  --program-keypair "$PROGRAM_KEYPAIR" \
  --rpc-url "$RPC_URL"

echo
echo "DEPLOYMENT COMPLETE"
echo "PROGRAM_ID=$PROGRAM_ID"
echo "CLUSTER_OFFSET=456"
echo
echo "Next: commit the synced public program ID files, initialize computation definitions, and set:"
echo "  VITE_CONFIDENTIAL_MARKETS=true"
echo "  VITE_ARCIUM_PROGRAM_ID=$PROGRAM_ID"
echo "  VITE_ARCIUM_CLUSTER_OFFSET=456"
