import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import {
  MILADY_MARKET_PROGRAM_ID,
  USDG_DEVNET_MINT,
  deriveBetaConfigPda,
  deriveConfigPda,
  deriveResolutionConfigPda,
} from "../sdk/src/index.js";
import { deriveMarketLintConfigPda } from "../sdk/src/marketLint.js";

function expandHome(value: string) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function keypairStatus(env: string) {
  const filePath = process.env[env];
  if (!filePath) return { ok: false, value: null };
  try {
    const raw = JSON.parse(fs.readFileSync(expandHome(filePath), "utf8")) as number[];
    const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
    return { ok: true, value: kp.publicKey.toBase58() };
  } catch {
    return { ok: false, value: null };
  }
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const [protocol] = deriveConfigPda();
  const [resolution] = deriveResolutionConfigPda();
  const [marketLint] = deriveMarketLintConfigPda(MILADY_MARKET_PROGRAM_ID);
  const [beta] = deriveBetaConfigPda();

  const [programInfo, mintInfo, protocolInfo, resolutionInfo, lintInfo, betaInfo] =
    await Promise.all([
      connection.getAccountInfo(MILADY_MARKET_PROGRAM_ID, "confirmed"),
      connection.getAccountInfo(USDG_DEVNET_MINT, "confirmed"),
      connection.getAccountInfo(protocol, "confirmed"),
      connection.getAccountInfo(resolution, "confirmed"),
      connection.getAccountInfo(marketLint, "confirmed"),
      connection.getAccountInfo(beta, "confirmed"),
    ]);

  const attestor = keypairStatus("MARKETLINT_ATTESTOR_KEYPAIR");
  const betaOracle = keypairStatus("BETA_ORACLE_KEYPAIR");
  const checks = [
    ["program deployed", Boolean(programInfo?.executable), MILADY_MARKET_PROGRAM_ID.toBase58()],
    ["USDG Devnet mint", Boolean(mintInfo), USDG_DEVNET_MINT.toBase58()],
    ["ProtocolConfig", Boolean(protocolInfo), protocol.toBase58()],
    ["ResolutionConfig", Boolean(resolutionInfo), resolution.toBase58()],
    ["MarketLintConfig", Boolean(lintInfo), marketLint.toBase58()],
    ["MarketLint attestor key", attestor.ok, attestor.value],
    ["BetaConfig", Boolean(betaInfo), beta.toBase58()],
    ["Beta oracle key", betaOracle.ok, betaOracle.value],
    ["Pyth API key", Boolean(process.env.PYTH_API_KEY), null],
  ] as const;

  console.log("\n33MILADY DEVNET LAUNCH READINESS\n");
  for (const [label, ok, value] of checks) {
    console.log(`${ok ? "PASS" : "MISS"}  ${label}${value ? `  ${value}` : ""}`);
  }

  const critical = checks.slice(0, 6);
  const ready = critical.every(([, ok]) => ok);
  console.log(`\nMarkets launch status: ${ready ? "READY" : "NOT READY"}`);
  console.log(`RPC: ${rpc}\n`);
  if (!ready) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
