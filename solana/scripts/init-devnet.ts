import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  MILADY_MARKET_PROGRAM_ID,
  USDG_DEVNET_MINT,
  deriveBetaConfigPda,
  deriveConfigPda,
  deriveResolutionConfigPda,
} from "../sdk/src/index.js";
import {
  buildInitializeConfigInstruction,
  buildInitializeResolutionConfigInstruction,
  instructionDiscriminator,
} from "../sdk/src/transactions.js";
import { deriveMarketLintConfigPda } from "../sdk/src/marketLint.js";

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const FEE_BPS = Number(process.env.MARY_JANE_FEE_BPS || "30");
const PROPOSAL_BOND = BigInt(process.env.MARY_JANE_PROPOSAL_BOND_BASE_UNITS || "1000000");
const DISPUTE_BOND = BigInt(process.env.MARY_JANE_DISPUTE_BOND_BASE_UNITS || "2000000");
const CHALLENGE_SECS = BigInt(process.env.MARY_JANE_CHALLENGE_SECS || "120");
const ESCALATION_SECS = BigInt(process.env.MARY_JANE_ESCALATION_SECS || "180");

function expandHome(value: string) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function loadKeypair(filePath: string) {
  const raw = JSON.parse(fs.readFileSync(expandHome(filePath), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadOrCreateKeypair(filePath: string) {
  const expanded = expandHome(filePath);
  if (fs.existsSync(expanded)) return loadKeypair(expanded);
  fs.mkdirSync(path.dirname(expanded), { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(expanded, JSON.stringify(Array.from(kp.secretKey)));
  try { fs.chmodSync(expanded, 0o600); } catch {}
  console.log(`Created keypair: ${expanded}`);
  return kp;
}

function u16(value: number) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function i64(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value);
  return out;
}

async function maybeFund(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  targetSol = 0.01,
) {
  const balance = await connection.getBalance(recipient, "confirmed");
  const target = Math.floor(targetSol * LAMPORTS_PER_SOL);
  if (balance >= target) return;
  const needed = target - balance;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: needed,
    }),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  console.log(`Funded ${recipient.toBase58()} with ${needed / LAMPORTS_PER_SOL} DEVNET SOL: ${sig}`);
}

async function sendIfMissing(
  connection: Connection,
  payer: Keypair,
  address: PublicKey,
  ix: TransactionInstruction,
  label: string,
) {
  const existing = await connection.getAccountInfo(address, "confirmed");
  if (existing) {
    console.log(`${label} already initialized: ${address.toBase58()}`);
    return null;
  }
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer],
    { commitment: "confirmed" },
  );
  console.log(`${label} initialized: ${sig}`);
  return sig;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const authorityPath = process.env.SOLANA_WALLET || "~/.config/solana/id.json";
  const authority = loadKeypair(authorityPath);

  const programAccount = await connection.getAccountInfo(
    MILADY_MARKET_PROGRAM_ID,
    "confirmed",
  );
  if (!programAccount?.executable) {
    throw new Error(
      `Mary Jane program ${MILADY_MARKET_PROGRAM_ID.toBase58()} is not deployed/executable on Devnet`,
    );
  }

  const mintAccount = await connection.getAccountInfo(USDG_DEVNET_MINT, "confirmed");
  if (!mintAccount) throw new Error("USDG Devnet mint is not available");

  const attestorPath =
    process.env.MARKETLINT_ATTESTOR_KEYPAIR ||
    "~/.config/solana/mary-jane-attestor.json";
  const betaOraclePath =
    process.env.BETA_ORACLE_KEYPAIR ||
    "~/.config/solana/mary-jane-beta-oracle.json";

  const attestor = loadOrCreateKeypair(attestorPath);
  const betaOracle = loadOrCreateKeypair(betaOraclePath);

  await maybeFund(connection, authority, attestor.publicKey);
  await maybeFund(connection, authority, betaOracle.publicKey);

  const [protocolConfig] = deriveConfigPda(MILADY_MARKET_PROGRAM_ID);
  await sendIfMissing(
    connection,
    authority,
    protocolConfig,
    buildInitializeConfigInstruction({
      authority: authority.publicKey,
      collateralMint: USDG_DEVNET_MINT,
      feeBps: FEE_BPS,
      programId: MILADY_MARKET_PROGRAM_ID,
    }),
    "ProtocolConfig",
  );

  const [resolutionConfig] = deriveResolutionConfigPda(MILADY_MARKET_PROGRAM_ID);
  await sendIfMissing(
    connection,
    authority,
    resolutionConfig,
    buildInitializeResolutionConfigInstruction({
      authority: authority.publicKey,
      proposalBond: PROPOSAL_BOND,
      disputeBond: DISPUTE_BOND,
      challengePeriodSecs: CHALLENGE_SECS,
      escalationPeriodSecs: ESCALATION_SECS,
      programId: MILADY_MARKET_PROGRAM_ID,
    }),
    "ResolutionConfig",
  );

  const [marketLintConfig] = deriveMarketLintConfigPda(MILADY_MARKET_PROGRAM_ID);
  const marketLintData = Buffer.concat([
    instructionDiscriminator("initialize_marketlint_config"),
    attestor.publicKey.toBuffer(),
    Buffer.from([
      Number(process.env.MARKETLINT_MIN_SCORE || "80"),
      Number(process.env.MARKETLINT_MAX_DUPLICATE || "60"),
      Number(process.env.MARKETLINT_MIN_RESOLUTION_CLARITY || "70"),
      (process.env.MARKETLINT_REQUIRE_GREEN || "true").toLowerCase() === "false" ? 0 : 1,
    ]),
  ]);
  await sendIfMissing(
    connection,
    authority,
    marketLintConfig,
    new TransactionInstruction({
      programId: MILADY_MARKET_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocolConfig, isSigner: false, isWritable: false },
        { pubkey: marketLintConfig, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: marketLintData,
    }),
    "MarketLintConfig",
  );

  const [betaConfig] = deriveBetaConfigPda(MILADY_MARKET_PROGRAM_ID);
  const betaData = Buffer.concat([
    instructionDiscriminator("initialize_beta_config"),
    betaOracle.publicKey.toBuffer(),
    i64(BigInt(process.env.BETA_LOCK_BUFFER_SECS || "15")),
    i64(BigInt(process.env.BETA_MAX_ORACLE_DELAY_SECS || "120")),
    u16(Number(process.env.BETA_FEE_BPS || "30")),
  ]);
  await sendIfMissing(
    connection,
    authority,
    betaConfig,
    new TransactionInstruction({
      programId: MILADY_MARKET_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocolConfig, isSigner: false, isWritable: false },
        { pubkey: betaConfig, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: betaData,
    }),
    "BetaConfig",
  );

  const repoRoot = path.resolve(process.cwd(), "..");
  const envPath = path.join(repoRoot, "Mary-Jane-Vercel.generated.env");
  const certifyToken = crypto.randomBytes(32).toString("hex");
  const indexerToken = crypto.randomBytes(32).toString("hex");

  const env = [
    `SOLANA_RPC_URL=${RPC}`,
    `MARKETLINT_ATTESTOR_SECRET_KEY=${JSON.stringify(Array.from(attestor.secretKey))}`,
    `MARKETLINT_CERTIFY_TOKEN=${certifyToken}`,
    "MARKETLINT_PUBLIC_CERTIFY=true",
    "MARKETLINT_CERT_TTL_SECS=86400",
    `INDEXER_ADMIN_TOKEN=${indexerToken}`,
    "PYTH_API_KEY=",
    "",
  ].join("\n");
  fs.writeFileSync(envPath, env, { mode: 0o600 });

  console.log("\nMARY JANE DEVNET INITIALIZATION COMPLETE");
  console.log(JSON.stringify({
    rpc: RPC,
    programId: MILADY_MARKET_PROGRAM_ID.toBase58(),
    authority: authority.publicKey.toBase58(),
    collateralMint: USDG_DEVNET_MINT.toBase58(),
    protocolConfig: protocolConfig.toBase58(),
    resolutionConfig: resolutionConfig.toBase58(),
    marketLintConfig: marketLintConfig.toBase58(),
    marketLintAttestor: attestor.publicKey.toBase58(),
    betaConfig: betaConfig.toBase58(),
    betaOracle: betaOracle.publicKey.toBase58(),
    vercelEnvFile: envPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
