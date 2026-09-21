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

BALANCE="$(solana balance --lamports | awk '{print $1}')"
MIN_LAMPORTS=5000000000
if [ "$BALANCE" -lt "$MIN_LAMPORTS" ]; then
  echo "Funding Devnet wallet (target: at least 5 DEVNET SOL)..."
  for _ in 1 2 3; do
    solana airdrop 2 --url devnet || true
    sleep 3
    BALANCE="$(solana balance --lamports | awk '{print $1}')"
    if [ "$BALANCE" -ge "$MIN_LAMPORTS" ]; then break; fi
  done
fi

echo "Deployer: $(solana address)"
echo "Balance: $(solana balance)"

BALANCE="$(solana balance --lamports | awk '{print $1}')"
if [ "$BALANCE" -lt "$MIN_LAMPORTS" ]; then
  echo
  echo "ERROR: Mary Jane deployment wallet needs at least 5 DEVNET SOL before deployment."
  echo "Address: $(solana address)"
  echo "Use the official Devnet faucet if CLI airdrops are rate-limited:"
  echo "https://faucet.solana.com/"
  exit 1
fi

cd "$ROOT_DIR/solana"
npm install

mkdir -p target/deploy
PROGRAM_KEYPAIR="target/deploy/milady_market-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  solana-keygen new --no-bip39-passphrase --outfile "$PROGRAM_KEYPAIR"
fi

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
cd "$ROOT_DIR"
node scripts/sync-program-id.mjs "$PROGRAM_ID"

cd "$ROOT_DIR/solana"
echo "Building Mary Jane program $PROGRAM_ID..."
anchor build

echo "Deploying/upgrading Mary Jane on Solana Devnet (IDL upload disabled)..."
if ! anchor program deploy --provider.cluster devnet --no-idl; then
  echo "Anchor program deploy did not complete; falling back to Solana CLI deployment..."
  solana program deploy \
    target/deploy/milady_market.so \
    --program-id target/deploy/milady_market-keypair.json \
    --url devnet
fi

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
