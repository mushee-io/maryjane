import crypto from "node:crypto";
import type express from "express";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("BS3vTdhrkK5zHchx92PFGeodckt1dLzf7i9uJyEsmZst");
const PROTOCOL = new PublicKey("ACszf63tCaLrk11goAU4FLsZyuXq1xznbHsS4SMmSvWc");
const USDG_MINT = new PublicKey("H9fWLuVzqjWjkFjsZ8hSYUb3fGGofa4XHtwCSxQbP9PS");
const LENDING_POOL = new PublicKey("Gkxt6cQjhrqD6CoXLC3TabNxPB1fDYfru1xsTPD1rsru");
const LIQUIDITY_VAULT = new PublicKey("77SvAEarM7aXgvN2TV8Hw4Nd4Dy4oQ3Brv9TM2y9HUPN");
const SOL_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

const MARKET_DISC = crypto.createHash("sha256").update("account:MarketConfig").digest().subarray(0, 8);
const CREDIT_DISC = crypto.createHash("sha256").update("account:CreditAccount").digest().subarray(0, 8);
const SUPPLIER_DISC = crypto.createHash("sha256").update("account:SupplierPosition").digest().subarray(0, 8);

function ixDisc(name: string) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}
function u64(value: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}
function parseSixDecimals(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(text)) throw new Error("Amount must be a positive number with at most 6 decimals");
  const [whole, frac = ""] = text.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  if (raw <= 0n) throw new Error("Amount must be greater than zero");
  return raw;
}
function formatRaw(raw: bigint) {
  return Number(raw) / 1_000_000;
}
function shortSymbol(data: Buffer) {
  return data.subarray(72, 80).toString("utf8").replace(/\0+$/g, "");
}
function decodeMarket(pubkey: PublicKey, data: Buffer) {
  if (data.length < 143 || !data.subarray(0, 8).equals(MARKET_DISC)) return null;
  return {
    address: pubkey,
    mint: new PublicKey(data.subarray(40, 72)),
    symbol: shortSymbol(data),
    feedId: "0x" + data.subarray(80, 112).toString("hex"),
    decimals: data.readUInt8(112),
    ltvBps: data.readUInt16LE(113),
    liquidationThresholdBps: data.readUInt16LE(115),
    liquidationBonusBps: data.readUInt16LE(117),
    maxConfidenceBps: data.readUInt16LE(119),
    maxPriceAgeSecs: data.readUInt32LE(121),
    enabled: Boolean(data.readUInt8(149)),
  };
}
function decodeCredit(data: Buffer | null) {
  if (!data || data.length < 77 || !data.subarray(0, 8).equals(CREDIT_DISC)) return null;
  let o = 8;
  const owner = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const debt = data.readBigUInt64LE(o); o += 8;
  o += 16; // borrow index
  o += 8; // last borrow ts
  const count = data.readUInt32LE(o); o += 4;
  const collaterals: Array<{ market: PublicKey; amount: bigint }> = [];
  for (let i = 0; i < count; i++) {
    if (o + 40 > data.length) break;
    const market = new PublicKey(data.subarray(o, o + 32)); o += 32;
    const amount = data.readBigUInt64LE(o); o += 8;
    collaterals.push({ market, amount });
  }
  if (o + 41 > data.length) return { owner, debt, collaterals, lastCollateralValue: 0n, lastBorrowLimit: 0n, lastLiquidationCapacity: 0n, lastHealthFactor: 0n };
  const lastCollateralValue = data.readBigUInt64LE(o); o += 8;
  const lastBorrowLimit = data.readBigUInt64LE(o); o += 8;
  const lastLiquidationCapacity = data.readBigUInt64LE(o); o += 8;
  const lastHealthFactor = data.readBigUInt64LE(o);
  return { owner, debt, collaterals, lastCollateralValue, lastBorrowLimit, lastLiquidationCapacity, lastHealthFactor };
}
function decodeSupplier(data: Buffer | null) {
  if (!data || data.length < 81 || !data.subarray(0, 8).equals(SUPPLIER_DISC)) return null;
  return {
    owner: new PublicKey(data.subarray(8, 40)),
    lendingPool: new PublicKey(data.subarray(40, 72)),
    principal: data.readBigUInt64LE(72),
  };
}
async function tokenBalance(connection: Connection, address: PublicKey) {
  try {
    return BigInt((await connection.getTokenAccountBalance(address, "confirmed")).value.amount);
  } catch {
    return 0n;
  }
}
async function findSolxMarket(connection: Connection) {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID);
  for (const { pubkey, account } of accounts) {
    const decoded = decodeMarket(pubkey, Buffer.from(account.data));
    if (decoded?.symbol === "SOLx") return decoded;
  }
  throw new Error("SOLx market is not initialized on Devnet");
}
async function currentSolPrice() {
  const apiKey = process.env.PYTH_API_KEY?.trim();
  if (!apiKey) return { price: null as number | null, configured: false, updateData: null as string[] | null };

  const url = new URL("https://pyth.dourolabs.app/hermes/v2/updates/price/latest");
  url.searchParams.append("ids[]", SOL_FEED_ID);
  url.searchParams.set("encoding", "base64");
  url.searchParams.set("parsed", "true");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Pyth SOL/USD request failed (${response.status}): ${detail.slice(0, 180)}`);
  }

  const body: any = await response.json();
  const parsed = body.parsed?.find((item: any) =>
    ("0x" + String(item.id).replace(/^0x/, "")).toLowerCase() === SOL_FEED_ID
  ) ?? body.parsed?.[0];
  if (!parsed?.price || !body?.binary?.data?.length) throw new Error("Pyth SOL/USD response is incomplete");
  const price = Number(parsed.price.price) * 10 ** Number(parsed.price.expo);
  return { price, configured: true, updateData: body.binary.data as string[] };
}
function deriveWalletState(wallet: PublicKey, solxMint: PublicKey, solxMarket: PublicKey) {
  const [credit] = PublicKey.findProgramAddressSync([Buffer.from("credit"), wallet.toBuffer()], PROGRAM_ID);
  const [supplier] = PublicKey.findProgramAddressSync([Buffer.from("supplier"), LENDING_POOL.toBuffer(), wallet.toBuffer()], PROGRAM_ID);
  const [solxVault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), credit.toBuffer(), solxMarket.toBuffer()], PROGRAM_ID);
  const usdgAta = getAssociatedTokenAddressSync(USDG_MINT, wallet);
  const solxAta = getAssociatedTokenAddressSync(solxMint, wallet);
  return { credit, supplier, solxVault, usdgAta, solxAta };
}
async function legacyTransaction(connection: Connection, wallet: PublicKey, instructions: TransactionInstruction[]) {
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: wallet, recentBlockhash: latest.blockhash });
  tx.add(...instructions);
  return {
    transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}
function faucetPdas(wallet: PublicKey, mint: PublicKey) {
  const [faucet] = PublicKey.findProgramAddressSync([Buffer.from("faucet"), mint.toBuffer()], PROGRAM_ID);
  const [claim] = PublicKey.findProgramAddressSync([Buffer.from("claim"), wallet.toBuffer(), mint.toBuffer()], PROGRAM_ID);
  return { faucet, claim };
}

export function registerFortyFourMiladyRoutes(app: express.Express, connection: Connection) {
  app.get("/api/v1/44-milady/state", async (req, res) => {
    try {
      const wallet = req.query.wallet ? new PublicKey(String(req.query.wallet)) : null;
      const solx = await findSolxMarket(connection);
      const programInfo = await connection.getAccountInfo(PROGRAM_ID, "confirmed");
      const poolUsdg = await tokenBalance(connection, LIQUIDITY_VAULT);
      let oracle: { price: number | null; configured: boolean } = { price: null, configured: Boolean(process.env.PYTH_API_KEY) };
      try {
        const live = await currentSolPrice();
        oracle = { price: live.price, configured: live.configured };
      } catch {
        oracle = { price: null, configured: Boolean(process.env.PYTH_API_KEY) };
      }

      if (!wallet) {
        return res.json({
          network: "devnet",
          programId: PROGRAM_ID.toBase58(),
          programLive: Boolean(programInfo?.executable),
          protocol: PROTOCOL.toBase58(),
          usdgMint: USDG_MINT.toBase58(),
          lendingPool: LENDING_POOL.toBase58(),
          liquidityVault: LIQUIDITY_VAULT.toBase58(),
          poolUsdg: formatRaw(poolUsdg),
          solx: { market: solx.address.toBase58(), mint: solx.mint.toBase58(), ltvBps: solx.ltvBps, liquidationThresholdBps: solx.liquidationThresholdBps },
          oracle,
        });
      }

      const w = deriveWalletState(wallet, solx.mint, solx.address);
      const [creditInfo, supplierInfo, walletUsdg, walletSolx, vaultSolx, solLamports] = await Promise.all([
        connection.getAccountInfo(w.credit, "confirmed"),
        connection.getAccountInfo(w.supplier, "confirmed"),
        tokenBalance(connection, w.usdgAta),
        tokenBalance(connection, w.solxAta),
        tokenBalance(connection, w.solxVault),
        connection.getBalance(wallet, "confirmed"),
      ]);
      const credit = decodeCredit(creditInfo ? Buffer.from(creditInfo.data) : null);
      const supplier = decodeSupplier(supplierInfo ? Buffer.from(supplierInfo.data) : null);
      const debt = credit?.debt ?? 0n;

      let collateralValue = credit ? formatRaw(credit.lastCollateralValue) : 0;
      let borrowLimit = credit ? formatRaw(credit.lastBorrowLimit) : 0;
      let liquidationCapacity = credit ? formatRaw(credit.lastLiquidationCapacity) : 0;
      if (oracle.price != null && vaultSolx > 0n) {
        collateralValue = formatRaw(vaultSolx) * oracle.price;
        borrowLimit = collateralValue * (solx.ltvBps / 10_000);
        liquidationCapacity = collateralValue * (solx.liquidationThresholdBps / 10_000);
      }
      const debtNumber = formatRaw(debt);
      const healthFactor = debtNumber > 0 ? liquidationCapacity / debtNumber : null;

      res.json({
        network: "devnet",
        programId: PROGRAM_ID.toBase58(),
        programLive: Boolean(programInfo?.executable),
        protocol: PROTOCOL.toBase58(),
        usdgMint: USDG_MINT.toBase58(),
        lendingPool: LENDING_POOL.toBase58(),
        liquidityVault: LIQUIDITY_VAULT.toBase58(),
        poolUsdg: formatRaw(poolUsdg),
        solx: {
          market: solx.address.toBase58(),
          mint: solx.mint.toBase58(),
          ltvBps: solx.ltvBps,
          liquidationThresholdBps: solx.liquidationThresholdBps,
          walletBalance: formatRaw(walletSolx),
          deposited: formatRaw(vaultSolx),
        },
        oracle,
        wallet: {
          address: wallet.toBase58(),
          sol: solLamports / 1e9,
          usdg: formatRaw(walletUsdg),
          credit: w.credit.toBase58(),
          creditExists: Boolean(creditInfo),
          supplier: w.supplier.toBase58(),
          suppliedUsdg: supplier ? formatRaw(supplier.principal) : 0,
        },
        credit: {
          debt: debtNumber,
          collateralValue,
          borrowLimit,
          availableToBorrow: Math.max(0, borrowLimit - debtNumber),
          liquidationCapacity,
          healthFactor,
        },
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Unable to load 44 Milady state" });
    }
  });

  app.post("/api/v1/44-milady/build-transaction", async (req, res) => {
    try {
      const wallet = new PublicKey(String(req.body.wallet || ""));
      const action = String(req.body.action || "");
      const solx = await findSolxMarket(connection);
      const w = deriveWalletState(wallet, solx.mint, solx.address);
      const amount = action === "initializeCredit" || action === "claimUsdg" || action === "claimSolx" || action === "repayMax"
        ? 0n
        : parseSixDecimals(req.body.amount);
      const instructions: TransactionInstruction[] = [];

      if (action === "initializeCredit") {
        instructions.push(new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: false },
            { pubkey: w.credit, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: ixDisc("initialize_credit_account"),
        }));
      } else if (action === "claimUsdg" || action === "claimSolx") {
        const mint = action === "claimUsdg" ? USDG_MINT : solx.mint;
        const destination = action === "claimUsdg" ? w.usdgAta : w.solxAta;
        const { faucet, claim } = faucetPdas(wallet, mint);
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet, destination, wallet, mint));
        instructions.push(new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: false },
            { pubkey: faucet, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: true },
            { pubkey: destination, isSigner: false, isWritable: true },
            { pubkey: claim, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: ixDisc("claim_faucet"),
        }));
      } else if (action === "supply") {
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet, w.usdgAta, wallet, USDG_MINT));
        instructions.push(new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: false },
            { pubkey: LENDING_POOL, isSigner: false, isWritable: true },
            { pubkey: USDG_MINT, isSigner: false, isWritable: false },
            { pubkey: w.usdgAta, isSigner: false, isWritable: true },
            { pubkey: LIQUIDITY_VAULT, isSigner: false, isWritable: true },
            { pubkey: w.supplier, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([ixDisc("supply_usdg"), u64(amount)]),
        }));
      } else if (action === "withdrawSupply") {
        instructions.push(new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: false },
            { pubkey: LENDING_POOL, isSigner: false, isWritable: true },
            { pubkey: USDG_MINT, isSigner: false, isWritable: false },
            { pubkey: w.usdgAta, isSigner: false, isWritable: true },
            { pubkey: LIQUIDITY_VAULT, isSigner: false, isWritable: true },
            { pubkey: w.supplier, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([ixDisc("withdraw_supplied_usdg"), u64(amount)]),
        }));
      } else if (action === "deposit") {
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet, w.solxAta, wallet, solx.mint));
        instructions.push(new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: false },
            { pubkey: w.credit, isSigner: false, isWritable: true },
            { pubkey: solx.address, isSigner: false, isWritable: true },
            { pubkey: solx.mint, isSigner: false, isWritable: false },
            { pubkey: w.solxAta, isSigner: false, isWritable: true },
            { pubkey: w.solxVault, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([ixDisc("deposit_collateral"), u64(amount)]),
        }));
      } else if (action === "repay" || action === "repayMax") {
        instructions.push(new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: false },
            { pubkey: w.credit, isSigner: false, isWritable: true },
            { pubkey: LENDING_POOL, isSigner: false, isWritable: true },
            { pubkey: USDG_MINT, isSigner: false, isWritable: false },
            { pubkey: w.usdgAta, isSigner: false, isWritable: true },
            { pubkey: LIQUIDITY_VAULT, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: action === "repayMax" ? ixDisc("repay_usdg_max") : Buffer.concat([ixDisc("repay_usdg"), u64(amount)]),
        }));
      } else if (action === "withdrawCollateral") {
        const creditInfo = await connection.getAccountInfo(w.credit, "confirmed");
        const credit = decodeCredit(creditInfo ? Buffer.from(creditInfo.data) : null);
        if ((credit?.debt ?? 0n) > 0n) throw new Error("Repay the USDG debt before withdrawing collateral");
        instructions.push(new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: false },
            { pubkey: w.credit, isSigner: false, isWritable: true },
            { pubkey: LENDING_POOL, isSigner: false, isWritable: true },
            { pubkey: solx.address, isSigner: false, isWritable: true },
            { pubkey: solx.mint, isSigner: false, isWritable: false },
            { pubkey: w.solxAta, isSigner: false, isWritable: true },
            { pubkey: w.solxVault, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([ixDisc("withdraw_collateral"), u64(amount)]),
        }));
      } else {
        throw new Error("Unsupported 44 Milady action");
      }

      res.json(await legacyTransaction(connection, wallet, instructions));
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Unable to build 44 Milady transaction" });
    }
  });

  app.post("/api/v1/44-milady/build-borrow", async (req, res) => {
    try {
      const walletKey = new PublicKey(String(req.body.wallet || ""));
      const amount = parseSixDecimals(req.body.amount);
      const solx = await findSolxMarket(connection);
      const w = deriveWalletState(walletKey, solx.mint, solx.address);
      const creditInfo = await connection.getAccountInfo(w.credit, "confirmed");
      if (!creditInfo) throw new Error("Initialize your 44 Milady credit account first");

      const vaultAmount = await tokenBalance(connection, w.solxVault);
      if (vaultAmount <= 0n) throw new Error("Deposit SOLx collateral first");

      const pyth = await currentSolPrice();
      if (!pyth.configured || pyth.price == null || !pyth.updateData) {
        throw new Error("PYTH_API_KEY is not configured on the Mary Jane server");
      }

      const collateralValue = formatRaw(vaultAmount) * pyth.price;
      const maxBorrowRaw = BigInt(
        Math.floor(collateralValue * (solx.ltvBps / 10_000) * 1_000_000),
      );
      const credit = decodeCredit(Buffer.from(creditInfo.data));
      const currentDebt = credit?.debt ?? 0n;
      if (currentDebt + amount > maxBorrowRaw) {
        throw new Error("Borrow amount exceeds the current SOLx LTV limit");
      }

      res.json({
        updateData: pyth.updateData,
        feedId: SOL_FEED_ID,
        oraclePrice: pyth.price,
        collateralValue,
        maxBorrow: Number(maxBorrowRaw) / 1_000_000,
        amountBaseUnits: amount.toString(),
        accounts: {
          programId: PROGRAM_ID.toBase58(),
          protocol: PROTOCOL.toBase58(),
          credit: w.credit.toBase58(),
          lendingPool: LENDING_POOL.toBase58(),
          usdgMint: USDG_MINT.toBase58(),
          borrowerUsdgAccount: w.usdgAta.toBase58(),
          liquidityVault: LIQUIDITY_VAULT.toBase58(),
          solxMarket: solx.address.toBase58(),
        },
      });
    } catch (error: any) {
      res.status(400).json({
        error: error?.message || "Unable to prepare Pyth-backed borrow",
      });
    }
  });
}
