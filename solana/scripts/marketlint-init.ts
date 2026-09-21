import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("9tELwXSuJCP5vNrvBfo1PxGorDbMCGBQBEcsWTJtpHMy");

function expandHome(value: string) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function loadKeypair(envName: string, fallback?: string) {
  const filePath = process.env[envName] || fallback;
  if (!filePath) throw new Error(`${envName} is required`);
  const raw = JSON.parse(fs.readFileSync(expandHome(filePath), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function discriminator(name: string) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed",
  );
  const authority = loadKeypair("MARKETLINT_ADMIN_KEYPAIR", "~/.config/solana/id.json");
  const attestor = loadKeypair("MARKETLINT_ATTESTOR_KEYPAIR");

  const minScore = Number(process.env.MARKETLINT_MIN_SCORE || "80");
  const maxDuplicate = Number(process.env.MARKETLINT_MAX_DUPLICATE || "60");
  const minResolution = Number(process.env.MARKETLINT_MIN_RESOLUTION_CLARITY || "70");
  const requireGreen = (process.env.MARKETLINT_REQUIRE_GREEN || "true").toLowerCase() !== "false";

  for (const value of [minScore, maxDuplicate, minResolution]) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error("MarketLint thresholds must be integers from 0 to 100");
    }
  }

  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID,
  );
  const [marketLintConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("marketlint-config")],
    PROGRAM_ID,
  );

  if (await connection.getAccountInfo(marketLintConfig, "confirmed")) {
    console.log(`MarketLintConfig already exists: ${marketLintConfig.toBase58()}`);
    return;
  }

  const data = Buffer.concat([
    discriminator("initialize_marketlint_config"),
    attestor.publicKey.toBuffer(),
    Buffer.from([minScore, maxDuplicate, minResolution, requireGreen ? 1 : 0]),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: marketLintConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [authority],
    { commitment: "confirmed" },
  );

  console.log(JSON.stringify({
    signature,
    marketLintConfig: marketLintConfig.toBase58(),
    authority: authority.publicKey.toBase58(),
    attestor: attestor.publicKey.toBase58(),
    minScore,
    maxDuplicate,
    minResolution,
    requireGreen,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
