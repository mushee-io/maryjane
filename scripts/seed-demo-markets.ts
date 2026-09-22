import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

type DemoMarket = {
  id: string;
  question: string;
  description: string;
  source: string;
  category: string;
  deadline: string;
  closeAt: string;
  resolutionAt: string;
  yesLabel: string;
  noLabel: string;
  cover: string;
};

const BASE = (process.env.MARY_JANE_BASE_URL || "https://maryjane-blue.vercel.app").replace(/\/$/, "");
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const LIQUIDITY_USDG = Number(process.env.DEMO_LIQUIDITY_USDG || "10");
const INVENTORY_USDG = Number(process.env.DEMO_INVENTORY_USDG || "3");
const ORDER_SHARES = Number(process.env.DEMO_ORDER_SHARES || "1");
const RESEED = process.env.DEMO_RESEED === "true";
const CREATE_ONLY = process.env.DEMO_CREATE_ONLY === "true";
const SKIP_BOOK = process.env.DEMO_SKIP_BOOK === "true";

const DEMOS: DemoMarket[] = [
  {
    id: "sol-300",
    question: "Will SOL/USD close above $300 at 23:59 UTC on 15 October 2026?",
    description: "Resolve YES if the final valid Pyth SOL/USD observation at or before 23:59 UTC on 15 October 2026 is strictly above $300; otherwise resolve NO. Resolve INVALID if the source is unavailable or contradictory.",
    source: "Pyth SOL/USD",
    category: "Crypto",
    deadline: "15 October 2026, 23:59 UTC",
    closeAt: "2026-10-15T23:55:00Z",
    resolutionAt: "2026-10-15T23:59:00Z",
    yesLabel: "Above $300",
    noLabel: "$300 or below",
    cover: "sol",
  },
  {
    id: "btc-150k",
    question: "Will BTC/USD close above $150,000 at 23:59 UTC on 31 October 2026?",
    description: "Resolve YES if the final valid Pyth BTC/USD observation at or before 23:59 UTC on 31 October 2026 is strictly above $150,000; otherwise resolve NO. Resolve INVALID if the source is unavailable or contradictory.",
    source: "Pyth BTC/USD",
    category: "Crypto",
    deadline: "31 October 2026, 23:59 UTC",
    closeAt: "2026-10-31T23:55:00Z",
    resolutionAt: "2026-10-31T23:59:00Z",
    yesLabel: "Above $150K",
    noLabel: "$150K or below",
    cover: "btc",
  },
  {
    id: "eth-6k",
    question: "Will ETH/USD close above $6,000 at 23:59 UTC on 31 October 2026?",
    description: "Resolve YES if the final valid Pyth ETH/USD observation at or before 23:59 UTC on 31 October 2026 is strictly above $6,000; otherwise resolve NO. Resolve INVALID if the source is unavailable or contradictory.",
    source: "Pyth ETH/USD",
    category: "Crypto",
    deadline: "31 October 2026, 23:59 UTC",
    closeAt: "2026-10-31T23:55:00Z",
    resolutionAt: "2026-10-31T23:59:00Z",
    yesLabel: "Above $6K",
    noLabel: "$6K or below",
    cover: "eth",
  },
  {
    id: "nvda-220",
    question: "Will NVIDIA close above $220 on 30 October 2026?",
    description: "Resolve YES if NVIDIA's official regular-session closing price on 30 October 2026 is strictly above $220 according to Nasdaq; otherwise resolve NO. Resolve INVALID if no official closing price is published.",
    source: "Nasdaq official closing price",
    category: "Tech",
    deadline: "30 October 2026, 20:00 UTC",
    closeAt: "2026-10-30T19:55:00Z",
    resolutionAt: "2026-10-30T20:00:00Z",
    yesLabel: "Above $220",
    noLabel: "$220 or below",
    cover: "nvda",
  },
  {
    id: "london-20c",
    question: "Will London Heathrow temperature exceed 20°C on 10 October 2026?",
    description: "Resolve YES if the Met Office official observation for London Heathrow records a temperature strictly above 20°C at any point on 10 October 2026; otherwise resolve NO. Resolve INVALID if the official observation is unavailable.",
    source: "Met Office official observation",
    category: "World",
    deadline: "10 October 2026, 23:59 UTC",
    closeAt: "2026-10-10T00:00:00Z",
    resolutionAt: "2026-10-10T23:59:00Z",
    yesLabel: "Above 20°C",
    noLabel: "20°C or below",
    cover: "weather",
  },
  {
    id: "ucl-final-3goals",
    question: "Will the winning team score more than 2 goals in the 2027 UEFA Champions League final?",
    description: "Resolve YES if the winning team is credited with at least 3 goals in regulation and extra time in UEFA's official match report for the 2027 Champions League final; otherwise resolve NO. Penalty-shootout kicks do not count.",
    source: "UEFA official match report",
    category: "Sports",
    deadline: "31 May 2027, 23:59 UTC",
    closeAt: "2027-05-29T18:00:00Z",
    resolutionAt: "2027-05-31T23:59:00Z",
    yesLabel: "3+ goals",
    noLabel: "0–2 goals",
    cover: "football",
  },
  {
    id: "avatar-2b",
    question: "Will Avatar: Fire and Ash worldwide box office exceed $2 billion by 31 December 2026?",
    description: "Resolve YES if Box Office Mojo reports worldwide cumulative box office strictly above $2,000,000,000 by 23:59 UTC on 31 December 2026; otherwise resolve NO. Resolve INVALID if the source permanently withdraws the figure.",
    source: "Box Office Mojo worldwide box office",
    category: "Culture",
    deadline: "31 December 2026, 23:59 UTC",
    closeAt: "2026-12-31T23:50:00Z",
    resolutionAt: "2026-12-31T23:59:00Z",
    yesLabel: "Above $2B",
    noLabel: "$2B or below",
    cover: "cinema",
  },
];

function expandHome(value: string) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function loadWallet() {
  const file = process.env.DEMO_WALLET_KEYPAIR || process.env.E2E_WALLET_KEYPAIR;
  if (!file) throw new Error("DEMO_WALLET_KEYPAIR or E2E_WALLET_KEYPAIR is required");
  const raw = JSON.parse(fs.readFileSync(expandHome(file), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function unix(value: string) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("Invalid date: " + value);
  return Math.floor(ms / 1000);
}

function baseUnits(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Amount must be positive");
  return String(Math.round(value * 1_000_000));
}

async function api<T>(pathname: string, body: unknown): Promise<T> {
  const response = await fetch(BASE + pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    throw new Error(pathname + " HTTP " + response.status + ": " + (data?.error || text.slice(0, 300)));
  }
  return data as T;
}

async function submit(
  connection: Connection,
  wallet: Keypair,
  built: { transactionBase64: string; lastValidBlockHeight?: number },
) {
  const tx = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  tx.sign(wallet);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  if (tx.recentBlockhash && built.lastValidBlockHeight) {
    const result = await connection.confirmTransaction({
      signature,
      blockhash: tx.recentBlockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    }, "confirmed");
    if (result.value.err) throw new Error("Solana transaction failed: " + JSON.stringify(result.value.err));
  } else {
    await connection.confirmTransaction(signature, "confirmed");
  }
  return signature;
}

async function main() {
  const selected = new Set(process.argv.slice(2));
  const demos = selected.size ? DEMOS.filter((market) => selected.has(market.id)) : DEMOS;
  if (!demos.length) throw new Error("No demo market IDs matched");

  const wallet = loadWallet();
  const connection = new Connection(RPC, "confirmed");
  const now = Math.floor(Date.now() / 1000);
  const summary: any[] = [];

  console.log("Mary Jane demo seeder");
  console.log("Base: " + BASE);
  console.log("Wallet: " + wallet.publicKey.toBase58());
  console.log("Markets: " + demos.length);

  for (const demo of demos) {
    const closeTs = unix(demo.closeAt);
    const resolutionTs = unix(demo.resolutionAt);
    if (closeTs <= now) {
      console.log("SKIP " + demo.id + ": close time is already in the past");
      continue;
    }

    const metadataUrl = BASE + "/demo/metadata/" + demo.id + ".json";
    const coverImageUrl = BASE + "/demo/" + demo.cover + ".svg";
    const yesImageUrl = BASE + "/demo/up.svg";
    const noImageUrl = BASE + "/demo/down.svg";
    const input = {
      question: demo.question,
      description: demo.description,
      source: demo.source,
      category: demo.category,
      deadline: demo.deadline,
      closeTs,
      resolutionTs,
      yesLabel: demo.yesLabel,
      noLabel: demo.noLabel,
      coverImageUrl,
      yesImageUrl,
      noImageUrl,
      metadataUrl,
    };

    console.log("\\n[" + demo.id + "] certify + prepare");
    const prepared = await api<any>("/api/prepare-create", {
      wallet: wallet.publicKey.toBase58(),
      input,
    });
    if (prepared?.report?.analysis?.verdict !== "green") {
      throw new Error(demo.id + " did not receive GREEN MarketLint verdict");
    }

    const market = new PublicKey(prepared.addresses.market);
    const existing = await connection.getAccountInfo(market, "confirmed");
    let createSignature: string | null = null;
    if (!existing) {
      createSignature = await submit(connection, wallet, prepared);
      console.log("CREATE " + market.toBase58() + " " + createSignature);
    } else {
      console.log("EXISTS " + market.toBase58());
    }

    const shouldSeed = !CREATE_ONLY && (!existing || RESEED);
    const signatures: Record<string, string | null> = { create: createSignature };

    if (shouldSeed) {
      console.log("[" + demo.id + "] add " + LIQUIDITY_USDG + " USDG AMM liquidity");
      const liquidity = await api<any>("/api/complete-set", {
        wallet: wallet.publicKey.toBase58(),
        market: market.toBase58(),
        action: "ADD_LIQUIDITY",
        amountBaseUnits: baseUnits(LIQUIDITY_USDG),
      });
      signatures.liquidity = await submit(connection, wallet, liquidity);

      if (!SKIP_BOOK) {
        console.log("[" + demo.id + "] create " + INVENTORY_USDG + " complete-set inventory");
        const split = await api<any>("/api/complete-set", {
          wallet: wallet.publicKey.toBase58(),
          market: market.toBase58(),
          action: "SPLIT",
          amountBaseUnits: baseUnits(INVENTORY_USDG),
        });
        signatures.split = await submit(connection, wallet, split);

        const orders = [
          { side: "YES", kind: "BUY", priceBps: 4800 },
          { side: "YES", kind: "SELL", priceBps: 5200 },
          { side: "NO", kind: "BUY", priceBps: 4800 },
          { side: "NO", kind: "SELL", priceBps: 5200 },
        ];
        for (const order of orders) {
          const built = await api<any>("/api/order-place", {
            wallet: wallet.publicKey.toBase58(),
            market: market.toBase58(),
            side: order.side,
            kind: order.kind,
            priceBps: order.priceBps,
            sharesBaseUnits: baseUnits(ORDER_SHARES),
          });
          const sig = await submit(connection, wallet, built);
          signatures[order.kind.toLowerCase() + "-" + order.side.toLowerCase()] = sig;
          console.log("ORDER " + order.kind + " " + order.side + " @ " + (order.priceBps / 100).toFixed(0) + "¢ " + sig);
        }
      }
    } else if (!CREATE_ONLY) {
      console.log("SKIP SEED " + demo.id + ": market already existed. Set DEMO_RESEED=true to add another liquidity/book layer.");
    }

    summary.push({
      id: demo.id,
      question: demo.question,
      market: market.toBase58(),
      marketSeed: prepared.report.hashes.marketSeed,
      verdict: prepared.report.analysis.verdict,
      signatures,
    });
  }

  const outputPath = path.join(process.cwd(), "data", "demo-seed-result.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    base: BASE,
    wallet: wallet.publicKey.toBase58(),
    markets: summary,
  }, null, 2));

  console.log("\\nDEMO SEED COMPLETE: " + summary.length + " markets");
  console.log("Manifest: " + outputPath);
  console.log(JSON.stringify(summary.map((item) => ({ id: item.id, market: item.market, verdict: item.verdict })), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
