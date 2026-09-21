import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  Transaction,
} from "@solana/web3.js";

type Manifest = {
  marketSeed: string;
  market: string;
  creator: string;
  outcome?: "YES" | "NO";
  reportHash: string;
  closeTs: number;
  resolutionTs: number;
  signatures: Record<string, string>;
};

const server = process.env.MILADY_SERVER_URL || "http://localhost:3000";
const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const manifestPath =
  process.env.E2E_MANIFEST ||
  path.join(process.cwd(), "data", "devnet-e2e-manifest.json");

function loadWallet() {
  const file = process.env.E2E_WALLET_KEYPAIR;
  if (!file) throw new Error("E2E_WALLET_KEYPAIR is required");
  const resolved = file.startsWith("~/")
    ? path.join(process.env.HOME || process.cwd(), file.slice(2))
    : file;
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadManifest(): Manifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}. Run create first.`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
}

function saveManifest(manifest: Manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function api<T>(pathname: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (process.env.MARKETLINT_CERTIFY_TOKEN) {
    headers["x-marketlint-token"] = process.env.MARKETLINT_CERTIFY_TOKEN;
  }
  const response = await fetch(`${server}${pathname}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}

async function submit(
  connection: Connection,
  wallet: Keypair,
  transactionBase64: string,
) {
  const tx = Transaction.from(Buffer.from(transactionBase64, "base64"));
  tx.sign(wallet);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

async function main() {
  const command = process.argv[2] || "status";
  const connection = new Connection(rpc, "confirmed");

  if (command === "status") {
    const readiness = await api<any>("/api/v1/launch/readiness");
    console.log(JSON.stringify(readiness, null, 2));
    return;
  }

  const wallet = loadWallet();

  if (command === "create") {
    const now = Math.floor(Date.now() / 1000);
    const closeTs = now + Number(process.env.E2E_CLOSE_SECS || "300");
    const resolutionTs =
      closeTs + Number(process.env.E2E_RESOLUTION_DELAY_SECS || "0");
    const question =
      process.env.E2E_QUESTION ||
      `Will SOL/USD be above $300 at ${new Date(closeTs * 1000).toISOString()}?`;
    const source = process.env.E2E_SOURCE || "Pyth SOL/USD";
    const payload = await api<any>("/api/v1/markets/prepare-create", {
      wallet: wallet.publicKey.toBase58(),
      input: {
        question,
        description:
          process.env.E2E_DESCRIPTION ||
          "Resolve from the named source at the scheduled close observation; INVALID if the source is unavailable.",
        source,
        category: process.env.E2E_CATEGORY || "Crypto",
        deadline: new Date(closeTs * 1000).toISOString(),
        closeTs,
        resolutionTs,
      },
    });
    const signature = await submit(connection, wallet, payload.transactionBase64);
    const manifest: Manifest = {
      marketSeed: payload.report.hashes.marketSeed,
      market: payload.addresses.market,
      creator: wallet.publicKey.toBase58(),
      reportHash: payload.report.hashes.reportHash,
      closeTs,
      resolutionTs,
      signatures: {
        certification: payload.certificationSignature,
        create: signature,
      },
    };
    saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const manifest = loadManifest();

  if (command === "seed") {
    const amount = BigInt(
      Math.round(Number(process.env.E2E_LIQUIDITY_USDG || "25") * 1_000_000),
    );
    const built = await api<any>("/api/v1/markets/seed-liquidity-transaction", {
      wallet: wallet.publicKey.toBase58(),
      marketSeed: manifest.marketSeed,
      amountBaseUnits: amount.toString(),
    });
    manifest.signatures.seed = await submit(
      connection,
      wallet,
      built.transactionBase64,
    );
    saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (command === "trade") {
    const amount = BigInt(
      Math.round(Number(process.env.E2E_TRADE_USDG || "1") * 1_000_000),
    );
    const built = await api<any>("/api/v1/markets/trade-transaction", {
      wallet: wallet.publicKey.toBase58(),
      marketSeed: manifest.marketSeed,
      side: process.env.E2E_TRADE_SIDE || "YES",
      direction: process.env.E2E_TRADE_DIRECTION || "BUY",
      amountInBaseUnits: amount.toString(),
      minAmountOutBaseUnits: process.env.E2E_MIN_OUT_BASE_UNITS || "1",
    });
    manifest.signatures.trade = await submit(
      connection,
      wallet,
      built.transactionBase64,
    );
    saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (command === "close") {
    const built = await api<any>("/api/v1/markets/close-transaction", {
      wallet: wallet.publicKey.toBase58(),
      marketSeed: manifest.marketSeed,
    });
    manifest.signatures.close = await submit(
      connection,
      wallet,
      built.transactionBase64,
    );
    saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (command === "propose") {
    const outcome = (process.env.E2E_OUTCOME || "YES") as "YES" | "NO";
    const built = await api<any>("/api/v1/markets/propose-resolution-transaction", {
      wallet: wallet.publicKey.toBase58(),
      marketSeed: manifest.marketSeed,
      outcome,
      evidence: process.env.E2E_EVIDENCE || "Devnet E2E evidence",
      source: process.env.E2E_SOURCE || "Pyth SOL/USD",
      observation: process.env.E2E_OBSERVATION || "Devnet E2E observation",
    });
    manifest.outcome = outcome;
    manifest.signatures.propose = await submit(
      connection,
      wallet,
      built.transactionBase64,
    );
    saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (command === "finalize") {
    const built = await api<any>("/api/v1/markets/finalize-transaction", {
      wallet: wallet.publicKey.toBase58(),
      proposer: manifest.creator,
      marketSeed: manifest.marketSeed,
    });
    manifest.signatures.finalize = await submit(
      connection,
      wallet,
      built.transactionBase64,
    );
    saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (command === "redeem") {
    if (!manifest.outcome) throw new Error("Manifest has no final YES/NO outcome");
    const built = await api<any>("/api/v1/markets/redeem-transaction", {
      wallet: wallet.publicKey.toBase58(),
      marketSeed: manifest.marketSeed,
      outcome: manifest.outcome,
      amountBaseUnits: process.env.E2E_REDEEM_BASE_UNITS || "1",
    });
    manifest.signatures.redeem = await submit(
      connection,
      wallet,
      built.transactionBase64,
    );
    saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (command === "open-flow") {
    for (const phase of ["create", "seed", "trade"]) {
      console.log(
        `Run phases individually for deterministic checkpoints: npm run e2e:devnet -- ${phase}`,
      );
    }
    return;
  }

  throw new Error(
    "Unknown command. Use status|create|seed|trade|close|propose|finalize|redeem",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
