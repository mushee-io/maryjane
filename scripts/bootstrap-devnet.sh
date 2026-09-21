#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Mary Jane Devnet Bootstrap =="

if ! command -v solana >/dev/null 2>&1 || ! command -v anchor >/dev/null 2>&1; then
  echo "Installing the official Solana/Anchor toolchain..."
  curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
fi

echo "Toolchain:"
rustc --version
solana --version
anchor --version
node --version

if [ ! -d .git ]; then
  echo "This script must run inside the Mary Jane Git repository."
  exit 1
fi

git pull --ff-only

solana config set --url devnet >/dev/null

WALLET="$HOME/.config/solana/id.json"
if [ ! -f "$WALLET" ]; then
  mkdir -p "$(dirname "$WALLET")"
  solana-keygen new --no-bip39-passphrase --outfile "$WALLET"
fi

solana config set --keypair "$WALLET" >/dev/null

PROGRAM_ID="HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL"
PROGRAM_EXISTS=0
if solana program show "$PROGRAM_ID" --url devnet >/dev/null 2>&1; then
  PROGRAM_EXISTS=1
  echo "Mary Jane program already exists on Devnet: $PROGRAM_ID"
else
  echo "Mary Jane program is not yet executable on Devnet."
fi

echo "Deployer: $(solana address)"
echo "Current balance: $(solana balance)"

cd "$ROOT_DIR/solana"
npm install

mkdir -p target/deploy

# Reclaim any stale upgrade buffer left by a failed prior deployment.
# This does NOT close the deployed Mary Jane program.
UPGRADE_BUFFER_KEYPAIR="target/deploy/milady_market-upgrade-buffer.json"
if [ -f "$UPGRADE_BUFFER_KEYPAIR" ]; then
  UPGRADE_BUFFER_ADDRESS="$(solana-keygen pubkey "$UPGRADE_BUFFER_KEYPAIR" 2>/dev/null || true)"
  if [ -n "$UPGRADE_BUFFER_ADDRESS" ]; then
    if solana account "$UPGRADE_BUFFER_ADDRESS" --url devnet >/dev/null 2>&1; then
      echo "Closing stale upgrade buffer $UPGRADE_BUFFER_ADDRESS to reclaim DEVNET SOL..."
      solana program close "$UPGRADE_BUFFER_ADDRESS" --url devnet || true
      echo "Balance after stale-buffer reclaim: $(solana balance)"
    fi
  fi
  rm -f "$UPGRADE_BUFFER_KEYPAIR"
fi

PROGRAM_KEYPAIR="target/deploy/milady_market-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  solana-keygen new --no-bip39-passphrase --outfile "$PROGRAM_KEYPAIR"
fi

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
cd "$ROOT_DIR"
node scripts/sync-program-id.mjs "$PROGRAM_ID"

cd "$ROOT_DIR/solana"
echo "Building Mary Jane program $PROGRAM_ID for Devnet-compatible sBPF v2..."
anchor build --arch v2

PROGRAM_SO="target/deploy/milady_market.so"
PROGRAM_SIZE="$(wc -c < "$PROGRAM_SO" | tr -d ' ')"
echo "Program binary size: $PROGRAM_SIZE bytes"

RENT_OUTPUT="$(solana rent "$PROGRAM_SIZE" --url devnet)"
echo "$RENT_OUTPUT"
RENT_SOL="$(printf '%s\n' "$RENT_OUTPUT" | awk '/Rent-exempt minimum:/ {print $3}')"
if [ -z "$RENT_SOL" ]; then
  echo "ERROR: Could not determine exact deployment-buffer rent."
  exit 1
fi

# Buffer rent plus a small transaction-fee cushion.
REQUIRED_LAMPORTS="$(node -e 'const rent=Number(process.argv[1]); console.log(Math.ceil((rent + 0.005) * 1e9))' "$RENT_SOL")"
BALANCE_LAMPORTS="$(solana balance --lamports | awk '{print $1}')"

if [ "$BALANCE_LAMPORTS" -lt "$REQUIRED_LAMPORTS" ]; then
  SHORTFALL_LAMPORTS=$((REQUIRED_LAMPORTS - BALANCE_LAMPORTS))
  SHORTFALL_SOL="$(node -e 'console.log((Number(process.argv[1])/1e9).toFixed(9))' "$SHORTFALL_LAMPORTS")"
  echo
  echo "Deployment preflight: wallet is short by only $SHORTFALL_SOL DEVNET SOL."

  # For small shortfalls, try one small faucet request rather than asking for another large airdrop.
  if [ "$SHORTFALL_LAMPORTS" -le 200000000 ]; then
    echo "Trying one 0.1 DEVNET SOL airdrop to cover the small shortfall..."
    solana airdrop 0.1 --url devnet || true
    sleep 3
    BALANCE_LAMPORTS="$(solana balance --lamports | awk '{print $1}')"
  fi
fi

if [ "$BALANCE_LAMPORTS" -lt "$REQUIRED_LAMPORTS" ]; then
  SHORTFALL_LAMPORTS=$((REQUIRED_LAMPORTS - BALANCE_LAMPORTS))
  SHORTFALL_SOL="$(node -e 'console.log((Number(process.argv[1])/1e9).toFixed(9))' "$SHORTFALL_LAMPORTS")"
  echo
  echo "STOP BEFORE DEPLOY: insufficient buffer rent."
  echo "Current balance: $(solana balance)"
  echo "Exact rent: $RENT_SOL DEVNET SOL"
  echo "Remaining shortfall including fee cushion: $SHORTFALL_SOL DEVNET SOL"
  echo "Address: $(solana address)"
  echo
  echo "Do NOT send another 5 SOL. Only cover the printed shortfall, then rerun."
  exit 1
fi

echo "Deploying/upgrading Mary Jane on Solana Devnet (IDL upload disabled)..."
anchor program deploy --provider.cluster devnet --no-idl

echo "Verifying executable program account..."
solana program show "$PROGRAM_ID" --url devnet

echo "Publishing Anchor IDL separately (non-blocking)..."
anchor idl init -f target/idl/milady_market.json "$PROGRAM_ID" || \
  echo "IDL publication skipped/failed; program deployment remains valid."

echo "Initializing onchain configuration..."
npm run init:devnet

echo "Checking launch readiness..."
npm run launch:readiness || true

cd "$ROOT_DIR"
echo
echo "Program deployed: $PROGRAM_ID"
echo "Generated Vercel env: $ROOT_DIR/Mary-Jane-Vercel.generated.env"
echo
echo "Syncing the real program ID back to GitHub so Vercel gets it..."
git add server.ts solana/Anchor.toml solana/programs/milady_market/src/lib.rs solana/sdk/src/index.ts solana/scripts/marketlint-init.ts solana/scripts/beta-keeper.ts
if ! git diff --cached --quiet; then
  git commit -m "chore: sync deployed Mary Jane program id $PROGRAM_ID"
  git push origin main
fi

echo
echo "MARY JANE DEVNET BOOTSTRAP COMPLETE"
echo "Next: import Mary-Jane-Vercel.generated.env into the Vercel project, then redeploy."
