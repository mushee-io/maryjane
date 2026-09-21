import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "node:http";
import crypto from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { MarketIndexer, rangeToMs, type MarketStatus } from "./src/lib/marketIndexer";
import {
  MILADY_MARKET_PROGRAM_ID as SDK_PROGRAM_ID,
  USDG_DEVNET_MINT,
  deriveConfigPda,
  deriveMarketAddresses,
  deriveResolutionConfigPda,
  deriveBetaConfigPda,
  deriveSettlementReceiptPda,
} from "./solana/sdk/src/index";
import {
  buildAddLiquidityInstruction,
  buildCloseMarketInstruction,
  buildCreateCertifiedMarketInstruction,
  buildFinalizeUncontestedInstruction,
  buildProposeResolutionInstruction,
  buildRedeemWinningsInstruction,
  buildTradeInstruction,
} from "./solana/sdk/src/transactions";
import {
  MarketLintReportStore,
  compileMarketLintReport,
  hex32,
  type MarketLintInput,
} from "./src/lib/marketLint";
const PORT = 3000;
const MILADY_MARKET_PROGRAM_ID = new PublicKey("9tELwXSuJCP5vNrvBfo1PxGorDbMCGBQBEcsWTJtpHMy");
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const BETA_ROUND_DISCRIMINATOR = Buffer.from("cde37f64f671e03d", "hex");
const BETA_POSITION_DISCRIMINATOR = Buffer.from("5a698f407c23b0fb", "hex");
const ENTER_BETA_ROUND_DISCRIMINATOR = Buffer.from("404c2c1e78d8eeca", "hex");
const CLAIM_BETA_ROUND_DISCRIMINATOR = Buffer.from("5db4f8f7614b6f55", "hex");

type DecodedBetaRound = {
  address: string;
  assetHash: string;
  asset: string;
  roundId: string;
  collateralMint: string;
  vault: string;
  startPrice: string;
  endPrice: string;
  priceExponent: number;
  startObservedTs: number;
  endObservedTs: number;
  openTs: number;
  lockTs: number;
  closeTs: number;
  upPool: string;
  downPool: string;
  protocolFees: string;
  outcome: "UNRESOLVED" | "UP" | "DOWN" | "PUSH";
  status: "OPEN" | "LOCKED" | "SETTLED";
};

const betaAssetLabels = new Map<string, string>(
  ["SOL/USD", "BTC/USD", "ETH/USD"].map((symbol) => [
    crypto.createHash("sha256").update(`33milady:beta:asset:${symbol}`).digest("hex"),
    symbol,
  ]),
);

function decodeBetaRound(address: PublicKey, raw: Buffer): DecodedBetaRound | null {
  if (raw.length < 263 || !raw.subarray(0, 8).equals(BETA_ROUND_DISCRIMINATOR)) {
    return null;
  }

  let o = 8;
  const assetHash = raw.subarray(o, o + 32).toString("hex"); o += 32;
  const roundId = raw.readBigUInt64LE(o); o += 8;
  const collateralMint = new PublicKey(raw.subarray(o, o + 32)); o += 32;
  const vault = new PublicKey(raw.subarray(o, o + 32)); o += 32;
  const startPrice = raw.readBigInt64LE(o); o += 8;
  const endPrice = raw.readBigInt64LE(o); o += 8;
  const priceExponent = raw.readInt32LE(o); o += 4;
  const startObservedTs = Number(raw.readBigInt64LE(o)); o += 8;
  const endObservedTs = Number(raw.readBigInt64LE(o)); o += 8;
  o += 32; // open observation hash
  o += 32; // close observation hash
  const openTs = Number(raw.readBigInt64LE(o)); o += 8;
  const lockTs = Number(raw.readBigInt64LE(o)); o += 8;
  const closeTs = Number(raw.readBigInt64LE(o)); o += 8;
  const upPool = raw.readBigUInt64LE(o); o += 8;
  const downPool = raw.readBigUInt64LE(o); o += 8;
  const protocolFees = raw.readBigUInt64LE(o); o += 8;
  const outcomeIndex = raw.readUInt8(o++);
  const statusIndex = raw.readUInt8(o++);

  const outcomes = ["UNRESOLVED", "UP", "DOWN", "PUSH"] as const;
  const statuses = ["OPEN", "LOCKED", "SETTLED"] as const;

  return {
    address: address.toBase58(),
    assetHash,
    asset: betaAssetLabels.get(assetHash) || `0x${assetHash.slice(0, 10)}…`,
    roundId: roundId.toString(),
    collateralMint: collateralMint.toBase58(),
    vault: vault.toBase58(),
    startPrice: startPrice.toString(),
    endPrice: endPrice.toString(),
    priceExponent,
    startObservedTs,
    endObservedTs,
    openTs,
    lockTs,
    closeTs,
    upPool: upPool.toString(),
    downPool: downPool.toString(),
    protocolFees: protocolFees.toString(),
    outcome: outcomes[outcomeIndex] || "UNRESOLVED",
    status: statuses[statusIndex] || "OPEN",
  };
}

function decodeBetaPosition(raw: Buffer) {
  if (raw.length < 98 || !raw.subarray(0, 8).equals(BETA_POSITION_DISCRIMINATOR)) {
    return null;
  }
  let o = 8;
  const owner = new PublicKey(raw.subarray(o, o + 32)); o += 32;
  const round = new PublicKey(raw.subarray(o, o + 32)); o += 32;
  const upStake = raw.readBigUInt64LE(o); o += 8;
  const downStake = raw.readBigUInt64LE(o); o += 8;
  const collateralPaid = raw.readBigUInt64LE(o); o += 8;
  const claimed = raw.readUInt8(o++) !== 0;

  return {
    owner: owner.toBase58(),
    round: round.toBase58(),
    upStake: upStake.toString(),
    downStake: downStake.toString(),
    collateralPaid: collateralPaid.toString(),
    claimed,
  };
}

function u64Buffer(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function i64Buffer(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value);
  return out;
}

function anchorInstructionDiscriminator(name: string) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function loadKeypairFromPath(filePath: string): Keypair {
  const expanded = filePath.startsWith("~/")
    ? path.join(process.env.HOME || process.cwd(), filePath.slice(2))
    : filePath;
  const raw = JSON.parse(fs.readFileSync(expanded, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadKeypairFromEnvironment(
  secretEnvName: string,
  pathEnvName: string,
): Keypair {
  const inlineSecret = process.env[secretEnvName]?.trim();
  if (inlineSecret) {
    let raw: number[];
    if (inlineSecret.startsWith("[")) {
      raw = JSON.parse(inlineSecret) as number[];
    } else {
      const decoded = Buffer.from(inlineSecret, "base64").toString("utf8");
      raw = JSON.parse(decoded) as number[];
    }
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }

  const filePath = process.env[pathEnvName];
  if (filePath) return loadKeypairFromPath(filePath);

  throw new Error(
    `${secretEnvName} or ${pathEnvName} must be configured`,
  );
}

const DB_DIR = process.env.VERCEL
  ? path.join("/tmp", "mary-jane-data")
  : path.join(process.cwd(), "data");

export async function createMaryJaneApp(options: { local?: boolean } = {}) {
  const local = options.local ?? true;
  const app = express();
  const httpServer = createHttpServer(app);
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      app: "Mary Jane",
      network: "solana-devnet",
      programId: MILADY_MARKET_PROGRAM_ID.toBase58(),
      timestamp: Date.now(),
    });
  });

  const solana = new Connection(SOLANA_RPC_URL, "confirmed");
  const marketIndexer = new MarketIndexer(
    solana,
    MILADY_MARKET_PROGRAM_ID,
    path.join(DB_DIR, "market-index.json"),
  );
  const marketLintStore = new MarketLintReportStore(
    path.join(DB_DIR, "marketlint-reports.json"),
  );
  const publicCertificationWindows = new Map<
    string,
    { startedAt: number; count: number }
  >();

  const certifyMarketForCreator = async (
    creator: PublicKey,
    input: MarketLintInput,
  ) => {
    const hasAttestor =
      Boolean(process.env.MARKETLINT_ATTESTOR_SECRET_KEY) ||
      Boolean(process.env.MARKETLINT_ATTESTOR_KEYPAIR);
    if (!hasAttestor) {
      throw new Error(
        "MARKETLINT_ATTESTOR_SECRET_KEY or MARKETLINT_ATTESTOR_KEYPAIR is not configured",
      );
    }
    if (
      !Number.isInteger(input?.closeTs) ||
      !Number.isInteger(input?.resolutionTs) ||
      Number(input.closeTs) <= Math.floor(Date.now() / 1000) ||
      Number(input.resolutionTs) < Number(input.closeTs)
    ) {
      throw new Error(
        "Certification requires future closeTs and resolutionTs >= closeTs",
      );
    }

    const report = compileMarketLintReport(
      input,
      marketIndexer.marketFingerprints(),
      marketLintStore.list(500),
    );
    if (report.analysis.verdict !== "green") {
      const error = new Error("MarketLint report is not publish-ready") as Error & {
        report?: typeof report;
        statusCode?: number;
      };
      error.report = report;
      error.statusCode = 422;
      throw error;
    }

    const attestor = loadKeypairFromEnvironment(
      "MARKETLINT_ATTESTOR_SECRET_KEY",
      "MARKETLINT_ATTESTOR_KEYPAIR",
    );
    const [marketLintConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketlint-config")],
      MILADY_MARKET_PROGRAM_ID,
    );
    const [certification] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketlint-cert"), hex32(report.hashes.marketSeed)],
      MILADY_MARKET_PROGRAM_ID,
    );

    const configAccount = await solana.getAccountInfo(
      marketLintConfig,
      "confirmed",
    );
    if (!configAccount) {
      const error = new Error("MarketLint config is not initialized onchain") as Error & {
        statusCode?: number;
      };
      error.statusCode = 409;
      throw error;
    }

    const ttlSecs = Math.min(
      7 * 24 * 60 * 60,
      Math.max(300, Number(process.env.MARKETLINT_CERT_TTL_SECS || "86400")),
    );
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + ttlSecs);
    const verdictIndex =
      report.analysis.verdict === "green"
        ? 0
        : report.analysis.verdict === "yellow"
          ? 1
          : 2;

    const data = Buffer.concat([
      anchorInstructionDiscriminator("certify_market"),
      hex32(report.hashes.marketSeed),
      creator.toBuffer(),
      hex32(report.hashes.questionHash),
      hex32(report.hashes.metadataHash),
      hex32(report.hashes.specHash),
      hex32(report.hashes.reportHash),
      hex32(report.hashes.sourceHash),
      i64Buffer(BigInt(input.closeTs!)),
      i64Buffer(BigInt(input.resolutionTs!)),
      Buffer.from([report.analysis.overallScore]),
      Buffer.from([verdictIndex]),
      Buffer.from([report.analysis.ambiguityScore]),
      Buffer.from([report.analysis.duplicateProbability]),
      Buffer.from([report.analysis.resolutionClarityScore]),
      i64Buffer(expiresAt),
    ]);

    const ix = new TransactionInstruction({
      programId: MILADY_MARKET_PROGRAM_ID,
      keys: [
        { pubkey: attestor.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketLintConfig, isSigner: false, isWritable: false },
        { pubkey: certification, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const signature = await sendAndConfirmTransaction(
      solana,
      new Transaction().add(ix),
      [attestor],
      { commitment: "confirmed" },
    );

    report.certifiedAt = Date.now();
    marketLintStore.upsert(report);

    return {
      report,
      certification,
      marketLintConfig,
      attestor: attestor.publicKey,
      expiresAt,
      signature,
    };
  };

  const authorizePublicCertification = (req: express.Request) => {
    const token = process.env.MARKETLINT_CERTIFY_TOKEN;
    if (token && req.header("x-marketlint-token") === token) {
      return;
    }
    if (process.env.MARKETLINT_PUBLIC_CERTIFY !== "true") {
      const error = new Error(
        "Public MarketLint certification is disabled on this deployment",
      ) as Error & { statusCode?: number };
      error.statusCode = 403;
      throw error;
    }

    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const current = publicCertificationWindows.get(key);
    if (!current || now - current.startedAt >= hour) {
      publicCertificationWindows.set(key, { startedAt: now, count: 1 });
      return;
    }
    if (current.count >= 3) {
      const error = new Error(
        "Public certification rate limit reached; retry after the current hour window",
      ) as Error & { statusCode?: number };
      error.statusCode = 429;
      throw error;
    }
    current.count += 1;
  };

  if (local) {
    void marketIndexer.start().catch((error) => {
      console.error("[MarketIndexer] startup failed", error);
    });
  } else {
    await marketIndexer.syncNow();
  }

  const liveClients = new Set<express.Response>();

  app.post("/api/v1/marketlint/analyze", (req, res) => {
    try {
      const input = req.body as MarketLintInput;
      const indexed = marketIndexer.marketFingerprints();
      const report = compileMarketLintReport(
        input,
        indexed,
        marketLintStore.list(500),
      );
      marketLintStore.upsert(report);
      res.json(report);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "MarketLint analysis failed" });
    }
  });

  app.get("/api/v1/marketlint/reports", (req, res) => {
    res.json({ items: marketLintStore.list(Number(req.query.limit || 50)) });
  });

  app.get("/api/v1/marketlint/reports/:hash", (req, res) => {
    const report = marketLintStore.get(req.params.hash);
    if (!report) return res.status(404).json({ error: "MarketLint report not found" });
    res.json(report);
  });

  app.post("/api/v1/marketlint/certify", async (req, res) => {
    try {
      const apiToken = process.env.MARKETLINT_CERTIFY_TOKEN;
      if (!apiToken || req.header("x-marketlint-token") !== apiToken) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const creator = new PublicKey(String(req.body.creator || ""));
      const result = await certifyMarketForCreator(
        creator,
        req.body.input as MarketLintInput,
      );
      res.json({
        report: result.report,
        certification: result.certification.toBase58(),
        marketLintConfig: result.marketLintConfig.toBase58(),
        attestor: result.attestor.toBase58(),
        closeTs: result.report.input.closeTs,
        resolutionTs: result.report.input.resolutionTs,
        expiresAt: result.expiresAt.toString(),
        signature: result.signature,
      });
    } catch (error: any) {
      console.error("[MarketLint] certification failed", error);
      res.status(error?.statusCode || 400).json({
        error: error?.message || "Certification failed",
        report: error?.report,
      });
    }
  });

  app.get("/api/v1/launch/readiness", async (_req, res) => {
    try {
      const [protocolConfig] = deriveConfigPda(MILADY_MARKET_PROGRAM_ID);
      const [resolutionConfig] = deriveResolutionConfigPda(
        MILADY_MARKET_PROGRAM_ID,
      );
      const [betaConfig] = deriveBetaConfigPda(MILADY_MARKET_PROGRAM_ID);
      const [marketLintConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketlint-config")],
        MILADY_MARKET_PROGRAM_ID,
      );

      const [
        programAccount,
        collateralMintAccount,
        protocolConfigAccount,
        resolutionConfigAccount,
        marketLintConfigAccount,
        betaConfigAccount,
      ] = await Promise.all([
        solana.getAccountInfo(MILADY_MARKET_PROGRAM_ID, "confirmed"),
        solana.getAccountInfo(USDG_DEVNET_MINT, "confirmed"),
        solana.getAccountInfo(protocolConfig, "confirmed"),
        solana.getAccountInfo(resolutionConfig, "confirmed"),
        solana.getAccountInfo(marketLintConfig, "confirmed"),
        solana.getAccountInfo(betaConfig, "confirmed"),
      ]);

      let attestorConfigured = false;
      let attestorPublicKey: string | null = null;
      try {
        if (
          process.env.MARKETLINT_ATTESTOR_SECRET_KEY ||
          process.env.MARKETLINT_ATTESTOR_KEYPAIR
        ) {
          const attestor = loadKeypairFromEnvironment(
            "MARKETLINT_ATTESTOR_SECRET_KEY",
            "MARKETLINT_ATTESTOR_KEYPAIR",
          );
          attestorConfigured = true;
          attestorPublicKey = attestor.publicKey.toBase58();
        }
      } catch {
        attestorConfigured = false;
      }

      const checks = [
        {
          id: "program",
          label: "Mary Jane program deployed",
          critical: true,
          ok: Boolean(programAccount?.executable),
          address: MILADY_MARKET_PROGRAM_ID.toBase58(),
        },
        {
          id: "program-id",
          label: "Server/SDK program IDs match",
          critical: true,
          ok:
            SDK_PROGRAM_ID.toBase58() ===
            MILADY_MARKET_PROGRAM_ID.toBase58(),
        },
        {
          id: "collateral",
          label: "USDG Devnet collateral mint exists",
          critical: true,
          ok: Boolean(collateralMintAccount),
          address: USDG_DEVNET_MINT.toBase58(),
        },
        {
          id: "protocol-config",
          label: "ProtocolConfig initialized",
          critical: true,
          ok: Boolean(protocolConfigAccount),
          address: protocolConfig.toBase58(),
        },
        {
          id: "resolution-config",
          label: "ResolutionConfig initialized",
          critical: true,
          ok: Boolean(resolutionConfigAccount),
          address: resolutionConfig.toBase58(),
        },
        {
          id: "marketlint-config",
          label: "MarketLintConfig initialized",
          critical: true,
          ok: Boolean(marketLintConfigAccount),
          address: marketLintConfig.toBase58(),
        },
        {
          id: "marketlint-attestor",
          label: "MarketLint attestor key available to server",
          critical: true,
          ok: attestorConfigured,
          address: attestorPublicKey,
        },
        {
          id: "beta-config",
          label: "Mary Jane Beta config initialized",
          critical: false,
          ok: Boolean(betaConfigAccount),
          address: betaConfig.toBase58(),
        },
        {
          id: "pyth",
          label: "Pyth keeper API key configured",
          critical: false,
          ok: Boolean(process.env.PYTH_API_KEY),
        },
      ];
      const critical = checks.filter((check) => check.critical);
      res.json({
        network: "devnet",
        rpc: SOLANA_RPC_URL,
        programId: MILADY_MARKET_PROGRAM_ID.toBase58(),
        readyForMarkets: critical.every((check) => check.ok),
        readyForPublicCreation:
          critical.every((check) => check.ok) &&
          process.env.MARKETLINT_PUBLIC_CERTIFY === "true",
        publicCertificationEnabled:
          process.env.MARKETLINT_PUBLIC_CERTIFY === "true",
        checks,
        indexer: marketIndexer.status(),
      });
    } catch (error: any) {
      res.status(502).json({
        error: "Unable to evaluate Devnet launch readiness",
        detail: error?.message || String(error),
      });
    }
  });

  app.post("/api/v1/markets/prepare-create", async (req, res) => {
    try {
      authorizePublicCertification(req);

      const wallet = new PublicKey(String(req.body.wallet || ""));
      const input = req.body.input as MarketLintInput;
      const certified = await certifyMarketForCreator(wallet, input);

      const [protocolConfig] = deriveConfigPda(MILADY_MARKET_PROGRAM_ID);
      const [protocolConfigAccount, collateralMintAccount] = await Promise.all([
        solana.getAccountInfo(protocolConfig, "confirmed"),
        solana.getAccountInfo(USDG_DEVNET_MINT, "confirmed"),
      ]);
      if (!protocolConfigAccount) {
        return res.status(409).json({
          error: "ProtocolConfig is not initialized on Devnet",
        });
      }
      if (!collateralMintAccount) {
        return res.status(409).json({ error: "USDG Devnet mint was not found" });
      }

      const marketSeed = hex32(certified.report.hashes.marketSeed);
      const ix = buildCreateCertifiedMarketInstruction({
        authority: wallet,
        collateralMint: USDG_DEVNET_MINT,
        tokenProgram: collateralMintAccount.owner,
        marketSeed,
        questionHash: hex32(certified.report.hashes.questionHash),
        metadataHash: hex32(certified.report.hashes.metadataHash),
        closeTs: BigInt(input.closeTs!),
        resolutionTs: BigInt(input.resolutionTs!),
      });
      const addresses = deriveMarketAddresses(
        marketSeed,
        MILADY_MARKET_PROGRAM_ID,
      );
      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: wallet,
        recentBlockhash: latest.blockhash,
      }).add(ix);

      res.json({
        report: certified.report,
        certificationSignature: certified.signature,
        certification: certified.certification.toBase58(),
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
        addresses: Object.fromEntries(
          Object.entries(addresses).map(([key, value]) => [
            key,
            value.toBase58(),
          ]),
        ),
        tokenProgram: collateralMintAccount.owner.toBase58(),
      });
    } catch (error: any) {
      console.error("[Markets] prepare-create failed", error);
      res.status(error?.statusCode || 400).json({
        error: error?.message || "Unable to prepare certified market",
        report: error?.report,
      });
    }
  });

  app.post("/api/v1/markets/seed-liquidity-transaction", async (req, res) => {
    try {
      const wallet = new PublicKey(String(req.body.wallet || ""));
      const marketSeed = hex32(String(req.body.marketSeed || ""));
      const amount = BigInt(String(req.body.amountBaseUnits || "0"));
      if (amount < 1_000n) {
        return res.status(400).json({
          error: "Initial liquidity must be at least 1,000 collateral base units",
        });
      }

      const addresses = deriveMarketAddresses(
        marketSeed,
        MILADY_MARKET_PROGRAM_ID,
      );
      const [marketAccount, collateralMintAccount] = await Promise.all([
        solana.getAccountInfo(addresses.market, "confirmed"),
        solana.getAccountInfo(USDG_DEVNET_MINT, "confirmed"),
      ]);
      if (!marketAccount) {
        return res.status(404).json({ error: "Market does not exist on Devnet" });
      }
      if (!collateralMintAccount) {
        return res.status(409).json({ error: "USDG Devnet mint was not found" });
      }

      const tokenProgram = collateralMintAccount.owner;
      const userCollateral = getAssociatedTokenAddressSync(
        USDG_DEVNET_MINT,
        wallet,
        false,
        tokenProgram,
      );
      const userYes = getAssociatedTokenAddressSync(
        addresses.yesMint,
        wallet,
        false,
        tokenProgram,
      );
      const userNo = getAssociatedTokenAddressSync(
        addresses.noMint,
        wallet,
        false,
        tokenProgram,
      );

      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: wallet,
        recentBlockhash: latest.blockhash,
      })
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet,
            userCollateral,
            wallet,
            USDG_DEVNET_MINT,
            tokenProgram,
          ),
        )
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet,
            userYes,
            wallet,
            addresses.yesMint,
            tokenProgram,
          ),
        )
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet,
            userNo,
            wallet,
            addresses.noMint,
            tokenProgram,
          ),
        )
        .add(
          buildAddLiquidityInstruction({
            authority: wallet,
            collateralMint: USDG_DEVNET_MINT,
            tokenProgram,
            marketSeed,
            userCollateral,
            userYes,
            userNo,
            amount,
          }),
        );

      res.json({
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
        market: addresses.market.toBase58(),
        userCollateral: userCollateral.toBase58(),
        userYes: userYes.toBase58(),
        userNo: userNo.toBase58(),
      });
    } catch (error: any) {
      res.status(400).json({
        error: error?.message || "Unable to build liquidity transaction",
      });
    }
  });

  app.post("/api/v1/markets/trade-transaction", async (req, res) => {
    try {
      const wallet = new PublicKey(String(req.body.wallet || ""));
      const marketSeed = hex32(String(req.body.marketSeed || ""));
      const side = String(req.body.side || "").toUpperCase();
      const direction = String(req.body.direction || "").toUpperCase();
      const amountIn = BigInt(String(req.body.amountInBaseUnits || "0"));
      const minAmountOut = BigInt(
        String(req.body.minAmountOutBaseUnits || "0"),
      );
      if (side !== "YES" && side !== "NO") {
        return res.status(400).json({ error: "side must be YES or NO" });
      }
      if (direction !== "BUY" && direction !== "SELL") {
        return res.status(400).json({ error: "direction must be BUY or SELL" });
      }
      if (amountIn <= 0n || minAmountOut <= 0n) {
        return res.status(400).json({
          error: "amountInBaseUnits and minAmountOutBaseUnits must be positive",
        });
      }

      const addresses = deriveMarketAddresses(
        marketSeed,
        MILADY_MARKET_PROGRAM_ID,
      );
      const [marketAccount, collateralMintAccount] = await Promise.all([
        solana.getAccountInfo(addresses.market, "confirmed"),
        solana.getAccountInfo(USDG_DEVNET_MINT, "confirmed"),
      ]);
      if (!marketAccount) {
        return res.status(404).json({ error: "Market does not exist on Devnet" });
      }
      if (!collateralMintAccount) {
        return res.status(409).json({ error: "USDG Devnet mint was not found" });
      }

      const tokenProgram = collateralMintAccount.owner;
      const userCollateral = getAssociatedTokenAddressSync(
        USDG_DEVNET_MINT,
        wallet,
        false,
        tokenProgram,
      );
      const userYes = getAssociatedTokenAddressSync(
        addresses.yesMint,
        wallet,
        false,
        tokenProgram,
      );
      const userNo = getAssociatedTokenAddressSync(
        addresses.noMint,
        wallet,
        false,
        tokenProgram,
      );
      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: wallet,
        recentBlockhash: latest.blockhash,
      })
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet,
            userCollateral,
            wallet,
            USDG_DEVNET_MINT,
            tokenProgram,
          ),
        )
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet,
            userYes,
            wallet,
            addresses.yesMint,
            tokenProgram,
          ),
        )
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet,
            userNo,
            wallet,
            addresses.noMint,
            tokenProgram,
          ),
        )
        .add(
          buildTradeInstruction({
            authority: wallet,
            collateralMint: USDG_DEVNET_MINT,
            tokenProgram,
            marketSeed,
            userCollateral,
            userYes,
            userNo,
            side,
            direction,
            amountIn,
            minAmountOut,
          }),
        );

      res.json({
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
        market: addresses.market.toBase58(),
      });
    } catch (error: any) {
      res.status(400).json({
        error: error?.message || "Unable to build trade transaction",
      });
    }
  });

  app.post("/api/v1/markets/close-transaction", async (req, res) => {
    try {
      const wallet = new PublicKey(String(req.body.wallet || ""));
      const marketSeed = hex32(String(req.body.marketSeed || ""));
      const addresses = deriveMarketAddresses(marketSeed, MILADY_MARKET_PROGRAM_ID);
      const marketAccount = await solana.getAccountInfo(addresses.market, "confirmed");
      if (!marketAccount) return res.status(404).json({ error: "Market does not exist on Devnet" });

      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: wallet,
        recentBlockhash: latest.blockhash,
      }).add(buildCloseMarketInstruction({ caller: wallet, marketSeed }));

      res.json({
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
        market: addresses.market.toBase58(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Unable to build close transaction" });
    }
  });

  app.post("/api/v1/markets/propose-resolution-transaction", async (req, res) => {
    try {
      const wallet = new PublicKey(String(req.body.wallet || ""));
      const marketSeed = hex32(String(req.body.marketSeed || ""));
      const outcome = String(req.body.outcome || "").toUpperCase();
      if (outcome !== "YES" && outcome !== "NO" && outcome !== "INVALID") {
        return res.status(400).json({ error: "outcome must be YES, NO, or INVALID" });
      }

      const addresses = deriveMarketAddresses(marketSeed, MILADY_MARKET_PROGRAM_ID);
      const [marketAccount, collateralMintAccount] = await Promise.all([
        solana.getAccountInfo(addresses.market, "confirmed"),
        solana.getAccountInfo(USDG_DEVNET_MINT, "confirmed"),
      ]);
      if (!marketAccount) return res.status(404).json({ error: "Market does not exist on Devnet" });
      if (!collateralMintAccount) return res.status(409).json({ error: "USDG Devnet mint was not found" });

      const tokenProgram = collateralMintAccount.owner;
      const proposerCollateral = getAssociatedTokenAddressSync(
        USDG_DEVNET_MINT,
        wallet,
        false,
        tokenProgram,
      );
      const evidenceHash = crypto
        .createHash("sha256")
        .update(String(req.body.evidence || ""))
        .digest();
      const sourceHash = crypto
        .createHash("sha256")
        .update(String(req.body.source || ""))
        .digest();
      const observationHash = crypto
        .createHash("sha256")
        .update(String(req.body.observation || ""))
        .digest();

      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: wallet,
        recentBlockhash: latest.blockhash,
      })
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet,
            proposerCollateral,
            wallet,
            USDG_DEVNET_MINT,
            tokenProgram,
          ),
        )
        .add(
          buildProposeResolutionInstruction({
            proposer: wallet,
            marketSeed,
            collateralMint: USDG_DEVNET_MINT,
            proposerCollateral,
            tokenProgram,
            outcome,
            evidenceHash,
            sourceHash,
            observationHash,
          }),
        );

      res.json({
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
        market: addresses.market.toBase58(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Unable to build resolution proposal" });
    }
  });

  app.post("/api/v1/markets/finalize-transaction", async (req, res) => {
    try {
      const caller = new PublicKey(String(req.body.wallet || ""));
      const proposer = new PublicKey(String(req.body.proposer || ""));
      const marketSeed = hex32(String(req.body.marketSeed || ""));
      const addresses = deriveMarketAddresses(marketSeed, MILADY_MARKET_PROGRAM_ID);
      const collateralMintAccount = await solana.getAccountInfo(USDG_DEVNET_MINT, "confirmed");
      if (!collateralMintAccount) return res.status(409).json({ error: "USDG Devnet mint was not found" });
      const tokenProgram = collateralMintAccount.owner;
      const proposerCollateral = getAssociatedTokenAddressSync(
        USDG_DEVNET_MINT,
        proposer,
        false,
        tokenProgram,
      );

      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: caller,
        recentBlockhash: latest.blockhash,
      }).add(
        buildFinalizeUncontestedInstruction({
          caller,
          proposer,
          marketSeed,
          collateralMint: USDG_DEVNET_MINT,
          proposerCollateral,
          tokenProgram,
        }),
      );

      res.json({
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
        market: addresses.market.toBase58(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Unable to build finalize transaction" });
    }
  });

  app.post("/api/v1/markets/redeem-transaction", async (req, res) => {
    try {
      const wallet = new PublicKey(String(req.body.wallet || ""));
      const marketSeed = hex32(String(req.body.marketSeed || ""));
      const outcome = String(req.body.outcome || "").toUpperCase();
      const amount = BigInt(String(req.body.amountBaseUnits || "0"));
      if ((outcome !== "YES" && outcome !== "NO") || amount <= 0n) {
        return res.status(400).json({ error: "resolved outcome and positive amount are required" });
      }

      const addresses = deriveMarketAddresses(marketSeed, MILADY_MARKET_PROGRAM_ID);
      const collateralMintAccount = await solana.getAccountInfo(USDG_DEVNET_MINT, "confirmed");
      if (!collateralMintAccount) return res.status(409).json({ error: "USDG Devnet mint was not found" });
      const tokenProgram = collateralMintAccount.owner;
      const winningMint = outcome === "YES" ? addresses.yesMint : addresses.noMint;
      const userWinning = getAssociatedTokenAddressSync(
        winningMint,
        wallet,
        false,
        tokenProgram,
      );
      const userCollateral = getAssociatedTokenAddressSync(
        USDG_DEVNET_MINT,
        wallet,
        false,
        tokenProgram,
      );
      const [receipt] = deriveSettlementReceiptPda(
        addresses.market,
        wallet,
        MILADY_MARKET_PROGRAM_ID,
      );

      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: wallet,
        recentBlockhash: latest.blockhash,
      })
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet,
            userCollateral,
            wallet,
            USDG_DEVNET_MINT,
            tokenProgram,
          ),
        )
        .add(
          buildRedeemWinningsInstruction({
            owner: wallet,
            marketSeed,
            collateralMint: USDG_DEVNET_MINT,
            collateralVault: addresses.collateralVault,
            winningMint,
            userWinning,
            userCollateral,
            receipt,
            tokenProgram,
            amount,
          }),
        );

      res.json({
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
        market: addresses.market.toBase58(),
        receipt: receipt.toBase58(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Unable to build redemption transaction" });
    }
  });

  app.get("/api/v1/indexer/status", (_req, res) => {
    res.json({
      network: "devnet",
      programId: MILADY_MARKET_PROGRAM_ID.toBase58(),
      ...marketIndexer.status(),
    });
  });

  app.get("/api/v1/analytics/protocol", (_req, res) => {
    res.json(marketIndexer.analytics());
  });

  app.get("/api/v1/markets", (req, res) => {
    const statusRaw = String(req.query.status || "").toUpperCase();
    const allowedStatuses: MarketStatus[] = [
      "OPEN",
      "CLOSED",
      "RESOLUTION_PENDING",
      "DISPUTED",
      "RESOLVED_YES",
      "RESOLVED_NO",
      "CANCELLED",
    ];
    const status = allowedStatuses.includes(statusRaw as MarketStatus)
      ? (statusRaw as MarketStatus)
      : undefined;
    const sortRaw = String(req.query.sort || "volume");
    const sort =
      sortRaw === "liquidity" || sortRaw === "newest" || sortRaw === "ending"
        ? sortRaw
        : "volume";

    res.json(
      marketIndexer.listMarkets({
        q: req.query.q ? String(req.query.q) : undefined,
        status,
        sort,
        limit: Number(req.query.limit || 25),
        offset: Number(req.query.offset || 0),
      }),
    );
  });

  app.get("/api/v1/markets/:address", (req, res) => {
    const market = marketIndexer.getMarket(req.params.address);
    if (!market) return res.status(404).json({ error: "Market not indexed" });
    res.json({
      market,
      recentEvents: marketIndexer.events({
        market: market.address,
        limit: 50,
      }),
    });
  });

  app.get("/api/v1/markets/:address/chart", (req, res) => {
    const market = marketIndexer.getMarket(req.params.address);
    if (!market) return res.status(404).json({ error: "Market not indexed" });
    const rangeMs = rangeToMs(req.query.range ? String(req.query.range) : "24h");
    res.json({
      market: market.address,
      range: String(req.query.range || "24h"),
      points: marketIndexer.marketChart(market.address, rangeMs),
    });
  });

  app.get("/api/v1/beta/rounds", (req, res) => {
    res.json({
      items: marketIndexer.listBetaRounds(Number(req.query.limit || 100)),
    });
  });

  app.get("/api/v1/beta/:address/chart", (req, res) => {
    const round = marketIndexer.getBetaRound(req.params.address);
    if (!round) return res.status(404).json({ error: "Beta round not indexed" });
    const rangeMs = rangeToMs(req.query.range ? String(req.query.range) : "24h");
    res.json({
      round: round.address,
      range: String(req.query.range || "24h"),
      points: marketIndexer.betaChart(round.address, rangeMs),
    });
  });

  app.get("/api/v1/events", (req, res) => {
    res.json({
      items: marketIndexer.events({
        market: req.query.market ? String(req.query.market) : undefined,
        round: req.query.round ? String(req.query.round) : undefined,
        type: req.query.type ? String(req.query.type) : undefined,
        limit: Number(req.query.limit || 100),
      }),
    });
  });

  app.post("/api/v1/indexer/sync", async (req, res) => {
    const configuredToken = process.env.INDEXER_ADMIN_TOKEN;
    if (!configuredToken) {
      return res.status(503).json({ error: "Manual sync endpoint is disabled" });
    }
    if (req.header("x-indexer-token") !== configuredToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await marketIndexer.syncNow();
    res.json({ success: true, ...marketIndexer.status() });
  });

  app.get("/api/v1/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(`event: ready\ndata: ${JSON.stringify({
      status: marketIndexer.status(),
      analytics: marketIndexer.analytics(),
    })}\n\n`);
    liveClients.add(res);

    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    }, 20_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      liveClients.delete(res);
    });
  });

  app.get("/api/33-beta/rounds", async (_req, res) => {
    try {
      const accounts = await solana.getProgramAccounts(MILADY_MARKET_PROGRAM_ID);
      const rounds = accounts
        .map(({ pubkey, account }) => decodeBetaRound(pubkey, Buffer.from(account.data)))
        .filter((round): round is DecodedBetaRound => Boolean(round))
        .sort((a, b) => b.openTs - a.openTs);

      res.json({
        network: "devnet",
        programId: MILADY_MARKET_PROGRAM_ID.toBase58(),
        rounds,
      });
    } catch (error: any) {
      console.error("[Mary Jane Beta] round query failed", error);
      res.status(502).json({
        error: "Unable to read 33 Beta rounds from Solana Devnet",
        detail: error?.message || String(error),
      });
    }
  });

  app.get("/api/33-beta/position", async (req, res) => {
    try {
      const round = new PublicKey(String(req.query.round || ""));
      const wallet = new PublicKey(String(req.query.wallet || ""));
      const [position] = PublicKey.findProgramAddressSync(
        [Buffer.from("beta-position"), round.toBuffer(), wallet.toBuffer()],
        MILADY_MARKET_PROGRAM_ID,
      );
      const account = await solana.getAccountInfo(position, "confirmed");
      if (!account) {
        return res.json({ position: null, address: position.toBase58() });
      }

      res.json({
        address: position.toBase58(),
        position: decodeBetaPosition(Buffer.from(account.data)),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Invalid position query" });
    }
  });

  app.post("/api/33-beta/enter-transaction", async (req, res) => {
    try {
      const wallet = new PublicKey(String(req.body.wallet || ""));
      const roundKey = new PublicKey(String(req.body.round || ""));
      const side = String(req.body.side || "").toUpperCase();
      const amount = BigInt(String(req.body.amountBaseUnits || "0"));

      if (side !== "UP" && side !== "DOWN") {
        return res.status(400).json({ error: "side must be UP or DOWN" });
      }
      if (amount <= 0n) {
        return res.status(400).json({ error: "amountBaseUnits must be positive" });
      }

      const roundAccount = await solana.getAccountInfo(roundKey, "confirmed");
      if (!roundAccount) return res.status(404).json({ error: "Beta round not found" });

      const round = decodeBetaRound(roundKey, Buffer.from(roundAccount.data));
      if (!round) return res.status(400).json({ error: "Account is not a 33 Beta round" });
      if (round.status !== "OPEN") return res.status(400).json({ error: "Beta round is not open" });
      if (Math.floor(Date.now() / 1000) >= round.lockTs) {
        return res.status(400).json({ error: "Beta round is locked" });
      }

      const collateralMint = new PublicKey(round.collateralMint);
      const vault = new PublicKey(round.vault);
      const mintAccount = await solana.getAccountInfo(collateralMint, "confirmed");
      if (!mintAccount) return res.status(404).json({ error: "Collateral mint not found" });
      const tokenProgram = mintAccount.owner;

      const [betaConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("beta-config")],
        MILADY_MARKET_PROGRAM_ID,
      );
      const [protocolConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        MILADY_MARKET_PROGRAM_ID,
      );
      const [position] = PublicKey.findProgramAddressSync(
        [Buffer.from("beta-position"), roundKey.toBuffer(), wallet.toBuffer()],
        MILADY_MARKET_PROGRAM_ID,
      );
      const userCollateral = getAssociatedTokenAddressSync(
        collateralMint,
        wallet,
        false,
        tokenProgram,
      );

      const instructionData = Buffer.concat([
        ENTER_BETA_ROUND_DISCRIMINATOR,
        Buffer.from([side === "UP" ? 0 : 1]),
        u64Buffer(amount),
      ]);

      const ix = new TransactionInstruction({
        programId: MILADY_MARKET_PROGRAM_ID,
        keys: [
          { pubkey: wallet, isSigner: true, isWritable: true },
          { pubkey: betaConfig, isSigner: false, isWritable: false },
          { pubkey: protocolConfig, isSigner: false, isWritable: false },
          { pubkey: collateralMint, isSigner: false, isWritable: false },
          { pubkey: roundKey, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: userCollateral, isSigner: false, isWritable: true },
          { pubkey: position, isSigner: false, isWritable: true },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: instructionData,
      });

      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: wallet,
        recentBlockhash: latest.blockhash,
      }).add(ix);

      res.json({
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
        position: position.toBase58(),
      });
    } catch (error: any) {
      console.error("[Mary Jane Beta] enter transaction build failed", error);
      res.status(400).json({ error: error?.message || "Unable to build Beta entry transaction" });
    }
  });

  app.post("/api/33-beta/claim-transaction", async (req, res) => {
    try {
      const wallet = new PublicKey(String(req.body.wallet || ""));
      const roundKey = new PublicKey(String(req.body.round || ""));

      const roundAccount = await solana.getAccountInfo(roundKey, "confirmed");
      if (!roundAccount) return res.status(404).json({ error: "Beta round not found" });
      const round = decodeBetaRound(roundKey, Buffer.from(roundAccount.data));
      if (!round) return res.status(400).json({ error: "Account is not a 33 Beta round" });
      if (round.status !== "SETTLED") {
        return res.status(400).json({ error: "Beta round has not settled" });
      }

      const collateralMint = new PublicKey(round.collateralMint);
      const vault = new PublicKey(round.vault);
      const mintAccount = await solana.getAccountInfo(collateralMint, "confirmed");
      if (!mintAccount) return res.status(404).json({ error: "Collateral mint not found" });
      const tokenProgram = mintAccount.owner;
      const [protocolConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        MILADY_MARKET_PROGRAM_ID,
      );
      const [position] = PublicKey.findProgramAddressSync(
        [Buffer.from("beta-position"), roundKey.toBuffer(), wallet.toBuffer()],
        MILADY_MARKET_PROGRAM_ID,
      );
      const userCollateral = getAssociatedTokenAddressSync(
        collateralMint,
        wallet,
        false,
        tokenProgram,
      );

      const ix = new TransactionInstruction({
        programId: MILADY_MARKET_PROGRAM_ID,
        keys: [
          { pubkey: wallet, isSigner: true, isWritable: true },
          { pubkey: protocolConfig, isSigner: false, isWritable: false },
          { pubkey: collateralMint, isSigner: false, isWritable: false },
          { pubkey: roundKey, isSigner: false, isWritable: false },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: position, isSigner: false, isWritable: true },
          { pubkey: userCollateral, isSigner: false, isWritable: true },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
        ],
        data: CLAIM_BETA_ROUND_DISCRIMINATOR,
      });

      const latest = await solana.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: wallet,
        recentBlockhash: latest.blockhash,
      }).add(ix);

      res.json({
        transactionBase64: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        lastValidBlockHeight: latest.lastValidBlockHeight,
      });
    } catch (error: any) {
      console.error("[Mary Jane Beta] claim transaction build failed", error);
      res.status(400).json({ error: error?.message || "Unable to build Beta claim transaction" });
    }
  });

  // Vite middleware setup
  if (!local) {
    return app;
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws/markets",
  });

  const unsubscribeRealtime = marketIndexer.subscribe((update) => {
    const payload = JSON.stringify(update);

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }

    for (const client of liveClients) {
      client.write(`event: ${update.kind}\ndata: ${payload}\n\n`);
    }
  });

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        kind: "ready",
        status: marketIndexer.status(),
        analytics: marketIndexer.analytics(),
      }),
    );
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Mary Jane server running on http://localhost:${PORT}`);
    console.log(`Mary Jane realtime stream: ws://localhost:${PORT}/ws/markets`);
  });

  const shutdown = async () => {
    unsubscribeRealtime();
    await marketIndexer.stop();
    for (const client of liveClients) client.end();
    wss.close();
    httpServer.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  return app;
}

if (!process.env.VERCEL) {
  void createMaryJaneApp({ local: true });
}
